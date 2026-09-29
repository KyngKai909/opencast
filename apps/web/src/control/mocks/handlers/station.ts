// team (accounts), break rule, translators, claims (trust), notification prefs, claiming a station (network).
// The Station area owns this file.

import { http, type HttpHandler } from "msw";
import { accountsApi, networkApi, notificationsApi, stationsApi, trustApi, type BreakRule, type LogCode, type TeamMember } from "@opencast/contracts";
import { ClaimPageX, ClaimsX, ClaimX, InviteBodyX, stationExtApi } from "../../api/ext/station";
import { now } from "../../../lib/clock";
import { dbStation, getDb, membership, saveDb, stationLog } from "../db";
import { PEOPLE, type MockPerson } from "../fixtures/people";
import { ALWAYS_ON, DEAD_AIR_AT, defaultBreakRule, defaultPrefs, newId, saveStationState, stationState, type StationInvite } from "../fixtures/station";
import { fail, needsUser, path, personOf, reply } from "../respond";

const DAY = 86_400_000;
const WEEK = 7 * DAY;
/** How far ahead the switcher looks for dead air. */
const DEAD_AIR_LOOKAHEAD = 6 * 3600e3;

type Role = "owner" | "operator" | "host";

/** The person's role on the station, or the response to send instead. */
function roleOn(stationId: string, p: MockPerson, allowed: Role[], action: string): Role | Response {
  if (!dbStation(stationId)) return fail(404, "not_found", "That station wasn't found.");
  const m = membership(stationId, p.id);
  if (!m) return fail(403, "forbidden", "That station isn't one of yours.");
  if (!allowed.includes(m.role)) return fail(403, "forbidden", action);
  return m.role;
}

function callSignOf(stationId: string): string {
  const st = dbStation(stationId);
  return st?.ident.callSign ?? st?.ident.name ?? "the station";
}

// ---- team ----

function toInvite(i: StationInvite) {
  return { id: i.id, email: i.email, phone: i.phone, role: i.role, expiresAt: i.expiresAt, acceptedAt: i.acceptedAt, createdAt: i.createdAt };
}

function team(stationId: string, me: MockPerson) {
  const t = now().getTime();
  const members: TeamMember[] = getDb()
    .members.filter((m) => m.stationId === stationId)
    .map((m) => {
      const person = PEOPLE.find((x) => x.id === m.personId);
      return {
        userId: m.personId,
        displayName: person?.displayName ?? null,
        email: person?.email ?? null,
        role: m.role,
        note: m.hosts,
        // Whoever is looking is in master control right now.
        lastInAt: m.personId === me.id ? new Date(t).toISOString() : m.lastInAt
      };
    });
  const rank = { owner: 0, operator: 1, host: 2 } as Record<string, number>;
  members.sort((a, b) => (rank[a.role] ?? 3) - (rank[b.role] ?? 3));
  const invites = stationState()
    .invites.filter((i) => i.stationId === stationId && !i.acceptedAt)
    .map(toInvite);
  return { members, invites };
}

const OWNER_ONLY_TEAM = "Only the owner can change the team.";

