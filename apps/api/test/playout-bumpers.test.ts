// A243: bumper roles in chained sequences, against the database. The break rule's sequences (read,
// written, an older body's `cadence.bumpers`), the library's roles and windows, the run sheet with
// chained sequences in breaks and between programs, up next naming the guide's next program (and
// left out before off air), the room each element gets (priority, held spots never displaced), the
// filler keeping room for the chosen elements, picks taking turns from the as-run log, and an
// assembled channel: the up-next DATERANGE and the as-run rows. Relays keep the between bumpers.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { HLS_CLASS, HlsUpNext, parseDateRanges } from "@opencast/contracts";
import { createPlanner, type Segment } from "../src/v1/modules/playout/engine/plan.js";
import { createFiller } from "../src/v1/modules/playout/engine/fill.js";
import { createEngine, type Engine } from "../src/v1/modules/playout/engine/index.js";
import { relayPicture } from "../src/v1/modules/playout/engine/relayBreaks.js";
import { createHarness, dummyFile, fakeTranscoder, itemFixture, market, prepareQueued, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let kai: User;
let jess: User;
let marketId: string;
let planner: ReturnType<typeof createPlanner>;
let filler: ReturnType<typeof createFiller>;
const MIN = 60_000;
const $ = (d: number) => Math.round(d * 1_000_000);

const hms = (d: Date) => d.toISOString().slice(11, 19);
const shape = (segments: Segment[]) => segments.map((s) => `${hms(s.startsAt)} ${s.code} ${Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 1000)}s${s.code === "BMP" ? ` ${s.label}` : ""}`);
const RULE = { mode: "after_every_program", everyMinutes: null, lengthMs: 120_000, spotMsPerHour: 180_000, sameSpotPerHour: 2, fillOrder: ["SPT", "UND", "BMP", "SID"], openTimeTo: "spot_market", blockedCategories: [] };
const DEFAULTS = { open: { roles: ["into_break"], every: "break" }, close: { roles: ["out_of_break"], every: "break" }, between: { roles: [], every: "program" } };
const CHAINED = {
  open: { roles: ["into_break", "up_next"], every: "break" },
  close: { roles: ["up_next", "out_of_break"], every: "break" },
  between: { roles: ["any"], every: "program" }
};

async function station(callSign: string, tenths: number) {
  const s = await stationFixture(h, { callSign, name: `${callSign} TV`, ownerId: kai.id, marketId, tenths, signedOn: true, colour: "#8C3B7A" });
  await itemFixture(h, s.id, { title: `${callSign} ident`, code: "SID", durationMs: 5_000 });
  return s.id;
}

/** The four bumpers the chained tests use: one per role. */
async function bumpers(stationId: string) {
  await itemFixture(h, stationId, { title: "Right back", code: "BMP", bumperRole: "into_break", durationMs: 5_000 });
  await itemFixture(h, stationId, { title: "Up next", code: "BMP", bumperRole: "up_next", durationMs: 8_000 });
  await itemFixture(h, stationId, { title: "Back to it", code: "BMP", bumperRole: "out_of_break", durationMs: 5_000 });
  await itemFixture(h, stationId, { title: "Sting", code: "BMP", durationMs: 3_000 });
}

async function program(stationId: string, title: string, itemMs: number) {
  const p = await kai.post(`/v1/stations/${stationId}/programs`, { title, description: `${title}.` }).expect(201);
  return itemFixture(h, stationId, { title: `${title}, ep. 1`, programId: p.body.id, durationMs: itemMs });
}

const onLog = (stationId: string, itemId: string, startsAt: string, endsAt: string) => kai.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt, endsAt, itemId }).expect(201);

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-10-02T02:59:00.000Z"); // 7:59 pm in Los Angeles.
  planner = createPlanner({ deps: h.deps, services: h.services });
  filler = createFiller({ deps: h.deps, services: h.services });
  marketId = (await market(h)).id;
  kai = await h.signIn("Kai");
  jess = await h.signIn("Jess");
}, 60_000);
afterAll(() => h.close());

