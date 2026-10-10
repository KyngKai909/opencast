// Suggested break points (programming prompt, Phase 4). Fixtures made with lavfi, small pictures
// at the real lengths: a 22-minute "old TV episode" with black-and-silent gaps where the commercials
// were (and a few that don't count: in the first or last two minutes, black but not silent, silent
// but not black, too close to a stronger one), and the same episode with chapter marks. Where the
// rules put breaks, at the real thresholds; what FFmpeg finds in each file; that preparing looks
// once, keeps them apart from the maker's own points and never holds an item up; that the station
// uses or dismisses them; that carried episodes keep the maker's points; that programs prepared
// before are looked at while the worker is idle. And the first copy's sweep (open decision P1.3).
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { chapterBreaks, detectedSpans, fadeBreaks, ffmpegBreakFinder, type BreakFinder } from "../src/v1/modules/playout/engine/breaks.js";
import { createPreparer, refKey, syncPreparedVersions, versionedKey, type Preparer } from "../src/v1/modules/playout/engine/prepare.js";
import { createHarness, dummyFile, fakeTranscoder, itemFixture, market, prepareQueued, stationFixture, type Harness, type User } from "./harness.js";

const MIN = 60_000;
let dir: string;
const files = { oldTv: "", chapters: "", radio: "" };

async function ffmpeg(args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr))));
  });
}

/** `between(t,a,b)+…` for FFmpeg's `enable`, from spans in seconds. */
const during = (spans: Array<[number, number]>) => spans.map(([a, b]) => `between(t,${a},${b})`).join("+");

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencast-breaks-"));
  // Black and silent together: in the first two minutes (the cold open's), at 3:00, 6:30 (short,
  // and within eight minutes of stronger ones), 11:00 (the strongest), 19:10, and in the last two
  // minutes (the credits'). Silent only at 14:00; black only at 16:00.
  const both: Array<[number, number]> = [[30, 31], [180, 181], [390, 390.4], [660, 661.2], [1150, 1150.8], [1270, 1272]];
  const black = during([...both, [960, 962]]);
  const silent = during([...both, [840, 842]]);
  files.oldTv = path.join(dir, "old-tv.mp4");
  await ffmpeg([
    "-f", "lavfi", "-i", `color=c=gray:s=64x36:r=5:d=1320,drawbox=c=black:t=fill:enable='${black}'`,
    "-f", "lavfi", "-i", `sine=f=440:r=8000:d=1320,volume=0:enable='${silent}'`,
    "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-b:a", "16k", files.oldTv
  ]);
  // The same episode with chapter marks: at 0, 1:00 (first two minutes), 6:00, 8:00 (two minutes
  // after 6:00), 13:00, 19:00 and 21:00 (the last two minutes).
  const meta = path.join(dir, "chapters.txt");
  const starts = [0, 60, 360, 480, 780, 1140, 1260];
  await fs.writeFile(meta, [";FFMETADATA1", ...starts.flatMap((s, i) => ["[CHAPTER]", "TIMEBASE=1/1000", `START=${s * 1000}`, `END=${(starts[i + 1] ?? 1320) * 1000}`, `title=Part ${i + 1}`])].join("\n"));
  files.chapters = path.join(dir, "chapters.mp4");
  await ffmpeg(["-i", files.oldTv, "-i", meta, "-map", "0", "-map_metadata", "1", "-map_chapters", "1", "-c", "copy", files.chapters]);
  // A radio hour's ten minutes: silent gaps, no picture, no chapters.
  files.radio = path.join(dir, "radio.m4a");
  await ffmpeg(["-f", "lavfi", "-i", `sine=f=440:r=8000:d=600,volume=0:enable='${during([[180, 181], [420, 421]])}'`, "-c:a", "aac", "-b:a", "16k", files.radio]);
}, 60_000);

