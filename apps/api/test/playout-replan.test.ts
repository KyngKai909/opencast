// A replan while programs are already written ahead (2026-10-10), without FFmpeg, on a frozen
// clock. Found in the Phase 6 realtime tests: another station's generated station ID became ready
// mid-air, every channel planned again, and the program written next (rows go 20 s ahead) aired
// the station ID slate for its whole length: the cut deleted its row but the assembler still
// counted it as aired. Now what's cut airs again as planned, and only the stations whose run
// sheets went without an item plan again when it becomes ready.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createEngine, type Engine } from "../src/v1/modules/playout/engine/index.js";
import type { TranscodeJob } from "../src/v1/modules/playout/engine/prepare.js";
import { createHarness, dummyFile, fakeTranscoder, itemFixture, market, stationFixture, type Harness } from "./harness.js";

let h: Harness;
let engine: Engine;
let beat: { id: string };
let reelCid: string;
let heldCid: string;
const fake = fakeTranscoder();
/** The late program's file is held back until the test lets it through. */
let release: () => void = () => undefined;
const gate = new Promise<void>((resolve) => (release = resolve));
const transcoder = async (job: TranscodeJob) => {
  if (job.key === heldCid) await gate;
  return fake(job);
};
const at = (s: number) => new Date(Date.parse("2026-10-02T04:00:00.000Z") + s * 1000);
const rows = async () => h.db.select().from(schema.channelItems).where(eq(schema.channelItems.stationId, beat.id)).orderBy(asc(schema.channelItems.seq));
/** The rows from `s` seconds on, as `start code label`. */
const from = async (s: number) => (await rows()).filter((r) => r.startsAt >= at(s) && r.kind !== "end").map((r) => `${(r.startsAt.getTime() - at(0).getTime()) / 1000} ${r.code} ${r.label}`);

/** Prepares everything queued but the held file. */
async function prepareAllButHeld() {
  for (let i = 0; i < 400; i++) {
    await engine.preparer.pump();
    const [left] = await h.db
      .select({ key: schema.preparedItems.key })
      .from(schema.preparedItems)
      .where(and(inArray(schema.preparedItems.status, ["queued", "preparing"]), ne(schema.preparedItems.key, heldCid)))
      .limit(1);
    if (!left) return;
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function runUntil(s: number) {
  while (h.clock.now() < at(s)) {
    h.clock.advance(Math.min(2_000, at(s).getTime() - h.clock.now().getTime()));
    await engine.tick();
    await prepareAllButHeld();
  }
}

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-10-02T03:59:20.000Z");
  const m = await market(h);
  const kai = await h.signIn("Kai");
  const dee = await h.signIn("Dee");
  beat = await stationFixture(h, { callSign: "BEAT", ownerId: kai.id, marketId: m.id, tenths: 121, signedOn: true });
  const reel = await stationFixture(h, { callSign: "REEL", ownerId: dee.id, marketId: m.id, tenths: 241, signedOn: true });
  // No breaks: each program fills its slot.
  await kai.put(`/v1/stations/${beat.id}/break-rule`, { mode: "after_every_program", everyMinutes: null, lengthMs: 120_000, spotMsPerHour: 180_000, sameSpotPerHour: 2, fillOrder: ["SPT", "UND", "BMP", "SID"], openTimeTo: "station_id_and_bumpers", blockedCategories: [] }).expect(200);
  await itemFixture(h, beat.id, { title: "BEAT ident", code: "SID", durationMs: 4_000, location: await dummyFile() });
  const program = async (title: string, s: number, e: number) => {
    const item = await itemFixture(h, beat.id, { title, durationMs: 12_000, location: await dummyFile() });
    await kai.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt: at(s).toISOString(), endsAt: at(e).toISOString(), itemId: item.id }).expect(201);
    return (await h.services.library.currentContent([item.id])).get(item.id)!;
  };
  await program("Side A", 0, 12);
  await program("Side B", 12, 24);
  await program("Side C", 24, 36);
  heldCid = await program("Late Tape", 36, 48);
  // A long last slot, so there's no dead air to fill (which plans again) while it runs.
  await program("Side D", 48, 120);
  // Another station's item, on no log here.
  const reelItem = await itemFixture(h, reel.id, { title: "Night Reel 1", durationMs: 12_000, location: await dummyFile() });
  reelCid = (await h.services.library.currentContent([reelItem.id])).get(reelItem.id)!;
  await h.db.insert(schema.playoutState).values({ stationId: beat.id, onAir: true });
  engine = createEngine({ deps: h.deps, services: h.services }, { transcoder, prepareConcurrency: 2, log: () => undefined });
  await engine.sweep();
  await prepareAllButHeld();
}, 60_000);

afterAll(async () => {
  release();
  await engine?.stopAll();
  await h.close();
});

describe("a replan with programs written ahead", () => {
  it("keeps them: the programs after the one on air are written again as programs, not the station ID slate", async () => {
    await runUntil(6);
    // Side A on air; B and C written ahead (rows go 20 s ahead).
    expect(await from(12)).toEqual(expect.arrayContaining(["12 PGM Side B", "24 PGM Side C"]));
    // The log changed (or anything this station waits on became ready): plan again.
    engine.assemblers.get(beat.id)!.replan();
    await engine.tick();
    const after = await from(12);
    expect(after.slice(0, 2)).toEqual(["12 PGM Side B", "24 PGM Side C"]);
    expect(after.filter((r) => r.includes("Station ID slate") && !r.startsWith("36 "))).toEqual([]);
    // And they air whole: Side C's three segments.
    const c = (await rows()).find((r) => r.label === "Side C")!;
    expect(c.segments).toBe(3);
    expect(c.reason).toBe("planned");
  });

  it("doesn't plan again when an item no run sheet here went without becomes ready (another station's)", async () => {
    await runUntil(14);
    const before = (await rows()).find((r) => r.label === "Side C")!;
    await engine.preparer.want([{ contentId: reelCid, mediaKind: "video", band: "tv", durationMs: 12_000 }]);
    await prepareAllButHeld();
    expect(engine.preparer.isReady(reelCid, "tv")).toBe(true);
    await runUntil(16);
    // Side C's row is the same row: nothing was cut or written again.
    const after = (await rows()).find((r) => r.label === "Side C")!;
    expect(after.id).toBe(before.id);
  });

  it("plans again when an item this station went without becomes ready, and airs it from the next boundary", async () => {
    await runUntil(20);
    // Not prepared: its slot is written as the station ID slate (and the station ID).
    expect((await from(36))[0]).toBe("36 OPEN Station ID slate");
    release();
    for (let i = 0; i < 200 && !engine.preparer.isReady(heldCid, "tv"); i++) await new Promise((r) => setTimeout(r, 20));
    expect(engine.preparer.isReady(heldCid, "tv")).toBe(true);
    await runUntil(30);
    expect((await from(36))[0]).toBe("36 PGM Late Tape");
  });
});