describe("the break rule's bumper sequences", () => {
  let id: string;
  beforeAll(async () => {
    id = await station("SEQS", 131);
  });

  it("read as the defaults (one into the break, one out, none between), mirroring cadence.bumpers", async () => {
    await kai.put(`/v1/stations/${id}/break-rule`, { ...RULE, cadence: { stationId: { every: "break" }, bumpers: { every: "hour" }, underwriting: { every: "break" } } }).expect(200);
    const rule = (await kai.get(`/v1/stations/${id}/break-rule`).expect(200)).body;
    expect(rule.bumperSequences).toEqual({ open: { roles: ["into_break"], every: "hour" }, close: { roles: ["out_of_break"], every: "hour" }, between: { roles: [], every: "program" } });
    const [row] = await h.db.select().from(schema.breakRules).where(eq(schema.breakRules.stationId, id));
    expect(row.bumperSequences).toBeNull();
  });

  it("are stored once changed, cadence.bumpers reading as the opening one's", async () => {
    const rule = (await kai.get(`/v1/stations/${id}/break-rule`).expect(200)).body;
    const set = (await kai.put(`/v1/stations/${id}/break-rule`, { ...rule, bumperSequences: { ...CHAINED, open: { roles: ["into_break", "up_next"], every: "program" } } }).expect(200)).body;
    expect(set.bumperSequences.open).toEqual({ roles: ["into_break", "up_next"], every: "program" });
    expect(set.cadence.bumpers).toEqual({ every: "program" });
    // Left out (an app from before), they stay.
    const { bumperSequences: _left, ...older } = set;
    expect((await kai.put(`/v1/stations/${id}/break-rule`, older).expect(200)).body.bumperSequences).toEqual(set.bumperSequences);
  });

  it("an older body that sets only cadence.bumpers sets both the opening and closing cadence", async () => {
    const rule = (await kai.get(`/v1/stations/${id}/break-rule`).expect(200)).body;
    const { bumperSequences: _s, ...older } = rule;
    const set = (await kai.put(`/v1/stations/${id}/break-rule`, { ...older, cadence: { ...rule.cadence, bumpers: { every: "n_programs", n: 3 } } }).expect(200)).body;
    expect(set.bumperSequences.open).toEqual({ roles: ["into_break", "up_next"], every: "n_programs", n: 3 });
    expect(set.bumperSequences.close).toEqual({ roles: ["up_next", "out_of_break"], every: "n_programs", n: 3 });
    expect(set.bumperSequences.between).toEqual(CHAINED.between);
  });

  it("refuse a role twice in one position, and N programs without an N", async () => {
    const rule = (await kai.get(`/v1/stations/${id}/break-rule`).expect(200)).body;
    const twice = await kai.put(`/v1/stations/${id}/break-rule`, { ...rule, bumperSequences: { ...CHAINED, close: { roles: ["any", "any"], every: "break" } } }).expect(400);
    expect(twice.body.error.fields).toMatchObject({ "bumperSequences.close.roles": "Each role once" });
    await kai.put(`/v1/stations/${id}/break-rule`, { ...rule, bumperSequences: { ...CHAINED, between: { roles: ["any"], every: "n_programs" } } }).expect(400);
    // Five roles in one position doesn't pass the contract.
    await kai.put(`/v1/stations/${id}/break-rule`, { ...rule, bumperSequences: { ...CHAINED, open: { roles: ["into_break", "out_of_break", "up_next", "any", "any"], every: "break" } } }).expect(400);
  });
});

