// Captions, prepared once and carried by the channel (X2). An uploaded track is kept by content ID
// and cut into the item's segments when the item is prepared (or within a minute, if it already
// was); an item without captions is ready all the same; the channel's master names a subtitle
// rendition and its subtitle playlist follows the pictures, with empty WebVTT where there are no
// captions. With FFmpeg (tiny): a caption file sent with an upload, a file with an embedded
// mov_text track (carried through the upload, read at preparation), and a translator drawing a
// cue into a segment's picture.
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { parseVtt, vttContentId } from "../src/v1/lib/captions.js";
import { createEngine, type Engine } from "../src/v1/modules/playout/engine/index.js";
import { scaledLadder } from "../src/v1/modules/playout/engine/ladder.js";
import { createPreparer, DEFAULT_START_PTS, ffmpegTranscoder, startPtsOf, type CaptionGenerator } from "../src/v1/modules/playout/engine/prepare.js";
import { burnCaptionsIn } from "../src/v1/modules/playout/engine/sender.js";
import { createHarness, dummyFile, fakeTranscoder, itemFixture, market, prepareQueued, stationFixture, testClip, type Harness, type User } from "./harness.js";

let h: Harness;
let kai: User;
let beat: { id: string };
let engine: Engine;
let lateCid: string;
let tapeId: string;
let tapeCid: string;
const fake = fakeTranscoder();
const objectsDir = () => path.join(h.deps.config.storageRoot, "objects");
const SRT = "1\n00:00:01,000 --> 00:00:05,000\nGood evening.\n\n2\n00:00:09,000 --> 00:00:10,000\nThis is Late Crate.\n";

async function runUntil(iso: string, stepMs = 2_000) {
  const end = Date.parse(iso);
  while (h.clock.now().getTime() < end) {
    h.clock.advance(Math.min(stepMs, end - h.clock.now().getTime()));
    await engine.tick();
    await prepareQueued(h, engine.preparer);
  }
}

function run(args: string[], command = "ffmpeg"): Promise<{ code: number; stdout: Buffer }> {
  return new Promise((resolve) => {
    const child = spawn(command, ["-hide_banner", "-loglevel", "error", ...args]);
    const out: Buffer[] = [];
    child.stdout.on("data", (d) => out.push(d));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(out) }));
  });
}

/** Lines after the program date-time `iso`: its segments' URIs, up to the next item. */
function segmentsAt(text: string, iso: string): string[] {
  const lines = text.split("\n");
  const from = lines.indexOf(`#EXT-X-PROGRAM-DATE-TIME:${iso}`);
  expect(from).toBeGreaterThan(0);
  const out: string[] = [];
  for (const line of lines.slice(from + 1)) {
    if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME") || line === "#EXT-X-DISCONTINUITY") break;
    if (line && !line.startsWith("#")) out.push(line);
  }
  return out;
}

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-10-02T02:59:50.000Z");
  const m = await market(h);
  kai = await h.signIn("Kai");
  beat = await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId: m.id, tenths: 121, signedOn: true });
  await kai
    .put(`/v1/stations/${beat.id}/break-rule`, { mode: "none", everyMinutes: null, lengthMs: 120_000, spotMsPerHour: 0, sameSpotPerHour: 4, fillOrder: ["SPT", "UND", "BMP", "SID"], openTimeTo: "spot_market", blockedCategories: [] })
    .expect(200);
  await itemFixture(h, beat.id, { title: "BEAT ident", code: "SID", durationMs: 4_000, location: await dummyFile() });
  const late = await itemFixture(h, beat.id, { title: "Late Crate", durationMs: 12_000, location: await dummyFile() });
  lateCid = (await h.services.library.currentContent([late.id])).get(late.id)!;
  const tape = await itemFixture(h, beat.id, { title: "Borrowed Tape", durationMs: 8_000, location: await dummyFile() });
  tapeId = tape.id;
  tapeCid = (await h.services.library.currentContent([tape.id])).get(tape.id)!;
  await kai.put(`/v1/library/${late.id}/captions`, { language: "en", text: SRT }).expect(200);
  await kai.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt: "2026-10-02T03:00:00.000Z", endsAt: "2026-10-02T03:00:12.000Z", itemId: late.id }).expect(201);
  await kai.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt: "2026-10-02T03:00:12.000Z", endsAt: "2026-10-02T03:00:20.000Z", itemId: tape.id }).expect(201);
  await kai.post(`/v1/stations/${beat.id}/log`, { kind: "program", startsAt: "2026-10-02T03:01:00.000Z", endsAt: "2026-10-02T03:01:08.000Z", itemId: tape.id }).expect(201);
  await h.db.insert(schema.playoutState).values({ stationId: beat.id, onAir: true });
  engine = createEngine({ deps: h.deps, services: h.services }, { transcoder: fake, log: () => undefined });
}, 60_000);

