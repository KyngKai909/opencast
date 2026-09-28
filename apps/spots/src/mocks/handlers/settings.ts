// the business profile (getBusiness, updateBusiness, locations, the logo), the team (members,
// invites, resending, joining), notification prefs, connections, receipts, funding sources
// (remove, make default), closing the account. The Settings area owns this file.

import { http, HttpResponse, type HttpHandler } from "msw";
import { accountsApi, Me, notificationsApi, spotsApi, type Business, type Invite, type NotificationPrefs } from "@opencast/contracts";
import { ConnectionsX, BusinessSettingsX, settingsExtApi } from "../../api/ext/settings";
import { roleOn } from "../access";
import { balanceOf, dbBusiness, getDb, move, saveDb } from "../db";
import { LOGOS } from "../fixtures/businesses";
import { personByEmail, type MockPerson } from "../fixtures/people";
import {
  ALWAYS_ON,
  BUSINESS_KINDS,
  checkInvite,
  checkRemoveLocation,
  emailOf,
  inviteExpiry,
  isClosed,
  mockNow,
  nameOf,
  newId,
  pdfOf,
  prefsFor,
  receiptsFor,
  saveSettings,
  settingsState,
  type MockInvite
} from "../fixtures/settings";
import { MARKET } from "../fixtures/stations";
import { fail, needsUser, path, reply } from "../respond";

const OWNER_ONLY = "Only the owner can do that.";

/** The business, or the 404 for one that's gone. */
function business(id: string): Business | Response {
  const b = dbBusiness(id);
  if (!b || isClosed(id)) return fail(404, "not_found", "That business wasn't found.");
  return b;
}

function profile(b: Business) {
  return { ...b, logoMark: LOGOS[b.id], shortName: settingsState().shortNames[b.id] ?? null };
}

function badBody(message = "Check what you entered and try again.") {
  return fail(400, "bad_request", message);
}

async function bodyOf<T>(request: Request, schema: { safeParse(x: unknown): { success: true; data: T } | { success: false; error: { issues: { message: string; path: PropertyKey[] }[] } } }): Promise<T | Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badBody();
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    const first = r.error.issues[0];
    const field = String(first?.path[0] ?? "");
    const words: Record<string, string> = {
      website: "Enter the website's address, like orangestreet.example.",
      receiptsEmail: "Enter an email address.",
      email: "Enter an email address.",
      ein: "An EIN is nine digits, like 12-3456789.",
      name: "A business needs a name.",
      category: "Choose a category."
    };
    return badBody(words[field] ?? first?.message);
  }
  return r.data;
}

// ---- Team ----

function teamOf(businessId: string) {
  const db = getDb();
  const rank = { owner: 0, manager: 1, viewer: 2 } as const;
  const members = db.members
    .filter((m) => m.businessId === businessId)
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (a.m.role === "owner" ? 0 : 1) - (b.m.role === "owner" ? 0 : 1) || a.i - b.i || rank[a.m.role] - rank[b.m.role])
    .map(({ m }) => ({ userId: m.personId, displayName: nameOf(m.personId), email: emailOf(m.personId), role: m.role, note: m.note, lastInAt: m.lastInAt }));
  const invites: Invite[] = settingsState()
    .invites.filter((i) => i.businessId === businessId && i.acceptedAt === null)
    .map(({ businessId: _b, note: _n, ...i }) => i);
  return { members, invites };
}

function inviteOut(i: MockInvite): Invite {
  const { businessId: _b, note: _n, ...rest } = i;
  return rest;
}

function meOf(p: MockPerson) {
  const db = getDb();
  const memberships = db.members
    .filter((m) => m.personId === p.id && !isClosed(m.businessId))
    .map((m) => ({ kind: "business" as const, business: { id: m.businessId, name: db.businesses.find((b) => b.id === m.businessId)!.name }, role: m.role }));
  return {
    id: p.id,
    displayName: p.displayName,
    email: p.email,
    market: { ...MARKET, open: true },
    isAdmin: false,
    identities: [{ kind: "email" as const, value: p.email, verifiedAt: "2026-06-01T19:00:00.000Z" }],
    memberships,
    settings: {}
  };
}

