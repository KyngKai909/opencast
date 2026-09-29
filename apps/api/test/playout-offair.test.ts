// Planned off air in the current worker (added 2026-09-29): after the sign-off slate the outputs
// close and the playlist ends with #EXT-X-ENDLIST; at the back time a new playlist starts. ffmpeg
// in real time, about 25 seconds (a new playlist takes a few seconds to appear).
import { promises as fs } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createPlanner, type Segment } from "../src/v1/modules/playout/engine/plan.js";
import { StationRunner } from "../src/v1/modules/playout/engine/runner.js";
import { createHarness, market, stationFixture, type Harness } from "./harness.js";

let h: Harness;
let stationId: string;

beforeAll(async () => {
  h = await createHarness({ realTime: true });
  const m = await market(h);
  stationId = (await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", marketId: m.id, tenths: 121, signedOn: true, colour: "#8C3B7A" })).id;
  await h.db.insert(schema.playoutState).values({ stationId, onAir: true });
}, 60_000);
afterAll(() => h.close());

const sleepUntil = (t: number) => new Promise((r) => setTimeout(r, Math.max(0, t - Date.now())));

describe("off air in the worker", () => {
  it("ends the playlist after the sign-off slate, and starts a new one at the back time", async () => {
    const logs: string[] = [];
    const planner = createPlanner({ deps: h.deps, services: h.services });
    const look = { callSign: "BEAT", channel: "12.1", name: "Inland Beat", homeCity: null, colour: "#8C3B7A" };
    const t0 = Math.ceil((Date.now() + 2_000) / 1000) * 1000;
    const slate = await planner.slates.offAir(look, "6:00 am");
    const sid = await planner.slates.stationId(look);
    const at = (s: number) => new Date(t0 + s * 1000);
    const segments: Segment[] = [
      { key: "slate", startsAt: at(0), endsAt: at(4), code: "OPEN", label: "Off air", source: { kind: "image", path: slate }, reason: "slate", inBreak: false },
      { key: "dark", startsAt: at(4), endsAt: at(9), code: "OPEN", label: "Off air", source: { kind: "off", backAt: at(9) }, reason: "slate", inBreak: false },
      { key: "sid", startsAt: at(9), endsAt: at(22), code: "OPEN", label: "Station ID slate", source: { kind: "image", path: sid }, reason: "station_id_fill", inBreak: false }
    ];
    const hlsDir = path.join(h.deps.config.storageRoot, "hls", stationId);
    const runner = new StationRunner({ deps: h.deps, services: h.services }, stationId, {
      hlsDir,
      outputs: [],
      plan: async () => segments,
      slates: planner.slates,
      look: { ...look, bug: { mode: "off", opacity: 78 } },
      liveInput: async () => null,
      appOrigin: "https://app.opencast.test",
      log: (line) => logs.push(`${new Date().toISOString()} ${line}`)
    });
    await sleepUntil(t0 - 500);
    runner.start();

    await sleepUntil(t0 + 7_000);
    const ended = await fs.readFile(path.join(hlsDir, "index.m3u8"), "utf8");
    expect(ended.trimEnd().endsWith("#EXT-X-ENDLIST")).toBe(true);
    expect(ended).toMatch(/seg_\d+\.ts/);

    await sleepUntil(t0 + 20_000);
    const back = await fs.readFile(path.join(hlsDir, "index.m3u8"), "utf8").catch((error) => {
      console.log(logs.join("\n"));
      throw error;
    });
    expect(back).not.toMatch(/#EXT-X-ENDLIST/);
    expect(back).toMatch(/seg_000000000\.ts/);
    await runner.stop();

    // What aired: the slate and the station ID. Nothing while off air.
    const rows = await h.db.select().from(schema.asRun).where(eq(schema.asRun.stationId, stationId)).orderBy(asc(schema.asRun.startedAt));
    expect(rows.map((r) => r.reason)).toEqual(["slate", "station_id_fill"]);
    expect(rows[1].startedAt.getTime()).toBeGreaterThanOrEqual(t0 + 8_500);
  }, 60_000);
});