afterAll(async () => {
  await engine?.stopAll();
  await h?.close();
});

describe("an uploaded caption track", () => {
  it("is kept by content ID, like media", async () => {
    const [track] = await h.db.select().from(schema.captionTracks);
    const { cid } = vttContentId(track.vtt);
    expect(track.contentId).toBe(cid);
    expect(await fs.readFile(path.join(objectsDir(), cid), "utf8")).toBe(track.vtt);
    const [ref] = await h.db.select().from(schema.contentRefs).where(eq(schema.contentRefs.cid, cid));
    expect(ref).toMatchObject({ owner: "caption_track" });
  });

  it("is cut into the item's 4-second segments when it's prepared, mapped onto its first timestamp; an item without captions is ready all the same", async () => {
    await engine.tick();
    await prepareQueued(h, engine.preparer);
    expect(engine.preparer.isReady(lateCid, "tv")).toBe(true);
    expect(engine.preparer.isReady(tapeCid, "tv")).toBe(true);
    const rows = await h.db.select().from(schema.preparedCaptions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: lateCid, source: "uploaded", language: "en", segments: 3 });
    expect(rows[0].rendition).toMatch(/^cc[0-9a-f]{12}$/);
    const dir = path.join(objectsDir(), "prepared", lateCid, rows[0].rendition);
    const segs = await Promise.all([0, 1, 2].map((i) => fs.readFile(path.join(dir, `seg_0000${i}.vtt`), "utf8")));
    // The fake transcoder's segments aren't MPEG-TS: FFmpeg's usual start.
    for (const s of segs) expect(parseVtt(s).timestampMap).toEqual({ mpegts: DEFAULT_START_PTS, localMs: 0 });
    expect(segs.map((s) => parseVtt(s).cues.map((c) => c.text))).toEqual([["Good evening."], ["Good evening."], ["This is Late Crate."]]);
    expect(await fs.readFile(path.join(dir, "index.m3u8"), "utf8")).toContain("seg_00002.vtt");
  });

  it("the master names the subtitle rendition; the subtitle playlist carries the captions, and empty WebVTT for the rest, on the pictures' timeline", async () => {
    await runUntil("2026-10-02T03:00:26.000Z");
    const master = (await h.services.playout.playlist(beat.id, "master.m3u8"))!.body;
    expect(master).toContain('#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=YES');
    expect(master.split("\n").filter((l) => l.startsWith("#EXT-X-STREAM-INF")).every((l) => l.includes('SUBTITLES="subs"'))).toBe(true);

    const subs = (await h.services.playout.playlist(beat.id, "subs.m3u8"))!.body;
    const v720 = (await h.services.playout.playlist(beat.id, "v720.m3u8"))!.body;
    const seq = (t: string) => t.split("\n").filter((l) => /^#EXT-X-(MEDIA|DISCONTINUITY)-SEQUENCE/.test(l));
    expect(seq(subs)).toEqual(seq(v720));
    expect(subs.split("\n").filter((l) => l === "#EXT-X-DISCONTINUITY").length).toBe(v720.split("\n").filter((l) => l === "#EXT-X-DISCONTINUITY").length);
    const [prepared] = await h.db.select().from(schema.preparedCaptions);
    expect(segmentsAt(subs, "2026-10-02T03:00:00.000Z")).toEqual([0, 1, 2].map((i) => `/objects/prepared/${lateCid}/${prepared.rendition}/seg_0000${i}.vtt`));
    expect(segmentsAt(subs, "2026-10-02T03:00:12.000Z")).toEqual(["empty.vtt", "empty.vtt"]);
    // What came before 3:00 (the station ID holds) has no captions either.
    expect(subs.split("\n").filter((l) => l && !l.startsWith("#")).every((l) => l === "empty.vtt" || l.includes(prepared.rendition))).toBe(true);
    expect(await h.services.playout.playlist(beat.id, "empty.vtt")).toMatchObject({ body: "WEBVTT\n", contentType: "text/vtt" });
  });

  it("uploaded after the item was prepared, it's cut within the minute, and goes with its next airing", async () => {
    await kai.put(`/v1/library/${tapeId}/captions`, { language: "en", text: "WEBVTT\n\n00:00:00.500 --> 00:00:03.000\nFrom the tape." }).expect(200);
    await runUntil("2026-10-02T03:01:10.000Z");
    const rows = await h.db.select().from(schema.preparedCaptions).where(eq(schema.preparedCaptions.key, tapeCid));
    expect(rows).toMatchObject([{ source: "uploaded", segments: 2 }]);
    const subs = (await h.services.playout.playlist(beat.id, "subs.m3u8"))!.body;
    // Published before the track was cut: left as it was.
    expect(segmentsAt(subs, "2026-10-02T03:00:12.000Z")).toEqual(["empty.vtt", "empty.vtt"]);
    expect(segmentsAt(subs, "2026-10-02T03:01:00.000Z")).toEqual([0, 1].map((i) => `/objects/prepared/${tapeCid}/${rows[0].rendition}/seg_0000${i}.vtt`));
  });

  it("the radio band has no subtitle rendition", async () => {
    const m = await market(h, "desert", "Desert");
    const nite = await stationFixture(h, { callSign: "NITE", ownerId: kai.id, marketId: m.id, tenths: 884, band: "radio", signedOn: true });
    await h.db.insert(schema.channelItems).values({ stationId: nite.id, run: 1, seq: 0, disc: 0, startsAt: new Date(Date.parse("2026-10-02T03:00:00Z")), endsAt: new Date(Date.parse("2026-10-02T03:00:04Z")), kind: "prepared", preparedKey: tapeCid, segments: 1, segmentMs: [4000], code: "PGM", label: "x", reason: "planned" });
    expect((await h.services.playout.playlist(nite.id, "master.m3u8"))!.body).not.toContain("SUBTITLES");
    expect(await h.services.playout.playlist(nite.id, "subs.m3u8")).toBeNull();
  });
});

