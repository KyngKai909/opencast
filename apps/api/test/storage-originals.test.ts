// Prepare from the original (Follow-up, storage): uploads and spots keep their original, once, by
// content ID in Infrequent Access, and playout prepares from it (a source bigger than 720p gives a
// real 1080p). What was prepared goes with the file (garbage collection, takedowns). Storing the
// same bytes again never moves Infrequent Access to Standard. Previews play the prepared segments.
// And the one-off steps: items prepared from the old 1280 px copy move to their originals; Pinata
// pins and files keyed by location are relinked to content IDs. All against the local store.
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { contentIdOf } from "../src/v1/storage.js";
import { createPreparer, ffmpegTranscoder, refKey, type Preparer } from "../src/v1/modules/playout/engine/prepare.js";
import { copyPin, prepareFromOriginals, relinkLocations } from "../src/v1/storageMaintenance.js";
import { anon, createHarness, dummyFile, fakeIpfs, fakeTranscoder, market, prepareQueued, stationFixture, testClip, type Harness, type User } from "./harness.js";

let h: Harness;
let kai: User;
let jess: User;
let beatId: string;
let marketId: string;
let preparer: Preparer;
let transcoder: ReturnType<typeof fakeTranscoder>;

const objectsDir = () => path.join(h.deps.config.storageRoot, "objects");
const exists = (file: string) =>
  fs.access(file).then(
    () => true,
    () => false
  );
const ctx = () => ({ deps: h.deps, services: h.services });

function run(args: string[], command = "ffmpeg"): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args);
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
  });
}