export const settingsHandlers: HttpHandler[] = [
  // ---- The business ----

  http.get(path(spotsApi.getBusiness), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const b = business(id);
    if (b instanceof Response) return b;
    const r = roleOn(id, p, "see");
    if (r instanceof Response) return r;
    return reply(BusinessSettingsX, profile(b));
  }),

  http.patch(path(spotsApi.updateBusiness), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const b = business(id);
    if (b instanceof Response) return b;
    const body = await bodyOf(request, spotsApi.updateBusiness.body!);
    if (body instanceof Response) return body;
    // The profile is the owner's and managers'; money settings and tax details are the owner's.
    const money = ["autoTopUp", "receiptsEmail", "legalName", "ein"].some((k) => k in body);
    const r = roleOn(id, p, money ? "manage" : "advertise", money ? "Only the owner can change money settings and tax details." : "Viewers can't change the business.");
    if (r instanceof Response) return r;
    const { ein, ...rest } = body;
    Object.assign(b, rest);
    if (ein !== undefined) b.einLast4 = ein === null ? null : ein.replace(/\D/g, "").slice(-4);
    if (body.customersWhere === "online" && !b.marketIds.length) b.marketIds = [MARKET.id];
    saveDb();
    return reply(BusinessSettingsX, profile(b));
  }),

  http.post(path(spotsApi.addLocation), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const b = business(id);
    if (b instanceof Response) return b;
    const r = roleOn(id, p, "advertise", "Viewers can't change the business.");
    if (r instanceof Response) return r;
    const body = await bodyOf(request, spotsApi.addLocation.body!);
    if (body instanceof Response) return body;
    b.locations.push({
      id: newId(),
      kind: body.kind,
      label: body.label ?? null,
      streetAddress: body.streetAddress ?? null,
      city: body.city,
      latitude: body.latitude,
      longitude: body.longitude,
      radiusMiles: body.radiusMiles ?? null
    });
    saveDb();
    return reply(BusinessSettingsX, profile(b), 201);
  }),

  http.patch(path(settingsExtApi.updateLocation), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const b = business(id);
    if (b instanceof Response) return b;
    const r = roleOn(id, p, "advertise", "Viewers can't change the business.");
    if (r instanceof Response) return r;
    const loc = b.locations.find((l) => l.id === String(params.locationId));
    if (!loc) return fail(404, "not_found", "That location wasn't found.");
    const body = await bodyOf(request, settingsExtApi.updateLocation.body!);
    if (body instanceof Response) return body;
    Object.assign(loc, body);
    if (loc.kind === "location") loc.radiusMiles = null;
    saveDb();
    return reply(BusinessSettingsX, profile(b));
  }),

  http.delete(path(spotsApi.removeLocation), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const b = business(id);
    if (b instanceof Response) return b;
    const r = roleOn(id, p, "advertise", "Viewers can't change the business.");
    if (r instanceof Response) return r;
    const locationId = String(params.locationId);
    const check = checkRemoveLocation(
      b,
      locationId,
      getDb().spots.filter((s) => s.businessId === id)
    );
    if (!check.ok) return fail(409, "location_in_use", check.message);
    b.locations = b.locations.filter((l) => l.id !== locationId);
    saveDb();
    return reply(BusinessSettingsX, profile(b));
  }),

  http.post(path(settingsExtApi.uploadLogo), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const b = business(id);
    if (b instanceof Response) return b;
    const r = roleOn(id, p, "advertise", "Viewers can't change the business.");
    if (r instanceof Response) return r;
    const file = (await request.formData()).get("file");
    if (!(file instanceof Blob) || !file.type.startsWith("image/")) return badBody("Choose a PNG or JPEG image.");
    // Kept small for the mock's saved state: drawn at 256 pixels square.
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width !== bitmap.height || bitmap.width < 256) return fail(422, "logo_size", "The logo has to be square, at least 256 pixels.");
      const canvas = new OffscreenCanvas(256, 256);
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, 256, 256);
      const blob = await canvas.convertToBlob({ type: "image/png" });
      b.logoUrl = await new Promise<string>((done) => {
        const fr = new FileReader();
        fr.onload = () => done(String(fr.result));
        fr.readAsDataURL(blob);
      });
    } catch {
      return badBody("That image couldn't be read. Try a PNG or JPEG.");
    }
    saveDb();
    return reply(BusinessSettingsX, profile(b));
  }),

  // ---- The team ----

  http.get(path(accountsApi.getBusinessTeam), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const b = business(id);
    if (b instanceof Response) return b;
    const r = roleOn(id, p, "see");
    if (r instanceof Response) return r;
    return reply(accountsApi.getBusinessTeam.response, teamOf(id));
  }),

  http.post(path(accountsApi.inviteToBusiness), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const b = business(id);
    if (b instanceof Response) return b;
    const r = roleOn(id, p, "manage", "Only the owner can invite people.");
    if (r instanceof Response) return r;
    const body = await bodyOf(request, accountsApi.inviteToBusiness.body!);
    if (body instanceof Response) return body;
    if (!body.email) return badBody("Enter an email address.");
    const s = settingsState();
    const now = mockNow();
    const check = checkInvite(body.email, id, getDb().members, s.invites, now);
    if (!check.ok) return fail(check.status, check.code, check.message);
    if (check.replaces) s.invites = s.invites.filter((i) => i !== check.replaces);
    const invite: MockInvite = {
      id: newId(),
      businessId: id,
      email: body.email.trim().toLowerCase(),
      phone: null,
      role: body.role,
      note: body.note ?? null,
      createdAt: now.toISOString(),
      expiresAt: inviteExpiry(now),
      acceptedAt: null
    };
    s.invites.push(invite);
    saveSettings();
    return reply(accountsApi.inviteToBusiness.response, inviteOut(invite), 201);
  }),

  http.patch(path(accountsApi.updateBusinessMember), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const b = business(id);
    if (b instanceof Response) return b;
    const r = roleOn(id, p, "manage", "Only the owner changes the team.");
    if (r instanceof Response) return r;
    const body = await bodyOf(request, accountsApi.updateBusinessMember.body!);
    if (body instanceof Response) return body;
    const m = getDb().members.find((x) => x.businessId === id && x.personId === String(params.userId));
    if (!m) return fail(404, "not_found", "That person isn't on the team.");
    if (m.role === "owner") return fail(409, "owner", "The owner's role doesn't change here.");
    if (body.role) m.role = body.role;
    if (body.note !== undefined) m.note = body.note;
    saveDb();
    return reply(accountsApi.updateBusinessMember.response, teamOf(id));
  }),

  http.delete(path(accountsApi.removeBusinessMember), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const b = business(id);
    if (b instanceof Response) return b;
    const r = roleOn(id, p, "manage", "Only the owner changes the team.");
    if (r instanceof Response) return r;
    const db = getDb();
    const m = db.members.find((x) => x.businessId === id && x.personId === String(params.userId));
    if (!m) return fail(404, "not_found", "That person isn't on the team.");
    if (m.role === "owner") return fail(409, "owner", "The owner can't be removed.");
    db.members = db.members.filter((x) => x !== m);
    saveDb();
    return reply(accountsApi.removeBusinessMember.response, teamOf(id));
  }),

  http.post(path(accountsApi.resendInvite), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const invite = settingsState().invites.find((i) => i.id === String(params.inviteId));
    if (!invite || isClosed(invite.businessId)) return fail(404, "not_found", "That invite wasn't found.");
    const r = roleOn(invite.businessId, p, "manage", "Only the owner can invite people.");
    if (r instanceof Response) return r;
    if (invite.acceptedAt) return fail(409, "accepted", "They've already joined.");
    invite.expiresAt = inviteExpiry(mockNow());
    saveSettings();
    return reply(accountsApi.resendInvite.response, inviteOut(invite));
  }),

  http.post(path(accountsApi.acceptInvite), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const invite = settingsState().invites.find((i) => i.id === String(params.inviteId));
    if (!invite || isClosed(invite.businessId) || invite.email !== p.email) return fail(404, "not_found", "That invite wasn't found.");
    if (invite.acceptedAt) return fail(409, "accepted", "You've already joined.");
    const now = mockNow();
    if (Date.parse(invite.expiresAt) <= now.getTime()) return fail(410, "expired", "This invite has expired. Ask for a new one.");
    const db = getDb();
    if (!db.members.some((m) => m.businessId === invite.businessId && m.personId === p.id))
      db.members.push({ businessId: invite.businessId, personId: p.id, role: invite.role as "manager" | "viewer", note: invite.note, lastInAt: now.toISOString() });
    invite.acceptedAt = now.toISOString();
    if (!emailOf(p.id)) settingsState().joined[p.id] = p.email;
    saveDb();
    saveSettings();
    return reply(Me, meOf(personByEmail(p.email)));
  }),

  // ---- Notifications ----

  http.get(path(notificationsApi.getPrefs), ({ request }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const url = new URL(request.url);
    if (url.searchParams.get("scope") !== "business") return reply(notificationsApi.getPrefs.response, { prefs: {}, alwaysOn: [] });
    const id = url.searchParams.get("scopeId") ?? "";
    const r = roleOn(id, p, "see");
    if (r instanceof Response) return r;
    return reply(notificationsApi.getPrefs.response, { prefs: prefsFor(p.id, id, r.role), alwaysOn: [...ALWAYS_ON] });
  }),

  http.put(path(notificationsApi.setPrefs), async ({ request }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const body = await bodyOf(request, notificationsApi.setPrefs.body!);
    if (body instanceof Response) return body;
    if (body.scope !== "business" || !body.scopeId) return reply(notificationsApi.setPrefs.response, { prefs: body.prefs, alwaysOn: [] });
    const id = body.scopeId;
    // Everyone sets their own, viewers included.
    const r = roleOn(id, p, "see");
    if (r instanceof Response) return r;
    const s = settingsState();
    const key = `${p.id}:${id}`;
    const known = new Set<string>(BUSINESS_KINDS);
    const changes: NotificationPrefs = Object.fromEntries(Object.entries(body.prefs).filter(([k]) => known.has(k) && !(ALWAYS_ON as readonly string[]).includes(k)));
    s.prefs[key] = { ...(s.prefs[key] ?? {}), ...changes };
    saveSettings();
    return reply(notificationsApi.setPrefs.response, { prefs: prefsFor(p.id, id, r.role), alwaysOn: [...ALWAYS_ON] });
  }),

  // ---- Connections ----

  http.get(path(settingsExtApi.getConnections), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const b = business(id);
    if (b instanceof Response) return b;
    const r = roleOn(id, p, "see");
    if (r instanceof Response) return r;
    return reply(ConnectionsX, connectionsOf(id));
  }),

  http.post(path(settingsExtApi.connect), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const b = business(id);
    if (b instanceof Response) return b;
    const r = roleOn(id, p, "manage", "Only the owner can connect other services.");
    if (r instanceof Response) return r;
    const body = await bodyOf(request, settingsExtApi.connect.body!);
    if (body instanceof Response) return body;
    const s = settingsState();
    const c = (s.connections[id] ??= { clearPay: false, checkout: null });
    if (params.kind === "clear_pay") c.clearPay = true;
    else if (params.kind === "checkout") {
      if (!body.provider) return badBody("Choose Shopify, Stripe or Square.");
      c.checkout = body.provider;
    } else return fail(404, "not_found", "That connection wasn't found.");
    saveSettings();
    return reply(ConnectionsX, connectionsOf(id));
  }),

  // ---- Money and receipts ----

  http.get(path(settingsExtApi.listReceipts), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const b = business(id);
    if (b instanceof Response) return b;
    const r = roleOn(id, p, "see");
    if (r instanceof Response) return r;
    return reply(settingsExtApi.listReceipts.response, receiptsFor(id, getDb().movements[id] ?? [], settingsState().statements, mockNow()));
  }),

  // The receipts' documents.
  http.get("*/mock-media/receipts/:file", ({ params }) => {
    const rid = String(params.file).replace(/\.pdf$/, "");
    const db = getDb();
    for (const b of db.businesses) {
      const found = receiptsFor(b.id, db.movements[b.id] ?? [], settingsState().statements, mockNow()).find((x) => x.id === rid);
      if (!found) continue;
      const day = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "long", day: "numeric", year: "numeric" }).format(new Date(found.at));
      const kind = { prepayment: "Prepayment (money added to your balance, not an expense)", expense: "Expense", statement: "Monthly statement" }[found.kind];
      const lines = [
        `${b.name}: ${found.title}`,
        b.legalName ?? b.name,
        b.einLast4 ? `EIN ending ${b.einLast4}` : "",
        "",
        day,
        found.detail ?? "",
        `$${(found.amountMicros / 1e6).toFixed(2)}`,
        kind,
        "",
        "Opencast for business. A mock document."
      ];
      return new HttpResponse(pdfOf(lines), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${found.title.replace(/\W+/g, "-").toLowerCase()}.pdf"` } });
    }
    return new HttpResponse("Not found", { status: 404 });
  }),

  http.delete(path(settingsExtApi.removeFundingSource), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const b = business(id);
    if (b instanceof Response) return b;
    const r = roleOn(id, p, "manage", "Only the owner can change where money comes from.");
    if (r instanceof Response) return r;
    const bal = balanceOf(id);
    const src = bal.fundingSources.find((f) => f.id === String(params.sourceId));
    if (!src) return fail(404, "not_found", "That funding source wasn't found.");
    if (src.isDefault) return fail(409, "default_source", "That's your default. Make another one the default first.");
    bal.fundingSources = bal.fundingSources.filter((f) => f !== src);
    saveDb();
    return reply(settingsExtApi.removeFundingSource.response, bal.fundingSources);
  }),

  http.post(path(settingsExtApi.makeDefaultFundingSource), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const b = business(id);
    if (b instanceof Response) return b;
    const r = roleOn(id, p, "manage", "Only the owner can change where money comes from.");
    if (r instanceof Response) return r;
    const bal = balanceOf(id);
    if (!bal.fundingSources.some((f) => f.id === String(params.sourceId))) return fail(404, "not_found", "That funding source wasn't found.");
    for (const f of bal.fundingSources) f.isDefault = f.id === String(params.sourceId);
    saveDb();
    return reply(settingsExtApi.makeDefaultFundingSource.response, bal.fundingSources);
  }),

  // ---- Closing the account ----

  http.post(path(settingsExtApi.closeBusiness), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const b = business(id);
    if (b instanceof Response) return b;
    const r = roleOn(id, p, "manage", "Only the owner can close the account.");
    if (r instanceof Response) return r;
    const body = await bodyOf(request, settingsExtApi.closeBusiness.body!);
    if (body instanceof Response) return body;
    if (body.confirmName.trim().toLowerCase() !== b.name.toLowerCase()) return badBody(`Type ${b.name} to close it.`);
    const db = getDb();
    const bal = balanceOf(id);
    const returned = bal.availableMicros;
    const held = bal.heldMicros;
    if (returned > 0) {
      const to = bal.fundingSources.find((f) => f.isDefault)?.label ?? null;
      move(id, { kind: "withdrawn", label: "Returned on closing", amountMicros: -returned, detail: to });
    }
    for (const s of db.spots) if (s.businessId === id && s.state !== "ended") s.state = "ended";
    // Nobody is on its team any more: it leaves everyone's switcher.
    db.members = db.members.filter((m) => m.businessId !== id);
    const closedAt = mockNow().toISOString();
    const st = settingsState();
    st.closed[id] = closedAt;
    st.invites = st.invites.filter((i) => i.businessId !== id);
    saveDb();
    saveSettings();
    return reply(settingsExtApi.closeBusiness.response, { closedAt, returnedMicros: returned, heldMicros: held });
  })
];

function connectionsOf(id: string) {
  const c = settingsState().connections[id] ?? { clearPay: false, checkout: null };
  return {
    clearPay: { connected: c.clearPay },
    checkout: { connected: c.checkout !== null, provider: c.checkout }
  };
}
