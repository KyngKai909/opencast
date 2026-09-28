// The market mock's rules: what fits BEAT's schedule, carrying into tonight's gap, placing a weekly
// slot with a repeat airing, approval, roles, notice. On the reference's Saturday, 8:42:12 pm.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getResponse, type HttpHandler } from "msw";

const NOW = new Date("2026-09-27T03:42:12Z");
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const BEAT = U(12);
const SLOW_HOURS = U(600001);
const NEWSREEL = U(600005);
const LATE_CRATE = U(600009);
const DOUBLE_FEATURE = U(600019);
const NITE_REQUEST = U(620001);

let handlers: HttpHandler[];
let db: typeof import("../db");
let market: typeof import("../fixtures/market");
let place: typeof import("./market").placements;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  db = await import("../db");
  market = await import("../fixtures/market");
  const m = await import("./market");
  handlers = m.marketHandlers;
  place = m.placements;
});

beforeEach(() => {
  localStorage.clear();
  db.resetDb();
  market.resetMarket();
});

async function api(method: string, path: string, o: { as?: string; body?: unknown; query?: Record<string, string> } = {}) {
  const url = new URL(`http://localhost/v1${path}`);
  for (const [k, v] of Object.entries(o.query ?? {})) url.searchParams.set(k, v);
  const req = new Request(url, { method, headers: { authorization: `Bearer mock-access-token:${o.as ?? "kai"}@example.com`, "content-type": "application/json" }, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const res = await getResponse(handlers, req);
  if (!res) throw new Error(`No mock for ${method} ${path}`);
  return { status: res.status, json: await res.json() };
}

type Fit = { reason: string; label: string; exact: boolean; startsAt: string | null };
type O = { id: string; program: { title: string }; approval: string; fit: Fit[]; status: string };

describe("what fits the schedule", () => {
  it("finds tonight's dead air, exact for Slow Hours, and BEAT's library repeats", async () => {
    const { json } = await api("GET", "/catalog/offers", { query: { forStation: BEAT } });
    const by = (t: string) => (json as O[]).find((o) => o.program.title === t)!;
    expect(by("Slow Hours").fit).toEqual([
      expect.objectContaining({ reason: "dead_air", label: "11:40 pm gap", exact: true, startsAt: "2026-09-27T06:40:00.000Z" }),
      expect.objectContaining({ reason: "library_repeats", label: "weeknights 1:00 am" })
    ]);
    expect(by("Nights at the observatory").fit[0]).toEqual(expect.objectContaining({ reason: "dead_air", exact: false }));
    expect(by("Crate Diggers Radio Hour").fit.map((f) => f.reason)).toEqual(["library_repeats"]);
    expect(by("Council Watch").fit).toEqual([]);
  });

  it("answers the Monitor with and without a gap", async () => {
    const fits = (await api("GET", "/catalog/offers", { query: { forStation: BEAT, fitsSchedule: "true" } })).json as O[];
    expect(fits[0]!.program.title).toBe("Slow Hours");
    const gap = (await api("GET", "/catalog/offers", { query: { forStation: BEAT, gap: "2026-09-27T06:40:00.000Z" } })).json as O[];
    expect(gap.filter((o) => o.approval === "any_station").map((o) => o.program.title).sort()).toEqual(["Nights at the observatory", "Slow Hours"]);
    expect(gap.filter((o) => o.approval === "i_approve")).toHaveLength(3);
  });
});

describe("carrying", () => {
  it("puts another airing of Slow Hours in tonight's gap under the agreement BEAT has", async () => {
    const r = await api("POST", `/catalog/offers/${SLOW_HOURS}/requests`, { body: { carrierStationId: BEAT, term: "barter", slots: [{ weekday: 6, time: "23:40" }], startsOn: "2026-09-26" } });
    expect(r.status).toBe(201);
    expect(r.json).toEqual(expect.objectContaining({ status: "approved", agreementId: U(270002) }));
    const p = await api("POST", `/carriage/agreements/${U(270002)}/place`, { body: { from: "2026-09-26", weeks: 1 } });
    expect(p.json).toEqual({ placed: 1, replaced: 0, blockedByLimit: 0 });
    const entry = db.getDb().log.find((e) => e.startsAt === "2026-09-27T06:40:00.000Z")!;
    expect(entry).toEqual(expect.objectContaining({ title: "Slow Hours", episodeTitle: "ep. 22", carriageAgreementId: U(270002), endsAt: "2026-09-27T08:59:00.000Z" }));
    // The gap is filled, so nothing fits it now.
    const after = (await api("GET", "/catalog/offers", { query: { forStation: BEAT, gap: "2026-09-27T06:40:00.000Z" } })).json as O[];
    expect(after).toEqual([]);
  });

  it("places Newsreel hour weekly on Sundays, with Wednesday's repeat of the same episode", async () => {
    const slots = [{ weekday: 0, time: "20:00" }, { weekday: 3, time: "22:00" }];
    const r = await api("POST", `/catalog/offers/${NEWSREEL}/requests`, { body: { carrierStationId: BEAT, term: "cash", slots, repeatSlots: [slots[1]], startsOn: "2026-09-27" } });
    const agreementId = (r.json as { agreementId: string }).agreementId;
    expect(agreementId).toBeTruthy();
    const p = await api("POST", `/carriage/agreements/${agreementId}/place`, { body: { from: "2026-09-27", weeks: 4, replaceExisting: true } });
    expect((p.json as { placed: number }).placed).toBe(8);
    const placed = db.getDb().log.filter((e) => e.carriageAgreementId === agreementId).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    expect(placed.slice(0, 3).map((e) => [e.startsAt, e.episodeTitle])).toEqual([
      ["2026-09-28T03:00:00.000Z", "ep. 1"],
      ["2026-10-01T05:00:00.000Z", "ep. 1"],
      ["2026-10-05T03:00:00.000Z", "ep. 2"]
    ]);
    expect(placed[0]!.repeatGroupId).toBe(placed[1]!.repeatGroupId);
    const ag = (await api("GET", `/stations/${BEAT}/carriage/agreements`)).json as { carrying: { id: string; slots: unknown[] }[] };
    expect(ag.carrying.find((a) => a.id === agreementId)!.slots).toEqual(slots);
  });

  it("asks when the maker approves each station, and places nothing", async () => {
    const r = await api("POST", `/catalog/offers/${DOUBLE_FEATURE}/requests`, { body: { carrierStationId: BEAT, term: "cash", slots: [{ weekday: 6, time: "23:40" }], startsOn: "2026-09-26" } });
    expect(r.json).toEqual(expect.objectContaining({ status: "asked", agreementId: null }));
  });

  it("lets owners and operators carry, not hosts", async () => {
    const body = { carrierStationId: BEAT, term: "cash", slots: [{ weekday: 0, time: "20:00" }], startsOn: "2026-09-27" };
    expect((await api("POST", `/catalog/offers/${NEWSREEL}/requests`, { as: "jen", body })).status).toBe(403);
    expect((await api("POST", `/catalog/offers/${NEWSREEL}/requests`, { as: "marcus", body })).status).toBe(201);
  });

  it("works out every airing from the slots", () => {
    const p = place([{ weekday: 1, time: "01:00" }], [], "2026-09-27", 2);
    expect(p.map((x) => x.startsAt)).toEqual(["2026-09-28T08:00:00.000Z", "2026-10-05T08:00:00.000Z"]);
  });
});

describe("the maker's side", () => {
  it("has NITE's request waiting, approves it once, and counts NITE among the carriers", async () => {
    const reqs = (await api("GET", `/stations/${BEAT}/carriage/requests`)).json as { incoming: { id: string; status: string; carrierProfile: { members: number } }[] };
    expect(reqs.incoming).toEqual([expect.objectContaining({ id: NITE_REQUEST, status: "asked", carrierProfile: expect.objectContaining({ members: 96 }) })]);
    const d = await api("POST", `/carriage/requests/${NITE_REQUEST}/decision`, { body: { decision: "approve" } });
    expect(d.json).toEqual(expect.objectContaining({ status: "approved" }));
    expect((await api("POST", `/carriage/requests/${NITE_REQUEST}/decision`, { body: { decision: "approve" } })).status).toBe(409);
    const ag = (await api("GET", `/stations/${BEAT}/carriage/agreements`)).json as { carriedBy: { program: { title: string }; carrier: { callSign: string } }[] };
    expect(ag.carriedBy.filter((a) => a.program.title === "Late Crate").map((a) => a.carrier.callSign).sort()).toEqual(["HALL", "NITE", "SAZN"]);
  });

  it("declines with a reason from the short list", async () => {
    const d = await api("POST", `/carriage/requests/${NITE_REQUEST}/decision`, { body: { decision: "decline", reason: "time_slot" } });
    expect(d.json).toEqual(expect.objectContaining({ status: "declined", declineReason: "time_slot" }));
  });

  it("gives the notice the terms promise when carriage ends", async () => {
    const e = await api("POST", `/carriage/agreements/${U(270101)}/end`);
    expect(e.json).toEqual(expect.objectContaining({ endNoticeGivenAt: NOW.toISOString(), endsAt: "2026-10-04T03:42:12.000Z" }));
    expect((await api("POST", `/carriage/agreements/${U(270101)}/end`)).status).toBe(409);
  });

  it("offers Crate Talk, and refuses Crate Session because of its link import", async () => {
    const terms = { termsOffered: ["barter", "cash"], cashPriceMicros: 3_000_000, cashPriceUnit: "per_airing", barterMakerMsPerHour: 120_000, airingsPerEpisode: 3, windowDays: 7, liveOnly: false, noticeDays: 7, approval: "i_approve", radioBandAllowed: true };
    const no = await api("POST", `/programs/${U(280002)}/offer`, { body: terms });
    expect(no.status).toBe(409);
    const yes = await api("POST", `/programs/${U(280003)}/offer`, { body: terms });
    expect(yes.status).toBe(201);
    expect(yes.json).toEqual(expect.objectContaining({ program: expect.objectContaining({ title: "Crate Talk", format: expect.objectContaining({ cadence: "weekly", episodeLengthMs: 3_600_000 }) }) }));
    const mine = (await api("GET", "/catalog/offers", { query: { maker: BEAT } })).json as O[];
    expect(mine.map((o) => o.program.title).sort()).toEqual(["Beat Tape Live", "Crate Talk", "Late Crate"]);
  });

  it("withdraws an offer: it leaves the market but stays on the maker's list", async () => {
    await api("PATCH", `/catalog/offers/${LATE_CRATE}`, { body: { status: "withdrawn" } });
    const all = (await api("GET", "/catalog/offers")).json as O[];
    expect(all.some((o) => o.id === LATE_CRATE)).toBe(false);
    const mine = (await api("GET", "/catalog/offers", { query: { maker: BEAT } })).json as O[];
    expect(mine.find((o) => o.id === LATE_CRATE)!.status).toBe("withdrawn");
  });
});