describe("the library's roles and windows", () => {
  let id: string;
  beforeAll(async () => {
    id = await station("ROLE", 141);
  });

  it("a bumper takes a role and a window; anything else refuses a role, and a new type clears it", async () => {
    const b = await itemFixture(h, id, { title: "Sting", code: "BMP", durationMs: 5_000 });
    const item = (await kai.patch(`/v1/library/${b.id}`, { bumperRole: "up_next", airs: { from: "2026-12-01", until: "2026-12-31", dailyFrom: "18:00", dailyUntil: "02:00" } }).expect(200)).body;
    expect(item).toMatchObject({ code: "BMP", bumperRole: "up_next", airs: { from: "2026-12-01", until: "2026-12-31", dailyFrom: "18:00", dailyUntil: "02:00" }, airingNow: false });
    const show = await itemFixture(h, id, { title: "Late Crate", durationMs: 30 * MIN });
    await kai.patch(`/v1/library/${show.id}`, { bumperRole: "any" }).expect(400);
    await kai.patch(`/v1/library/${show.id}`, { airs: { from: "2026-12-01", until: null, dailyFrom: null, dailyUntil: null } }).expect(400);
    await kai.patch(`/v1/library/${b.id}`, { airs: { from: null, until: null, dailyFrom: "18:00", dailyUntil: null } }).expect(400);
    await kai.patch(`/v1/library/${b.id}`, { airs: { from: "2026-12-31", until: "2026-12-01", dailyFrom: null, dailyUntil: null } }).expect(400);
    // A station ID keeps its window but not a role.
    const sid = (await kai.patch(`/v1/library/${b.id}`, { code: "SID" }).expect(200)).body;
    expect(sid).toMatchObject({ code: "SID", bumperRole: null, airs: { from: "2026-12-01" } });
    // A program takes neither.
    const pgm = (await kai.patch(`/v1/library/${b.id}`, { code: "PGM" }).expect(200)).body;
    expect(pgm).toMatchObject({ bumperRole: null, airs: null, airingNow: true });
  });

  it("lists bumpers by role (Any includes bumpers without one)", async () => {
    await itemFixture(h, id, { title: "Plain", code: "BMP", durationMs: 5_000 });
    await itemFixture(h, id, { title: "Tagged any", code: "BMP", bumperRole: "any", durationMs: 5_000 });
    await itemFixture(h, id, { title: "Coming up", code: "BMP", bumperRole: "up_next", durationMs: 5_000 });
    const any = (await kai.get(`/v1/stations/${id}/library?bumperRole=any`).expect(200)).body.items.map((i: { title: string }) => i.title);
    expect(any.sort()).toEqual(["Plain", "Tagged any"]);
    const next = (await kai.get(`/v1/stations/${id}/library?bumperRole=up_next`).expect(200)).body.items.map((i: { title: string }) => i.title);
    expect(next).toEqual(["Coming up"]);
  });
});