const teamHandlers = [
  http.get(path(accountsApi.getStationTeam), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const r = roleOn(id, p, ["owner", "operator"], "Hosts don't see the team.");
    if (r instanceof Response) return r;
    return reply(accountsApi.getStationTeam.response, team(id, p));
  }),

  http.post(path(accountsApi.inviteToStation), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const r = roleOn(id, p, ["owner"], OWNER_ONLY_TEAM);
    if (r instanceof Response) return r;
    const parsed = InviteBodyX.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(400, "invalid", "Enter an email address or a phone number.");
    const body = parsed.data;
    const email = body.email?.trim().toLowerCase() ?? null;
    const phone = body.phone?.trim() || null;
    if (!email && !phone) return fail(400, "invalid", "Enter an email address or a phone number.");
    if (body.role === "host" && !body.programIds?.length) return fail(400, "invalid", "Choose the blocks they'll host.");
    const already = email && getDb().members.some((m) => m.stationId === id && PEOPLE.find((x) => x.id === m.personId)?.email === email);
    if (already) return fail(409, "already_member", `They're already on ${callSignOf(id)}'s team.`);
    const s = stationState();
    // Inviting the same address again replaces the waiting invite.
    s.invites = s.invites.filter((i) => !(i.stationId === id && !i.acceptedAt && ((email && i.email === email) || (phone && i.phone === phone))));
    const t = now().getTime();
    const invite: StationInvite = {
      id: newId(),
      stationId: id,
      email,
      phone,
      role: body.role,
      note: body.note ?? null,
      programIds: body.programIds ?? [],
      createdAt: new Date(t).toISOString(),
      expiresAt: new Date(t + WEEK).toISOString(),
      acceptedAt: null
    };
    s.invites.push(invite);
    saveStationState();
    return reply(accountsApi.inviteToStation.response, toInvite(invite), 201);
  }),

  http.patch(path(accountsApi.updateStationMember), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const r = roleOn(id, p, ["owner"], OWNER_ONLY_TEAM);
    if (r instanceof Response) return r;
    const m = membership(id, String(params.userId));
    if (!m) return fail(404, "not_found", "They aren't on the team.");
    if (m.role === "owner") return fail(409, "owner", "Ownership moves from the Ownership section.");
    const body = accountsApi.updateStationMember.body.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, "invalid", "That change can't be made.");
    if (body.data.role) {
      m.role = body.data.role;
      // An operator runs every block; a host needs blocks given again.
      if (m.role === "operator") m.hostProgramIds = [];
    }
    if (body.data.note !== undefined) m.hosts = body.data.note;
    saveDb();
    return reply(accountsApi.updateStationMember.response, team(id, p));
  }),

  http.delete(path(accountsApi.removeStationMember), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const r = roleOn(id, p, ["owner"], OWNER_ONLY_TEAM);
    if (r instanceof Response) return r;
    const m = membership(id, String(params.userId));
    if (!m) return fail(404, "not_found", "They aren't on the team.");
    if (m.role === "owner") return fail(409, "owner", "Transfer ownership before leaving the team.");
    const db = getDb();
    db.members = db.members.filter((x) => x !== m);
    saveDb();
    return reply(accountsApi.removeStationMember.response, team(id, p));
  }),

  http.post(path(accountsApi.transferStationOwnership), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const r = roleOn(id, p, ["owner"], "Only the owner can transfer the station.");
    if (r instanceof Response) return r;
    const body = accountsApi.transferStationOwnership.body.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, "invalid", "Choose someone on the team.");
    const to = membership(id, body.data.toUserId);
    if (!to || to.personId === p.id) return fail(400, "invalid", "Choose someone on the team.");
    const from = membership(id, p.id)!;
    from.role = "operator";
    to.role = "owner";
    to.hostProgramIds = [];
    saveDb();
    return reply(accountsApi.transferStationOwnership.response, team(id, p));
  }),

  http.post(path(accountsApi.resendInvite), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const invite = stationState().invites.find((i) => i.id === String(params.inviteId));
    if (!invite) return fail(404, "not_found", "That invite wasn't found.");
    const r = roleOn(invite.stationId, p, ["owner"], OWNER_ONLY_TEAM);
    if (r instanceof Response) return r;
    invite.expiresAt = new Date(now().getTime() + WEEK).toISOString();
    saveStationState();
    return reply(accountsApi.resendInvite.response, toInvite(invite));
  })
];

// ---- the switcher's status (A5) ----

/** When dead air next starts on a station, within the lookahead, or null. */
export function nextDeadAir(stationId: string, at: Date = now()): string | null {
  const from = at.toISOString();
  const to = new Date(at.getTime() + DEAD_AIR_LOOKAHEAD).toISOString();
  const fixed = DEAD_AIR_AT[stationId];
  if (fixed) return fixed > from && fixed < to ? fixed : null;
  // Only a station whose log the mock keeps can say where its gaps are.
  const log = stationLog(stationId, from, to);
  if (!stationLog(stationId).length) return null;
  return firstGap(log, from, to);
}

/** The first moment from `from` that nothing on the log covers (short joins between entries don't count). */
export function firstGap(entries: { startsAt: string; endsAt: string }[], from: string, to: string): string | null {
  const TOLERANCE = 5 * 60_000;
  let cursor = from;
  for (const e of [...entries].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    if (Date.parse(e.startsAt) - Date.parse(cursor) >= TOLERANCE) return cursor;
    if (e.endsAt > cursor) cursor = e.endsAt;
  }
  return cursor < to ? cursor : null;
}

const statusHandlers = [
  http.get(path(stationExtApi.myStationStatus), ({ request }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const db = getDb();
    const rows = db.members
      .filter((m) => m.personId === p.id)
      .map((m) => {
        const st = dbStation(m.stationId);
        const studio = st?.ident.kind === "studio";
        return { stationId: m.stationId, onAir: !!st?.onAir && !studio, deadAirAt: studio || !st?.onAir ? null : nextDeadAir(m.stationId) };
      });
    return reply(stationExtApi.myStationStatus.response, rows);
  })
];

