// ledger (station earnings, statements, payout account, moving money to the bank), audience, and
// the held earnings of claimable stations. The Earnings area owns this file.
//
// Who sees what (station-settings 03.1, the contract's summaries): owners and operators see
// earnings, statements and the audience; only owners move money, see the payout account and
// download a statement's CSV; hosts see none of it. A station sees only its own numbers.

import { http } from "msw";
import { audienceApi, ledgerApi, networkApi, relayViewersLabel } from "@opencast/contracts";
import { money } from "@opencast/ui";
import { dbStation, getDb, membership } from "../db";
import { audienceReport, hasAudience, heldEarnings, moveToBank, payoutAccount, setPayoutTo, stationEarnings, stationStatements, statementCsv, statementOwner } from "../fixtures/earnings";
import type { MockPerson } from "../fixtures/people";
import { stationState } from "../fixtures/station";
import { BEAT } from "../fixtures/stations";
import { makerWatchData } from "../fixtures/watch";
import { fail, needsUser, path, reply } from "../respond";

type Need = "see" | "own";

/** The person's role on the station decides: owners and operators see, owners act. */
function guard(person: MockPerson, stationId: string, need: Need): Response | null {
  if (!dbStation(stationId)) return fail(404, "not_found", "That station wasn't found.");
  const m = membership(stationId, person.id);
  if (!m) return fail(403, "forbidden", "That station isn't one of yours.");
  if (m.role === "host") return fail(403, "forbidden", "Only owners and operators see the station's money and audience.");
  if (need === "own" && m.role !== "owner") return fail(403, "forbidden", "Only owners move money.");
  return null;
}

const RELAY = (youtube: [number, number], twitch: [number, number]) => [
  { platform: "youtube" as const, label: relayViewersLabel("youtube"), micros: youtube[0], airings: youtube[1] },
  { platform: "twitch" as const, label: relayViewersLabel("twitch"), micros: twitch[0], airings: twitch[1] }
];
/** BEAT's relay viewers by period: YouTube (online businesses, and local ones for the share in their area) and Twitch (online businesses only). */
const RELAY_VIEWERS = { week: RELAY([3_200_000, 8], [800_000, 2]), month: RELAY([12_400_000, 31], [3_100_000, 9]), year: RELAY([12_400_000, 31], [3_100_000, 9]) };

export const earningsHandlers = [
  http.get(path(ledgerApi.getStationEarnings), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const no = guard(p, id, "see");
    if (no) return no;
    const q = new URL(request.url).searchParams.get("period");
    const period = q === "week" || q === "year" ? q : "month";
    const e = stationEarnings(id, period);
    if (!e) return fail(404, "not_found", "There are no earnings for this station yet.");
    // Ads from partners: the switch in Breaks settings; nothing earned until the backfill exists.
    const on = !!stationState().breakRules[id]?.adsFromPartners;
    // Relay viewers (follow-up Phase 3): BEAT relays to YouTube and Twitch since September 14. Their
    // lines are carved out of the spots line, so the total stays the ledger's.
    const relay = id === BEAT.id ? RELAY_VIEWERS[period] : null;
    const lines = relay
      ? { ...e.lines, spots: { ...e.lines.spots, micros: e.lines.spots.micros - relay.reduce((s, l) => s + l.micros, 0) }, relayViewers: relay }
      : e.lines;
    return reply(ledgerApi.getStationEarnings.response, { ...e, lines: { ...lines, partnerAds: { on, micros: 0, pendingMicros: 0 } } });
  }),

  http.get(path(ledgerApi.listStationStatements), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const no = guard(p, id, "see");
    if (no) return no;
    return reply(ledgerApi.listStationStatements.response, stationStatements(id));
  }),

  http.get(path(ledgerApi.getStatementCsv), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const found = statementOwner(String(params.statementId));
    if (!found) return fail(404, "not_found", "That statement wasn't found.");
    const m = membership(found.stationId, p.id);
    if (!m) return fail(403, "forbidden", "That station isn't one of yours.");
    if (m.role !== "owner") return fail(403, "forbidden", "Only owners download statements.");
    const st = dbStation(found.stationId)!;
    return reply(ledgerApi.getStatementCsv.response, statementCsv(found.statement, st.ident.callSign ?? st.ident.handle ?? "station"));
  }),

  http.get(path(ledgerApi.getPayoutAccount), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const no = guard(p, id, "own");
    if (no) return no;
    const a = payoutAccount(id, dbStation(id)?.ident.callSign ?? "The station");
    if (!a) return fail(404, "not_found", "There's no payout account for this station yet.");
    return reply(ledgerApi.getPayoutAccount.response, a);
  }),

  // Paying out to the owner's linked Clear wallet (read-only access is enough), or back.
  http.put(path(ledgerApi.setPayoutDestination), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const no = guard(p, id, "own");
    if (no) return no;
    const body = ledgerApi.setPayoutDestination.body.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, "invalid", "Choose where the station is paid.");
    const link = getDb().clearLinks?.[p.id];
    if (body.data.kind === "clear_wallet" && !link) return fail(409, "clear_not_linked", "Connect Clear first.");
    setPayoutTo(id, body.data.kind, body.data.kind === "clear_wallet" ? link!.address : null);
    const a = payoutAccount(id)!;
    return reply(ledgerApi.setPayoutDestination.response, { status: a.status, url: a.url });
  }),

  http.post(path(ledgerApi.moveToBank), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const no = guard(p, id, "own");
    if (no) return no;
    const body = ledgerApi.moveToBank.body.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(422, "invalid", "Enter an amount to move.");
    const r = moveToBank(id, body.data.amountMicros, money);
    if (!r.ok) return fail(r.status, r.code, r.message);
    return reply(ledgerApi.moveToBank.response, { payoutId: r.payoutId, scheduledFor: r.scheduledFor }, 201);
  }),

  http.get(path(audienceApi.getAudience), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const no = guard(p, id, "see");
    if (no) return no;
    if (dbStation(id)?.ident.kind === "studio") return fail(409, "studio", "Studios don't broadcast, so there's no audience to count.");
    const q = audienceApi.getAudience.query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!q.success) return fail(422, "invalid", "Ask for a window with a start and an end.");
    if (!hasAudience(id)) return fail(404, "not_found", "There's no audience for this station yet.");
    return reply(audienceApi.getAudience.response, audienceReport(id, q.data.from, q.data.to)!);
  }),

  // Watch data (follow-up Phase 1), Offering your programs: the maker's programs across every
  // station that aired them, added up (fixtures/watch.ts). Owners and operators; studios too.
  http.get(path(audienceApi.programWatchData), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const no = guard(p, id, "see");
    if (no) return no;
    const q = audienceApi.programWatchData.query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!q.success) return fail(400, "bad_request", "Ask for a window with a start and an end.");
    const span = Date.parse(q.data.to) - Date.parse(q.data.from);
    if (span <= 0 || span > 366 * 86_400_000) return fail(400, "bad_request", "Ask for up to a year.");
    return reply(audienceApi.programWatchData.response, makerWatchData(id, q.data.from, q.data.to));
  }),

  // Admin only in the API. The mock has no admins, so it answers anyone signed in (the network desk
  // and the creator's claim page read the same held amount).
  http.get(path(networkApi.heldEarnings), ({ request }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    return reply(networkApi.heldEarnings.response, heldEarnings());
  })
];