describe("chained sequences on the run sheet", () => {
  let id: string;
  let reel: { id: string };

  beforeAll(async () => {
    id = await station("CHAN", 151);
    await kai.put(`/v1/stations/${id}/break-rule`, { ...RULE, bumperSequences: CHAINED }).expect(200);
    await bumpers(id);
    const crate = await program(id, "Late Crate", 56 * MIN);
    reel = await program(id, "Saturday Reel", 58 * MIN);
    await onLog(id, crate.id, "2026-10-02T03:00:00.000Z", "2026-10-02T04:00:00.000Z");
    await onLog(id, reel.id, "2026-10-02T04:00:00.000Z", "2026-10-02T05:00:00.000Z");
    // Off air after Saturday Reel.
    await kai.post(`/v1/stations/${id}/log`, { kind: "off_air", startsAt: "2026-10-02T05:00:00.000Z", endsAt: "2026-10-02T13:00:00.000Z" }).expect(201);
  }, 60_000);

  it("into, up next, (spots, credit), out, the station ID, then between programs just before the next starts", async () => {
    const segments = await planner.plan(id, new Date("2026-10-02T03:55:00Z"), new Date("2026-10-02T04:00:30Z"));
    expect(shape(segments)).toEqual([
      "03:00:00 PGM 3360s",
      "03:56:00 BMP 5s Right back",
      "03:56:05 BMP 8s Up next",
      // Up next was in the opening sequence: the closing one leaves it out.
      "03:56:13 BMP 5s Back to it",
      "03:56:18 OPEN 214s",
      "03:59:52 SID 5s",
      "03:59:57 BMP 3s Sting",
      "04:00:00 PGM 3480s"
    ]);
    const upNext = segments.find((s) => s.bumperRole === "up_next")!;
    expect(upNext).toMatchObject({ position: "open", inBreak: true, announces: { title: "Saturday Reel", episodeTitle: "Saturday Reel, ep. 1", startsAt: "2026-10-02T04:00:00.000Z" } });
    // The between bumper is outside the break's SCTE-35 span; the break's span ends before it.
    const sting = segments.find((s) => s.position === "between")!;
    expect(sting).toMatchObject({ inBreak: false, bumperRole: "any" });
    expect(sting.breakSpan).toBeUndefined();
    const sid = segments.find((s) => s.code === "SID")!;
    expect(sid.breakSpan).toEqual({ startsAt: new Date("2026-10-02T03:56:00Z"), lengthMs: 237_000 });
    // Relays set to show the station ID slate during breaks still air it.
    expect(relayPicture({ inBreak: sting.inBreak, code: sting.code }, { breakHandling: "station_id_slate", partnerAds: false })).toEqual({ show: "as_aired", why: "program" });
  });

  it("names the guide's next program, as the dial and the banner's Next have it", async () => {
    const segments = await planner.plan(id, new Date("2026-10-02T03:56:00Z"), new Date("2026-10-02T03:57:00Z"));
    const guide = (await h.services.log.nowNext([id], new Date("2026-10-02T03:56:00Z"))).get(id)!.next!;
    expect(segments.find((s) => s.bumperRole === "up_next")!.announces).toMatchObject({ entryId: guide.logEntryId, title: guide.title, episodeTitle: guide.episodeTitle, startsAt: guide.startsAt });
    expect(await h.services.log.upNextAfter(id, new Date("2026-10-02T04:00:00Z"))).toMatchObject({ title: "Saturday Reel" });
  });

  it("before off air: no up next (nothing's on next) and nothing between (it's a sign-off)", async () => {
    const segments = await planner.plan(id, new Date("2026-10-02T04:58:00Z"), new Date("2026-10-02T05:00:00Z"));
    expect(segments.some((s) => s.bumperRole === "up_next")).toBe(false);
    expect(segments.some((s) => s.position === "between")).toBe(false);
    expect(shape(segments.filter((s) => s.code === "BMP"))).toEqual(["04:58:00 BMP 5s Right back", "04:58:05 BMP 5s Back to it"]);
    expect(await h.services.log.upNextAfter(id, new Date("2026-10-02T05:00:00Z"))).toBeNull();
  });

  it("the log's break rows show each element, up next with what it names", async () => {
    const view = (await kai.get(`/v1/stations/${id}/log?from=2026-10-02T03:00:00.000Z&to=2026-10-02T05:00:00.000Z`).expect(200)).body;
    const rows = view.breaks.find((b: { startsAt: string }) => b.startsAt === "2026-10-02T03:56:00.000Z").rows;
    const bumperRows = rows.filter((r: { code: string }) => r.code === "BMP");
    expect(bumperRows.map((r: { title: string; note: string; element: { position: string; role: string; fits: boolean } }) => [r.title, r.note, r.element.position, r.element.role, r.element.fits])).toEqual([
      ["Right back", "Into the break", "open", "into_break", true],
      ["Up next", "Up next: Saturday Reel, 9:00 pm", "open", "up_next", true],
      ["Back to it", "Out of the break", "close", "out_of_break", true],
      ["Sting", "Between programs", "between", "any", true]
    ]);
    expect(bumperRows[1].element.announces).toEqual({ title: "Saturday Reel", startsAt: "2026-10-02T04:00:00.000Z" });
    // In air order: the between bumper after the station ID.
    expect(rows.map((r: { code: string }) => r.code).slice(-2)).toEqual(["SID", "BMP"]);
    // The same rows, as avails (BreakContent), carry the element too; `kind` stays "bumper".
    h.clock.set("2026-10-02T03:30:00.000Z");
    const avails = (await kai.get(`/v1/stations/${id}/avails?hours=1`).expect(200)).body.breaks[0].contents;
    expect(avails.filter((c: { kind: string }) => c.kind === "bumper").map((c: { element: { role: string } }) => c.element.role)).toEqual(["into_break", "up_next", "out_of_break", "any"]);
    h.clock.set("2026-10-02T02:59:00.000Z");
  });
});