describe("where breaks go", () => {
  it("chapter marks: each start, but not in the first or last two minutes, nor within five minutes of the last one kept", () => {
    expect(chapterBreaks([0, 1, 6, 8, 13, 19, 21].map((m) => m * MIN), 22 * MIN)).toEqual([6 * MIN, 13 * MIN, 19 * MIN]);
    expect(chapterBreaks([0, 2 * MIN, 20 * MIN], 22 * MIN)).toEqual([2 * MIN, 20 * MIN]);
    expect(chapterBreaks([0], 22 * MIN)).toEqual([]);
  });

  it("fades: black and silent together for 0.3 s or more, the strongest in each stretch of eight minutes, clear of the edges", () => {
    const at = (s: number, len: number) => ({ startMs: s * 1000, endMs: s * 1000 + len });
    const black = [at(30, 1000), at(180, 1000), at(390, 400), at(660, 1200), at(960, 2000), at(1150, 800), at(1270, 2000), at(1500, 200)];
    const silence = [at(30, 1000), at(180, 1000), at(390, 400), at(660, 1200), at(840, 2000), at(1150, 800), at(1270, 2000), at(1500, 200)];
    expect(fadeBreaks(black, silence, 1320_000)).toEqual([180_500, 660_600, 1150_400]);
    // The weaker one at 6:30 is kept only in a shorter stretch (3:30 from the one at 3:00).
    expect(fadeBreaks(black, silence, 1320_000, 3 * MIN)).toEqual([180_500, 390_200, 660_600, 1150_400]);
    // Overlapping by less than 0.3 s isn't one.
    expect(fadeBreaks([at(600, 1000)], [at(600.8, 1000)], 1320_000)).toEqual([]);
    expect(fadeBreaks([at(600, 1000)], [at(600.6, 1000)], 1320_000)).toEqual([600_800]);
  });

  it("reads FFmpeg's log", () => {
    const log = [
      "[silencedetect @ 0x1] silence_start: 180.032",
      "[silencedetect @ 0x1] silence_end: 181.056 | silence_duration: 1.024",
      "[silencedetect @ 0x1] silence_start: 1319.5"
    ].join("\n");
    expect(detectedSpans(log, "silence", 0, 1320_000)).toEqual([{ startMs: 180_032, endMs: 181_056 }, { startMs: 1319_500, endMs: 1320_000 }]);
    expect(detectedSpans("[blackdetect @ 0x2] black_start:0.6 black_end:1.8 black_duration:1.2", "black", 179_500)).toEqual([{ startMs: 180_100, endMs: 181_300 }]);
  });
});

describe("looking in a file", () => {
  const find = ffmpegBreakFinder();

  it("an old TV episode: where it's black and silent together, where the commercials were", async () => {
    const found = await find({ file: files.oldTv, durationMs: 1320_000, video: true });
    expect(found.source).toBe("fade");
    expect(found.offsetsMs).toHaveLength(3);
    [180_500, 660_600, 1150_400].forEach((ms, i) => expect(Math.abs(found.offsetsMs[i] - ms)).toBeLessThan(300));
  }, 30_000);

  it("a file with chapter marks: its chapters, not its fades", async () => {
    expect(await find({ file: files.chapters, durationMs: 1320_000, video: true })).toEqual({ source: "chapter", offsetsMs: [360_000, 780_000, 1140_000] });
  }, 30_000);

  it("sound only, without chapters: nothing (a fade needs a picture)", async () => {
    expect(await find({ file: files.radio, durationMs: 600_000, video: false })).toEqual({ source: null, offsetsMs: [] });
  }, 30_000);
});

