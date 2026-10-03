// A244: programming blocks (Build B of design-bumpers-blocks), against the database. The block
// itself (made, named, coloured, archived), its library items (never in the station's pools; its
// intros and outros never the station's openers and closers), placing it on a date's log (edit
// mode: added, moved, taken off, never overlapping, locked on air, crossing 6:00 am), day templates
// (copied, generated, edited dates kept, regenerated, taken off, no 6:00 am crossing), membership
// (by start, overrun, starts before, empty, off air inside), the run sheet (entering, inside and
// leaving a block; block, then station, then automatic for bumpers by role, the bumper order, the
// ID, the intro and the outro; back-to-back blocks; no room for the intro; sign-on skips it; the
// automatic card asked for and used once prepared; the radio band), the viewer side (the dial's,
// guide's and station page's blocks, the Monitor's status) and an assembled channel (the block's
// logo bug, the as-run log, a carried member's barter spot and billing unchanged). A station with no
// blocks airs exactly as before.
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { HLS_CLASS, HlsBug, HlsUpNext, parseDateRanges } from "@opencast/contracts";
import { createPlanner, type Segment } from "../src/v1/modules/playout/engine/plan.js";
import { createEngine, type Engine } from "../src/v1/modules/playout/engine/index.js";
import { createHarness, dummyFile, fakeTranscoder, itemFixture, market, prepareQueued, radioTenths, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let kai: User;
let jess: User;
let marketId: string;
let planner: ReturnType<typeof createPlanner>;
const MIN = 60_000;
const $ = (d: number) => Math.round(d * 1_000_000);

/** A wall-clock time in Los Angeles (PDT in October), as UTC ISO. */
const pt = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-07:00`).toISOString();
const SAT = "2026-10-03";
const hms = (d: Date) => d.toISOString().slice(11, 19);
const shape = (segments: Segment[]) =>
  segments.map((s) => `${hms(s.startsAt)} ${s.code} ${Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 1000)}s${["BMP", "SID", "OPN", "CLS"].includes(s.code) ? ` ${s.label}` : ""}${s.block ? ` [${s.block.name}]` : ""}`);

const RULE = { mode: "after_every_program", everyMinutes: null, lengthMs: 120_000, spotMsPerHour: 180_000, sameSpotPerHour: 2, fillOrder: ["SPT", "UND", "BMP", "SID"], openTimeTo: "spot_market", blockedCategories: [] };
const SEQUENCES = { open: { roles: ["into_break"], every: "break" }, close: { roles: ["out_of_break"], every: "break" }, between: { roles: ["any"], every: "program" } };

async function station(callSign: string, tenths: number, opts: { sequences?: object; band?: "tv" | "radio" } = {}) {
  const s = await stationFixture(h, { callSign, name: `${callSign} TV`, ownerId: kai.id, marketId, tenths, signedOn: true, colour: "#8C3B7A", band: opts.band });
  await kai.put(`/v1/stations/${s.id}/break-rule`, { ...RULE, bumperSequences: opts.sequences ?? SEQUENCES }).expect(200);
  await itemFixture(h, s.id, { title: `${callSign} ident`, code: "SID", durationMs: 5_000 });
  await itemFixture(h, s.id, { title: "Right back", code: "BMP", bumperRole: "into_break", durationMs: 5_000 });
  await itemFixture(h, s.id, { title: "Back to it", code: "BMP", bumperRole: "out_of_break", durationMs: 5_000 });
  await itemFixture(h, s.id, { title: "Sting", code: "BMP", durationMs: 3_000 });
  return s.id;
}

async function program(stationId: string, title: string, itemMs: number) {
  const p = await kai.post(`/v1/stations/${stationId}/programs`, { title, description: `${title}.` }).expect(201);
  return itemFixture(h, stationId, { title: `${title}, ep. 1`, programId: p.body.id, durationMs: itemMs });
}

const onLog = (stationId: string, itemId: string, startsAt: string, endsAt: string) => kai.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt, endsAt, itemId }).expect(201);
const makeBlock = async (stationId: string, body: object) => (await kai.post(`/v1/stations/${stationId}/blocks`, body).expect(201)).body as { id: string; name: string };
const changes = (stationId: string, body: object) => kai.post(`/v1/stations/${stationId}/log/changes`, body);
async function place(stationId: string, blockId: string, startsAt: string, endsAt: string) {
  const res = await changes(stationId, { changes: [{ op: "block_add", key: "b", blockId, startsAt, endsAt }] }).expect(200);
  expect(res.body.applied).toBe(true);
  return res.body.changes[0].spanId as string;
}
const logOf = async (stationId: string, from: string, to: string) => (await kai.get(`/v1/stations/${stationId}/log?from=${from}&to=${to}`).expect(200)).body;

/** The block's own items: an ID, an into-the-break bumper, an Any sting, an intro (no outro: the automatic card). */
async function blockItems(stationId: string, blockId: string) {
  await itemFixture(h, stationId, { title: "LCN ID", code: "SID", durationMs: 6_000, programBlockId: blockId });
  await itemFixture(h, stationId, { title: "LCN in", code: "BMP", bumperRole: "into_break", durationMs: 4_000, programBlockId: blockId });
  await itemFixture(h, stationId, { title: "LCN sting", code: "BMP", durationMs: 2_000, programBlockId: blockId });
  await itemFixture(h, stationId, { title: "LCN intro", code: "OPN", durationMs: 6_000, programBlockId: blockId });
}

async function picture(width = 400, height = 400, colour = "#E0B040"): Promise<string> {
  const dir = path.join(os.tmpdir(), "opencast-test-logos");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${randomUUID()}.png`);
  await sharp({ create: { width, height, channels: 4, background: colour } }).png().toFile(file);
  return file;
}

beforeAll(async () => {
  h = await createHarness();
  h.clock.set(pt(SAT, "13:00"));
  planner = createPlanner({ deps: h.deps, services: h.services });
  marketId = (await market(h)).id;
  kai = await h.signIn("Kai");
  jess = await h.signIn("Jess");
}, 60_000);
afterAll(() => h.close());