// ---- break rule ----

/** The station ID always closes a break; everything else keeps its order (station-settings 02.1). */
export function normaliseFillOrder(order: LogCode[]): LogCode[] {
  const rest = order.filter((c, i) => c !== "SID" && c !== "PGM" && c !== "OPEN" && order.indexOf(c) === i);
  return [...rest, "SID"];
}

function breakRuleOf(stationId: string): BreakRule {
  return stationState().breakRules[stationId] ?? defaultBreakRule();
}

const breakHandlers = [
  http.get(path(stationsApi.getBreakRule), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const r = roleOn(id, p, ["owner", "operator"], "Hosts don't set the break rule.");
    if (r instanceof Response) return r;
    return reply(stationsApi.getBreakRule.response, breakRuleOf(id));
  }),

  http.put(path(stationsApi.setBreakRule), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const r = roleOn(id, p, ["owner", "operator"], "Hosts don't set the break rule.");
    if (r instanceof Response) return r;
    const body = stationsApi.setBreakRule.body.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, "invalid", "That break rule can't be saved.");
    const rule = { ...body.data, fillOrder: normaliseFillOrder(body.data.fillOrder) };
    if (rule.mode === "every_n_minutes" && !rule.everyMinutes) return fail(400, "invalid", "Say how often breaks come.");
    if (rule.mode !== "every_n_minutes") rule.everyMinutes = null;
    stationState().breakRules[id] = rule;
    saveStationState();
    return reply(stationsApi.setBreakRule.response, rule);
  })
];

// ---- translators ----

const translatorHandlers = [
  http.get(path(stationsApi.listTranslators), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const r = roleOn(id, p, ["owner", "operator"], "Hosts don't manage translators.");
    if (r instanceof Response) return r;
    // A connected translator relays while the station is on air (A.7: "YouTube, Relaying").
    const onAir = !!dbStation(id)?.onAir;
    const list = (stationState().translators[id] ?? []).map((t) => (onAir && t.enabled && t.status === "connected" ? { ...t, status: "relaying" as const } : t));
    return reply(stationsApi.listTranslators.response, list);
  }),

  http.post(path(stationsApi.addTranslator), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const r = roleOn(id, p, ["owner", "operator"], "Hosts don't manage translators.");
    if (r instanceof Response) return r;
    const body = stationsApi.addTranslator.body.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      const bad = body.error.issues[0]?.path[0];
      return fail(400, "invalid", bad === "rtmpUrl" ? "The address starts with rtmp:// or rtmps://." : bad === "streamKey" ? "Paste the stream key." : "Give it a name.");
    }
    const s = stationState();
    const t = {
      id: newId(),
      service: body.data.service,
      name: body.data.name,
      rtmpUrl: body.data.rtmpUrl,
      hasStreamKey: true,
      breakHandling: body.data.breakHandling,
      prerecordedLabel: body.data.prerecordedLabel,
      enabled: true,
      // The key is checked when it first relays; the mock takes it as good.
      status: "connected" as const
    };
    s.translators[id] = [...(s.translators[id] ?? []), t];
    saveStationState();
    return reply(stationsApi.addTranslator.response, t, 201);
  }),

  http.patch(path(stationsApi.updateTranslator), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const r = roleOn(id, p, ["owner", "operator"], "Hosts don't manage translators.");
    if (r instanceof Response) return r;
    const t = (stationState().translators[id] ?? []).find((x) => x.id === String(params.translatorId));
    if (!t) return fail(404, "not_found", "That translator wasn't found.");
    const body = stationsApi.updateTranslator.body.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, "invalid", "That change can't be made.");
    const { streamKey, ...rest } = body.data;
    Object.assign(t, rest, streamKey ? { hasStreamKey: true } : {});
    saveStationState();
    return reply(stationsApi.updateTranslator.response, t);
  }),

  http.delete(path(stationsApi.removeTranslator), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const r = roleOn(id, p, ["owner", "operator"], "Hosts don't manage translators.");
    if (r instanceof Response) return r;
    const s = stationState();
    s.translators[id] = (s.translators[id] ?? []).filter((x) => x.id !== String(params.translatorId));
    saveStationState();
    return reply(stationsApi.removeTranslator.response, { ok: true });
  })
];

// ---- rights claims (trust) ----

/** Whole days left to answer, counting a part day as a day ("9 days to answer"). */
export function daysLeft(dueAt: string, at: Date = now()): number {
  return Math.max(0, Math.ceil((Date.parse(dueAt) - at.getTime()) / DAY));
}