describe("up next in a mid-program break", () => {
  it("names the next program with its time (Next at)", async () => {
    const id = await station("MIDP", 161);
    await kai.put(`/v1/stations/${id}/break-rule`, { ...RULE, mode: "every_n_minutes", everyMinutes: 30, bumperSequences: { open: { roles: ["up_next"], every: "break" }, close: { roles: [], every: "break" }, between: { roles: [], every: "program" } } }).expect(200);
    await bumpers(id);
    const crate = await program(id, "Late Crate", 56 * MIN);
    const reel = await program(id, "Saturday Reel", 56 * MIN);
    await onLog(id, crate.id, "2026-10-02T03:00:00.000Z", "2026-10-02T04:00:00.000Z");
    await onLog(id, reel.id, "2026-10-02T04:00:00.000Z", "2026-10-02T05:00:00.000Z");
    const segments = await planner.plan(id, new Date("2026-10-02T03:29:00Z"), new Date("2026-10-02T03:33:00Z"));
    const upNext = segments.find((s) => s.bumperRole === "up_next")!;
    expect(hms(upNext.startsAt)).toBe("03:30:00");
    expect(upNext.announces).toMatchObject({ title: "Saturday Reel", startsAt: "2026-10-02T04:00:00.000Z" });
    const rows = (await kai.get(`/v1/stations/${id}/log?from=2026-10-02T03:00:00.000Z&to=2026-10-02T04:00:00.000Z`).expect(200)).body.breaks[0].rows;
    expect(rows[0]).toMatchObject({ code: "BMP", note: "Up next: Saturday Reel, 9:00 pm", element: { position: "open", role: "up_next" } });
  });
});

describe("not enough room", () => {
  it("each element whole or not at all, by priority; what's left holds before the station ID", async () => {
    const id = await station("TINY", 171);
    await kai.put(`/v1/stations/${id}/break-rule`, { ...RULE, bumperSequences: CHAINED }).expect(200);
    await bumpers(id);
    const crate = await program(id, "Late Crate", 59 * MIN + 40_000);
    const reel = await program(id, "Saturday Reel", 58 * MIN);
    await onLog(id, crate.id, "2026-10-02T03:00:00.000Z", "2026-10-02T04:00:00.000Z");
    await onLog(id, reel.id, "2026-10-02T04:00:00.000Z", "2026-10-02T05:00:00.000Z");
    // A 20-second closing break: the station ID (5), into the break (5), out of it (5); up next (8)
    // no longer fits, the sting (3, Any, last) does; 2 seconds hold on the slate.
    const segments = await planner.plan(id, new Date("2026-10-02T03:59:40Z"), new Date("2026-10-02T04:00:00Z"));
    expect(shape(segments)).toEqual(["03:59:40 BMP 5s Right back", "03:59:45 BMP 5s Back to it", "03:59:50 OPEN 2s", "03:59:52 SID 5s", "03:59:57 BMP 3s Sting"]);
    const rows = (await kai.get(`/v1/stations/${id}/log?from=2026-10-02T03:00:00.000Z&to=2026-10-02T04:00:00.000Z`).expect(200)).body.breaks[0].rows;
    expect(rows.find((r: { title: string }) => r.title === "Up next")).toMatchObject({ lengthMs: 0, note: "Didn't fit: Up next (:08)", element: { fits: false } });
  });
});

