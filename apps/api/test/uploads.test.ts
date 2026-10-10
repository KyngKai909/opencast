// Direct uploads (follow-up Phase 4): presigned multipart uploads straight to object storage, here
// with the local protocol (part URLs on the API itself, signed the same way), which is the same
// flow the apps use against R2. Role checks, create, sign, list, complete, abort; resuming from
// the parts the store has; the content ID worked out from the stored bytes and a duplicate stored
// once; Infrequent Access for originals; preparation started; a completion picked up after a
// restart; abandoned uploads cleaned up; and production refusing the local protocol.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { UPLOAD_MAX_PARTS, UPLOAD_MIN_PART_BYTES, uploadPartCount, uploadPartSize } from "@opencast/contracts";
import { contentIdOf } from "../src/v1/storage.js";
import { createUploadsService } from "../src/v1/modules/uploads/service.js";
import { anon, createHarness, market, radioTenths, stationFixture, testClip, type Harness, type User } from "./harness.js";

let h: Harness;
let kai: User;
let jess: User;
let dana: User;
let beatId: string;
let marketId: string;
let wave: string;
let clip: string;

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const objectsDir = () => path.join(h.deps.config.storageRoot, "objects");
const exists = (file: string) =>
  fs.access(file).then(
    () => true,
    () => false
  );

function ffmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });
}

type Session = { id: string; key: string; protocol: string; partSize: number; partCount: number; parallel: number; parts: Array<{ partNumber: number; url: string }> };

/** Sends one part to its signed URL, as the browser does (no sign-in header). */
async function putPart(url: string, bytes: Buffer) {
  const res = await anon(h).put(url).set("content-type", "application/octet-stream").send(bytes);
  return res;
}

/** Starts an upload and sends the parts `only` names (all of them by default). */
async function send(user: User, purpose: object, file: string, options: { only?: number[]; name?: string; type?: string } = {}) {
  const bytes = await fs.readFile(file);
  const created = await user.post("/v1/uploads", { purpose, filename: options.name ?? path.basename(file), size: bytes.length, contentType: options.type ?? "" }).expect(201);
  const session = created.body as Session;
  const etags = new Map<number, string>();
  const wanted = options.only ?? Array.from({ length: session.partCount }, (_, i) => i + 1);
  const signed = await user.post(`/v1/uploads/${session.id}/parts`, { partNumbers: wanted }).expect(200);
  for (const part of signed.body.parts as Array<{ partNumber: number; url: string }>) {
    const slice = bytes.subarray((part.partNumber - 1) * session.partSize, part.partNumber * session.partSize);
    const res = await putPart(part.url, slice);
    expect(res.status).toBe(200);
    expect(res.headers["access-control-expose-headers"]).toBe("ETag");
    etags.set(part.partNumber, res.headers.etag);
  }
  return { session, bytes, etags };
}

async function complete(user: User, id: string, etags: Map<number, string>) {
  const res = await user.post(`/v1/uploads/${id}/complete`, { parts: [...etags].map(([partNumber, etag]) => ({ partNumber, etag })) });
  await h.services.uploads.settle();
  return res;
}

beforeAll(async () => {
  h = await createHarness();
  marketId = (await market(h)).id;
  kai = await h.signIn("Kai");
  jess = await h.signIn("Jess");
  dana = await h.signIn("Dana");
  beatId = (await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId, tenths: 121, signedOn: true })).id;
  // Two parts at 16 MiB: two minutes of stereo sound.
  wave = path.join(os.tmpdir(), "opencast-test-clips", "upload-125s.wav");
  if (!(await exists(wave))) {
    await fs.mkdir(path.dirname(wave), { recursive: true });
    await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=330:duration=125", "-ac", "2", "-ar", "44100", `${wave}.${process.pid}.wav`]);
    await fs.rename(`${wave}.${process.pid}.wav`, wave);
  }
  clip = await testClip(6);
}, 60_000);
afterAll(() => h.close());

