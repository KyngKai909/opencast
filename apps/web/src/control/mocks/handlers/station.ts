// team (accounts), break rule, translators, claims (trust), notification prefs, claiming a station (network).
// The Station area owns this file.

import { http, type HttpHandler } from "msw";
import { accountsApi, Me, networkApi, notificationsApi, stationsApi, trustApi, type BreakRule, type InvitePreview, type LogCode, type TeamMember } from "@opencast/contracts";
import { ClaimsX, ClaimX } from "../../api/ext/station";
import { now } from "../../../lib/clock";
import { dbStation, getDb, membership, saveDb, stationLog } from "../db";
import { PEOPLE, type MockPerson } from "../fixtures/people";
import { ALWAYS_ON, DEAD_AIR_AT, breakRuleOf, defaultPrefs, newId, saveStationState, stationState, type StationInvite } from "../fixtures/station";
import { fail, needsUser, path, personOf, reply } from "../respond";
import { meView } from "../../../mocks/me";
import { offAirFor } from "../schedule";

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
  return { id: i.id, email: i.email, phone: i.phone, role: i.role, expiresAt: i.expiresAt, acceptedAt: i.acceptedAt, createdAt: i.createdAt, ...(i.role === "host" ? { programIds: i.programIds } : {}) };
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
        // A4: a host's live programs.
        ...(m.role === "host" ? { programIds: m.hostProgramIds ?? [] } : {}),
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
/** An invite's email goes again at most this often (the API's rule). */
const RESEND_GAP_MS = 10 * 60_000;

/** An invited address as the invite's page shows it: `d…@example.com`. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf("@");
  return at <= 0 ? "…" : `${address.slice(0, 1)}…${address.slice(at)}`;
}

/** An invite as its page shows it (getInvite), for whoever's asking. */
function invitePreview(i: StationInvite, p: MockPerson | null): InvitePreview {
  const st = dbStation(i.stationId);
  const owner = getDb().members.find((m) => m.stationId === i.stationId && m.role === "owner");
  return {
    id: i.id,
    team: { kind: "station", id: i.stationId, name: st?.ident.name ?? "A station", callSign: st?.ident.callSign ?? null },
    role: i.role,
    invitedBy: PEOPLE.find((x) => x.id === owner?.personId)?.displayName ?? null,
    emailHint: i.email ? maskEmail(i.email) : null,
    state: i.acceptedAt ? "accepted" : Date.parse(i.expiresAt) <= now().getTime() ? "expired" : "open",
    expiresAt: i.expiresAt,
    signedInAs: p?.email ?? null,
    emailMatches: p && i.email ? i.email === p.email : null,
    acceptedByYou: !!p && i.acceptedBy === p.id
  };
}

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
    const parsed = accountsApi.inviteToStation.body.safeParse(await request.json().catch(() => null));
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
    if (invite.acceptedAt) return fail(409, "invite_used", "They've already joined.");
    // Every send sets the expiry a week out, so the last send was a week before it.
    const lastSent = Date.parse(invite.expiresAt) - WEEK;
    const wait = lastSent + RESEND_GAP_MS - now().getTime();
    if (wait > 0) {
      const ago = Math.max(0, Math.floor((now().getTime() - lastSent) / 60_000));
      const left = Math.ceil(wait / 60_000);
      return fail(429, "resend_too_soon", `It went out ${ago === 0 ? "less than a minute" : `${ago} minute${ago === 1 ? "" : "s"}`} ago. You can send it again in ${left} minute${left === 1 ? "" : "s"}.`);
    }
    invite.expiresAt = new Date(now().getTime() + WEEK).toISOString();
    saveStationState();
    return reply(accountsApi.resendInvite.response, toInvite(invite));
  }),

  // An invite's page (/control/invites/:inviteId): anyone with the link reads it.
  http.get(path(accountsApi.getInvite), ({ request, params }) => {
    const invite = stationState().invites.find((i) => i.id === String(params.inviteId));
    if (!invite) return fail(404, "not_found", "That invite wasn't found.");
    return reply(accountsApi.getInvite.response, invitePreview(invite, personOf(request)));
  }),

  // Joining: the invited email must be the signed-in person's.
  http.post(path(accountsApi.acceptInvite), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const invite = stationState().invites.find((i) => i.id === String(params.inviteId));
    if (!invite) return fail(404, "not_found", "That invite wasn't found.");
    if (invite.acceptedAt) {
      if (invite.acceptedBy === p.id) return reply(Me, meView(p));
      return fail(409, "invite_used", "This invite was already used. Ask for a new one if you still need to join.");
    }
    if (Date.parse(invite.expiresAt) <= now().getTime()) return fail(422, "invite_expired", "This invite has expired. Ask for a new one.");
    if (invite.email && invite.email !== p.email)
      return fail(403, "invite_email_mismatch", `This invite is for ${maskEmail(invite.email)}; you're signed in as ${p.email}. Sign in with ${maskEmail(invite.email)} to join.`);
    if (!membership(invite.stationId, p.id))
      getDb().members.push({ stationId: invite.stationId, personId: p.id, role: invite.role as Role, hosts: null, hostProgramIds: invite.role === "host" ? invite.programIds : [], lastInAt: now().toISOString() });
    invite.acceptedAt = now().toISOString();
    invite.acceptedBy = p.id;
    saveDb();
    saveStationState();
    return reply(Me, meView(p));
  })
];