describe("with FFmpeg (tiny)", () => {
  let clip: string;

  beforeAll(async () => {
    // A 5-second clip with a mov_text track in English.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencast-cc-"));
    const srt = path.join(dir, "in.srt");
    await fs.writeFile(srt, "1\n00:00:00,500 --> 00:00:02,000\nHello there.\n\n2\n00:00:04,200 --> 00:00:04,900\nSecond segment.\n");
    clip = path.join(dir, "clip.mp4");
    const made = await run(["-y", "-f", "lavfi", "-i", "testsrc=duration=5:size=160x90:rate=24", "-f", "lavfi", "-i", "sine=duration=5", "-i", srt, "-map", "0:v", "-map", "1:a", "-map", "2:s", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-c:s", "mov_text", "-metadata:s:s:0", "language=eng", clip]);
    expect(made.code).toBe(0);
  }, 30_000);

  it("a caption file sent with an upload becomes its track; one that isn't captions stops the upload", async () => {
    const bad = await kai.post(`/v1/stations/${beat.id}/library/uploads`).attach("file", await testClip(4)).field("title", "Nope").field("captions", "just words").expect(422);
    expect(bad.body.error.code).toBe("not_captions");
    const res = await kai.post(`/v1/stations/${beat.id}/library/uploads`).attach("file", await testClip(4)).field("title", "With captions").field("captions", SRT).field("captionLanguage", "es").expect(201);
    expect(res.body).toMatchObject({ captions: "uploaded", captionLanguage: "es" });
    const track = await kai.get(`/v1/library/${res.body.id}/captions`).expect(200);
    expect(track.body).toMatchObject({ language: "es", source: "uploaded" });
    expect(track.body.vtt).toContain("00:00:01.000 --> 00:00:05.000\nGood evening.");
    await h.services.library.settle();
  }, 60_000);

  it("an embedded mov_text track is carried through the upload and read at preparation, mapped onto the segments' timestamps", async () => {
    const res = await kai.post(`/v1/stations/${beat.id}/library/uploads`).attach("file", clip).field("title", "Embedded").expect(201);
    await h.services.library.settle();
    const cid = (await h.services.library.currentContent([res.body.id])).get(res.body.id)!;
    const asked: string[] = [];
    const generator: CaptionGenerator = {
      name: "test",
      generate: async ({ key }) => {
        asked.push(key);
        return null;
      }
    };
    const preparer = createPreparer({ deps: h.deps, services: h.services }, { ladder: scaledLadder(0.1), transcoder: ffmpegTranscoder({ preset: "ultrafast" }), scratchDir: await fs.mkdtemp(path.join(os.tmpdir(), "opencast-prep-")), captionGenerator: generator });
    await preparer.init();
    await preparer.want([{ contentId: cid, mediaKind: "video", band: "tv", durationMs: 5_000 }]);
    await prepareQueued(h, preparer);
    expect(preparer.isReady(cid, "tv")).toBe(true);
    // It had captions of its own: nothing asked of speech-to-text.
    expect(asked).toEqual([]);
    // One with none is asked about (once); the default generator makes nothing, and it's ready all the same.
    const plain = await itemFixture(h, beat.id, { title: "No captions", durationMs: 3_000, location: await testClip(3) });
    const plainCid = (await h.services.library.currentContent([plain.id])).get(plain.id)!;
    await preparer.want([{ contentId: plainCid, mediaKind: "video", band: "tv", durationMs: 3_000 }]);
    await prepareQueued(h, preparer);
    expect(asked).toEqual([plainCid]);
    expect(preparer.isReady(plainCid, "tv")).toBe(true);
    expect(await h.db.select().from(schema.preparedCaptions).where(eq(schema.preparedCaptions.key, plainCid))).toEqual([]);
    const [row] = await h.db.select().from(schema.preparedCaptions).where(eq(schema.preparedCaptions.key, cid));
    expect(row).toMatchObject({ source: "embedded", language: "en", segments: 2 });
    const dir = path.join(objectsDir(), "prepared", cid);
    const pts = await startPtsOf(path.join(dir, "v720", "seg_00000.ts"));
    expect(pts).not.toBeNull();
    const segs = await Promise.all([0, 1].map((i) => fs.readFile(path.join(dir, row.rendition, `seg_0000${i}.vtt`), "utf8")));
    expect(segs.map((s) => parseVtt(s).timestampMap)).toEqual([{ mpegts: pts, localMs: 0 }, { mpegts: pts, localMs: 0 }]);
    expect(segs.map((s) => parseVtt(s).cues.map((c) => c.text))).toEqual([["Hello there."], ["Second segment."]]);

    // A translator that draws captions in: the cue goes into the picture, the timestamps stay.
    const segment = await fs.readFile(path.join(dir, "v720", "seg_00001.ts"));
    const cue = parseVtt(segs[1]).cues[0];
    const at = (ms: number) => (pts! + ms * 90) / 90_000;
    const burned = (await burnCaptionsIn(segment, [{ text: cue.text, from: at(cue.startMs), to: at(cue.endMs) }], { width: 128, height: 72, videoKbps: 280 }, os.tmpdir()))!;
    expect(burned).not.toBeNull();
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "opencast-burn-"));
    await fs.writeFile(path.join(scratch, "in.ts"), segment);
    await fs.writeFile(path.join(scratch, "out.ts"), burned);
    const before = (await startPtsOf(path.join(scratch, "in.ts")))!;
    const after = (await startPtsOf(path.join(scratch, "out.ts")))!;
    expect(Math.abs(after - before)).toBeLessThan(90 * 50);
    // The bottom of the frame at 4.5 s into the item (the cue's middle) has the cue on it; at 4.0 s it doesn't.
    const bottom = async (file: string, n: number) => (await run(["-i", path.join(scratch, file), "-vf", `select=eq(n\\,${n}),crop=iw:16:0:ih-16`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"])).stdout;
    const diff = (a: Buffer, b: Buffer) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;
    expect(diff(await bottom("in.ts", 15), await bottom("out.ts", 15))).toBeGreaterThan(8);
    expect(diff(await bottom("in.ts", 0), await bottom("out.ts", 0))).toBeLessThan(5);
  }, 90_000);
});