describe("suggested while preparing, used or dismissed", () => {
  let h: Harness;
  let owner: User;
  let carrierOwner: User;
  let reel: { id: string };
  let beat: { id: string };
  let programId: string;
  const items = { chapters: "", oldTv: "", own: "", broken: "", short: "", older: "" };
  const cids: Record<keyof typeof items, string> = { chapters: "", oldTv: "", own: "", broken: "", short: "", older: "" };
  const lines: string[] = [];
  let preparer: Preparer;
  const scratch = () => fs.mkdtemp(path.join(os.tmpdir(), "opencast-breaks-prep-"));
  const want = (keys: Array<keyof typeof items>, durationMs = 22 * MIN) => keys.map((k) => ({ contentId: cids[k], mediaKind: "video" as const, band: "tv" as const, durationMs }));

  const make = async (key: keyof typeof items, file: string, fields: { durationMs?: number; code?: "PGM" | "SPT"; same?: boolean } = {}) => {
    // A file of its own (the same picture and sound, its own bytes), unless it's to share one.
    const location = fields.same ? file : path.join(dir, `${key}.mp4`);
    if (location !== file) await ffmpeg(["-i", file, "-map", "0", "-c", "copy", "-metadata", `comment=${key}`, location]);
    const item = await itemFixture(h, reel.id, { programId: fields.code === "SPT" ? undefined : programId, title: key, location, durationMs: fields.durationMs ?? 22 * MIN, code: fields.code });
    items[key] = item.id;
    cids[key] = (await h.services.library.currentContent([item.id])).get(item.id)!;
  };

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set("2026-10-10T19:00:00.000Z");
    const m = await market(h);
    owner = await h.signIn("Reel owner");
    carrierOwner = await h.signIn("Beat owner");
    reel = await stationFixture(h, { callSign: "REEL", ownerId: owner.id, marketId: m.id, tenths: 241, signedOn: true });
    beat = await stationFixture(h, { callSign: "BEAT", ownerId: carrierOwner.id, marketId: m.id, tenths: 121, signedOn: true });
    programId = (await owner.post(`/v1/stations/${reel.id}/programs`, { title: "Saturday Reel", description: "Films from the archive." }).expect(201)).body.id;
    await make("chapters", files.chapters, { same: true });
    await make("oldTv", files.oldTv);
    await make("own", files.chapters, { same: true });
    await make("broken", await dummyFile(), { same: true });
    await make("short", files.oldTv, { durationMs: 7 * MIN });
    // The maker's own break points on one of them (the same file as another item, so it's looked at once).
    await owner.patch(`/v1/library/${items.own}`, { breakPointsMs: [10 * MIN] }).expect(200);
    preparer = createPreparer({ deps: h.deps, services: h.services }, { transcoder: fakeTranscoder(), breakFinder: ffmpegBreakFinder(), scratchDir: await scratch(), log: (line) => lines.push(line) });
    await preparer.init();
  }, 60_000);
  afterAll(() => h?.close());

  it("looks in each program's file once it's prepared, and keeps what it found apart from the maker's points", async () => {
    await preparer.want([...want(["chapters", "oldTv", "own"]), ...want(["short"], 7 * MIN)]);
    await prepareQueued(h, preparer);
    const rows = await h.db.select().from(schema.breakSuggestions);
    const of = (cid: string) => rows.find((r) => r.contentId === cid);
    // `own` is the chapters file again: one row for the file.
    expect(of(cids.chapters)).toMatchObject({ source: "chapter", offsetsMs: [360_000, 780_000, 1140_000], error: null });
    expect(of(cids.oldTv)).toMatchObject({ source: "fade", error: null });
    expect(of(cids.oldTv)!.offsetsMs).toHaveLength(3);
    // Under eight minutes: not looked at.
    expect(of(cids.short)).toBeUndefined();
    // The maker's own points are as they were.
    expect((await h.db.select().from(schema.assetBreakPoints).where(eq(schema.assetBreakPoints.assetId, items.chapters)))).toEqual([]);
    expect(lines.some((l) => /3 break points suggested, from chapter marks/.test(l))).toBe(true);
  }, 60_000);

  it("the library item says so, with its preview, and the item's own break points are untouched", async () => {
    const res = await owner.get(`/v1/library/${items.chapters}`).expect(200);
    expect(res.body.breakPointsMs).toEqual([]);
    expect(res.body.suggestedBreakPoints).toMatchObject({ source: "chapter", pointsMs: [360_000, 780_000, 1140_000] });
    expect(res.body.suggestedBreakPoints.previewUrl).toMatch(new RegExp(`/v1/previews/${cids.chapters}/v360\\.m3u8$`));
    expect((await owner.get(`/v1/library/${items.oldTv}`).expect(200)).body.suggestedBreakPoints).toMatchObject({ source: "fade" });
    // An item with break points of its own isn't offered any.
    expect((await owner.get(`/v1/library/${items.own}`).expect(200)).body).toMatchObject({ breakPointsMs: [10 * MIN], suggestedBreakPoints: null });
    // In the library's list too.
    const list = await owner.get(`/v1/stations/${reel.id}/library`).expect(200);
    expect(list.body.items.find((i: { id: string }) => i.id === items.chapters).suggestedBreakPoints.pointsMs).toEqual([360_000, 780_000, 1140_000]);
  });

  it("a carried episode keeps the maker's points: the carrier sees no suggestions and can't answer them", async () => {
    const terms = { termsOffered: ["barter", "cash"], cashPriceMicros: 2_500_000, cashPriceUnit: "per_airing", barterMakerMsPerHour: 120_000, airingsPerEpisode: 2, windowDays: 7, liveOnly: false, noticeDays: 7, approval: "i_approve", radioBandAllowed: true };
    const offer = await owner.post(`/v1/programs/${programId}/offer`, terms);
    expect(offer.status, JSON.stringify(offer.body)).toBe(201);
    const detail = await carrierOwner.get(`/v1/catalog/offers/${offer.body.id}`).expect(200);
    const episode = detail.body.episodes.find((e: { id: string }) => e.id === items.chapters);
    expect(episode.breakPointsMs).toEqual([]);
    expect(episode.suggestedBreakPoints).toBeUndefined();
    expect(detail.body.episodes.find((e: { id: string }) => e.id === items.own).breakPointsMs).toEqual([10 * MIN]);
    const refused = await carrierOwner.post(`/v1/library/${items.chapters}/break-suggestions`, { answer: "use" });
    expect([403, 404]).toContain(refused.status);
    expect((await owner.get(`/v1/library/${items.chapters}`).expect(200)).body.breakPointsMs).toEqual([]);
  });

  it("Use these: they become the item's break points, and aren't suggested again", async () => {
    const res = await owner.post(`/v1/library/${items.chapters}/break-suggestions`, { answer: "use" }).expect(200);
    expect(res.body).toMatchObject({ breakPointsMs: [360_000, 780_000, 1140_000], suggestedBreakPoints: null });
    const again = await owner.post(`/v1/library/${items.chapters}/break-suggestions`, { answer: "dismiss" }).expect(409);
    expect(again.body.error.code).toBe("no_suggestions");
  });

  it("Dismiss: nothing changes, and they aren't suggested again for this file (a new file's are)", async () => {
    const res = await owner.post(`/v1/library/${items.oldTv}/break-suggestions`, { answer: "dismiss" }).expect(200);
    expect(res.body).toMatchObject({ breakPointsMs: [], suggestedBreakPoints: null });
    // As though its file were replaced since: the new file's suggestions are asked about.
    await h.db.update(schema.assets).set({ breakSuggestionsAnswered: cids.chapters }).where(eq(schema.assets.id, items.oldTv));
    expect((await owner.get(`/v1/library/${items.oldTv}`).expect(200)).body.suggestedBreakPoints).toMatchObject({ source: "fade" });
  });

  it("a file that can't be read is ready all the same, and the failure is logged", async () => {
    const broken = createPreparer({ deps: h.deps, services: h.services }, { transcoder: fakeTranscoder(), breakFinder: ffmpegBreakFinder(), scratchDir: await scratch(), log: (line) => lines.push(line) });
    await broken.init();
    await broken.want(want(["broken"]));
    await prepareQueued(h, broken);
    expect(broken.isReady({ contentId: cids.broken }, "tv")).toBe(true);
    const [row] = await h.db.select().from(schema.breakSuggestions).where(eq(schema.breakSuggestions.contentId, cids.broken));
    expect(row).toMatchObject({ source: null, offsetsMs: [] });
    expect(row.error).toBeTruthy();
    expect(lines.some((l) => /break points failed/.test(l))).toBe(true);
    expect((await owner.get(`/v1/library/${items.broken}`).expect(200)).body.suggestedBreakPoints).toBeNull();
  }, 30_000);

  it("a finder that throws doesn't hold an item up either", async () => {
    const throwing: BreakFinder = async () => {
      throw new Error("no luck");
    };
    // A program added since it was offered (offering queues its episodes' previews).
    await make("older", files.oldTv);
    const cid = cids.older;
    const other = createPreparer({ deps: h.deps, services: h.services }, { transcoder: fakeTranscoder(), breakFinder: throwing, scratchDir: await scratch(), log: (line) => lines.push(line) });
    await other.init();
    await other.want(want(["older"]));
    await prepareQueued(h, other);
    expect(other.isReady({ contentId: cid }, "tv")).toBe(true);
    expect((await h.db.select().from(schema.breakSuggestions).where(eq(schema.breakSuggestions.contentId, cid)))[0]).toMatchObject({ error: "no luck", offsetsMs: [] });
    // Looked at again below, as a program prepared before Phase 4.
    await h.db.delete(schema.breakSuggestions).where(eq(schema.breakSuggestions.contentId, cid));
  }, 30_000);

  it("programs prepared before are looked at while there's nothing to prepare, one at a time", async () => {
    // `older` is prepared, and has no row: as a program prepared before Phase 4.
    expect(await h.db.select().from(schema.breakSuggestions).where(eq(schema.breakSuggestions.contentId, cids.older))).toEqual([]);
    const idle = createPreparer({ deps: h.deps, services: h.services }, { transcoder: fakeTranscoder(), breakFinder: ffmpegBreakFinder(), scratchDir: await scratch(), log: (line) => lines.push(line) });
    await idle.init();
    await idle.pump();
    await idle.settle();
    const [row] = await h.db.select().from(schema.breakSuggestions).where(eq(schema.breakSuggestions.contentId, cids.older));
    expect(row).toMatchObject({ source: "fade", error: null });
    expect(row.offsetsMs).toHaveLength(3);
    // The walk goes on to the end, then rests: nothing else to look at.
    await idle.pump();
    await idle.settle();
    expect((await h.db.select().from(schema.breakSuggestions)).length).toBe(4);
  }, 60_000);
});

