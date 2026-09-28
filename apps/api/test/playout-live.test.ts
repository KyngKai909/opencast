// A live block for real: the encoder connects late, airs, then drops. Stand-by slate
// until the signal comes, live while it's there, the slate again when it goes, and
// the station told. About 30 seconds.
import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createEngine } from "../src/v1/modules/playout/engine/index.js";
import { createHarness, market, stationFixture, type Harness } from "./harness.js";

const PORT = 19351;
let h: Harness;
let stationId: string;
let t0: number;
const logs: string[] = [];

beforeAll(async () => {
  h = await createHarness({ realTime: true });
  const m = await market(h);
  const kai = await h.signIn("Kai");
  const station = await stationFixture(h, { callSign: "LIVE", name: "Live Test", ownerId: kai.id, marketId: m.id, tenths: 131, signedOn: true });
  stationId = station.id;
  const [source] = await h.db.insert(schema.liveSources).values({ stationId, kind: "encoder", name: "Studio A", streamKey: "test-key" }).returning();
  t0 = Math.ceil((Date.now() + 3_000) / 1000) * 1000;
  await h.db.insert(schema.logEntries).values({ stationId, startsAt: new Date(t0), endsAt: new Date(t0 + 24_000), kind: "live", code: "PGM", liveSourceId: source.id });
  await h.db.insert(schema.playoutState).values({ stationId, onAir: true });
}, 60_000);

afterAll(() => h.close());

function encoder(seconds: number) {
  return spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-re", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=220", "-t", String(seconds), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", "30", "-c:a", "aac", "-f", "flv", `rtmp://127.0.0.1:${PORT}/live/test-key`], { stdio: "ignore" });
}

describe("live block", () => {
  it("stands by without a signal, airs the encoder while it's there, and stands by again", async () => {
    const engine = createEngine({ deps: h.deps, services: h.services }, { liveListen: { host: "127.0.0.1", port: PORT }, log: (l) => logs.push(l) });
    let pushed = false;
    while (Date.now() < t0 + 25_000) {
      if (!pushed && Date.now() >= t0 + 5_000) {
        pushed = true;
        encoder(9);
      }
      await engine.tick();
      await new Promise((r) => setTimeout(r, 500));
    }
    await engine.stopAll();
    await h.deps.bus.settle();

    const rows = await h.db.select().from(schema.asRun).where(eq(schema.asRun.stationId, stationId)).orderBy(asc(schema.asRun.startedAt));
    const block = rows.filter((r) => r.startedAt.getTime() >= t0 - 500 && r.startedAt.getTime() < t0 + 24_000);
    expect(block.map((r) => r.reason)).toEqual(["slate", "live", "slate"]);
    const [before, live, after] = block;
    // The slate from the top of the block, live within a couple of seconds of the encoder, for most of its push.
    expect(Math.abs(before.startedAt.getTime() - t0)).toBeLessThan(2_500);
    expect(live.startedAt.getTime() - (t0 + 5_000)).toBeLessThan(3_500);
    expect(live.endedAt.getTime() - live.startedAt.getTime()).toBeGreaterThan(5_000);
    expect(after.endedAt.getTime()).toBeGreaterThan(t0 + 22_000);
    // No gaps between them: the station never went silent.
    expect(live.startedAt.getTime() - before.endedAt.getTime()).toBeLessThan(500);
    expect(after.startedAt.getTime() - live.endedAt.getTime()).toBeLessThan(500);

    const notices = await h.db.select().from(schema.notices);
    expect(notices.some((n) => n.kind === "signal_lost")).toBe(true);
  }, 90_000);
});
