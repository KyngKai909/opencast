// Mock mode only: the other side of the desk's flows, so a creator can be taken from found to
// claimed on mocks. The creator answers (as the permission page would), a sign-on time comes, the
// creator claims, the verifiers approve and the 72 hours pass. Not part of the API.
import { http, HttpResponse, type HttpHandler } from "msw";
import { permissionLink } from "./permission";
import { now } from "../../../lib/clock";
import { advance, creatorById, getDb, newId, resetDb, saveDb, stationById, worksOf } from "../db";
import { resetSettings } from "../settingsDb";
import { resetSponsors } from "../sponsorsDb";
import { resetStorage } from "../storageDb";
import { resetClaims } from "../claimsDb";
import { bodyOf, fail, needsAdmin } from "../respond";

export const MOCK_BASE = "*/v1/__mock/desk";

function latestRequest(creatorId: string) {
  return getDb()
    .requests.filter((r) => r.creatorId === creatorId)
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];
}

export const mockHandlers: HttpHandler[] = [
  http.get(`${MOCK_BASE}/creators/:creatorId/link`, ({ request, params }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const r = latestRequest(String(params.creatorId));
    return r ? HttpResponse.json({ link: permissionLink(r.token), answered: !!r.answer }) : fail(404, "not_found", "Nothing was sent to them yet.");
  }),

  http.post(`${MOCK_BASE}/creators/:creatorId/answer`, async ({ request, params }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const c = creatorById(String(params.creatorId));
    const r = c && latestRequest(c.id);
    if (!c || !r) return fail(404, "not_found", "Nothing was sent to them yet.");
    if (r.answer) return fail(422, "already_answered", "This has been answered. Write to us to change it.");
    const answer = (await bodyOf<{ answer?: string }>(request))?.answer === "no" ? "no" : "yes";
    const at = now().toISOString();
    r.answer = { answer, answeredAt: at, workIds: answer === "yes" ? worksOf(c.id).filter((w) => !w.leftOutReason).map((w) => w.id) : [] };
    c.answeredAt = at;
    if (answer === "yes") Object.assign(c, { stage: "said_yes", nextAction: "Set up", nextActionDue: null });
    else Object.assign(c, { stage: "declined", doNotAsk: true, nextAction: null, nextActionDue: null });
    saveDb();
    return HttpResponse.json({ ok: true });
  }),

  http.post(`${MOCK_BASE}/creators/:creatorId/sign-on`, ({ request, params }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const c = creatorById(String(params.creatorId));
    const s = stationById(c?.stationId);
    if (!c || !s) return fail(404, "not_found", "That creator has no station yet.");
    s.signOnAt = now().toISOString();
    saveDb();
    advance(new Date(now().getTime() + 1000));
    return HttpResponse.json({ ok: true });
  }),

  http.post(`${MOCK_BASE}/creators/:creatorId/claim`, ({ request, params }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const c = creatorById(String(params.creatorId));
    const s = stationById(c?.stationId);
    if (!c || !s || s.ident.kind !== "claimable") return fail(404, "not_found", "That creator has no claimable station.");
    const d = getDb();
    if (d.handovers.some((h) => h.stationId === s.ident.id && !h.completedAt)) return fail(422, "in_progress", "A claim for this station is already in progress.");
    d.handovers.push({ id: newId(), stationId: s.ident.id, kind: "claim", startedAt: now().toISOString(), completedAt: null });
    saveDb();
    return HttpResponse.json({ ok: true });
  }),

  http.post(`${MOCK_BASE}/creators/:creatorId/claim-complete`, ({ request, params }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const c = creatorById(String(params.creatorId));
    const s = stationById(c?.stationId);
    const d = getDb();
    const h = s && d.handovers.find((x) => x.stationId === s.ident.id && !x.completedAt);
    if (!c || !s || !h) return fail(404, "not_found", "No claim is waiting.");
    h.completedAt = now().toISOString();
    // Paid to the creator's wallet; the station is theirs, an ordinary station now.
    d.balances[s.ident.id] = { heldMicros: 0, owedMicros: 0 };
    s.ident.kind = "station";
    Object.assign(c, { stage: "claimed", claimedAt: h.completedAt, nextAction: null, nextActionDue: null });
    saveDb();
    return HttpResponse.json({ ok: true });
  }),

  http.post(`${MOCK_BASE}/reset`, ({ request }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    resetDb();
    resetSettings();
    resetSponsors();
    resetStorage();
    resetClaims();
    return HttpResponse.json({ ok: true });
  })
];