// ---- the switcher's status (A5) ----

/** When dead air next starts on a station, within the lookahead, or null. */
export function nextDeadAir(stationId: string, at: Date = now()): string | null {
  const from = at.toISOString();
  const to = new Date(at.getTime() + DEAD_AIR_LOOKAHEAD).toISOString();
  const fixed = DEAD_AIR_AT[stationId];
  if (fixed) return fixed > from && fixed < to ? fixed : null;
  // Only a station whose log the mock keeps can say where its gaps are. Planned off air isn't dead air.
  const log = [...stationLog(stationId, from, to), ...offAirFor(stationId, from, to)];
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
  http.get(path(accountsApi.myStationStatus), ({ request }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const db = getDb();
    const rows = db.members
      .filter((m) => m.personId === p.id)
      .map((m) => {
        const st = dbStation(m.stationId);
        const studio = st?.ident.kind === "studio";
        const deadAirAt = studio || !st?.onAir ? null : nextDeadAir(m.stationId);
        // How long it lasts: until the next thing on the log, when the mock keeps one.
        const ahead = deadAirAt ? [...stationLog(m.stationId), ...offAirFor(m.stationId, deadAirAt, new Date(Date.parse(deadAirAt) + DAY).toISOString())].sort((a, b) => a.startsAt.localeCompare(b.startsAt)) : [];
        const deadAirEndsAt = deadAirAt ? (ahead.find((e) => e.startsAt > deadAirAt)?.startsAt ?? null) : null;
        return { stationId: m.stationId, onAir: !!st?.onAir && !studio, deadAirAt, deadAirEndsAt };
      });
    return reply(accountsApi.myStationStatus.response, rows);
  })
];

// ---- break rule ----

/** The station ID always closes a break; everything else keeps its order (station-settings 02.1). */
export function normaliseFillOrder(order: LogCode[]): LogCode[] {
  const rest = order.filter((c, i) => c !== "SID" && c !== "PGM" && c !== "OPEN" && order.indexOf(c) === i);
  return [...rest, "SID"];
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
    // Left out, the cadence stays as it was (added 2026-09-29), and so do spots when only they are.
    const before = breakRuleOf(id);
    const was = before.cadence;
    let cadence = body.data.cadence ? { ...body.data.cadence, spots: body.data.cadence.spots ?? was?.spots } : was;
    // A243, as the API: the sequences stay when left out, except that a body from before them that
    // changes how often bumpers air changes the opening and closing ones; sent, the bumpers' cadence
    // follows the opening one.
    let bumperSequences = body.data.bumperSequences ?? before.bumperSequences;
    if (body.data.bumperSequences) {
      const twice = (["open", "close", "between"] as const).find((p) => new Set(body.data.bumperSequences![p].roles).size !== body.data.bumperSequences![p].roles.length);
      if (twice) return fail(400, "bad_request", "Each bumper role can be in a position once.");
      const open = body.data.bumperSequences.open;
      if (cadence) cadence = { ...cadence, bumpers: open.every === "n_programs" ? { every: open.every, n: open.n } : { every: open.every } };
    } else if (body.data.cadence && bumperSequences && JSON.stringify(body.data.cadence.bumpers) !== JSON.stringify(was?.bumpers)) {
      const every = body.data.cadence.bumpers;
      bumperSequences = { ...bumperSequences, open: { ...bumperSequences.open, ...every }, close: { ...bumperSequences.close, ...every } };
    }
    const rule: BreakRule = { ...body.data, fillOrder: normaliseFillOrder(body.data.fillOrder), cadence, bumperSequences };
    if (rule.mode === "every_n_minutes" && !rule.everyMinutes) return fail(400, "invalid", "Say how often breaks come.");
    if (rule.cadence && Object.values(rule.cadence).some((c) => c.every === "n_programs" && !c.n)) return fail(400, "bad_request", "Say after how many programs.");
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

  http.post(path(trustApi.attachToClaim), async ({ request, params }) => {
    const found = claimFor(request, String(params.claimId), ["owner"], "Only the owner can answer a claim.");
    if (found instanceof Response) return found;
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") return fail(400, "invalid", "Choose the file to attach.");
    const name = (file as File).name || "attachment";
    return reply(trustApi.attachToClaim.response, { attachmentUrl: `https://files.opencast.example/claims/${found.claim.id}/${encodeURIComponent(name)}`, fileName: name }, 201);
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
  http.get(path(networkApi.getClaimPage), ({ params }) => {
    const tok = stationState().claimTokens.find((c) => c.token === String(params.token));
    if (!tok) return fail(404, "not_found", "This claim link isn't right. Check it against the email we sent.");
    const st = dbStation(tok.stationId);
    if (!st) return fail(404, "not_found", "This claim link isn't right. Check it against the email we sent.");
    advance();
    const h = [...stationState().handovers].reverse().find((x) => x.stationId === tok.stationId && x.status !== "cancelled");
    return reply(networkApi.getClaimPage.response, {
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
