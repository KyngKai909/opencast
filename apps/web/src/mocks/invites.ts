// Invite-only sign-ups in the one mock world (added 2026-10-07): who's in, and the codes. Everyone
// the mocks know is in, and so is any other address, except one at invite.example: that person
// signs in and waits for a code (`npm run dev:mock`, sign in as new@invite.example). The viewer's
// endpoints are in viewerInviteHandlers, the desk's in deskInviteHandlers.

import { http, type HttpHandler } from "msw";
import { invitesApi, type DeskInvites, type InviteCodeView, type MyInvites } from "@opencast/contracts";
import { isAdminNow } from "../desk/mocks/settingsDb";
import { meView } from "./me";
import type { MockPerson } from "./people";
import { fail, needsUser, path, personOf, reply } from "./respond";

interface Code {
  code: string;
  kind: "personal" | "internal";
  by: MockPerson | null;
  note: string | null;
  maxUses: number | null;
  joined: Array<{ name: string | null; at: string }>;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const ALLOWANCE = 10;
// Kept in localStorage so a reload keeps it ("oc-mock-invites"; remove it to start again).
const KEY = "oc-mock-invites";
interface Db {
  admitted: Record<string, { how: "code" | "desk"; code?: string }>;
  waiting: Record<string, MockPerson & { at: string }>;
  codes: Code[];
}
const fresh = (): Db => ({
  admitted: {},
  waiting: {},
  codes: [{ code: "OPEN2026", kind: "internal", by: null, note: "First batch", maxUses: null, joined: [], expiresAt: null, revokedAt: null, createdAt: "2026-10-07T17:00:00.000Z" }]
});
function load(): Db {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Db;
  } catch {
    // A fresh mock world.
  }
  return fresh();
}
function save(d: Db) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // Kept for this page only.
  }
}

const show = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;
const norm = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Whether the mock person is in. */
export function admittedNow(p: MockPerson): boolean {
  const db = load();
  if (!p.email.endsWith("@invite.example") || isAdminNow(p) || db.admitted[p.id]) return true;
  if (!db.waiting[p.id]) {
    db.waiting[p.id] = { ...p, at: new Date().toISOString() };
    save(db);
  }
  return false;
}

function view(c: Code): InviteCodeView {
  return { code: show(c.code), kind: c.kind, note: c.note, maxUses: c.maxUses, uses: c.joined.length, expiresAt: c.expiresAt, revokedAt: c.revokedAt, createdAt: c.createdAt, joined: [...c.joined].reverse() };
}

function mine(p: MockPerson): MyInvites {
  const db = load();
  const codes = db.codes.filter((c) => c.kind === "personal" && c.by?.id === p.id && !(c.revokedAt && !c.joined.length));
  return { inviteOnly: true, allowance: ALLOWANCE, left: Math.max(0, ALLOWANCE - codes.length), codes: codes.map(view).reverse() };
}

function desk(): DeskInvites {
  const db = load();
  const byHow = Object.values(db.admitted);
  const kindOf = (code?: string) => db.codes.find((c) => c.code === code)?.kind;
  return {
    inviteOnly: true,
    codesPerPerson: ALLOWANCE,
    internal: db.codes.filter((c) => c.kind === "internal").map(view).reverse(),
    waiting: Object.values(db.waiting).filter((w) => !db.admitted[w.id]).map((w) => ({ userId: w.id, name: w.displayName, email: w.email, signedUpAt: w.at })),
    counts: {
      admitted: 112 + byHow.length,
      byPersonalCode: byHow.filter((a) => a.how === "code" && kindOf(a.code) === "personal").length,
      byInternalCode: byHow.filter((a) => a.how === "code" && kindOf(a.code) === "internal").length,
      byTeamInvite: 0,
      byDesk: byHow.filter((a) => a.how === "desk").length,
      waiting: Object.keys(db.waiting).filter((id) => !db.admitted[id]).length,
      personalCodesMade: db.codes.filter((c) => c.kind === "personal").length
    },
    topInviters: []
  };
}

let next = 0;
function newCode(): string {
  const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  let n = 7919 * ++next + Date.now();
  for (let i = 0; i < 8; i++) {
    out += A[n % A.length];
    n = Math.floor(n / A.length) + 31 * (i + 3);
  }
  return out;
}

