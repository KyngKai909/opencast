// Cleaner pictures from prepare (programming prompt, Phase 1). Fixtures made with lavfi: an HLG
// phone clip, a PQ (HDR10) clip, an interlaced clip that says so, one that doesn't (idet finds it),
// and a vertical phone clip stored sideways with a rotation. The probe reads each; the filter graph
// deinterlaces, then sets the frame rate, then tonemaps, then scales; every rendition comes out
// tagged BT.709, the HDR ones as colourful as the scene was, the vertical one upright and
// pillarboxed. Items prepared before are probed by the re-prepare job, the HDR one prepared again
// beside its first copy, and it airs from the new copy once that's ready.
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { LADDER, scaledLadder } from "../src/v1/modules/playout/engine/ladder.js";
import { createPreparer, ffmpegTranscoder, pictureFilters, probe, refKey, syncPreparedVersions, versionedKey, type Picture, type Preparer } from "../src/v1/modules/playout/engine/prepare.js";
import { prepareCleanerPictures } from "../src/v1/storageMaintenance.js";
import { createHarness, itemFixture, prepareQueued, stationFixture, testClip, type Harness } from "./harness.js";

let dir: string;
const clips: Record<"hlg" | "pq" | "interlaced" | "unflagged" | "vertical", string> = { hlg: "", pq: "", interlaced: "", unflagged: "", vertical: "" };

function run(args: string[], command = "ffmpeg"): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args);
    const out: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(out), stderr }));
  });
}

async function ffmpeg(args: string[]) {
  const result = await run(["-hide_banner", "-loglevel", "error", "-y", ...args]);
  if (result.code !== 0) throw new Error(result.stderr);
}