/** A one-second 1920 by 1080 clip (bigger than the old 1280 px copy), made once. */
async function fullHdClip(): Promise<string> {
  const file = path.join(os.tmpdir(), "opencast-test-clips", "clip-1s-1080p.mp4");
  if (await exists(file)) return file;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.${process.pid}.mp4`;
  const made = await run(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", partial]);
  expect(made.code).toBe(0);
  await fs.rename(partial, file);
  return file;
}

/** A legacy item: an asset with one file row keyed by where it was (no content ID). */
async function legacyItem(stationId: string, file: Partial<typeof schema.assetFiles.$inferInsert>, title = "From before") {
  const [item] = await h.db.insert(schema.assets).values({ stationId, title, code: "PGM", source: "upload", mediaKind: "video", durationMs: 6_000, status: "ready" }).returning();
  await h.db.insert(schema.rightsConfirmations).values({ assetId: item.id, basis: "made_it" });
  const [row] = await h.db.insert(schema.assetFiles).values({ assetId: item.id, version: 1, ...file }).returning();
  return { item, row };
}

async function preparedRows(key: string) {
  const [items, renditions, captions] = await Promise.all([
    h.db.select().from(schema.preparedItems).where(eq(schema.preparedItems.key, key)),
    h.db.select().from(schema.preparedRenditions).where(eq(schema.preparedRenditions.key, key)),
    h.db.select().from(schema.preparedCaptions).where(eq(schema.preparedCaptions.key, key))
  ]);
  return { items: items.length, renditions: renditions.length, captions: captions.length };
}

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-10-01T19:00:00.000Z");
  marketId = (await market(h)).id;
  kai = await h.signIn("Kai");
  jess = await h.signIn("Jess");
  beatId = (await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId, tenths: 121, signedOn: true })).id;
  transcoder = fakeTranscoder();
  preparer = createPreparer(ctx(), { transcoder, scratchDir: await fs.mkdtemp(path.join(os.tmpdir(), "opencast-originals-")) });
  await preparer.init();
}, 60_000);
afterAll(() => h.close());

describe("prepared from the original", () => {
  it("keeps the upload as it came, in Infrequent Access, and prepares a real 1080p from a source bigger than 720p", async () => {
    const clip = await fullHdClip();
    const up = await kai.post(`/v1/stations/${beatId}/library/uploads`).attach("file", clip).field("title", "Full HD").expect(201);
    await h.services.library.settle();
    const item = await kai.get(`/v1/library/${up.body.id}`).expect(200);
    const { cid } = await contentIdOf(clip);
    // The item's file is the original's bytes; nothing was compressed or stored beside it.
    expect(item.body).toMatchObject({ status: "ready", picture: { width: 1920, height: 1080 }, storage: { contentId: cid } });
    expect(item.body.loudnessLufs).toEqual(expect.any(Number));
    const [file] = await h.db.select().from(schema.assetFiles).where(eq(schema.assetFiles.assetId, up.body.id));
    expect(file).toMatchObject({ contentId: cid, originalContentId: null, compression: null });
    expect((await h.db.select().from(schema.contents).where(eq(schema.contents.cid, cid)))[0].storageClass).toBe("infrequent");
    expect(await h.db.select().from(schema.contentRefs).where(eq(schema.contentRefs.cid, cid))).toEqual([expect.objectContaining({ owner: "asset_file", ownerId: file.id })]);
    expect(await exists(path.join(h.deps.config.storageRoot, "uploads", beatId, "ready"))).toBe(false);

    // Playout prepares from that original, with FFmpeg (the full ladder, the fastest preset).
    const real = createPreparer(ctx(), { transcoder: ffmpegTranscoder({ preset: "ultrafast" }), scratchDir: await fs.mkdtemp(path.join(os.tmpdir(), "opencast-1080-")) });
    await real.init();
    const [ref] = [...(await h.services.library.itemsByIds([up.body.id])).values()];
    expect(refKey(ref)).toBe(cid);
    await real.want([{ contentId: ref.contentId, mediaKind: "video", band: "tv", durationMs: ref.durationMs }]);
    await prepareQueued(h, real);
    expect(real.isReady(cid, "tv")).toBe(true);
    const probe = await run(["-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height", "-of", "csv=p=0", path.join(objectsDir(), "prepared", cid, "v1080", "seg_00000.ts")], "ffprobe");
    expect(probe.stdout.trim().split("\n")[0]).toBe("1920,1080");
    // Prepared from the original's bytes (its content ID is the key), and nothing else was stored.
    const prepared = await h.db.select().from(schema.preparedItems).where(eq(schema.preparedItems.key, cid));
    expect(prepared).toEqual([expect.objectContaining({ contentId: cid, status: "ready" })]);
    expect(await h.db.select({ cid: schema.contents.cid }).from(schema.contents)).toEqual([{ cid }]);
  }, 120_000);

  it("keeps a spot's original too, and checks it", async () => {
    const business = await jess
      .post("/v1/businesses", { name: "Orange Street Coffee", category: "Coffee and food", customersWhere: "location", locations: [{ kind: "location", streetAddress: "101 Orange St", city: "Redlands", latitude: 34.0558, longitude: -117.1817 }] })
      .expect(201);
    const spot = await jess
      .post(`/v1/businesses/${business.body.id}/spots`, { title: "Fall menu", lengthSec: 15, category: "Food", rate: { kind: "per_thousand", micros: 8_000_000 }, budget: { totalMicros: 300_000_000, dailyCapMicros: 12_000_000 }, targeting: { withinMiles: 10 } })
      .expect(201);
    const clip = await testClip(15);
    const uploaded = await jess.post(`/v1/spots/${spot.body.id}/file`).attach("file", clip).expect(200);
    const { cid } = await contentIdOf(clip);
    const [file] = await h.db.select().from(schema.spotFiles).where(eq(schema.spotFiles.spotId, spot.body.id));
    expect(file).toMatchObject({ contentId: cid, widthPx: 640, heightPx: 360 });
    expect((await h.db.select().from(schema.contents).where(eq(schema.contents.cid, cid)))[0].storageClass).toBe("infrequent");
    const checks = Object.fromEntries(uploaded.body.file.checks.map((c: { check: string; result: string }) => [c.check, c.result]));
    expect(checks).toMatchObject({ length: "fine", picture: "fixed" });
    // A draft has no preview asked for yet.
    expect(uploaded.body.file).toMatchObject({ previewUrl: null, previewStatus: null });
    expect(await exists(path.join(h.deps.config.storageRoot, "uploads", `business-${business.body.id}`))).toBe(false);

    // In review, it plays its prepared segments: "Being prepared" first.
    const inReview = await jess.post(`/v1/spots/${spot.body.id}/submit`).expect(200);
    expect(inReview.body.file).toMatchObject({ previewUrl: null, previewStatus: "preparing" });
    const [queued] = await h.db.select().from(schema.preparedItems).where(eq(schema.preparedItems.key, cid));
    expect(queued).toMatchObject({ status: "queued", mediaKind: "video", renditions: ["a128", "v1080", "v360", "v480", "v720"] });
    await prepareQueued(h, preparer);
    const ready = await jess.get(`/v1/spots/${spot.body.id}`).expect(200);
    expect(ready.body.file).toMatchObject({ previewUrl: `/v1/previews/${cid}/v360.m3u8`, previewStatus: "ready" });
    // No separate preview rendition anywhere.
    expect(await exists(path.join(objectsDir(), "previews"))).toBe(false);
  }, 60_000);
});

describe("storage classes", () => {
  it("storing the same bytes as Standard keeps an Infrequent Access object where it is", async () => {
    const file = await dummyFile();
    const puts: string[] = [];
    const objects = h.deps.storage.objects;
    const put = objects.put.bind(objects);
    objects.put = async (key, f, options) => {
      puts.push(`${key}:${options.storageClass}`);
      return put(key, f, options);
    };
    try {
      const first = await h.services.library.content.store(file, { storageClass: "infrequent" });
      const again = await h.services.library.content.store(file, { storageClass: "standard" });
      expect(again).toMatchObject({ cid: first.cid, storageClass: "infrequent" });
      expect(puts).toEqual([`${first.cid}:infrequent`]);
      const [row] = await h.db.select().from(schema.contents).where(eq(schema.contents.cid, first.cid));
      expect(row.storageClass).toBe("infrequent");

      // Stored again after it went (nothing referenced it): in the class asked for now.
      await h.db.update(schema.contents).set({ deletedAt: h.clock.now(), deletedReason: "unreferenced" }).where(eq(schema.contents.cid, first.cid));
      await objects.delete(first.cid);
      const back = await h.services.library.content.store(file, { storageClass: "standard" });
      expect(back.storageClass).toBe("standard");
      expect(puts).toEqual([`${first.cid}:infrequent`, `${first.cid}:standard`]);
    } finally {
      objects.put = put;
    }
  });
});

describe("what was prepared goes with the file", () => {
  async function preparedItem(title: string, seconds: number) {
    const clip = await testClip(seconds);
    const up = await kai.post(`/v1/stations/${beatId}/library/uploads`).attach("file", clip).field("title", title).expect(201);
    await h.services.library.settle();
    const { cid } = await contentIdOf(clip);
    await preparer.want([{ contentId: cid, mediaKind: "video", band: "tv", durationMs: seconds * 1000 }, { contentId: cid, mediaKind: "video", band: "radio", durationMs: seconds * 1000 }]);
    await prepareQueued(h, preparer);
    // A caption track cut into its segments (as the preparer does for an uploaded or embedded track).
    const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello\n";
    await kai.put(`/v1/library/${up.body.id}/captions`, { language: "en", text: vtt, source: "uploaded" }).expect(200);
    expect(await preparer.prepareCaptions(cid)).toBe(1);
    expect(await preparedRows(cid)).toEqual({ items: 1, renditions: 6, captions: 1 });
    expect(await exists(path.join(objectsDir(), "prepared", cid, "v720", "seg_00000.ts"))).toBe(true);
    return { itemId: up.body.id as string, cid };
  }

  it("garbage collection deletes the prepared segments and their rows; as-run rows stay", async () => {
    const { itemId, cid } = await preparedItem("Collected", 5);
    const [track] = await h.db.select().from(schema.captionTracks).where(eq(schema.captionTracks.assetId, itemId));
    const [cut] = await h.db.select().from(schema.preparedCaptions).where(eq(schema.preparedCaptions.contentId, track.contentId!));
    expect(await exists(path.join(objectsDir(), "prepared", cid, cut.rendition, "seg_00000.vtt"))).toBe(true);
    // The caption track removed: its file goes, and so does what was cut from it; the item's renditions stay.
    await kai.delete(`/v1/library/${itemId}/captions`).expect(200);
    expect((await h.services.library.content.info([track.contentId!])).get(track.contentId!)?.deleted).toBe(true);
    expect(await h.db.select().from(schema.preparedCaptions).where(eq(schema.preparedCaptions.contentId, track.contentId!))).toEqual([]);
    expect(await exists(path.join(objectsDir(), "prepared", cid, cut.rendition))).toBe(false);
    expect(await preparedRows(cid)).toEqual({ items: 1, renditions: 6, captions: 0 });

    await h.db.insert(schema.asRun).values({ stationId: beatId, code: "PGM", startedAt: new Date("2026-09-30T19:00:00.000Z"), endedAt: new Date("2026-09-30T19:00:05.000Z"), assetId: itemId, reason: "planned" });
    await kai.delete(`/v1/library/${itemId}`).expect(200);
    expect(await exists(path.join(objectsDir(), cid))).toBe(false);
    expect(await exists(path.join(objectsDir(), "prepared", cid))).toBe(false);
    expect(await preparedRows(cid)).toEqual({ items: 0, renditions: 0, captions: 0 });
    // What aired is still on the record.
    expect(await h.db.select().from(schema.asRun).where(eq(schema.asRun.assetId, itemId))).toHaveLength(1);
    // The same bytes stored again later are prepared again (the preparer doesn't trust what it remembered).
    expect(preparer.isReady(cid, "tv")).toBe(true);
    await h.services.library.content.store(await testClip(5), { storageClass: "infrequent" });
    expect(await preparer.want([{ contentId: cid, mediaKind: "video", band: "tv", durationMs: 5_000 }])).toBe(1);
    expect(preparer.isReady(cid, "tv")).toBe(false);
  }, 60_000);

  it("a file a channel aired lately keeps its segments until the storage sweep", async () => {
    const { itemId, cid } = await preparedItem("Aired lately", 6);
    await h.db.insert(schema.channelItems).values({ stationId: beatId, run: 1, seq: 0, disc: 0, startsAt: new Date(h.clock.now().getTime() - 60_000), endsAt: h.clock.now(), kind: "prepared", preparedKey: cid, segments: 2, segmentMs: [4000, 2000], code: "PGM", label: "Aired lately", reason: "planned" });
    await kai.delete(`/v1/library/${itemId}`).expect(200);
    expect(await exists(path.join(objectsDir(), cid))).toBe(false);
    expect(await exists(path.join(objectsDir(), "prepared", cid, "v720", "seg_00000.ts"))).toBe(true);
    expect((await h.services.library.content.sweep()).prepared).toMatchObject({ dropped: 0, deferred: 1 });
    h.clock.advance(3 * 3_600_000);
    expect((await h.services.library.content.sweep()).prepared).toMatchObject({ dropped: 1, deferred: 0 });
    expect(await exists(path.join(objectsDir(), "prepared", cid))).toBe(false);
    expect(await preparedRows(cid)).toEqual({ items: 0, renditions: 0, captions: 0 });
  }, 60_000);

  it("a takedown deletes them at once, whether or not it aired lately", async () => {
    const { itemId, cid } = await preparedItem("Pulled", 7);
    await h.db.insert(schema.channelItems).values({ stationId: beatId, run: 1, seq: 10, disc: 0, startsAt: new Date(h.clock.now().getTime() - 60_000), endsAt: h.clock.now(), kind: "prepared", preparedKey: cid, segments: 2, segmentMs: [4000, 3000], code: "PGM", label: "Pulled", reason: "planned" });
    const filed = await anon(h).post("/v1/claims").send({ itemId, claimantName: "Studio", claimantContact: "x@example.com", claimText: "Ours.", swornStatement: true }).expect(201);
    // Locked while the claim is open: kept, prepared segments too (it can come back), but no preview.
    expect(await exists(path.join(objectsDir(), "prepared", cid, "v720", "seg_00000.ts"))).toBe(true);
    await anon(h).get(`/v1/previews/${cid}/v360.m3u8`).expect(404);
    await kai.post(`/v1/claims/${filed.body.claimId}/remove`).expect(200);
    expect(await exists(path.join(objectsDir(), cid))).toBe(false);
    expect(await exists(path.join(objectsDir(), "prepared", cid))).toBe(false);
    expect(await preparedRows(cid)).toEqual({ items: 0, renditions: 0, captions: 0 });
  }, 60_000);

  it("the sweep deletes the separate previews made before", async () => {
    const file = await dummyFile();
    const { cid } = await h.services.library.content.store(file, { storageClass: "infrequent" });
    await fs.mkdir(path.join(objectsDir(), "previews", cid), { recursive: true });
    await fs.writeFile(path.join(objectsDir(), "previews", cid, "index.m3u8"), "#EXTM3U\n");
    await h.db.insert(schema.contentPreviews).values({ cid, status: "ready" });
    await h.db.insert(schema.contentPreviewNeeds).values({ cid, reason: "offer", subjectId: "00000000-0000-4000-8000-000000000001" });
    expect((await h.services.library.content.sweep()).oldPreviews).toBe(1);
    expect(await exists(path.join(objectsDir(), "previews", cid))).toBe(false);
    expect(await h.db.select().from(schema.contentPreviews)).toEqual([]);
    expect(await h.db.select().from(schema.contentPreviewNeeds)).toEqual([]);
  });
});

describe("previews play the prepared segments", () => {
  it("a catalog offer's episodes: asked for when offered, 'Being prepared' until then, a short-cache playlist after", async () => {
    const program = await kai.post(`/v1/stations/${beatId}/programs`, { title: "Saturday Reel", description: "Films from the archive." }).expect(201);
    const clip = await testClip(9);
    const up = await kai.post(`/v1/stations/${beatId}/library/uploads`).attach("file", clip).field("title", "Saturday Reel, ep. 1").field("programId", program.body.id).expect(201);
    await h.services.library.settle();
    const { cid } = await contentIdOf(clip);
    const offer = await kai
      .post(`/v1/programs/${program.body.id}/offer`, { termsOffered: ["barter", "cash"], cashPriceMicros: 2_500_000, cashPriceUnit: "per_airing", barterMakerMsPerHour: 120_000, airingsPerEpisode: 2, windowDays: 7, liveOnly: false, noticeDays: 7, approval: "i_approve", radioBandAllowed: true })
      .expect(201);
    const waiting = await jess.get(`/v1/catalog/offers/${offer.body.id}`).expect(200);
    expect(waiting.body.episodes[0]).toMatchObject({ id: up.body.id, previewUrl: null, previewStatus: "preparing" });
    await anon(h).get(`/v1/previews/${cid}/v360.m3u8`).expect(404);
    await prepareQueued(h, preparer);
    const detail = await jess.get(`/v1/catalog/offers/${offer.body.id}`).expect(200);
    expect(detail.body.episodes[0]).toMatchObject({ previewUrl: `/v1/previews/${cid}/v360.m3u8`, previewStatus: "ready" });
    const playlist = await anon(h).get(`/v1/previews/${cid}/v360.m3u8`).expect(200);
    expect(playlist.headers["content-type"]).toMatch(/mpegurl/);
    expect(playlist.headers["cache-control"]).toBe("public, max-age=60");
    expect(playlist.text.split("\n")).toEqual([
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      "#EXT-X-TARGETDURATION:4",
      "#EXT-X-MEDIA-SEQUENCE:0",
      "#EXT-X-PLAYLIST-TYPE:VOD",
      "#EXT-X-INDEPENDENT-SEGMENTS",
      "#EXTINF:4.000,",
      `/objects/prepared/${cid}/v360/seg_00000.ts`,
      "#EXTINF:4.000,",
      `/objects/prepared/${cid}/v360/seg_00001.ts`,
      "#EXTINF:1.000,",
      `/objects/prepared/${cid}/v360/seg_00002.ts`,
      "#EXT-X-ENDLIST",
      ""
    ]);
    // Only the preview renditions, and only prepared ones.
    await anon(h).get(`/v1/previews/${cid}/v1080.m3u8`).expect(404);
    await anon(h).get(`/v1/previews/not-a-cid/v360.m3u8`).expect(404);
    // Withdrawn: nothing to delete (the segments are what it airs from).
    await kai.patch(`/v1/catalog/offers/${offer.body.id}`, { status: "withdrawn" }).expect(200);
    expect(await exists(path.join(objectsDir(), "prepared", cid, "v360", "seg_00000.ts"))).toBe(true);
  }, 60_000);

  it("a radio station's episodes play the 64k sound", async () => {
    const soundId = (await stationFixture(h, { callSign: "KSND", name: "Sound", ownerId: kai.id, marketId, tenths: 882, band: "radio" })).id;
    const program = await kai.post(`/v1/stations/${soundId}/programs`, { title: "Night Talk", description: "Calls after dark." }).expect(201);
    const clip = await testClip(5, "audio");
    await kai.post(`/v1/stations/${soundId}/library/uploads`).attach("file", clip).field("title", "Night Talk, ep. 1").field("programId", program.body.id).expect(201);
    await h.services.library.settle();
    const { cid } = await contentIdOf(clip);
    const offer = await kai
      .post(`/v1/programs/${program.body.id}/offer`, { termsOffered: ["barter", "cash"], cashPriceMicros: 1_000_000, cashPriceUnit: "per_airing", barterMakerMsPerHour: 120_000, airingsPerEpisode: 2, windowDays: 7, liveOnly: false, noticeDays: 7, approval: "i_approve", radioBandAllowed: true })
      .expect(201);
    const [queued] = await h.db.select().from(schema.preparedItems).where(eq(schema.preparedItems.key, cid));
    expect(queued).toMatchObject({ mediaKind: "audio", renditions: ["a128", "a64"] });
    await prepareQueued(h, preparer);
    const detail = await jess.get(`/v1/catalog/offers/${offer.body.id}`).expect(200);
    expect(detail.body.episodes[0]).toMatchObject({ previewUrl: `/v1/previews/${cid}/a64.m3u8`, previewStatus: "ready" });
    const playlist = await anon(h).get(`/v1/previews/${cid}/a64.m3u8`).expect(200);
    expect(playlist.text).toContain(`/objects/prepared/${cid}/a64/seg_00000.ts`);
  }, 60_000);

  it("an order's delivery: stored as an original, previewed from its prepared segments", async () => {
    const [business] = await h.db.select().from(schema.advertisers).limit(1);
    const [order] = await h.db
      .insert(schema.productionOrders)
      .values({ advertiserId: business.id, makerStationId: beatId, title: "Winter menu", lengthSec: 15, about: "Soup season.", neededBy: "2026-10-20", status: "accepted" })
      .returning();
    const clip = await testClip(15);
    const delivered = await kai.post(`/v1/orders/${order.id}/deliveries`).attach("file", clip).expect(200);
    const { cid } = await contentIdOf(clip);
    // The same bytes as the spot above: stored once, still in Infrequent Access.
    expect((await h.db.select().from(schema.contents).where(eq(schema.contents.cid, cid)))[0].storageClass).toBe("infrequent");
    expect(delivered.body.deliveries[0]).toMatchObject({ previewUrl: `/v1/previews/${cid}/v360.m3u8`, previewStatus: "ready" });
    const [brief] = await h.db.select().from(schema.orderFiles).where(and(eq(schema.orderFiles.orderId, order.id), eq(schema.orderFiles.role, "delivery")));
    expect(brief.contentId).toBe(cid);
  }, 60_000);
});

describe("one-off: items prepared from the 1280 px copy", () => {
  it("prepares the original, then moves the item onto it; the copy goes with what was prepared from it", async () => {
    // An item from before: its file is the copy, its original beside it; prepared (TV) from the copy.
    const [copyFile, originalFile] = [await dummyFile(), await dummyFile()];
    const content = h.services.library.content;
    const copy = (await content.store(copyFile, { storageClass: "standard" })).cid;
    const original = (await content.store(originalFile, { storageClass: "infrequent" })).cid;
    const [item] = await h.db.insert(schema.assets).values({ stationId: beatId, title: "Old upload", code: "PGM", source: "upload", mediaKind: "video", durationMs: 8_000, status: "ready" }).returning();
    await h.db.insert(schema.rightsConfirmations).values({ assetId: item.id, basis: "made_it" });
    const [row] = await h.db.insert(schema.assetFiles).values({ assetId: item.id, version: 1, contentId: copy, originalContentId: original, compression: { tool: "ffmpeg", profile: "720p" } }).returning();
    await content.addRef(h.db, copy, "asset_file", row.id);
    await content.addRef(h.db, original, "asset_original", row.id);
    await preparer.want([{ contentId: copy, mediaKind: "video", band: "tv", durationMs: 8_000 }]);
    await prepareQueued(h, preparer);

    // Report first: nothing changes.
    const report = await prepareFromOriginals(ctx(), { apply: false });
    expect(report).toMatchObject({ items: 1, toPrepare: 1, moved: 0 });
    expect(report.entries[0]).toMatchObject({ itemId: item.id, copy, original, bands: ["tv"], state: "to_prepare" });
    expect(await preparedRows(original)).toEqual({ items: 0, renditions: 0, captions: 0 });

    // Applied: the original is queued; the item stays on its copy until it's prepared.
    expect(await prepareFromOriginals(ctx(), { apply: true })).toMatchObject({ queued: 1, moved: 0 });
    expect((await h.services.library.currentContent([item.id])).get(item.id)).toBe(copy);
    await prepareQueued(h, preparer);
    expect(await prepareFromOriginals(ctx(), { apply: false })).toMatchObject({ readyToMove: 1 });

    // Applied again: moved onto the original; the copy and what was prepared from it are gone.
    expect(await prepareFromOriginals(ctx(), { apply: true })).toMatchObject({ moved: 1 });
    expect((await h.services.library.currentContent([item.id])).get(item.id)).toBe(original);
    const files = await h.db.select().from(schema.assetFiles).where(eq(schema.assetFiles.assetId, item.id));
    expect(files.map((f) => [f.version, f.contentId, f.originalContentId])).toEqual(expect.arrayContaining([[1, copy, original], [2, original, null]]));
    expect((await content.info([copy])).get(copy)?.deleted).toBe(true);
    expect(await exists(path.join(objectsDir(), copy))).toBe(false);
    expect(await preparedRows(copy)).toEqual({ items: 0, renditions: 0, captions: 0 });
    expect(await exists(path.join(objectsDir(), original))).toBe(true);

    // Nothing left to do.
    expect(await prepareFromOriginals(ctx(), { apply: true })).toMatchObject({ items: 0 });
  }, 60_000);
});

describe("one-off: relinks to content IDs", () => {
  it("move-off-pinata --copy copies a pin, checks it, and points the rows that used it at the content ID, never unpinning", async () => {
    const clip = await testClip(6);
    const pinCid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
    const server = http.createServer(async (req, res) => {
      if (req.url === `/ipfs/${pinCid}`) res.writeHead(200).end(await fs.readFile(clip));
      else res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const gateway = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ipfs`;
    try {
      const location = `${gateway}/${pinCid}`;
      const { item, row } = await legacyItem(beatId, { storage: "ipfs", location, ipfsCid: pinCid }, "Pinned");
      // Prepared from its old location (as `loc-…`).
      await preparer.want([{ location, mediaKind: "video", band: "tv", durationMs: 6_000 }]);
      await prepareQueued(h, preparer);
      const locKey = refKey({ location })!;
      expect(preparer.isReady(locKey, "tv")).toBe(true);
      const ipfs = h.deps.storage.ipfs as ReturnType<typeof fakeIpfs>;
      const unpin = ipfs.unpin;
      let unpinned = 0;
      ipfs.unpin = async (id) => {
        unpinned++;
        return unpin(id);
      };
      try {
        const copied = await copyPin(ctx(), { ipfsCid: pinCid, name: "Pinned", bytes: 1 }, gateway);
        const { cid } = await contentIdOf(clip);
        expect(copied).toMatchObject({ ipfsCid: pinCid, contentId: cid, verified: true, relinked: [{ table: "asset_files", id: row.id, carried: ["a128", "v1080", "v360", "v480", "v720"] }] });
        const [after] = await h.db.select().from(schema.assetFiles).where(eq(schema.assetFiles.id, row.id));
        // Its content ID, in object storage; where it was is kept for the record.
        expect(after).toMatchObject({ contentId: cid, storage: "local", location, ipfsCid: pinCid });
        expect(await h.db.select().from(schema.contentRefs).where(eq(schema.contentRefs.cid, cid))).toEqual(expect.arrayContaining([expect.objectContaining({ owner: "asset_file", ownerId: row.id })]));
        expect((await h.db.select().from(schema.contents).where(eq(schema.contents.cid, cid)))[0].storageClass).toBe("infrequent");
        // Ready to air under its content ID at once (carried over, not prepared again), and nothing deleted.
        const ref = (await h.services.library.itemsByIds([item.id])).get(item.id)!;
        expect(refKey(ref)).toBe(cid);
        await preparer.refresh([cid]);
        expect(preparer.isReady(cid, "tv")).toBe(true);
        expect(await exists(path.join(objectsDir(), "prepared", cid, "v720", "seg_00001.ts"))).toBe(true);
        expect(await exists(path.join(objectsDir(), "prepared", locKey, "v720", "seg_00001.ts"))).toBe(true);
        expect(await preparedRows(locKey)).toMatchObject({ items: 1, renditions: 5 });
        // Again: nothing more to relink.
        expect(await copyPin(ctx(), { ipfsCid: pinCid, name: "Pinned", bytes: 1 }, gateway)).toMatchObject({ verified: true, relinked: [] });
        expect(unpinned).toBe(0);
      } finally {
        ipfs.unpin = unpin;
      }
    } finally {
      server.close();
    }
  }, 60_000);

  it("rows keyed by a disk path are hashed, stored and relinked: report first, then once", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencast-legacy-"));
    const onDisk = path.join(dir, "old.mp4");
    await fs.copyFile(await dummyFile(), onDisk);
    const { row } = await legacyItem(beatId, { storage: "local", location: onDisk }, "On disk");
    const missing = await legacyItem(beatId, { storage: "local", location: path.join(dir, "gone.mp4") }, "Gone");

    const report = await relinkLocations(ctx(), { relink: false });
    expect(report.entries).toEqual(expect.arrayContaining([expect.objectContaining({ id: row.id, reachable: true }), expect.objectContaining({ id: missing.row.id, reachable: false })]));
    expect((await h.db.select().from(schema.assetFiles).where(eq(schema.assetFiles.id, row.id)))[0].contentId).toBeNull();

    const done = await relinkLocations(ctx(), { relink: true });
    const { cid } = await contentIdOf(onDisk);
    expect(done.entries).toEqual(expect.arrayContaining([expect.objectContaining({ id: row.id, contentId: cid, relinked: true }), expect.objectContaining({ id: missing.row.id, error: expect.any(String) })]));
    expect((await h.db.select().from(schema.assetFiles).where(eq(schema.assetFiles.id, row.id)))[0]).toMatchObject({ contentId: cid, storage: "local", location: onDisk });
    expect(await exists(path.join(objectsDir(), cid))).toBe(true);
    // The file where it was is left alone.
    expect(await exists(onDisk)).toBe(true);

    // Again: only the unreadable row is left, and nothing changes.
    const again = await relinkLocations(ctx(), { relink: true });
    expect(again.entries.map((e) => e.id)).toEqual([missing.row.id]);
  });
});