function withDays(c: ClaimX): ClaimX {
  return { ...c, daysToAnswer: c.state === "open" ? daysLeft(c.answerDueAt) : null };
}

export function standingOf(claims: ClaimX[], at: Date = now()) {
  const yearAgo = at.getTime() - 365 * DAY;
  const upheld = claims.filter((c) => c.state === "upheld" && Date.parse(c.receivedAt) >= yearAgo).length;
  const threshold = 3;
  return { status: upheld >= threshold ? ("offers_paused" as const) : ("good" as const), openClaims: claims.filter((c) => c.state === "open").length, upheldLast12Months: upheld, threshold };
}

function claimFor(request: Request, claimId: string, allowed: Role[], action: string): { claim: ClaimX } | Response {
  const p = needsUser(request);
  if (p instanceof Response) return p;
  const claim = stationState().claims.find((c) => c.id === claimId);
  if (!claim) return fail(404, "not_found", "That claim wasn't found.");
  const r = roleOn(claim.station.id, p, allowed, action);
  if (r instanceof Response) return r;
  return { claim };
}

const trustHandlers = [
  http.get(path(trustApi.listClaims), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const r = roleOn(id, p, ["owner", "operator"], "Hosts don't see rights claims.");
    if (r instanceof Response) return r;
    const claims = stationState()
      .claims.filter((c) => c.station.id === id)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .map(withDays);
    return reply(ClaimsX, { claims, standing: standingOf(claims) });
  }),

  http.post(path(stationExtApi.attachToClaim), async ({ request, params }) => {
    const found = claimFor(request, String(params.claimId), ["owner"], "Only the owner can answer a claim.");
    if (found instanceof Response) return found;
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") return fail(400, "invalid", "Choose the file to attach.");
    const name = (file as File).name || "attachment";
    return reply(stationExtApi.attachToClaim.response, { attachmentUrl: `https://files.opencast.example/claims/${found.claim.id}/${encodeURIComponent(name)}`, fileName: name }, 201);
  }),

  http.post(path(trustApi.answerClaim), async ({ request, params }) => {
    const found = claimFor(request, String(params.claimId), ["owner"], "Only the owner can answer a claim.");
    if (found instanceof Response) return found;
    const { claim } = found;
    if (claim.state !== "open") return fail(409, "not_open", "This claim has already been answered or closed.");
    const body = trustApi.answerClaim.body.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, "invalid", "Choose which is true, and tick the statement.");
    if (body.data.basis === "owner_permission" && !body.data.attachmentUrl) return fail(400, "invalid", "Attach the permission or licence.");
    const t = now();
    claim.state = "answered";
    claim.answer = {
      basis: body.data.basis,
      note: body.data.note?.trim() || null,
      attachmentUrl: body.data.attachmentUrl ?? null,
      answeredAt: t.toISOString(),
      // 10 business days: two weeks from a weekday.
      claimantReplyDueAt: new Date(t.getTime() + 14 * DAY).toISOString()
    };
    // Answered, it airs again from its next scheduled airing.
    claim.takedowns = claim.takedowns.map((d) => ({ ...d, restoredAt: t.toISOString() }));
    saveStationState();
    return reply(ClaimX, withDays(claim));
  }),

  http.post(path(trustApi.removeClaimedItem), ({ request, params }) => {
    const found = claimFor(request, String(params.claimId), ["owner", "operator"], "Hosts don't handle rights claims.");
    if (found instanceof Response) return found;
    const { claim } = found;
    if (claim.state !== "open") return fail(409, "not_open", "This claim has already been answered or closed.");
    claim.state = "removed";
    // It leaves the library and every log it was on.
    const db = getDb();
    db.library.items = db.library.items.filter((i) => i.id !== claim.item.id);
    db.log = db.log.filter((e) => e.itemId !== claim.item.id);
    saveDb();
    saveStationState();
    return reply(ClaimX, withDays(claim));
  })
];

// ---- notification settings ----