export const viewerInviteHandlers: HttpHandler[] = [
  http.get(path(invitesApi.check), ({ params }) => {
    const c = load().codes.find((x) => x.code === norm(String(params.code)));
    if (!c) return reply(invitesApi.check.response, { usable: false, reason: "unknown", from: null });
    const reason = c.revokedAt ? "revoked" : c.maxUses != null && c.joined.length >= c.maxUses ? "used" : null;
    return reply(invitesApi.check.response, { usable: !reason, reason, from: c.kind === "internal" ? "Opencast" : (c.by?.displayName ?? null) });
  }),
  http.post(path(invitesApi.redeem), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    if (!admittedNow(p)) {
      const db = load();
      const c = db.codes.find((x) => x.code === norm(String(params.code)));
      if (!c) return fail(404, "not_found", "That invite code isn't here.");
      if (c.revokedAt) return fail(409, "invite_revoked", "That invite code was taken back. Ask for another.");
      if (c.maxUses != null && c.joined.length >= c.maxUses) return fail(409, "invite_used", "That invite code has been used. Ask for another.");
      c.joined.push({ name: p.displayName, at: new Date().toISOString() });
      db.admitted[p.id] = { how: "code", code: c.code };
      save(db);
    }
    return reply(invitesApi.redeem.response, { ...meView(p), admitted: true });
  }),
  http.get(path(invitesApi.mine), ({ request }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    if (!admittedNow(p)) return fail(403, "invite_required", "Opencast is invite-only for now.");
    return reply(invitesApi.mine.response, mine(p));
  }),
  http.post(path(invitesApi.make), ({ request }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    if (mine(p).left <= 0) return fail(409, "no_invites_left", `You've made all ${ALLOWANCE} of your invite codes.`);
    const c: Code = { code: newCode(), kind: "personal", by: p, note: null, maxUses: 1, joined: [], expiresAt: null, revokedAt: null, createdAt: new Date().toISOString() };
    const db = load();
    db.codes.push(c);
    save(db);
    return reply(invitesApi.make.response, view(c), 201);
  }),
  http.delete(path(invitesApi.takeBack), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const db = load();
    const c = db.codes.find((x) => x.code === norm(String(params.code)) && x.by?.id === p.id);
    if (!c) return fail(404, "not_found", "That invite code isn't yours.");
    if (c.joined.length) return fail(409, "invite_used", "Someone already came in with that code.");
    c.revokedAt = new Date().toISOString();
    save(db);
    return reply(invitesApi.takeBack.response, mine(p));
  })
];

const adminOnly = (request: Request) => {
  const p = personOf(request);
  if (!p) return fail(401, "unauthorized", "Sign in to do that.");
  if (!isAdminNow(p)) return fail(403, "forbidden", "Only admins can do that.");
  return null;
};

export const deskInviteHandlers: HttpHandler[] = [
  http.get(path(invitesApi.desk), ({ request }) => adminOnly(request) ?? reply(invitesApi.desk.response, desk())),
  http.post(path(invitesApi.deskMake), async ({ request }) => {
    const no = adminOnly(request);
    if (no) return no;
    const body = (await request.json()) as { count: number; maxUses: number | null; note: string | null; expiresAt: string | null };
    const made = Array.from({ length: body.count }, (): Code => ({ code: newCode(), kind: "internal", by: personOf(request), note: body.note, maxUses: body.maxUses, joined: [], expiresAt: body.expiresAt, revokedAt: null, createdAt: new Date().toISOString() }));
    const db = load();
    db.codes.push(...made);
    save(db);
    return reply(invitesApi.deskMake.response, made.map(view), 201);
  }),
  http.delete(path(invitesApi.deskRevoke), ({ request, params }) => {
    const no = adminOnly(request);
    if (no) return no;
    const db = load();
    const c = db.codes.find((x) => x.code === norm(String(params.code)));
    if (!c) return fail(404, "not_found", "That invite code isn't here.");
    c.revokedAt ??= new Date().toISOString();
    save(db);
    return reply(invitesApi.deskRevoke.response, desk());
  }),
  http.post(path(invitesApi.letIn), async ({ request }) => {
    const no = adminOnly(request);
    if (no) return no;
    const { userId } = (await request.json()) as { userId: string };
    const db = load();
    if (!db.waiting[userId]) return fail(404, "not_found", "That person isn't waiting.");
    db.admitted[userId] = { how: "desk" };
    save(db);
    return reply(invitesApi.letIn.response, desk());
  })
];