/** A stream's colour tags and field order, as ffprobe reads them. */
async function tags(file: string) {
  const { stdout } = await run(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_space,color_transfer,color_primaries,field_order", "-of", "json", file], "ffprobe");
  return (JSON.parse(stdout.toString()) as { streams: Array<Record<string, string>> }).streams[0];
}

/** Average saturation (signalstats) of a file's frames after these filters. */
async function saturation(file: string, filters = "null"): Promise<number> {
  const { stderr } = await run(["-hide_banner", "-nostats", "-i", file, "-vf", `${filters},signalstats,metadata=print:key=lavfi.signalstats.SATAVG`, "-f", "null", "-"]);
  const values = [...stderr.matchAll(/SATAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** A frame as RGB, and a pixel of it. */
async function frame(file: string, width: number, height: number) {
  const { stdout } = await run(["-v", "error", "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  expect(stdout.length).toBe(width * height * 3);
  return (x: number, y: number) => [...stdout.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)];
}

/** Prepares one file to a rendition with the real transcoder; returns its first segment. */
async function transcode(file: string, rendition = LADDER.v360) {
  const outDir = await fs.mkdtemp(path.join(dir, "out-"));
  const result = await ffmpegTranscoder({ preset: "ultrafast" })({ key: path.basename(file), source: { kind: "file", path: file }, mediaKind: "video", durationMs: null, renditions: [rendition], outDir });
  return { result, segment: path.join(outDir, rendition.name, "seg_00000.ts") };
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencast-pictures-"));
  const scene = "testsrc2=size=640x360:rate=30:duration=3";
  const hdr = (transfer: string) => `zscale=tin=bt709:min=bt709:pin=bt709:rin=tv:t=${transfer}:p=bt2020:m=bt2020nc:r=tv:npl=100,format=yuv420p10le`;
  const tagged = (transfer: string) => ["-c:v", "libx264", "-preset", "ultrafast", "-color_trc", transfer, "-color_primaries", "bt2020", "-colorspace", "bt2020nc"];
  clips.hlg = path.join(dir, "hlg.mp4");
  clips.pq = path.join(dir, "pq.mp4");
  clips.interlaced = path.join(dir, "interlaced.mp4");
  clips.unflagged = path.join(dir, "unflagged.avi");
  clips.vertical = path.join(dir, "vertical.mp4");
  const sideways = path.join(dir, "sideways.mp4");
  // A moving picture at 60 fields a second, woven into 30 frames: combed wherever it moves.
  const fields = "testsrc2=size=720x480:rate=60:duration=3,interlace=scan=tff";
  await Promise.all([
    ffmpeg(["-f", "lavfi", "-i", scene, "-vf", hdr("arib-std-b67"), ...tagged("arib-std-b67"), clips.hlg]),
    ffmpeg(["-f", "lavfi", "-i", scene, "-vf", hdr("smpte2084"), ...tagged("smpte2084"), clips.pq]),
    ffmpeg(["-f", "lavfi", "-i", fields, "-c:v", "libx264", "-preset", "ultrafast", "-flags", "+ildct+ilme", "-x264-params", "tff=1", clips.interlaced]),
    ffmpeg(["-f", "lavfi", "-i", fields, "-c:v", "mpeg4", "-q:v", "2", clips.unflagged]),
    // A phone held upright: the scene (red along its top, green along its bottom) stored on its side, as the sensor sees it.
    ffmpeg(["-f", "lavfi", "-i", "color=c=gray:size=360x640:rate=30:duration=3,drawbox=x=0:y=0:w=360:h=80:color=red:t=fill,drawbox=x=0:y=560:w=360:h=80:color=green:t=fill", "-vf", "transpose=cclock", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", sideways])
  ]);
  await ffmpeg(["-display_rotation", "-90", "-i", sideways, "-c", "copy", clips.vertical]);
}, 60_000);

describe("the probe", () => {
  it("reads HLG and PQ from the colour transfer", async () => {
    expect((await probe(clips.hlg)).picture).toMatchObject({ transfer: "arib-std-b67", primaries: "bt2020", space: "bt2020nc", hdr: "hlg", interlaced: false, rotation: 0 });
    expect((await probe(clips.pq)).picture).toMatchObject({ transfer: "smpte2084", hdr: "pq", interlaced: false });
  });

  it("reads interlacing from the field order, or from an idet sample when the file doesn't say", async () => {
    expect((await probe(clips.interlaced)).picture).toMatchObject({ fieldOrder: "tt", interlaced: true, parity: null, hdr: null });
    expect((await probe(clips.unflagged)).picture).toMatchObject({ fieldOrder: null, interlaced: true, parity: "tff" });
    // An ordinary progressive clip: nothing to do.
    expect((await probe(await testClip(4))).picture).toMatchObject({ fieldOrder: "progressive", interlaced: false, hdr: null, rotation: 0 });
  }, 30_000);

  it("reads a phone clip's rotation: turn it a quarter clockwise", async () => {
    expect((await probe(clips.vertical)).picture).toMatchObject({ rotation: 90, hdr: null, interlaced: false });
  });
});

describe("the filter graph", () => {
  const plain: Picture = { transfer: null, primaries: null, space: null, fieldOrder: "progressive", rotation: 0, dolbyVision: false, hdr: null, interlaced: false, parity: null };

  it("deinterlaces, then sets the frame rate, then tonemaps, then 8-bit for the scalers", () => {
    const graph = pictureFilters({ ...plain, transfer: "arib-std-b67", space: "bt2020nc", primaries: "bt2020", fieldOrder: "tt", hdr: "hlg", interlaced: true });
    expect(graph).toEqual([
      "bwdif=mode=send_frame",
      "fps=30",
      "zscale=tin=arib-std-b67:min=bt2020nc:pin=bt2020:t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv",
      "format=yuv420p"
    ]);
    expect(pictureFilters({ ...plain, transfer: "smpte2084", hdr: "pq" })[1]).toMatch(/^zscale=tin=smpte2084:min=bt2020nc:pin=bt2020:/);
    expect(pictureFilters({ ...plain, interlaced: true, parity: "bff" })[0]).toBe("bwdif=mode=send_frame:parity=bff");
  });

  it("turns a rotated picture upright before anything else but deinterlacing", () => {
    expect(pictureFilters({ ...plain, rotation: 90 })).toEqual(["transpose=clock", "fps=30", "format=yuv420p"]);
    expect(pictureFilters({ ...plain, rotation: 270, interlaced: true })).toEqual(["bwdif=mode=send_frame", "transpose=cclock", "fps=30", "format=yuv420p"]);
    expect(pictureFilters({ ...plain, rotation: 180 })[0]).toBe("hflip,vflip");
  });

  it("leaves an ordinary picture as it was (and a file with no picture probed)", () => {
    expect(pictureFilters(plain)).toEqual(["fps=30", "format=yuv420p"]);
    expect(pictureFilters(null)).toEqual(["fps=30", "format=yuv420p"]);
  });
});

describe("what comes out", () => {
  it("tonemaps HLG and PQ to BT.709, tagged, as colourful as the scene and not washed out", async () => {
    for (const clip of [clips.hlg, clips.pq]) {
      const { result, segment } = await transcode(clip);
      expect(result.picture?.hdr).toBe(clip === clips.hlg ? "hlg" : "pq");
      expect(await tags(segment)).toMatchObject({ color_space: "bt709", color_transfer: "bt709", color_primaries: "bt709", field_order: "progressive" });
      // The old pipeline: the HDR signal taken as it was, grey.
      const washedOut = await saturation(clip, "format=yuv420p");
      const after = await saturation(segment);
      expect(after).toBeGreaterThan(washedOut * 1.4);
    }
  }, 60_000);

  it("deinterlaces: the combing is gone", async () => {
    for (const clip of [clips.interlaced, clips.unflagged]) {
      const { segment } = await transcode(clip);
      const { stderr } = await run(["-hide_banner", "-nostats", "-v", "info", "-i", segment, "-vf", "idet", "-f", "null", "-"]);
      const [tff, bff, progressive] = [...stderr.matchAll(/Multi frame detection: TFF:\s*(\d+)\s*BFF:\s*(\d+)\s*Progressive:\s*(\d+)/g)].pop()!.slice(1, 4).map(Number);
      expect(progressive).toBeGreaterThan(10 * Math.max(1, tff + bff));
      expect(await tags(segment)).toMatchObject({ color_space: "bt709", color_transfer: "bt709", color_primaries: "bt709" });
    }
    // Without bwdif (the old pipeline), the same clip is combed.
    const { stderr } = await run(["-hide_banner", "-nostats", "-v", "info", "-i", clips.interlaced, "-vf", "fps=30,idet", "-f", "null", "-"]);
    const before = [...stderr.matchAll(/Multi frame detection: TFF:\s*(\d+)\s*BFF:\s*(\d+)\s*Progressive:\s*(\d+)/g)].pop()!.slice(1, 4).map(Number);
    expect(before[0]).toBeGreaterThan(before[2]);
  }, 60_000);

  it("turns a vertical phone clip upright and pillarboxes it", async () => {
    const { segment } = await transcode(clips.vertical);
    const at = await frame(segment, 640, 360);
    const red = ([r, g, b]: number[]) => r > 150 && g < 90 && b < 90;
    const green = ([r, g, b]: number[]) => g > 90 && r < 60 && b < 60;
    const black = ([r, g, b]: number[]) => r < 30 && g < 30 && b < 30;
    // Black bars left and right, the picture between them.
    for (const x of [5, 100, 540, 635]) expect(black(at(x, 180))).toBe(true);
    expect(black(at(320, 180))).toBe(false);
    // Upright: the red along the scene's top is at the top, the green at the bottom, nothing at the sides.
    expect(red(at(320, 8))).toBe(true);
    expect(green(at(320, 352))).toBe(true);
    for (const x of [230, 410]) expect(red(at(x, 180)) || green(at(x, 180)) || black(at(x, 180))).toBe(false);
  }, 30_000);

  it("tags an ordinary clip BT.709 too", async () => {
    const { result, segment } = await transcode(await testClip(4));
    expect(result.picture).toMatchObject({ hdr: null, interlaced: false });
    expect(await tags(segment)).toMatchObject({ color_space: "bt709", color_transfer: "bt709", color_primaries: "bt709" });
  }, 30_000);
});

describe("items prepared before (the re-prepare job)", () => {
  let h: Harness;
  let preparer: Preparer;
  let hlgItem: string;
  let hlg: string;
  let sdr: string;

  beforeAll(async () => {
    h = await createHarness();
    const station = await stationFixture(h, { callSign: "PHON", name: "Phone Station" });
    const a = await itemFixture(h, station.id, { title: "Shot on a phone", durationMs: 3_000, location: clips.hlg });
    const b = await itemFixture(h, station.id, { title: "Ordinary", durationMs: 4_000, location: await testClip(4) });
    hlgItem = a.id;
    const current = await h.services.library.currentContent([a.id, b.id]);
    hlg = current.get(a.id)!;
    sdr = current.get(b.id)!;
    preparer = createPreparer({ deps: h.deps, services: h.services }, { ladder: scaledLadder(0.1), scratchDir: await fs.mkdtemp(path.join(os.tmpdir(), "opencast-prep-")), transcoder: ffmpegTranscoder({ preset: "ultrafast" }) });
    await preparer.init();
    await preparer.want([hlg, sdr].map((contentId) => ({ contentId, mediaKind: "video" as const, band: "tv" as const, durationMs: 3_000 })));
    await prepareQueued(h, preparer);
    // As they'd be had they been prepared before pipeline 2: nothing probed.
    await h.db.update(schema.preparedItems).set({ pipeline: 1, picture: null });
  }, 90_000);
  afterAll(() => h?.close());

  it("in a dry run, probes and counts what it would prepare again, and changes nothing", async () => {
    const report = await prepareCleanerPictures({ deps: h.deps, services: h.services }, { apply: false });
    expect(report).toMatchObject({ items: 2, probed: 2, hdr: 1, interlaced: 0, unchanged: 1, toPrepare: 1, queued: 0, ready: 0 });
    expect(report.entries.find((e) => e.key === hlg)).toMatchObject({ state: "to_prepare", hdr: "hlg", titles: ["Shot on a phone"] });
    const rows = await h.db.select().from(schema.preparedItems);
    expect(rows.map((r) => [r.key, r.picture]).sort()).toEqual([[hlg, null], [sdr, null]].sort());
  }, 30_000);

  it("applied: queues the HDR item beside its first copy, which airs until the new one is ready", async () => {
    const report = await prepareCleanerPictures({ deps: h.deps, services: h.services }, { apply: true });
    expect(report).toMatchObject({ toPrepare: 0, queued: 1, unchanged: 1 });
    const [queued] = await h.db.select().from(schema.preparedItems).where(eq(schema.preparedItems.key, versionedKey(hlg)));
    expect(queued).toMatchObject({ status: "queued", contentId: hlg, renditions: ["a128", "v1080", "v360", "v480", "v720"] });
    // What the probe found is kept, so a rerun doesn't probe again.
    const [first] = await h.db.select().from(schema.preparedItems).where(eq(schema.preparedItems.key, hlg));
    expect(first.picture).toMatchObject({ hdr: "hlg" });
    await syncPreparedVersions(h.db, { force: true });
    expect(refKey({ contentId: hlg })).toBe(hlg);
    expect(preparer.isReady({ contentId: hlg }, "tv")).toBe(true);
    expect((await h.services.library.history(hlgItem)).preparation?.converted).toEqual([]);

    await prepareQueued(h, preparer);
    expect(refKey({ contentId: hlg })).toBe(`${hlg}-p2`);
    expect(refKey({ contentId: sdr })).toBe(sdr);
    expect(preparer.isReady({ contentId: hlg }, "tv")).toBe(true);
    const [made] = await h.db.select().from(schema.preparedItems).where(eq(schema.preparedItems.key, versionedKey(hlg)));
    expect(made).toMatchObject({ status: "ready", pipeline: 2, picture: { hdr: "hlg" } });
    // Stored beside the first copy, which is still there.
    await fs.access(path.join(h.deps.config.storageRoot, "objects", "prepared", hlg, "v720", "seg_00000.ts"));
    const segment = path.join(h.deps.config.storageRoot, "objects", "prepared", `${hlg}-p2`, "v720", "seg_00000.ts");
    expect(await tags(segment)).toMatchObject({ color_transfer: "bt709", color_primaries: "bt709" });
    // The library item says so.
    expect((await h.services.library.history(hlgItem)).preparation).toMatchObject({ status: "ready", converted: ["from_hdr"] });

    const again = await prepareCleanerPictures({ deps: h.deps, services: h.services }, { apply: false });
    expect(again).toMatchObject({ items: 2, probed: 0, ready: 1, toPrepare: 0, unchanged: 1 });
  }, 90_000);

  it("drops the newer copy with the first when the file goes", async () => {
    const { dropped } = await h.services.playout.dropPrepared([hlg], { evenIfAiring: true });
    expect(dropped.sort()).toEqual([hlg, `${hlg}-p2`].sort());
    expect(await h.db.select().from(schema.preparedItems).where(eq(schema.preparedItems.key, versionedKey(hlg)))).toEqual([]);
    await syncPreparedVersions(h.db, { force: true });
    expect(refKey({ contentId: hlg })).toBe(hlg);
  }, 30_000);
});