const notificationHandlers = [
  http.get(path(notificationsApi.getPrefs), ({ request }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope");
    const scopeId = url.searchParams.get("scopeId");
    if (scope !== "station" || !scopeId) return fail(400, "invalid", "Master control keeps station notifications only.");
    if (!membership(scopeId, p.id)) return fail(403, "forbidden", "That station isn't one of yours.");
    const prefs = stationState().prefs[`${p.id}:${scopeId}`] ?? defaultPrefs();
    return reply(notificationsApi.getPrefs.response, { prefs, alwaysOn: [...ALWAYS_ON] });
  }),

  http.put(path(notificationsApi.setPrefs), async ({ request }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const body = notificationsApi.setPrefs.body.safeParse(await request.json().catch(() => null));
    if (!body.success || body.data.scope !== "station" || !body.data.scopeId) return fail(400, "invalid", "That setting can't be saved.");
    const scopeId = body.data.scopeId;
    if (!membership(scopeId, p.id)) return fail(403, "forbidden", "That station isn't one of yours.");
    const key = `${p.id}:${scopeId}`;
    const s = stationState();
    const prefs = { ...(s.prefs[key] ?? defaultPrefs()), ...body.data.prefs };
    // Always-on kinds stay on.
    for (const k of ALWAYS_ON) prefs[k] = { push: true, email: prefs[k]?.email ?? false };
    s.prefs[key] = prefs;
    saveStationState();
    return reply(notificationsApi.setPrefs.response, { prefs, alwaysOn: [...ALWAYS_ON] });
  })
];

// ---- claiming a station (network) ----

/** The mock's network desk checks a claimant a few seconds after they connect their account. */
const DESK_CHECK_MS = 4000;
const WAIT_MS = 72 * 3600e3;

function advance() {
  const t = Date.now();
  for (const h of stationState().handovers) {
    if (h.status === "verifying" && t - h.startedAtMs >= DESK_CHECK_MS) {
      h.status = h.kind === "stop" ? "approved" : "waiting_period";
      h.payableAfter = h.kind === "stop" ? null : new Date(now().getTime() + WAIT_MS).toISOString();
      saveStationState();
    }
  }
}

const networkHandlers = [
  http.get(path(stationExtApi.getClaimPage), ({ params }) => {
    const tok = stationState().claimTokens.find((c) => c.token === String(params.token));
    if (!tok) return fail(404, "not_found", "This claim link isn't right. Check it against the email we sent.");
    const st = dbStation(tok.stationId);
    if (!st) return fail(404, "not_found", "This claim link isn't right. Check it against the email we sent.");
    advance();
    const h = [...stationState().handovers].reverse().find((x) => x.stationId === tok.stationId && x.status !== "cancelled");
    return reply(ClaimPageX, {
      station: st.ident,
      ...tok.page,
      handover: h ? { handoverId: h.handoverId, kind: h.kind, status: h.status, payableAfter: h.payableAfter } : null
    });
  }),

  http.post(path(networkApi.startHandover), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const tok = stationState().claimTokens.find((c) => c.stationId === id);
    if (!tok) return fail(404, "not_found", "That station can't be claimed.");
    if (tok.personEmail !== p.email) return fail(403, "forbidden", `This station is waiting for ${tok.page.personName}. Sign in as them to claim it.`);
    const body = networkApi.startHandover.body.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, "invalid", "Connect the account your work comes from.");
    const s = stationState();
    const open = s.handovers.find((h) => h.stationId === id && h.status !== "cancelled" && h.status !== "completed");
    // Asking to stop replaces a claim in progress.
    if (open && open.kind === body.data.kind) return reply(networkApi.startHandover.response, { handoverId: open.handoverId, status: open.status, payableAfter: open.payableAfter }, 201);
    if (open) open.status = "cancelled";
    const h = { handoverId: newId(), stationId: id, personId: p.id, kind: body.data.kind, status: "verifying" as const, payableAfter: null, startedAtMs: Date.now() };
    s.handovers.push(h);
    saveStationState();
    return reply(networkApi.startHandover.response, { handoverId: h.handoverId, status: h.status, payableAfter: null }, 201);
  }),

  http.post(path(networkApi.approveHandover), ({ request, params }) => {
    const p = personOf(request);
    if (!p) return fail(401, "unauthorized", "Sign in to do that.");
    const h = stationState().handovers.find((x) => x.handoverId === String(params.handoverId));
    if (!h) return fail(404, "not_found", "That handover wasn't found.");
    h.status = h.kind === "stop" ? "approved" : "waiting_period";
    h.payableAfter = new Date(now().getTime() + WAIT_MS).toISOString();
    saveStationState();
    return reply(networkApi.approveHandover.response, { handoverId: h.handoverId, payableAfter: h.payableAfter, onChain: null });
  })
];

export const stationHandlers: HttpHandler[] = [...teamHandlers, ...statusHandlers, ...breakHandlers, ...translatorHandlers, ...trustHandlers, ...notificationHandlers, ...networkHandlers];