describe("defaults and rotation", () => {
  it("three or more Any bumpers take turns, least recently aired first, and every reader sees the same picks", async () => {
    const id = await station("ROTA", 181);
    await kai.put(`/v1/stations/${id}/break-rule`, RULE).expect(200);
    for (const [i, t] of ["A", "B", "C"].entries()) await itemFixture(h, id, { title: t, code: "BMP", durationMs: 5_000, createdAt: new Date(Date.UTC(2026, 8, 1, 0, i)) });
    const crate = await program(id, "Late Crate", 58 * MIN);
    for (const [a, z] of [["03", "04"], ["04", "05"], ["05", "06"]]) await onLog(id, crate.id, `2026-10-02T${a}:00:00.000Z`, `2026-10-02T${z}:00:00.000Z`);
    const bmps = async (from: string) =>
      (await planner.plan(id, new Date(from), new Date("2026-10-02T06:00:00Z"))).filter((s) => s.code === "BMP" && s.inBreak).map((s) => `${hms(s.startsAt).slice(0, 5)} ${s.label}`);
    const all = await bmps("2026-10-02T03:00:00Z");
    expect(all).toEqual(["03:58 A", "03:58 B", "04:58 C", "04:58 A", "05:58 B", "05:58 C"]);
    // A window starting later, and the log's view, agree.
    expect(await bmps("2026-10-02T04:30:00Z")).toEqual(all.slice(2));
    const breaks = await h.services.log.breaks(id, new Date("2026-10-02T03:00:00Z"), new Date("2026-10-02T06:00:00Z"));
    expect(breaks.map((b) => [...b.elements!.open, ...b.elements!.close].map((e) => e.title).join(""))).toEqual(["AB", "CA", "BC"]);
    // Once the 3:58 break has aired (the as-run log says B and C, say), the rest follow from that.
    h.clock.set("2026-10-02T04:30:00.000Z");
    const items = await h.db.select().from(schema.assets).where(eq(schema.assets.stationId, id));
    const byTitle = (t: string) => items.find((i) => i.title === t)!.id;
    await h.db.insert(schema.asRun).values([
      { stationId: id, code: "BMP", startedAt: new Date("2026-10-02T03:58:00Z"), endedAt: new Date("2026-10-02T03:58:05Z"), assetId: byTitle("B"), reason: "planned", position: "open" },
      { stationId: id, code: "BMP", startedAt: new Date("2026-10-02T03:59:00Z"), endedAt: new Date("2026-10-02T03:59:05Z"), assetId: byTitle("C"), reason: "planned", position: "close" }
    ]);
    expect(await bmps("2026-10-02T04:30:00Z")).toEqual(["04:58 A", "04:58 B", "05:58 C", "05:58 A"]);
    h.clock.set("2026-10-02T02:59:00.000Z");
  });

  it("a seasonal bumper airs only in its window; outside it the chain moves on", async () => {
    const id = await station("SNOW", 191);
    await kai.put(`/v1/stations/${id}/break-rule`, RULE).expect(200);
    await itemFixture(h, id, { title: "Plain", code: "BMP", durationMs: 5_000 });
    await itemFixture(h, id, { title: "Evening in", code: "BMP", bumperRole: "into_break", durationMs: 5_000, airs: { dailyFrom: "20:30", dailyUntil: "23:00" } });
    const crate = await program(id, "Late Crate", 58 * MIN);
    await onLog(id, crate.id, "2026-10-02T03:00:00.000Z", "2026-10-02T04:00:00.000Z");
    await onLog(id, crate.id, "2026-10-02T04:00:00.000Z", "2026-10-02T05:00:00.000Z");
    const segments = await planner.plan(id, new Date("2026-10-02T03:58:00Z"), new Date("2026-10-02T05:00:00Z"));
    // 8:58 pm: the evening one's window starts at 8:30 pm; 9:58 pm too. Out of the break: Any.
    expect(segments.filter((s) => s.code === "BMP").map((s) => `${hms(s.startsAt).slice(0, 5)} ${s.label}`)).toEqual(["03:58 Evening in", "03:58 Plain", "04:58 Evening in", "04:58 Plain"]);
    const early = await planner.plan(id, new Date("2026-10-02T02:58:00Z"), new Date("2026-10-02T03:00:00Z"));
    expect(early.filter((s) => s.code === "BMP" && s.label === "Evening in")).toEqual([]);
  });
});