describe("a programming block, made and kept", () => {
  let id: string;
  beforeAll(async () => {
    id = await station("BLKS", 301);
  });

  it("is made with a name, a colour that holds 4.5:1, a bug and its own order; names are the station's own", async () => {
    const made = await makeBlock(id, { name: "Late Crate Nights", description: "Records after dark.", colour: "#1F5C99", bug: "logo" });
    const read = (await kai.get(`/v1/stations/${id}/blocks/${made.id}`).expect(200)).body;
    expect(read).toMatchObject({ name: "Late Crate Nights", description: "Records after dark.", colour: "#1F5C99", bug: "logo", intro: true, outro: true, sequences: null, carried: false, reskin: "owner_only", logoUrl: null, owner: { id } });
    expect(read.items).toEqual({ intro: [], outro: [], id: [], bumpers: { into_break: 0, out_of_break: 0, up_next: 0, any: 0 } });
    expect(read.schedule).toEqual({ label: null, next: null });
    expect(read.onLog).toEqual({ templates: [], dates: [], ahead: 0 });
    // The same name (any case) is taken; a light colour isn't readable.
    expect((await kai.post(`/v1/stations/${id}/blocks`, { name: "late crate nights" }).expect(409)).body.error.code).toBe("block_name_taken");
    await kai.post(`/v1/stations/${id}/blocks`, { name: "Pale", colour: "#F0F0F0" }).expect(400);
    // Its own order is checked as the station's is.
    const twice = await kai.patch(`/v1/stations/${id}/blocks/${made.id}`, { sequences: { ...SEQUENCES, open: { roles: ["any", "any"], every: "break" } } }).expect(400);
    expect(twice.body.error.fields).toMatchObject({ "sequences.open.roles": "Each role once" });
    const own = (await kai.patch(`/v1/stations/${id}/blocks/${made.id}`, { sequences: { ...SEQUENCES, open: { roles: ["any"], every: "program" } }, bug: "off" }).expect(200)).body;
    expect(own).toMatchObject({ bug: "off", sequences: { open: { roles: ["any"], every: "program" } } });
    // Only its station's owners and operators.
    await jess.get(`/v1/stations/${id}/blocks`).expect(404);
  });

  it("takes a logo (a picture at least 128 pixels), and drops it", async () => {
    const made = await makeBlock(id, { name: "Saturday Matinee" });
    const up = await kai.post(`/v1/stations/${id}/blocks/${made.id}/logo`).attach("file", await picture()).expect(200);
    expect(up.body.logoUrl).toMatch(/\/objects\//);
    const small = await kai.post(`/v1/stations/${id}/blocks/${made.id}/logo`).attach("file", await picture(64, 64)).expect(422);
    expect(small.body.error.code).toBe("logo_size");
    expect((await kai.patch(`/v1/stations/${id}/blocks/${made.id}`, { removeLogo: true }).expect(200)).body.logoUrl).toBeNull();
  });

  it("has items of four types, never in the station's pools; its intros and outros are never the station's openers and closers", async () => {
    const made = await makeBlock(id, { name: "Night Owls" });
    await blockItems(id, made.id);
    await itemFixture(h, id, { title: "LCN goodbye", code: "CLS", durationMs: 5_000, programBlockId: made.id });
    const fillers = await h.services.library.fillers(id);
    expect(fillers.stationIds.map((f) => f.title)).toEqual(["BLKS ident"]);
    expect(fillers.bumpers.map((f) => f.title)).toEqual(["Right back", "Back to it", "Sting"]);
    const own = fillers.blocks.get(made.id)!;
    expect([own.stationIds, own.bumpers, own.intros, own.outros].map((l) => l.map((f) => f.title))).toEqual([["LCN ID"], ["LCN in", "LCN sting"], ["LCN intro"], ["LCN goodbye"]]);
    const identity = await h.services.library.identity(id);
    expect([...identity.openers, ...identity.closers]).toEqual([]);
    const read = (await kai.get(`/v1/stations/${id}/blocks/${made.id}`).expect(200)).body;
    expect(read.items).toMatchObject({ intro: [{ title: "LCN intro", durationMs: 6_000 }], outro: [{ title: "LCN goodbye" }], id: [{ title: "LCN ID" }], bumpers: { into_break: 1, any: 1, up_next: 0, out_of_break: 0 } });
    // The library lists a block's items, and an item says its block.
    const list = (await kai.get(`/v1/stations/${id}/library?programBlockId=${made.id}`).expect(200)).body.items.map((i: { title: string }) => i.title);
    expect(list.sort()).toEqual(["LCN ID", "LCN goodbye", "LCN in", "LCN intro", "LCN sting"]);
    const show = await itemFixture(h, id, { title: "Late Crate", durationMs: 30 * MIN });
    await kai.patch(`/v1/library/${show.id}`, { programBlockId: made.id }).expect(400);
    const sting = await itemFixture(h, id, { title: "Spare sting", code: "BMP", durationMs: 3_000 });
    expect((await kai.patch(`/v1/library/${sting.id}`, { programBlockId: made.id }).expect(200)).body.programBlockId).toBe(made.id);
    // Another station's block isn't this item's to join; a new type that can't belong clears it.
    const other = await station("BLKO", 311);
    const theirs = await makeBlock(other, { name: "Theirs" });
    await kai.patch(`/v1/library/${sting.id}`, { programBlockId: theirs.id }).expect(404);
    expect((await kai.patch(`/v1/library/${sting.id}`, { code: "PGM" }).expect(200)).body.programBlockId).toBeNull();
    // The database guards it too.
    await expect(h.db.update(schema.assets).set({ programBlockId: theirs.id }).where(eq(schema.assets.id, sting.id))).rejects.toThrow();
  });

  it("archives only once it's off the log, or takes itself off the log first (dates edited by hand keep theirs)", async () => {
    const made = await makeBlock(id, { name: "Archive Me" });
    const crate = await program(id, "Archive Crate", 50 * MIN);
    await onLog(id, crate.id, pt("2026-10-10", "21:00"), pt("2026-10-10", "22:00"));
    await place(id, made.id, pt("2026-10-10", "21:00"), pt("2026-10-10", "23:00"));
    await place(id, made.id, pt("2026-10-17", "21:00"), pt("2026-10-17", "23:00"));
    const refused = await kai.delete(`/v1/stations/${id}/blocks/${made.id}`).expect(409);
    expect(refused.body.error).toMatchObject({ code: "block_on_log", message: "Archive Me is on the log 2 more times. Take it off the log first." });
    const done = (await kai.delete(`/v1/stations/${id}/blocks/${made.id}?takeOffLog=true`).expect(200)).body;
    expect(done).toEqual({ ok: true, removed: 2, kept: 0 });
    expect((await kai.get(`/v1/stations/${id}/blocks`).expect(200)).body.blocks.map((b: { name: string }) => b.name)).not.toContain("Archive Me");
    // Its name is free again.
    await makeBlock(id, { name: "Archive Me" });
  });
});

describe("placing a block on a date's log (edit mode)", () => {
  let id: string;
  let blockId: string;
  let other: string;
  beforeAll(async () => {
    id = await station("BEDT", 321);
    blockId = (await makeBlock(id, { name: "Late Crate Nights", colour: "#1F5C99" })).id;
    other = (await makeBlock(id, { name: "Saturday Matinee" })).id;
  });

  it("adds, moves and takes off a span, with the changes' lines, and never two at once", async () => {
    const add = (await changes(id, { dryRun: true, changes: [{ op: "block_add", key: "k1", blockId, startsAt: pt(SAT, "21:00"), endsAt: pt("2026-10-04", "01:00") }] }).expect(200)).body;
    expect(add).toMatchObject({ applied: false, problems: [], changes: [{ op: "block_add", key: "k1", line: "Late Crate Nights added, Sat 9:00 pm to 1:00 am", startsAt: pt(SAT, "21:00"), endsAt: pt("2026-10-04", "01:00") }] });
    const spanId = await place(id, blockId, pt(SAT, "21:00"), pt("2026-10-04", "01:00"));
    const overlap = (await changes(id, { dryRun: true, changes: [{ op: "block_add", blockId: other, startsAt: pt(SAT, "23:00"), endsAt: pt("2026-10-04", "02:00") }] }).expect(200)).body;
    expect(overlap.problems).toEqual([{ index: 0, code: "block_overlap", message: "Blocks can't overlap: Late Crate Nights is on until 1:00 am." }]);
    const later = (await changes(id, { changes: [{ op: "block_resize", spanId, endsAt: pt("2026-10-04", "01:30") }] }).expect(200)).body;
    expect(later.changes[0]).toMatchObject({ op: "block_resize", spanId, line: "Late Crate Nights now ends at 1:30 am", endsAt: pt("2026-10-04", "01:30") });
    const off = (await changes(id, { changes: [{ op: "block_remove", spanId }] }).expect(200)).body;
    expect(off.changes[0].line).toBe("Late Crate Nights comes off the log");
    expect(await h.db.select().from(schema.programBlockSpans).where(eq(schema.programBlockSpans.id, spanId))).toEqual([]);
    // The database refuses an overlap too.
    await place(id, blockId, pt(SAT, "21:00"), pt(SAT, "22:00"));
    await expect(h.db.insert(schema.programBlockSpans).values({ stationId: id, blockId: other, startsAt: new Date(pt(SAT, "21:30")), endsAt: new Date(pt(SAT, "23:30")) })).rejects.toThrow();
  });

  it("keeps a span on air to its end (only the end can change, and not too soon)", async () => {
    const live = await station("BLIV", 331);
    const b = await makeBlock(live, { name: "Afternoon" });
    const spanId = await place(live, b.id, pt(SAT, "13:30"), pt(SAT, "15:00"));
    await h.db.insert(schema.playoutState).values({ stationId: live, onAir: true });
    h.clock.set(pt(SAT, "14:00"));
    try {
      const moved = (await changes(live, { dryRun: true, changes: [{ op: "block_resize", spanId, startsAt: pt(SAT, "13:00") }] }).expect(200)).body;
      expect(moved.problems).toEqual([{ index: 0, code: "block_locked", message: "Afternoon is on air. Change it after 3:00 pm." }]);
      expect((await changes(live, { dryRun: true, changes: [{ op: "block_remove", spanId }] }).expect(200)).body.problems[0].code).toBe("block_locked");
      expect((await changes(live, { dryRun: true, changes: [{ op: "block_resize", spanId, endsAt: pt(SAT, "14:00") }] }).expect(200)).body.problems[0].code).toBe("block_locked");
      expect((await changes(live, { dryRun: true, changes: [{ op: "block_resize", spanId, endsAt: pt(SAT, "16:00") }] }).expect(200)).body.problems).toEqual([]);
    } finally {
      h.clock.set(pt(SAT, "13:00"));
    }
  });

  it("may cross 6:00 am on a date, marking both broadcast days edited; the log's version follows its spans", async () => {
    const crossing = await station("BCRS", 341);
    const show = await program(crossing, "Overnight", 50 * MIN);
    await onLog(crossing, show.id, pt("2026-10-10", "22:00"), pt("2026-10-10", "23:00"));
    await kai.post(`/v1/stations/${crossing}/log/templates`, { fromDay: "2026-10-10", pattern: "daily" }).expect(201);
    const b = await makeBlock(crossing, { name: "Dawn Patrol" });
    const before = await logOf(crossing, pt("2026-10-11", "06:00"), pt("2026-10-12", "06:00"));
    const res = await changes(crossing, { base: { from: pt("2026-10-11", "06:00"), to: pt("2026-10-12", "06:00"), version: before.version }, changes: [{ op: "block_add", blockId: b.id, startsAt: pt("2026-10-12", "04:00"), endsAt: pt("2026-10-12", "08:00") }] }).expect(200);
    expect(res.body.version).not.toBe(before.version);
    const dates = await h.db.select().from(schema.dayTemplateDates).where(eq(schema.dayTemplateDates.stationId, crossing));
    expect(dates.filter((d) => d.editedAt).map((d) => d.date).sort()).toEqual(["2026-10-11", "2026-10-12"]);
    // A draft that began before is refused.
    await changes(crossing, { base: { from: pt("2026-10-11", "06:00"), to: pt("2026-10-12", "06:00"), version: before.version }, changes: [{ op: "block_add", blockId: b.id, startsAt: pt("2026-10-11", "20:00"), endsAt: pt("2026-10-11", "21:00") }] }).expect(409);
  });
});

describe("membership", () => {
  let id: string;
  let blockId: string;
  beforeAll(async () => {
    id = await station("BMEM", 351);
    blockId = (await makeBlock(id, { name: "Late Crate Nights", colour: "#1F5C99" })).id;
    const early = await program(id, "Early Bird", 50 * MIN);
    const crate = await program(id, "Late Crate", 56 * MIN);
    const reel = await program(id, "Saturday Reel", 58 * MIN);
    // Early Bird starts before the span (8:30) and runs into it: not a member.
    await onLog(id, early.id, pt(SAT, "20:30"), pt(SAT, "21:30"));
    await onLog(id, crate.id, pt(SAT, "21:30"), pt(SAT, "22:30"));
    // Saturday Reel starts inside and runs ten minutes past the end: it stays in the block.
    await onLog(id, reel.id, pt(SAT, "22:30"), pt(SAT, "23:40"));
    await place(id, blockId, pt(SAT, "21:00"), pt(SAT, "23:30"));
    // An empty span on Sunday.
    await place(id, blockId, pt("2026-10-04", "21:00"), pt("2026-10-04", "22:00"));
  });

  it("is by start: a program starting before isn't a member; one running past the end stays, and the band reaches that far", async () => {
    const log = await logOf(id, pt(SAT, "20:00"), pt("2026-10-05", "00:00"));
    const crate = log.entries.find((e: { title: string }) => e.title === "Late Crate");
    const reel = log.entries.find((e: { title: string }) => e.title === "Saturday Reel");
    expect(log.blocks).toHaveLength(2);
    expect(log.blocks[0]).toMatchObject({
      blockId,
      name: "Late Crate Nights",
      colour: "#1F5C99",
      startsAt: pt(SAT, "21:00"),
      endsAt: pt(SAT, "23:30"),
      airsFrom: pt(SAT, "21:30"),
      airsUntil: pt(SAT, "23:40"),
      pieces: [{ startsAt: pt(SAT, "21:30"), endsAt: pt(SAT, "23:40") }],
      templateId: null,
      entryIds: [crate.id, reel.id]
    });
    expect(log.blocks[0].problems).toEqual([{ code: "overrun", message: "Saturday Reel runs 10 minutes past the block's end, 11:30 pm. It stays in the block." }]);
    expect(log.blocks[1]).toMatchObject({ airsFrom: null, airsUntil: null, entryIds: [], problems: [{ code: "empty", message: "Nothing in this block yet. Put programs between 9:00 pm and 10:00 pm." }] });
  });

  it("names the block on its members' airings (the dial, the guide), and the guide's band runs first member to last", async () => {
    const window = (await h.services.log.window([id], new Date(pt(SAT, "20:00")), new Date(pt(SAT, "23:59")))).get(id)!;
    expect(window.map((a) => `${a.title}${a.block ? ` (${a.block.name})` : ""}`)).toEqual(["Early Bird", "Late Crate (Late Crate Nights)", "Saturday Reel (Late Crate Nights)"]);
    expect(window[1].block).toEqual({ id: blockId, name: "Late Crate Nights", colour: "#1F5C99" });
    const bands = (await h.services.log.blockBands([id], new Date(pt(SAT, "20:00")), new Date(pt(SAT, "23:59")))).get(id)!;
    expect(bands).toEqual([{ id: blockId, name: "Late Crate Nights", colour: "#1F5C99", logoUrl: null, startsAt: pt(SAT, "21:30"), endsAt: pt(SAT, "23:40") }]);
  });

  it("pauses for off-air time inside a span: two pieces, the members on both sides still in it", async () => {
    const paused = await station("BPAU", 361);
    const b = await makeBlock(paused, { name: "Split Shift" });
    const a = await program(paused, "Before", 50 * MIN);
    const c = await program(paused, "After", 50 * MIN);
    await onLog(paused, a.id, pt(SAT, "21:00"), pt(SAT, "22:00"));
    await kai.post(`/v1/stations/${paused}/log`, { kind: "off_air", startsAt: pt(SAT, "22:00"), endsAt: pt(SAT, "23:00") }).expect(201);
    await onLog(paused, c.id, pt(SAT, "23:00"), pt("2026-10-04", "00:00"));
    await place(paused, b.id, pt(SAT, "21:00"), pt("2026-10-04", "00:00"));
    const bands = (await h.services.log.blockBands([paused], new Date(pt(SAT, "20:00")), new Date(pt("2026-10-04", "01:00")))).get(paused)!;
    expect(bands.map((x) => [x.startsAt, x.endsAt])).toEqual([
      [pt(SAT, "21:00"), pt(SAT, "22:00")],
      [pt(SAT, "23:00"), pt("2026-10-04", "00:00")]
    ]);
  });
});

describe("day templates", () => {
  let id: string;
  let blockId: string;
  let templateId: string;
  beforeAll(async () => {
    id = await station("BTPL", 371);
    blockId = (await makeBlock(id, { name: "Late Crate Nights" })).id;
    const crate = await program(id, "Late Crate", 56 * MIN);
    await onLog(id, crate.id, pt(SAT, "21:00"), pt(SAT, "22:00"));
    await place(id, blockId, pt(SAT, "21:00"), pt("2026-10-04", "01:00"));
  });

  it("'Repeat this day' copies the day's blocks and generates them with its entries", async () => {
    const made = (await kai.post(`/v1/stations/${id}/log/templates`, { fromDay: SAT, pattern: "weekly" }).expect(201)).body;
    templateId = made.template.id;
    expect(made.template.blocks).toEqual([{ id: expect.any(String), blockId, name: "Late Crate Nights", colour: null, startTime: "21:00", lengthMs: 4 * 60 * MIN }]);
    const next = await logOf(id, pt("2026-10-10", "06:00"), pt("2026-10-11", "06:00"));
    expect(next.blocks).toHaveLength(1);
    expect(next.blocks[0]).toMatchObject({ blockId, startsAt: pt("2026-10-10", "21:00"), endsAt: pt("2026-10-11", "01:00"), templateId, airsFrom: pt("2026-10-10", "21:00") });
    // The block's schedule comes from its template.
    const block = (await kai.get(`/v1/stations/${id}/blocks/${blockId}`).expect(200)).body;
    expect(block.schedule).toEqual({ label: "Every Saturday, 9:00 pm to 1:00 am", next: pt(SAT, "21:00") });
    expect(block.onLog.templates).toEqual([{ templateId, name: null, label: "Every Saturday", startTime: "21:00", lengthMs: 4 * 60 * MIN }]);
  });

  it("an edited date keeps its span; changing the template remakes only the dates nobody edited", async () => {
    const edited = await logOf(id, pt("2026-10-17", "06:00"), pt("2026-10-18", "06:00"));
    await changes(id, { changes: [{ op: "block_resize", spanId: edited.blocks[0].id, endsAt: pt("2026-10-18", "00:00") }] }).expect(200);
    const res = (await kai.patch(`/v1/stations/${id}/log/templates/${templateId}`, { blocks: [{ blockId, startTime: "20:00", lengthMs: 3 * 60 * MIN }] }).expect(200)).body;
    expect(res.template.blocks.map((b: { startTime: string }) => b.startTime)).toEqual(["20:00"]);
    expect((await logOf(id, pt("2026-10-10", "06:00"), pt("2026-10-11", "06:00"))).blocks[0]).toMatchObject({ startsAt: pt("2026-10-10", "20:00"), endsAt: pt("2026-10-10", "23:00") });
    expect((await logOf(id, pt("2026-10-17", "06:00"), pt("2026-10-18", "06:00"))).blocks[0]).toMatchObject({ startsAt: pt("2026-10-17", "21:00"), endsAt: pt("2026-10-18", "00:00") });
  });

  it("refuses a block past 6:00 am in a template, and a day with one can't be repeated", async () => {
    const crossing = await kai.patch(`/v1/stations/${id}/log/templates/${templateId}`, { blocks: [{ blockId, startTime: "23:00", lengthMs: 8 * 60 * MIN }] }).expect(400);
    expect(crossing.body.error).toMatchObject({ code: "block_crosses_day", message: "A block in a day template ends by 6:00 am, when the next broadcast day starts. Make it two blocks, or place it on the date." });
    const overlapping = await kai.patch(`/v1/stations/${id}/log/templates/${templateId}`, { blocks: [{ blockId, startTime: "20:00", lengthMs: 2 * 60 * MIN }, { blockId, startTime: "21:00", lengthMs: 60 * MIN }] }).expect(400);
    expect(overlapping.body.error.code).toBe("block_overlap");
    const day = await station("BDAY", 381);
    const b = await makeBlock(day, { name: "All Night" });
    await place(day, b.id, pt(SAT, "23:00"), pt("2026-10-04", "07:00"));
    expect((await kai.post(`/v1/stations/${day}/log/templates`, { fromDay: SAT, pattern: "weekly" }).expect(422)).body.error.code).toBe("block_crosses_day");
  });

  it("taking the template off clears its blocks from the dates nobody edited", async () => {
    const removed = await kai.delete(`/v1/stations/${id}/log/templates/${templateId}`).expect(200);
    expect(removed.body.removed).toBeGreaterThan(0);
    const spans = await h.db.select().from(schema.programBlockSpans).where(and(eq(schema.programBlockSpans.stationId, id), eq(schema.programBlockSpans.blockId, blockId)));
    // The day it was built from and the edited date keep theirs.
    expect(spans.map((sp) => sp.startsAt.toISOString()).sort()).toEqual([pt(SAT, "21:00"), pt("2026-10-17", "21:00")]);
  });

  it("generates a template's span only where nothing overlaps it, counting the skip", async () => {
    const st = await station("BSKP", 391);
    const b = await makeBlock(st, { name: "Late Crate Nights" });
    const other = await makeBlock(st, { name: "In the Way" });
    await place(st, b.id, pt(SAT, "21:00"), pt(SAT, "23:00"));
    // Next Saturday already has another block at 10:00 pm (placed directly, as another template would).
    await h.db.insert(schema.programBlockSpans).values({ stationId: st, blockId: other.id, startsAt: new Date(pt("2026-10-10", "22:00")), endsAt: new Date(pt("2026-10-10", "23:30")) });
    const made = (await kai.post(`/v1/stations/${st}/log/templates`, { fromDay: SAT, pattern: "weekly" }).expect(201)).body;
    expect(made.generated.skippedForConflicts).toBe(1);
    expect((await logOf(st, pt("2026-10-10", "06:00"), pt("2026-10-11", "06:00"))).blocks.map((x: { name: string }) => x.name)).toEqual(["In the Way"]);
  });
});

describe("a block evening on the run sheet", () => {
  let id: string;
  let blockId: string;

  beforeAll(async () => {
    id = await station("BEVN", 401);
    blockId = (await makeBlock(id, { name: "Late Crate Nights", colour: "#1F5C99" })).id;
    await blockItems(id, blockId);
    const session = await program(id, "Crate Session", 56 * MIN);
    const crate = await program(id, "Late Crate", 56 * MIN);
    const reel = await program(id, "Saturday Reel", 58 * MIN);
    const desk = await program(id, "Night Desk", 56 * MIN);
    await onLog(id, session.id, pt(SAT, "20:00"), pt(SAT, "21:00"));
    await onLog(id, crate.id, pt(SAT, "21:00"), pt(SAT, "22:00"));
    await onLog(id, reel.id, pt(SAT, "22:00"), pt(SAT, "23:10"));
    await onLog(id, desk.id, pt(SAT, "23:10"), pt("2026-10-04", "00:10"));
    await place(id, blockId, pt(SAT, "21:00"), pt(SAT, "23:00"));
  }, 60_000);

  it("enters with the station's between and the block's intro; inside, its bumpers and ID; leaves with its outro and the station's between", async () => {
    const segments = await planner.plan(id, new Date(pt(SAT, "20:55")), new Date(Date.parse(pt(SAT, "23:10")) + 30_000));
    expect(shape(segments)).toEqual([
      "03:00:00 PGM 3360s",
      "03:56:00 BMP 5s Right back",
      "03:56:05 BMP 5s Back to it",
      "03:56:10 OPEN 216s",
      "03:59:46 SID 5s BEVN ident",
      // Between programs: the station's (it's the block's edge), then the block's intro.
      "03:59:51 BMP 3s Sting",
      "03:59:54 OPN 6s LCN intro [Late Crate Nights]",
      "04:00:00 PGM 3360s [Late Crate Nights]",
      // A member's break: the block's bumpers first (into: its own; out: its Any), and its ID.
      "04:56:00 BMP 4s LCN in [Late Crate Nights]",
      "04:56:04 BMP 2s LCN sting [Late Crate Nights]",
      "04:56:06 OPEN 226s [Late Crate Nights]",
      "04:59:52 SID 6s LCN ID [Late Crate Nights]",
      // Between two members: the block's own pools.
      "04:59:58 BMP 2s LCN sting [Late Crate Nights]",
      "05:00:00 PGM 3480s [Late Crate Nights]",
      "05:58:00 BMP 4s LCN in [Late Crate Nights]",
      "05:58:04 BMP 2s LCN sting [Late Crate Nights]",
      "05:58:06 OPEN 700s [Late Crate Nights]",
      "06:09:46 SID 6s LCN ID [Late Crate Nights]",
      // Saturday Reel ran past 11:00 pm: still the block's. Its automatic outro, then the station's between.
      "06:09:52 CLS 5s Late Crate Nights outro [Late Crate Nights]",
      "06:09:57 BMP 3s Sting",
      "06:10:00 PGM 3360s"
    ]);
    const intro = segments.find((s) => s.code === "OPN")!;
    expect(intro).toMatchObject({ position: "boundary", reason: "planned", inBreak: false, block: { id: blockId, bug: "logo", logoUrl: null } });
    expect(intro.breakSpan).toBeUndefined();
    const outro = segments.find((s) => s.code === "CLS")!;
    expect(outro).toMatchObject({ position: "boundary", reason: "slate", itemId: undefined });
    expect(outro.source).toMatchObject({ kind: "file", contentId: expect.stringMatching(/^blk-/) });
    // The station's between bumper at the edge is the station's: no block.
    expect(segments.find((s) => s.label === "Sting")!.block).toBeNull();
  });

  it("the log's break rows say so: the intro, the block's ID and bumpers, the outro", async () => {
    const log = await logOf(id, pt(SAT, "20:00"), pt("2026-10-04", "00:00"));
    const rows = (startsAt: string) => log.breaks.find((b: { startsAt: string }) => b.startsAt === startsAt).rows.map((r: { code: string; title: string; note: string | null; block?: { part: string } }) => `${r.code} ${r.title} | ${r.note}${r.block ? ` | ${r.block.part}` : ""}`);
    const open = "OPEN Open | Filled from the rotation about 20 minutes before";
    expect(rows(pt(SAT, "20:56"))).toEqual(["BMP Right back | Into the break", open, "BMP Back to it | Out of the break", "SID Station ID | null", "BMP Sting | Between programs", "SID LCN intro | Intro | intro"]);
    expect(rows(pt(SAT, "21:56"))).toEqual(["BMP LCN in | Into the break | bumper", open, "BMP LCN sting | Out of the break | bumper", "SID Late Crate Nights ID | Block ID | id", "BMP LCN sting | Between programs | bumper"]);
    expect(rows(pt(SAT, "22:58"))).toContain("SID Late Crate Nights outro | Outro | outro");
  });

  it("asks for the automatic card while it isn't prepared (it doesn't air until it is, never a slate)", async () => {
    const wanted: string[] = [];
    const waiting = createPlanner({ deps: h.deps, services: h.services }, { isReady: (ref) => !ref.contentId?.startsWith("blk-"), wantGenerated: async (spec) => void wanted.push(spec.key) });
    const segments = await waiting.plan(id, new Date(pt(SAT, "23:09")), new Date(pt(SAT, "23:10")));
    expect(segments.some((s) => s.code === "CLS")).toBe(false);
    expect(wanted.some((k) => k.startsWith("blk-"))).toBe(true);
  });
});

describe("precedence: block, then station, then automatic", () => {
  it("a block with its own order airs it in its breaks; the station's still airs at its edges", async () => {
    const id = await station("BORD", 411);
    const b = await makeBlock(id, { name: "Own Order", sequences: { open: { roles: ["any"], every: "break" }, close: { roles: [], every: "never" }, between: { roles: [], every: "program" } } });
    await blockItems(id, b.id);
    const one = await program(id, "One", 56 * MIN);
    const two = await program(id, "Two", 56 * MIN);
    const three = await program(id, "Three", 56 * MIN);
    await onLog(id, one.id, pt(SAT, "20:00"), pt(SAT, "21:00"));
    await onLog(id, two.id, pt(SAT, "21:00"), pt(SAT, "22:00"));
    await onLog(id, three.id, pt(SAT, "22:00"), pt(SAT, "23:00"));
    await place(id, b.id, pt(SAT, "20:00"), pt(SAT, "22:00"));
    const segments = await planner.plan(id, new Date(pt(SAT, "20:56")), new Date(pt(SAT, "22:00")));
    const bumpers = segments.filter((s) => s.code === "BMP" || s.code === "CLS").map((s) => `${hms(s.startsAt)} ${s.label}`);
    // Inside: the block's Any opening each break, nothing closing it, nothing between two members.
    // Leaving: the automatic outro, then the station's between.
    expect(bumpers).toEqual(["03:56:00 LCN sting", "04:56:00 LCN sting", "04:59:52 Own Order outro", "04:59:57 Sting"]);
  });

  it("without its own ID, intro or bumpers, the station's air (and the block's intro and outro can be off)", async () => {
    const id = await station("BBAR", 421);
    const b = await makeBlock(id, { name: "Bare", intro: false, outro: false });
    const one = await program(id, "One", 56 * MIN);
    const two = await program(id, "Two", 56 * MIN);
    await onLog(id, one.id, pt(SAT, "20:00"), pt(SAT, "21:00"));
    await onLog(id, two.id, pt(SAT, "21:00"), pt(SAT, "22:00"));
    await place(id, b.id, pt(SAT, "21:00"), pt(SAT, "22:00"));
    const segments = await planner.plan(id, new Date(pt(SAT, "20:56")), new Date(pt(SAT, "22:00")));
    expect(segments.filter((s) => ["BMP", "SID", "OPN", "CLS"].includes(s.code)).map((s) => `${hms(s.startsAt)} ${s.code} ${s.label}`)).toEqual([
      "03:56:00 BMP Right back",
      "03:56:05 BMP Back to it",
      "03:59:52 SID BBAR ident",
      "03:59:57 BMP Sting",
      "04:56:00 BMP Right back",
      "04:56:05 BMP Back to it",
      "04:59:55 SID BBAR ident"
    ]);
  });

  it("up next never falls back to the block's Any: the station's up next names the program, with its block", async () => {
    const id = await station("BUPN", 431, { sequences: { ...SEQUENCES, between: { roles: ["up_next"], every: "program" } } });
    await itemFixture(h, id, { title: "Up next", code: "BMP", bumperRole: "up_next", durationMs: 8_000 });
    const b = await makeBlock(id, { name: "Late Crate Nights" });
    await blockItems(id, b.id);
    const one = await program(id, "Crate Session", 56 * MIN);
    const two = await program(id, "Late Crate", 56 * MIN);
    const three = await program(id, "Saturday Reel", 56 * MIN);
    await onLog(id, one.id, pt(SAT, "20:00"), pt(SAT, "21:00"));
    await onLog(id, two.id, pt(SAT, "21:00"), pt(SAT, "22:00"));
    await onLog(id, three.id, pt(SAT, "22:00"), pt(SAT, "23:00"));
    await place(id, b.id, pt(SAT, "21:00"), pt(SAT, "23:00"));
    const segments = await planner.plan(id, new Date(pt(SAT, "20:56")), new Date(pt(SAT, "22:00")));
    const ups = segments.filter((s) => s.bumperRole === "up_next");
    expect(ups.map((s) => `${hms(s.startsAt)} ${s.label} ${s.announces?.title} · ${s.announces?.blockName}`)).toEqual(["03:59:46 Up next Late Crate · Late Crate Nights", "04:59:52 Up next Saturday Reel · Late Crate Nights"]);
  });

  it("the radio band has no automatic cards", async () => {
    const id = await station("BRAD", await radioTenths(h, 3), { band: "radio" });
    const b = await makeBlock(id, { name: "Radio Block" });
    const one = await program(id, "One", 56 * MIN);
    const two = await program(id, "Two", 56 * MIN);
    await onLog(id, one.id, pt(SAT, "20:00"), pt(SAT, "21:00"));
    await onLog(id, two.id, pt(SAT, "21:00"), pt(SAT, "22:00"));
    await place(id, b.id, pt(SAT, "21:00"), pt(SAT, "22:00"));
    const segments = await planner.plan(id, new Date(pt(SAT, "20:56")), new Date(pt(SAT, "22:00")));
    expect(segments.some((s) => s.code === "OPN" || s.code === "CLS")).toBe(false);
  });
});

describe("edges of a block", () => {
  it("back to back: outro A, the station's between, intro B", async () => {
    const id = await station("BBTB", 441);
    const a = await makeBlock(id, { name: "Block A" });
    const b = await makeBlock(id, { name: "Block B" });
    const one = await program(id, "One", 56 * MIN);
    const two = await program(id, "Two", 56 * MIN);
    await onLog(id, one.id, pt(SAT, "20:00"), pt(SAT, "21:00"));
    await onLog(id, two.id, pt(SAT, "21:00"), pt(SAT, "22:00"));
    await place(id, a.id, pt(SAT, "20:00"), pt(SAT, "21:00"));
    await place(id, b.id, pt(SAT, "21:00"), pt(SAT, "22:00"));
    const segments = await planner.plan(id, new Date(pt(SAT, "20:59")), new Date(pt(SAT, "21:00")));
    expect(shape(segments.filter((s) => s.startsAt >= new Date(pt(SAT, "20:59")) && s.code !== "OPEN" && s.code !== "SID"))).toEqual([
      "03:59:47 CLS 5s Block A outro [Block A]",
      "03:59:52 BMP 3s Sting",
      "03:59:55 OPN 5s Block B intro [Block B]"
    ]);
  });

  it("no room for the intro (the program before fills its slot): it's left out, and the log says so", async () => {
    const id = await station("BNRM", 451);
    const b = await makeBlock(id, { name: "Late Crate Nights" });
    await blockItems(id, b.id);
    const session = await program(id, "Crate Session", 60 * MIN);
    const crate = await program(id, "Late Crate", 56 * MIN);
    await onLog(id, session.id, pt(SAT, "20:00"), pt(SAT, "21:00"));
    await onLog(id, crate.id, pt(SAT, "21:00"), pt(SAT, "22:00"));
    await place(id, b.id, pt(SAT, "21:00"), pt(SAT, "22:00"));
    const segments = await planner.plan(id, new Date(pt(SAT, "20:55")), new Date(pt(SAT, "21:01")));
    expect(segments.some((s) => s.code === "OPN")).toBe(false);
    const log = await logOf(id, pt(SAT, "20:00"), pt(SAT, "23:00"));
    expect(log.blocks[0].problems).toEqual([{ code: "no_room_intro", message: "No room for the intro before 9:00 pm. Leave :06 at the end of Crate Session's slot." }]);
  });

  it("sign-on into a block: the station's opener, never the block's intro; the block's bug from its first program", async () => {
    const id = await station("BSGN", 461);
    const b = await makeBlock(id, { name: "Late Crate Nights" });
    await blockItems(id, b.id);
    const crate = await program(id, "Late Crate", 56 * MIN);
    await kai.post(`/v1/stations/${id}/log`, { kind: "off_air", startsAt: pt(SAT, "19:00"), endsAt: pt(SAT, "21:00") }).expect(201);
    await onLog(id, crate.id, pt(SAT, "21:00"), pt(SAT, "22:00"));
    await place(id, b.id, pt(SAT, "21:00"), pt(SAT, "22:00"));
    const segments = await planner.plan(id, new Date(pt(SAT, "20:58")), new Date(pt(SAT, "21:01")));
    expect(shape(segments)).toEqual(["02:01:05 OPEN 7130s", "03:59:55 OPN 5s 46.1 BSGN · Signing on", "04:00:00 PGM 3360s [Late Crate Nights]"]);
    expect(segments.find((s) => s.code === "OPN")).toMatchObject({ position: "sign_on", block: null });
  });

  it("a station with no blocks airs exactly as before: no block anywhere on its run sheet", async () => {
    const id = await station("BNON", 471);
    const one = await program(id, "One", 56 * MIN);
    const two = await program(id, "Two", 56 * MIN);
    await onLog(id, one.id, pt(SAT, "20:00"), pt(SAT, "21:00"));
    await onLog(id, two.id, pt(SAT, "21:00"), pt(SAT, "22:00"));
    const segments = await planner.plan(id, new Date(pt(SAT, "20:56")), new Date(pt(SAT, "21:01")));
    expect(shape(segments)).toEqual(["03:56:00 BMP 5s Right back", "03:56:05 BMP 5s Back to it", "03:56:10 OPEN 222s", "03:59:52 SID 5s BNON ident", "03:59:57 BMP 3s Sting", "04:00:00 PGM 3360s"]);
    expect(segments.every((s) => !("block" in s))).toBe(true);
    const log = await logOf(id, pt(SAT, "20:00"), pt(SAT, "23:00"));
    expect(log.blocks).toBeUndefined();
    expect(log.breaks.every((b: { rows: Array<{ block?: unknown }> }) => b.rows.every((r) => r.block === undefined))).toBe(true);
    const guide = (await h.services.log.window([id], new Date(pt(SAT, "20:00")), new Date(pt(SAT, "23:00")))).get(id)!;
    expect(guide.every((a) => !("block" in a))).toBe(true);
  });
});

describe("the viewer side and the Monitor", () => {
  let id: string;
  let blockId: string;
  let slug: string;
  beforeAll(async () => {
    id = await station("BVWR", 481);
    blockId = (await makeBlock(id, { name: "Late Crate Nights", description: "Records after dark.", colour: "#1F5C99" })).id;
    const crate = await program(id, "Late Crate", 56 * MIN);
    const reel = await program(id, "Saturday Reel", 56 * MIN);
    await onLog(id, crate.id, pt(SAT, "12:00"), pt(SAT, "13:00"));
    await onLog(id, reel.id, pt(SAT, "13:00"), pt(SAT, "14:00"));
    await onLog(id, crate.id, pt(SAT, "21:00"), pt(SAT, "22:00"));
    await onLog(id, reel.id, pt(SAT, "22:00"), pt(SAT, "23:00"));
    await place(id, blockId, pt(SAT, "21:00"), pt(SAT, "23:00"));
    await kai.post(`/v1/stations/${id}/log/templates`, { fromDay: SAT, pattern: "weekly" }).expect(201);
    // And this afternoon, on now (placed after the template was made).
    await h.db.insert(schema.programBlockSpans).values({ stationId: id, blockId, startsAt: new Date(pt(SAT, "12:00")), endsAt: new Date(pt(SAT, "14:00")) });
    await h.db.insert(schema.playoutState).values({ stationId: id, onAir: true });
    slug = "bvwr";
  });

  it("the guide's rows carry the station's blocks; the dial's now names its block", async () => {
    const guide = (await kai.get(`/v1/markets/inland-empire/guide?band=tv&from=${pt(SAT, "12:00")}&to=${pt("2026-10-04", "00:00")}`).expect(200)).body;
    const row = guide.rows.find((r: { station: { id: string } }) => r.station.id === id);
    expect(row.blocks).toEqual([
      { id: blockId, name: "Late Crate Nights", colour: "#1F5C99", logoUrl: null, startsAt: pt(SAT, "12:00"), endsAt: pt(SAT, "14:00") },
      { id: blockId, name: "Late Crate Nights", colour: "#1F5C99", logoUrl: null, startsAt: pt(SAT, "21:00"), endsAt: pt(SAT, "23:00") }
    ]);
    expect(row.airings.find((a: { title: string; startsAt: string }) => a.startsAt === pt(SAT, "21:00")).block).toEqual({ id: blockId, name: "Late Crate Nights", colour: "#1F5C99" });
    // Rows without blocks leave it out.
    expect(guide.rows.filter((r: { blocks?: unknown }) => r.blocks).length).toBeGreaterThan(0);
    const dial = (await kai.get(`/v1/markets/inland-empire/dial?band=tv`).expect(200)).body;
    expect(dial.rows.find((r: { station: { id: string } }) => r.station.id === id).now.block).toMatchObject({ name: "Late Crate Nights" });
  });

  it("the station page lists its blocks: schedule, next airing and programs", async () => {
    const page = (await kai.get(`/v1/stations/${slug}`).expect(200)).body;
    expect(page.blocks).toEqual([
      { id: blockId, name: "Late Crate Nights", description: "Records after dark.", logoUrl: null, colour: "#1F5C99", schedule: "Saturdays, 9:00 pm to 11:00 pm", next: pt(SAT, "12:00"), programs: ["Late Crate", "Saturday Reel"] }
    ]);
  });

  it("the Monitor: the block on now, and the one the next program enters", async () => {
    h.clock.set(pt(SAT, "13:30"));
    const now = (await kai.get(`/v1/stations/${id}/playout`).expect(200)).body;
    expect(now.block).toMatchObject({ id: blockId, name: "Late Crate Nights", startsAt: pt(SAT, "12:00"), endsAt: pt(SAT, "14:00") });
    // The next program (9:00 pm) enters the block again: another stretch of it.
    expect(now.next).toMatchObject({ title: "Late Crate", block: { name: "Late Crate Nights", startsAt: pt(SAT, "21:00") } });
    h.clock.set(pt(SAT, "20:30"));
    try {
      const later = (await kai.get(`/v1/stations/${id}/playout`).expect(200)).body;
      expect(later.block ?? null).toBeNull();
      expect(later.next.block).toMatchObject({ name: "Late Crate Nights", startsAt: pt(SAT, "21:00") });
    } finally {
      h.clock.set(pt(SAT, "13:00"));
    }
  });
});

describe("an assembled channel in a block", () => {
  let engine: Engine;
  let id: string;
  let reel: { id: string };
  let blockId: string;
  let agreementId: string;
  const fake = fakeTranscoder();
  const START = "2026-10-05T03:00:00.000Z";

  async function spot(owner: User, businessId: string, title: string) {
    const s = await owner.post(`/v1/businesses/${businessId}/spots`, { title, lengthSec: 15, category: "Food", rate: { kind: "per_airing", micros: $(4) }, budget: { totalMicros: $(40), dailyCapMicros: $(12) } }).expect(201);
    const { cid } = await h.services.library.content.store(await dummyFile(), { storageClass: "standard" });
    await h.db.insert(schema.spotFiles).values({ spotId: s.body.id, version: 1, contentId: cid, durationMs: 15_000 });
    await h.db.update(schema.spotsTable).set({ status: "listed" }).where(eq(schema.spotsTable.id, s.body.id));
    return s.body.id as string;
  }

  beforeAll(async () => {
    h.clock.set("2026-10-05T02:59:10.000Z");
    const reelOwner = await h.signIn("Reel");
    id = (await stationFixture(h, { callSign: "BASM", name: "Inland Beat", ownerId: kai.id, marketId, tenths: 491, signedOn: true, colour: "#8C3B7A" })).id;
    reel = await stationFixture(h, { callSign: "BREL", name: "Reel", ownerId: reelOwner.id, marketId, tenths: 501, signedOn: true });
    await kai.put(`/v1/stations/${id}/break-rule`, { ...RULE, spotMsPerHour: 600_000, sameSpotPerHour: 4, bumperSequences: { open: { roles: ["into_break"], every: "break" }, close: { roles: [], every: "break" }, between: { roles: [], every: "program" } } }).expect(200);
    await itemFixture(h, id, { title: "BASM ident", code: "SID", durationMs: 4_000, location: await dummyFile() });
    blockId = (await makeBlock(id, { name: "Late Crate Nights", colour: "#1F5C99", bug: "logo" })).id;
    await kai.post(`/v1/stations/${id}/blocks/${blockId}/logo`).attach("file", await picture()).expect(200);
    await itemFixture(h, id, { title: "LCN in", code: "BMP", bumperRole: "into_break", durationMs: 4_000, location: await dummyFile(), programBlockId: blockId });
    await itemFixture(h, id, { title: "LCN ID", code: "SID", durationMs: 4_000, location: await dummyFile(), programBlockId: blockId });
    await itemFixture(h, id, { title: "LCN intro", code: "OPN", durationMs: 4_000, location: await dummyFile(), programBlockId: blockId });
    const p1 = await kai.post(`/v1/stations/${id}/programs`, { title: "Crate Session", description: "Records." }).expect(201);
    const p2 = await kai.post(`/v1/stations/${id}/programs`, { title: "Late Crate", description: "Records." }).expect(201);
    const session = await itemFixture(h, id, { title: "Session 1", programId: p1.body.id, durationMs: 20_000, location: await dummyFile() });
    const crate = await itemFixture(h, id, { title: "Late Crate 1", programId: p2.body.id, durationMs: 20_000, location: await dummyFile() });

    // REEL's program, carried under barter: its breaks are half REEL's.
    const reelProgram = await reelOwner.post(`/v1/stations/${reel.id}/programs`, { title: "Saturday Reel", description: "Films." }).expect(201);
    const episode = await itemFixture(h, reel.id, { programId: reelProgram.body.id, title: "Reel 1", durationMs: 20_000, location: await dummyFile() });
    const offer = await reelOwner
      .post(`/v1/programs/${reelProgram.body.id}/offer`, { termsOffered: ["barter"], cashPriceMicros: null, cashPriceUnit: null, barterMakerMsPerHour: 1_800_000, airingsPerEpisode: null, windowDays: 7, liveOnly: false, noticeDays: 7, approval: "any_station", radioBandAllowed: true })
      .expect(201);
    await kai.post(`/v1/catalog/offers/${offer.body.id}/requests`, { carrierStationId: id, term: "barter", slots: [{ weekday: 0, time: "20:02" }], startsOn: "2026-10-01" }).expect(201);
    agreementId = (await kai.get(`/v1/stations/${id}/carriage/agreements`).expect(200)).body.carrying[0].id;
    const b = await jess.post("/v1/businesses", { name: "Orange Street Coffee", category: "Coffee and food", customersWhere: "online", marketIds: [marketId] }).expect(201);
    const card = await jess.post(`/v1/businesses/${b.body.id}/funding-sources`, { kind: "card", token: "tok_4417" }).expect(201);
    await jess.post(`/v1/businesses/${b.body.id}/deposits`, { amountMicros: $(100), fundingSourceId: card.body[0].id }).expect(201);
    const reelSpot = await spot(jess, b.body.id, "Reel sponsor");
    await h.db.insert(schema.rotations).values({ stationId: reel.id, kind: "main" }).onConflictDoNothing();
    const [rotation] = await h.db.select().from(schema.rotations).where(eq(schema.rotations.stationId, reel.id));
    await h.db.insert(schema.rotationSpots).values({ rotationId: rotation.id, spotId: reelSpot, position: 0 });

    // 8:00 pm Crate Session (40 s slot), 8:00:40 Late Crate (member, 40 s), 8:01:20 Saturday Reel (carried member, 60 s).
    await onLog(id, session.id, START, "2026-10-05T03:00:40.000Z");
    await onLog(id, crate.id, "2026-10-05T03:00:40.000Z", "2026-10-05T03:01:20.000Z");
    await kai.post(`/v1/stations/${id}/log`, { kind: "program", startsAt: "2026-10-05T03:01:20.000Z", endsAt: "2026-10-05T03:02:20.000Z", itemId: episode.id, carriageAgreementId: agreementId }).expect(201);
    await place(id, blockId, "2026-10-05T03:00:40.000Z", "2026-10-05T03:03:00.000Z");
    await h.db.insert(schema.playoutState).values({ stationId: id, onAir: true }).onConflictDoNothing();
    engine = createEngine({ deps: h.deps, services: h.services }, { transcoder: fake, log: () => undefined });
    await engine.tick();
    await prepareQueued(h, engine.preparer);
  }, 120_000);
  afterAll(async () => {
    await engine?.stopAll();
    h.clock.set(pt(SAT, "13:00"));
  });

  it("draws the block's logo as the bug over its members, records the block in the as-run log, and the maker's barter spot still airs", async () => {
    const end = Date.parse("2026-10-05T03:02:40.000Z");
    let playlist = "";
    while (h.clock.now().getTime() < end) {
      h.clock.advance(2_000);
      await engine.tick();
      await prepareQueued(h, engine.preparer);
      if (h.clock.now().getTime() === Date.parse("2026-10-05T03:01:30.000Z")) playlist = (await h.services.playout.playlist(id, "v720.m3u8"))!.body;
    }
    await h.deps.bus.settle();
    const ranges = parseDateRanges(playlist);
    const bugs = ranges.filter((r) => r.class === HLS_CLASS.bug).map((r) => ({ at: new Date(r.start).toISOString(), ...HlsBug.parse(r.attributes) }));
    const session = bugs.find((b) => b.at === START)!;
    expect(session).toMatchObject({ mode: "call_sign_and_channel" });
    expect(session.blockId ?? null).toBeNull();
    const member = bugs.find((b) => b.at === "2026-10-05T03:00:40.000Z")!;
    expect(member).toMatchObject({ mode: "logo", blockId, position: "bottom_right", opacity: 78 });
    expect(member.logoUrl).toMatch(/\/objects\//);
    // The intro's item tag says SID (players built before A242 know it), with its ident code.
    const intro = ranges.find((r) => r.class === HLS_CLASS.item && r.attributes.title === "LCN intro")!;
    expect(intro.attributes).toMatchObject({ code: "SID", identCode: "OPN" });
    expect(ranges.filter((r) => r.class === HLS_CLASS.upNext).map((r) => HlsUpNext.parse(r.attributes))).toEqual([]);

    const rows = await h.db.select().from(schema.asRun).where(eq(schema.asRun.stationId, id)).orderBy(asc(schema.asRun.startedAt));
    const fmt = (r: (typeof rows)[number]) => `${r.startedAt.toISOString().slice(11, 19)} ${r.code}${r.position ? ` ${r.position}` : ""}${r.programBlockId ? " [block]" : ""}`;
    const evening = rows.filter((r) => r.startedAt >= new Date(START)).map(fmt);
    expect(evening).toContain("03:00:36 OPN boundary [block]");
    expect(evening).toContain("03:00:40 PGM [block]");
    expect(evening.filter((r) => r.includes(" SID") && r.startsWith("03:01"))).toEqual(expect.arrayContaining([expect.stringContaining("[block]")]));
    expect(evening[0]).toBe("03:00:00 PGM");
    const asRun = (await kai.get(`/v1/stations/${id}/as-run?from=${START}&to=2026-10-05T03:03:00.000Z`).expect(200)).body;
    expect(asRun.find((r: { identCode: string | null }) => r.identCode === "OPN")).toMatchObject({ code: "SID", title: "LCN intro", position: "boundary", block: { id: blockId, name: "Late Crate Nights" } });
    expect(asRun.find((r: { title: string }) => r.title === "LCN ID")).toMatchObject({ code: "SID", block: { name: "Late Crate Nights" } });

    // Saturday Reel's barter break, under the block: REEL's spot airs, and REEL is paid as before.
    const producer = rows.filter((r) => r.code === "SPT" && r.carriageAgreementId === agreementId);
    expect(producer).toHaveLength(1);
    expect(producer[0].programBlockId).toBe(blockId);
    expect((await h.services.ledger.stationEarnings(reel.id, "month")).account.availableMicros).toBe($(4));
  }, 120_000);
});