describe("part size", () => {
  it("is 16 MiB up to 1 GiB, 32 MiB up to 16 GiB, then 64 MiB, and never more than 10,000 parts", () => {
    expect(uploadPartSize(1)).toBe(16 * MiB);
    expect(uploadPartCount(1)).toBe(1);
    expect(uploadPartCount(16 * MiB)).toBe(1);
    expect(uploadPartCount(16 * MiB + 1)).toBe(2);
    expect(uploadPartSize(GiB)).toBe(16 * MiB);
    expect(uploadPartSize(4 * GiB)).toBe(32 * MiB);
    expect(uploadPartCount(4 * GiB)).toBe(128);
    expect(uploadPartSize(16 * GiB + 1)).toBe(64 * MiB);
    expect(uploadPartCount(100 * GiB)).toBe(1600);
    for (const size of [5 * MiB, 700 * MiB, 3.3 * GiB, 99 * GiB, 700 * GiB, 5000 * GiB]) {
      expect(uploadPartSize(size)).toBeGreaterThanOrEqual(UPLOAD_MIN_PART_BYTES);
      expect(uploadPartCount(Math.floor(size))).toBeLessThanOrEqual(UPLOAD_MAX_PARTS);
    }
  });
});

describe("direct uploads", () => {
  it("checks the role for what the file is for, and only its sender can use an upload", async () => {
    const purpose = { kind: "library_item", stationId: beatId };
    // Not on BEAT: not found, as the old upload endpoint answers.
    await dana.post("/v1/uploads", { purpose, filename: "a.mp4", size: 10 }).expect(404);
    await anon(h).post("/v1/uploads").send({ purpose, filename: "a.mp4", size: 10 }).expect(401);
    // Too big for what it's for.
    const caption = await kai.post("/v1/uploads", { purpose: { kind: "relay_background", stationId: beatId }, filename: "bg.png", size: 10 }).expect(409);
    expect(caption.body.error.code).toBe("not_radio");
    const created = await kai.post("/v1/uploads", { purpose, filename: "a.mp4", size: 10 }).expect(201);
    expect(created.body).toMatchObject({ protocol: "local", partSize: 16 * MiB, partCount: 1, parallel: 5, state: "uploading" });
    expect(created.body.parts).toEqual([expect.objectContaining({ partNumber: 1, url: expect.stringMatching(/^\/v1\/uploads\/[0-9a-f-]{36}\/parts\/1\/data\?expires=\d+&signature=[0-9a-f]{64}$/) })]);
    for (const call of [dana.get(`/v1/uploads/${created.body.id}`), dana.get(`/v1/uploads/${created.body.id}/parts`), dana.post(`/v1/uploads/${created.body.id}/parts`, { partNumbers: [1] }), dana.delete(`/v1/uploads/${created.body.id}`)]) {
      await call.expect(404);
    }
    // A part number the upload doesn't have.
    await kai.post(`/v1/uploads/${created.body.id}/parts`, { partNumbers: [2] }).expect(422);
    // A part URL that's been changed, or has run out, is refused.
    const url: string = created.body.parts[0].url;
    expect((await putPart(url.replace(/signature=./, "signature=0"), Buffer.from("x"))).status).toBe(403);
    expect((await putPart(url.replace(/expires=\d+/, "expires=1000"), Buffer.from("x"))).status).toBe(403);
    await kai.delete(`/v1/uploads/${created.body.id}`).expect(200);
  });

  it("uploads in parts, resumes from what the store has, and keeps the original once by content ID, in Infrequent Access, prepared for air", async () => {
    // A dropped connection: only part 1 made it.
    const first = await send(kai, { kind: "library_item", stationId: beatId, fields: { title: "Tone test", code: "PGM" } }, wave, { only: [1] });
    expect(first.session.partCount).toBe(2);
    const listed = await kai.get(`/v1/uploads/${first.session.id}/parts`).expect(200);
    expect(listed.body.parts).toEqual([{ partNumber: 1, etag: first.etags.get(1), size: 16 * MiB }]);
    // Completing now is refused: part 2 isn't in.
    const early = await kai.post(`/v1/uploads/${first.session.id}/complete`, { parts: [{ partNumber: 1, etag: first.etags.get(1) }] }).expect(409);
    expect(early.body.error.code).toBe("parts_missing");
    // Resumed: only the missing part is sent.
    const signed = await kai.post(`/v1/uploads/${first.session.id}/parts`, { partNumbers: [2] }).expect(200);
    const res = await putPart(signed.body.parts[0].url, first.bytes.subarray(first.session.partSize));
    first.etags.set(2, res.headers.etag);
    const done = await complete(kai, first.session.id, first.etags);
    expect(done.status).toBe(200);
    expect(done.body.state).toBe("checking");

    const { cid } = await contentIdOf(wave);
    const upload = await kai.get(`/v1/uploads/${first.session.id}`).expect(200);
    expect(upload.body).toMatchObject({ state: "preparing", contentId: cid, duplicate: false, result: { itemId: first.session.id, stationId: beatId }, error: null });
    const item = await kai.get(`/v1/library/${upload.body.result.itemId}`).expect(200);
    expect(item.body).toMatchObject({ title: "Tone test", status: "ready", storage: { contentId: cid } });
    expect(item.body.loudnessLufs).toEqual(expect.any(Number));
    const [row] = await h.db.select().from(schema.contents).where(eq(schema.contents.cid, cid));
    expect(row).toMatchObject({ storageClass: "infrequent", bytes: first.bytes.length });
    // The staged copy is gone; the object is at its content ID, byte for byte.
    expect(await exists(path.join(objectsDir(), "uploads", first.session.id))).toBe(false);
    expect(await exists(path.join(objectsDir(), ".multipart", first.session.id))).toBe(false);
    expect(createHash("sha256").update(await fs.readFile(path.join(objectsDir(), cid))).digest("hex")).toBe(createHash("sha256").update(first.bytes).digest("hex"));
    // Preparation started: queued for the worker.
    const [prepared] = await h.db.select().from(schema.preparedItems).where(eq(schema.preparedItems.key, cid));
    expect(prepared).toMatchObject({ status: "queued", mediaKind: "audio" });
    // Completing again answers the same.
    await kai.post(`/v1/uploads/${first.session.id}/complete`, { parts: [...first.etags].map(([partNumber, etag]) => ({ partNumber, etag })) }).expect(200);
  }, 60_000);

  it("stores a duplicate once: the second upload's bytes are dropped and it points at the first", async () => {
    const { cid } = await contentIdOf(wave);
    const again = await send(kai, { kind: "library_item", stationId: beatId, fields: { title: "Tone test, again" } }, wave);
    await complete(kai, again.session.id, again.etags);
    const upload = await kai.get(`/v1/uploads/${again.session.id}`).expect(200);
    expect(upload.body).toMatchObject({ state: "preparing", contentId: cid, duplicate: true });
    expect(await h.db.select().from(schema.contents).where(eq(schema.contents.cid, cid))).toHaveLength(1);
    const refs = await h.db.select().from(schema.contentRefs).where(eq(schema.contentRefs.cid, cid));
    expect(refs.filter((r) => r.owner === "asset_file")).toHaveLength(2);
    expect(await exists(path.join(objectsDir(), "uploads", again.session.id))).toBe(false);
    // One object on disk for both.
    const stored = (await fs.readdir(objectsDir())).filter((n) => n.startsWith("b"));
    expect(stored.filter((n) => n === cid)).toHaveLength(1);
  }, 60_000);

  it("finishes for an admin on a station Opencast runs, where they have no membership (2026-10-04)", async () => {
    // The upload is checked again when it finishes, as the person is now: an admin's role on a
    // catalog station comes from being an admin, which that check used to leave out ("That station
    // wasn't found" after the bytes had all arrived).
    const ada = await h.signIn("Ada", { admin: true });
    const retro = await stationFixture(h, { kind: "catalog", callSign: "RETRO", name: "Retro Rerun", marketId, tenths: 41 });
    const sent = await send(ada, { kind: "library_item", stationId: retro.id, fields: { title: "Catalog clip" } }, clip);
    await complete(ada, sent.session.id, sent.etags).then((r) => expect(r.status).toBe(200));
    const upload = await ada.get(`/v1/uploads/${sent.session.id}`).expect(200);
    expect(upload.body.state).not.toBe("failed");
    expect(upload.body).toMatchObject({ result: { stationId: retro.id, itemId: expect.any(String) } });
  }, 60_000);

  it("refuses a file that can't be read, as the old upload did, keeping nothing", async () => {
    const junk = path.join(os.tmpdir(), `opencast-junk-${process.pid}.mp4`);
    await fs.writeFile(junk, Buffer.alloc(4096, 7));
    const sent = await send(kai, { kind: "library_item", stationId: beatId }, junk);
    await complete(kai, sent.session.id, sent.etags);
    const upload = await kai.get(`/v1/uploads/${sent.session.id}`).expect(200);
    const { cid } = await contentIdOf(junk);
    expect(upload.body).toMatchObject({ state: "failed", contentId: cid, error: { code: "unreadable_file", message: "That file can't be read as video or audio." } });
    expect(await h.db.select().from(schema.contents).where(eq(schema.contents.cid, cid))).toEqual([]);
    expect(await exists(path.join(objectsDir(), "uploads", sent.session.id))).toBe(false);
    expect(await exists(path.join(objectsDir(), cid))).toBe(false);
    await fs.rm(junk, { force: true });
  });

  it("replaces an item's file, and sets its caption track from a caption file", async () => {
    const first = await send(kai, { kind: "library_item", stationId: beatId, fields: { title: "Clip" } }, clip);
    await complete(kai, first.session.id, first.etags);
    const itemId = (await kai.get(`/v1/uploads/${first.session.id}`)).body.result.itemId as string;
    const other = await testClip(8);
    const replaced = await send(kai, { kind: "library_replace", itemId }, other);
    await complete(kai, replaced.session.id, replaced.etags);
    expect((await kai.get(`/v1/uploads/${replaced.session.id}`)).body).toMatchObject({ state: "preparing", result: { itemId } });
    const item = await kai.get(`/v1/library/${itemId}`).expect(200);
    expect(item.body.storage.contentId).toBe((await contentIdOf(other)).cid);

    const srt = path.join(os.tmpdir(), `opencast-captions-${process.pid}.srt`);
    await fs.writeFile(srt, "1\n00:00:00,000 --> 00:00:02,000\nHello from BEAT\n");
    await kai.post("/v1/uploads", { purpose: { kind: "caption", itemId, language: "en" }, filename: "big.srt", size: 2 * MiB }).expect(422);
    const captions = await send(kai, { kind: "caption", itemId, language: "en" }, srt);
    await complete(kai, captions.session.id, captions.etags);
    expect((await kai.get(`/v1/uploads/${captions.session.id}`)).body).toMatchObject({ state: "done", result: { itemId } });
    const track = await kai.get(`/v1/library/${itemId}/captions`).expect(200);
    expect(track.body.vtt).toContain("Hello from BEAT");
    await fs.rm(srt, { force: true });
  }, 60_000);

  it("checks a spot's file on arrival and starts its preparation", async () => {
    const business = await jess
      .post("/v1/businesses", { name: "Orange Street Coffee", category: "Coffee and food", customersWhere: "location", locations: [{ kind: "location", streetAddress: "101 Orange St", city: "Redlands", latitude: 34.0558, longitude: -117.1817 }] })
      .expect(201);
    const spot = await jess
      .post(`/v1/businesses/${business.body.id}/spots`, { title: "Fall menu", lengthSec: 15, category: "Food", rate: { kind: "per_thousand", micros: 8_000_000 }, budget: { totalMicros: 300_000_000, dailyCapMicros: 12_000_000 }, targeting: { withinMiles: 10 } })
      .expect(201);
    // Kai isn't the business's: not found.
    await kai.post("/v1/uploads", { purpose: { kind: "spot_file", spotId: spot.body.id }, filename: "spot.mp4", size: 10 }).expect(404);
    const file = await testClip(15);
    const sent = await send(jess, { kind: "spot_file", spotId: spot.body.id }, file);
    await complete(jess, sent.session.id, sent.etags);
    const { cid } = await contentIdOf(file);
    expect((await jess.get(`/v1/uploads/${sent.session.id}`)).body).toMatchObject({ state: "preparing", contentId: cid, result: { spotId: spot.body.id } });
    const checked = await jess.get(`/v1/spots/${spot.body.id}`).expect(200);
    const checks = Object.fromEntries(checked.body.file.checks.map((c: { check: string; result: string }) => [c.check, c.result]));
    expect(checks).toMatchObject({ length: "fine", picture: "fixed" });
    expect((await h.db.select().from(schema.contents).where(eq(schema.contents.cid, cid)))[0].storageClass).toBe("infrequent");
    expect((await h.db.select().from(schema.preparedItems).where(eq(schema.preparedItems.key, cid)))[0]).toMatchObject({ status: "queued" });
  }, 60_000);

  it("aborts: its parts are deleted and it takes no more", async () => {
    const sent = await send(kai, { kind: "library_item", stationId: beatId }, wave, { only: [1] });
    expect(await exists(path.join(objectsDir(), ".multipart", sent.session.id))).toBe(true);
    await kai.delete(`/v1/uploads/${sent.session.id}`).expect(200);
    expect(await exists(path.join(objectsDir(), ".multipart", sent.session.id))).toBe(false);
    expect((await kai.get(`/v1/uploads/${sent.session.id}`)).body.state).toBe("aborted");
    expect((await kai.post(`/v1/uploads/${sent.session.id}/parts`, { partNumbers: [2] }).expect(409)).body.error.code).toBe("not_uploading");
  }, 30_000);

  it("picks a completion up again after a restart, and aborts uploads abandoned for a day", async () => {
    // The API took the completion, then went away before finishing the multipart upload.
    const sent = await send(kai, { kind: "library_item", stationId: beatId, fields: { title: "After a restart" } }, clip);
    await h.db.update(schema.uploads).set({ state: "checking", leaseUntil: new Date(h.clock.now().getTime() - 1000), completedAt: h.clock.now() }).where(eq(schema.uploads.id, sent.session.id));
    const swept = await h.services.uploads.sweep();
    expect(swept.resumed).toBe(1);
    await h.services.uploads.settle();
    const upload = (await kai.get(`/v1/uploads/${sent.session.id}`)).body;
    expect(upload).toMatchObject({ state: "preparing", contentId: (await contentIdOf(clip)).cid, result: { itemId: sent.session.id } });
    const [row] = await h.db.select().from(schema.uploads).where(eq(schema.uploads.id, sent.session.id));
    expect(row.attempts).toBe(1);

    // Left half-sent: a day later it's aborted and its parts go.
    const left = await send(kai, { kind: "library_item", stationId: beatId }, wave, { only: [1] });
    h.clock.advance(25 * 3_600_000);
    const later = await h.services.uploads.sweep({ orphans: true });
    expect(later.abandoned).toBeGreaterThanOrEqual(1);
    expect((await kai.get(`/v1/uploads/${left.session.id}`)).body).toMatchObject({ state: "aborted", error: { code: "abandoned" } });
    expect(await exists(path.join(objectsDir(), ".multipart", left.session.id))).toBe(false);
    // Parts in the store with no upload waiting for them go too.
    const stray = path.join(objectsDir(), ".multipart", "11111111-2222-3333-4444-555555555555");
    await fs.mkdir(stray, { recursive: true });
    // Last written more than a day before the test's clock (not the file system's).
    const long = new Date(h.clock.now().getTime() - 25 * 3_600_000);
    await fs.utimes(stray, long, long);
    const orphaned = await h.services.uploads.sweep({ orphans: true });
    expect(orphaned.orphans).toBe(1);
    expect(await exists(path.join(objectsDir(), ".multipart", "11111111-2222-3333-4444-555555555555"))).toBe(false);
    h.clock.advance(-25 * 3_600_000);
  }, 60_000);

  it("refuses the local protocol in production", async () => {
    const production = createUploadsService({ deps: { ...h.deps, config: { ...h.deps.config, production: true } }, services: h.services });
    const me = { id: kai.id, privyDid: kai.did, isAdmin: false };
    await expect(production.create(me, { purpose: { kind: "library_item", stationId: beatId, fields: {} }, filename: "a.mp4", size: 10, contentType: "" })).rejects.toMatchObject({ status: 409, code: "uploads_need_bucket" });
    const created = await kai.post("/v1/uploads", { purpose: { kind: "library_item", stationId: beatId }, filename: "a.mp4", size: 10 }).expect(201);
    const url = new URL(created.body.parts[0].url, "http://api.test");
    const { Readable } = await import("node:stream");
    await expect(production.acceptLocalPart(created.body.id, 1, { expires: url.searchParams.get("expires")!, signature: url.searchParams.get("signature")! }, Readable.from([Buffer.from("x")]))).rejects.toMatchObject({ status: 404 });
  });

  it("checks a relay background's type before anything is sent", async () => {
    const radio = await stationFixture(h, { callSign: "KOLA", name: "Kola Radio", ownerId: kai.id, marketId: (await h.db.select().from(schema.markets))[0]!.id, tenths: await radioTenths(h, 3), band: "radio" });
    const wrong = await kai.post("/v1/uploads", { purpose: { kind: "relay_background", stationId: radio.id }, filename: "notes.pdf", size: 100, contentType: "application/pdf" }).expect(422);
    expect(wrong.body.error.code).toBe("wrong_file_type");
    const tooBig = await kai.post("/v1/uploads", { purpose: { kind: "relay_background", stationId: radio.id }, filename: "bg.mp4", size: 200 * MiB, contentType: "video/mp4" }).expect(422);
    expect(tooBig.body.error.code).toBe("too_big");
    await kai.post("/v1/uploads", { purpose: { kind: "relay_background", stationId: radio.id }, filename: "bg.png", size: 100, contentType: "image/png" }).expect(201);
  });
});