describe("the filler keeps room for the chosen elements", () => {
  it("a spot that would run into them isn't placed; held spots keep their place, and between takes only what's left", async () => {
    const id = await station("FILL", 201);
    await kai.put(`/v1/stations/${id}/break-rule`, { ...RULE, bumperSequences: CHAINED }).expect(200);
    await bumpers(id);
    const b = await jess.post("/v1/businesses", { name: "Orange Street Coffee", category: "Coffee and food", customersWhere: "online", marketIds: [marketId] }).expect(201);
    const card = await jess.post(`/v1/businesses/${b.body.id}/funding-sources`, { kind: "card", token: "tok_4417" }).expect(201);
    await jess.post(`/v1/businesses/${b.body.id}/deposits`, { amountMicros: $(100), fundingSourceId: card.body[0].id }).expect(201);
    const s = await jess.post(`/v1/businesses/${b.body.id}/spots`, { title: "Fall menu", lengthSec: 30, category: "Food", rate: { kind: "per_airing", micros: $(4) }, budget: { totalMicros: $(40), dailyCapMicros: $(12) } }).expect(201);
    await h.db.insert(schema.spotFiles).values({ spotId: s.body.id, version: 1, location: "/fixtures/fall.mp4", durationMs: 30_000 });
    await h.db.update(schema.spotsTable).set({ status: "listed" }).where(eq(schema.spotsTable.id, s.body.id));
    await kai.put(`/v1/stations/${id}/rotations/main`, { spotIds: [s.body.id] }).expect(200);
    const crate = await program(id, "Late Crate", 59 * MIN + 15_000);
    const reel = await program(id, "Saturday Reel", 59 * MIN + 10_000);
    await onLog(id, crate.id, "2026-10-02T03:00:00.000Z", "2026-10-02T04:00:00.000Z");
    await onLog(id, reel.id, "2026-10-02T04:00:00.000Z", "2026-10-02T05:00:00.000Z");
    await onLog(id, crate.id, "2026-10-02T05:00:00.000Z", "2026-10-02T06:00:00.000Z");
    // The 3:59:15 break is 45 seconds: the station ID (5) and the chosen elements (5 + 8 + 5 + 3)
    // leave 19, so the 30-second spot isn't placed. (The defaults, 5 + 5, would have left 30.)
    const results = await filler.fillAhead(id, h.clock.now(), 2 * 60 * MIN);
    expect(results.find((r) => r.placed.length)?.breakId).toBeUndefined();
    // The 4:59:10 break (50 seconds) was filled before its sequences (a pre-0048 break): the spot is
    // held there, and stays, whatever the sequences now want.
    await kai.put(`/v1/stations/${id}/break-rule`, { ...RULE, bumperSequences: DEFAULTS }).expect(200);
    h.clock.set("2026-10-02T04:30:00.000Z");
    const [held] = await filler.fillAhead(id, h.clock.now(), 60 * MIN);
    expect(held.placed).toHaveLength(1);
    await kai.put(`/v1/stations/${id}/break-rule`, { ...RULE, bumperSequences: { ...CHAINED, close: { roles: ["out_of_break"], every: "break" } } }).expect(200);
    const segments = await planner.plan(id, new Date("2026-10-02T04:59:10Z"), new Date("2026-10-02T05:00:00Z"));
    // 50 seconds: the held spot (30) and the station ID (5) first; into the break (5) and out (5)
    // by priority; up next (8) no longer fits, the sting between programs (3) does: 2 seconds hold.
    expect(shape(segments)).toEqual(["04:59:10 BMP 5s Right back", "04:59:15 SPT 30s", "04:59:45 BMP 5s Back to it", "04:59:50 OPEN 2s", "04:59:52 SID 5s", "04:59:57 BMP 3s Sting"]);
    h.clock.set("2026-10-02T02:59:00.000Z");
  });
});