describe("the first copy's sweep (P1.3)", () => {
  let h: Harness;
  let station: { id: string };
  let cid: string;
  const PI = schema.preparedItems;
  const PR = schema.preparedRenditions;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set("2026-10-10T19:00:00.000Z");
    station = await stationFixture(h, { callSign: "PHON" });
    const item = await itemFixture(h, station.id, { location: await dummyFile(), durationMs: 8_000 });
    cid = (await h.services.library.currentContent([item.id])).get(item.id)!;
    // A first copy, and a newer one beside it that took over on October 1.
    const took = new Date("2026-10-01T12:00:00.000Z");
    await h.db.insert(PI).values([
      { key: cid, contentId: cid, kind: "file", mediaKind: "video", status: "ready", renditions: ["a128", "v360"], durationMs: 8_000, preparedAt: new Date("2026-09-01T00:00:00.000Z") },
      { key: versionedKey(cid), contentId: cid, kind: "file", mediaKind: "video", status: "ready", renditions: ["a128", "v360"], durationMs: 8_000, preparedAt: took, pipeline: 2 }
    ]);
    for (const key of [cid, versionedKey(cid)]) {
      await h.db.insert(PR).values(["a128", "v360"].map((rendition) => ({ key, rendition, segments: 2, segmentMs: [4_000, 4_000], bytes: 10, preparedAt: took })));
      for (const rendition of ["a128", "v360"]) {
        const at = path.join(h.deps.config.storageRoot, "objects", "prepared", key, rendition);
        await fs.mkdir(at, { recursive: true });
        await fs.writeFile(path.join(at, "seg_00000.ts"), "ts");
      }
    }
  }, 30_000);
  afterAll(() => h?.close());

  const keys = async () => (await h.db.select({ key: PI.key }).from(PI)).map((r) => r.key).sort();

  it("keeps the first copy for a week after the newer one took over", async () => {
    h.clock.set("2026-10-07T12:00:00.000Z");
    expect(await h.services.playout.sweepFirstCopies()).toEqual({ dropped: 0, deferred: 0 });
    expect(await keys()).toEqual([cid, versionedKey(cid)].sort());
  });

  it("leaves it while a channel's playlist still points at it", async () => {
    h.clock.set("2026-10-10T19:00:00.000Z");
    const [row] = await h.db
      .insert(schema.channelItems)
      .values({ stationId: station.id, run: 1, seq: 1, disc: 0, startsAt: new Date("2026-10-10T18:59:00.000Z"), endsAt: new Date("2026-10-10T19:00:08.000Z"), kind: "prepared", preparedKey: cid, code: "PGM", label: "Episode", reason: "log" })
      .returning();
    expect(await h.services.playout.sweepFirstCopies()).toEqual({ dropped: 0, deferred: 1 });
    expect(await keys()).toEqual([cid, versionedKey(cid)].sort());
    await h.db.delete(schema.channelItems).where(eq(schema.channelItems.id, row.id));
  });

  it("then drops the first copy alone; the newer one airs on, and goes when the file does", async () => {
    expect(await h.services.playout.sweepFirstCopies()).toEqual({ dropped: 1, deferred: 0 });
    expect(await keys()).toEqual([versionedKey(cid)]);
    const objects = path.join(h.deps.config.storageRoot, "objects", "prepared");
    await expect(fs.access(path.join(objects, cid))).rejects.toThrow();
    await fs.access(path.join(objects, versionedKey(cid), "v360", "seg_00000.ts"));
    // Still the one that airs, and previews play it.
    await syncPreparedVersions(h.db, { force: true });
    expect(refKey({ contentId: cid })).toBe(versionedKey(cid));
    expect((await h.services.playout.previews([{ contentId: cid, mediaKind: "video", band: "tv" }])).get(cid)).toMatchObject({ status: "ready" });
    expect(await h.services.playout.sweepFirstCopies()).toEqual({ dropped: 0, deferred: 0 });
    // The file goes: the storage sweep finds the newer copy by its file.
    await h.db.delete(schema.contentRefs).where(eq(schema.contentRefs.cid, cid));
    await h.db.update(schema.contents).set({ deletedAt: h.clock.now(), deletedReason: "unreferenced" }).where(eq(schema.contents.cid, cid));
    expect((await h.services.playout.sweepPrepared()).dropped).toBeGreaterThan(0);
    expect(await keys()).toEqual([]);
  });
});