describe("an assembled channel", () => {
  let engine: Engine;
  let id: string;
  const fake = fakeTranscoder();

  beforeAll(async () => {
    h.clock.set("2026-10-03T02:59:10.000Z");
    id = (await stationFixture(h, { callSign: "ASMB", name: "ASMB TV", ownerId: kai.id, marketId, tenths: 211, signedOn: true, colour: "#8C3B7A" })).id;
    await itemFixture(h, id, { title: "ASMB ident", code: "SID", durationMs: 4_000, location: await dummyFile() });
    await kai.put(`/v1/stations/${id}/break-rule`, { ...RULE, bumperSequences: { open: { roles: ["into_break"], every: "break" }, close: { roles: ["out_of_break"], every: "break" }, between: { roles: ["up_next"], every: "program" } } }).expect(200);
    await itemFixture(h, id, { title: "Right back", code: "BMP", bumperRole: "into_break", durationMs: 4_000, location: await dummyFile() });
    await itemFixture(h, id, { title: "Back to it", code: "BMP", bumperRole: "out_of_break", durationMs: 4_000, location: await dummyFile() });
    await itemFixture(h, id, { title: "Up next", code: "BMP", bumperRole: "up_next", durationMs: 8_000, location: await dummyFile() });
    const p1 = await kai.post(`/v1/stations/${id}/programs`, { title: "Late Crate", description: "Records." }).expect(201);
    const p2 = await kai.post(`/v1/stations/${id}/programs`, { title: "Saturday Reel", description: "Films." }).expect(201);
    const crate = await itemFixture(h, id, { title: "Late Crate, ep. 1", programId: p1.body.id, durationMs: 36_000, location: await dummyFile() });
    const reel = await itemFixture(h, id, { title: "Reel 1", programId: p2.body.id, durationMs: 36_000, location: await dummyFile() });
    // 36 s of Late Crate in a 64-second slot (a 28-second closing break), then Saturday Reel.
    await onLog(id, crate.id, "2026-10-03T03:00:00.000Z", "2026-10-03T03:01:04.000Z");
    await onLog(id, reel.id, "2026-10-03T03:01:04.000Z", "2026-10-03T03:02:00.000Z");
    await h.db.insert(schema.playoutState).values({ stationId: id, onAir: true });
    engine = createEngine({ deps: h.deps, services: h.services }, { transcoder: fake, log: () => undefined });
    await engine.tick();
    await prepareQueued(h, engine.preparer);
  }, 60_000);
  afterAll(async () => {
    await engine?.stopAll();
  });

  it("draws up next from an up-next DATERANGE (the guide's title), and records role, position and what it announced", async () => {
    const end = Date.parse("2026-10-03T03:01:30.000Z");
    while (h.clock.now().getTime() < end) {
      h.clock.advance(2_000);
      await engine.tick();
      await prepareQueued(h, engine.preparer);
    }
    await h.deps.bus.settle();
    const playlist = (await h.services.playout.playlist(id, "v720.m3u8"))!.body;
    const ranges = parseDateRanges(playlist);
    const upNext = ranges.find((r) => r.class === HLS_CLASS.upNext)!;
    expect(upNext).toBeDefined();
    expect(HlsUpNext.parse(upNext.attributes)).toEqual({ logEntryId: expect.any(String), title: "Saturday Reel", episodeTitle: "Reel 1", startsAt: "2026-10-03T03:01:04.000Z", immediate: 1, carriedFrom: null, blockName: null });
    // A second into the clip, to its end (the program starts as it ends).
    expect(new Date(upNext.start).toISOString()).toBe("2026-10-03T03:00:57.000Z");
    expect(upNext.end).toBe(Date.parse("2026-10-03T03:01:04.000Z"));
    // Its item tag says BMP, with the role (players built before it drop the field).
    const item = ranges.find((r) => r.class === HLS_CLASS.item && r.attributes.title === "Up next")!;
    expect(item.attributes).toMatchObject({ code: "BMP", bumperRole: "up_next" });
    // The break's cue ends before the between bumper.
    const cue = ranges.find((r) => r.class === HLS_CLASS.break)!;
    expect(cue.end).toBe(Date.parse("2026-10-03T03:00:56.000Z"));

    const rows = await h.db.select().from(schema.asRun).where(eq(schema.asRun.stationId, id)).orderBy(asc(schema.asRun.startedAt));
    const bumperRows = rows.filter((r) => r.code === "BMP").map((r) => [r.bumperRole, r.position, r.announcedTitle]);
    expect(bumperRows).toEqual([
      ["into_break", "open", null],
      ["out_of_break", "close", null],
      ["up_next", "between", "Saturday Reel"]
    ]);
    const asRun = (await kai.get(`/v1/stations/${id}/as-run?from=2026-10-03T03:00:00.000Z&to=2026-10-03T03:02:00.000Z`).expect(200)).body;
    expect(asRun.find((r: { bumperRole: string | null }) => r.bumperRole === "up_next")).toMatchObject({ code: "BMP", position: "between", announced: { title: "Saturday Reel", entryId: expect.any(String) } });
  });
});
