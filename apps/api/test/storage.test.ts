// Storage by content ID: stored once, deleted with its last reference, locked by a
// claim and taken down when it's resolved against; IPFS only on purpose. Uploads are kept as
// their original (Infrequent Access), which playout prepares for air; previews play what's
// prepared (storage-originals.test.ts covers preparation, previews and the relinks).
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { cidFromSha256, contentIdOf, isContentId, sha256FromCid } from "../src/v1/storage.js";
import { createPlanner } from "../src/v1/modules/playout/engine/plan.js";
import { anon, createHarness, itemFixture, market, stationFixture, testClip, type Harness, type User } from "./harness.js";

let h: Harness;
let marketId: string;
let kai: User;
let jess: User;
let beatId: string;
let reelId: string;

const objectsDir = () => path.join(h.deps.config.storageRoot, "objects");
const exists = (file: string) =>
  fs.access(file).then(
    () => true,
    () => false
  );

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-09-22T19:00:00.000Z");
  marketId = (await market(h)).id;
  kai = await h.signIn("Kai");
  jess = await h.signIn("Jess");
  beatId = (await stationFixture(h, { callSign: "BEAT", ownerId: kai.id, marketId, tenths: 121, signedOn: true })).id;
  reelId = (await stationFixture(h, { callSign: "REEL", ownerId: jess.id, marketId, tenths: 241, signedOn: true })).id;
  await jess.patch(`/v1/stations/${reelId}/setup`, { legalName: "Reel LLC", legalContact: "jess@reel.example" }).expect(200);
}, 60_000);
afterAll(() => h.close());

describe("content IDs", () => {
  it("are CIDv1, raw, sha-256, in base32", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cid-"));
    await fs.writeFile(path.join(dir, "empty"), "");
    await fs.writeFile(path.join(dir, "hello"), "hello world");
    // Reference values computed independently (Python: hashlib + base64.b32encode).
    expect((await contentIdOf(path.join(dir, "empty"))).cid).toBe("bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku");
    const hello = await contentIdOf(path.join(dir, "hello"));
    expect(hello.cid).toBe("bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e");
    expect(cidFromSha256(sha256FromCid(hello.cid))).toBe(hello.cid);
  });

  it("only reads our own kind of CID as a sha-256: v1, raw, sha2-256, base32", () => {
    const good = "bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e";
    expect(isContentId(good)).toBe(true);
    // An IPFS CID of a chunked file (dag-pb) names a DAG, not the bytes.
    expect(() => sha256FromCid("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi")).toThrow(/raw sha-256 CIDv1/);
    // CIDv0, other bases, upper case, a character outside base32, too short, too long.
    for (const bad of ["QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG", "zb2rhe5P4gXftAwvA4eXQ5HJwsER2owDyS9sKaQRRVQPn93bA", good.toUpperCase(), `${good.slice(0, 30)}1${good.slice(31)}`, good.slice(0, -1), `${good}a`, ""]) {
      expect(() => sha256FromCid(bad)).toThrow(/content ID/);
      expect(isContentId(bad)).toBe(false);
    }
    // The last character's padding bits must be zero.
    expect(() => sha256FromCid(`${good.slice(0, -1)}f`)).toThrow(/content ID/);
    // Right shape, wrong prefix (a CIDv1 with the dag-cbor codec, 0x71).
    const cbor = cidFromSha256(Buffer.alloc(32)).replace(/^bafkre/, "bafyre");
    expect(() => sha256FromCid(cbor)).toThrow(/raw sha-256 CIDv1/);
  });
});

describe("stored once", () => {
  let beatItem: string;
  let reelItem: string;
  let cid: string;
  let originalCid: string;

  it("stores the same file once, however many stations upload it", async () => {
    const clip = await testClip(6);
    const a = await kai.post(`/v1/stations/${beatId}/library/uploads`).attach("file", clip).field("title", "Shared clip").expect(201);
    const b = await jess.post(`/v1/stations/${reelId}/library/uploads`).attach("file", clip).field("title", "Shared clip").expect(201);
    await h.services.library.settle();
    const [one, two] = await Promise.all([kai.get(`/v1/library/${a.body.id}`).expect(200), jess.get(`/v1/library/${b.body.id}`).expect(200)]);
    beatItem = a.body.id;
    reelItem = b.body.id;
    cid = one.body.storage.contentId;
    expect(two.body.storage.contentId).toBe(cid);
    expect(one.body.storage).toMatchObject({ sharedWith: 1, locked: false, ipfs: null });
    // The original, as uploaded, in Infrequent Access: one object, and no copy made from it.
    expect(cid).toBe((await contentIdOf(clip)).cid);
    const [file] = await h.db.select().from(schema.assetFiles).where(eq(schema.assetFiles.assetId, beatItem));
    expect(file).toMatchObject({ contentId: cid, originalContentId: null });
    originalCid = cid;
    const rows = await h.db.select().from(schema.contents);
    expect(rows.find((r) => r.cid === cid)?.storageClass).toBe("infrequent");
    expect(await exists(path.join(objectsDir(), cid))).toBe(true);
    // No stray copies left in uploads, and nothing compressed.
    const leftovers = await fs.readdir(path.join(h.deps.config.storageRoot, "uploads", beatId, "originals")).catch(() => []);
    expect(leftovers).toEqual([]);
    expect(await exists(path.join(h.deps.config.storageRoot, "uploads", beatId, "ready"))).toBe(false);
  }, 60_000);

  it("deletes the object only when the last item pointing at it goes", async () => {
    await kai.delete(`/v1/library/${beatItem}`).expect(200);
    expect(await exists(path.join(objectsDir(), cid))).toBe(true);
    await jess.delete(`/v1/library/${reelItem}`).expect(200);
    expect(await exists(path.join(objectsDir(), cid))).toBe(false);
    expect(await exists(path.join(objectsDir(), originalCid))).toBe(false);
    const [row] = await h.db.select().from(schema.contents).where(eq(schema.contents.cid, cid));
    expect(row).toMatchObject({ deletedReason: "unreferenced" });
  });

  it("the database won't mark referenced content deleted", async () => {
    const item = await itemFixture(h, beatId, { location: await testClip(3), title: "Held" });
    const [file] = await h.db.select().from(schema.assetFiles).where(eq(schema.assetFiles.assetId, item.id));
    await expect(h.db.update(schema.contents).set({ deletedAt: new Date(), deletedReason: "unreferenced" }).where(eq(schema.contents.cid, file.contentId!))).rejects.toThrow();
  });
});

describe("takedowns", () => {
  it("locks the file while a claim is open, pulls every station's copy, and unlocks when answered", async () => {
    const clip = await testClip(7);
    const mine = await itemFixture(h, reelId, { location: clip, title: "Borrowed?" });
    const theirs = await itemFixture(h, beatId, { location: clip, title: "Same file, other station" });
    await kai.post(`/v1/stations/${beatId}/log`, { kind: "program", startsAt: "2026-09-23T03:00:00.000Z", itemId: theirs.id }).expect(201);
    const filed = await anon(h).post("/v1/claims").send({ itemId: mine.id, claimantName: "Studio", claimantContact: "x@example.com", claimText: "Ours.", swornStatement: true }).expect(201);
    const cid = (await h.services.library.contentOfItems([mine.id]))[0];
    expect((await h.services.library.content.info([cid])).get(cid)).toMatchObject({ locked: true, deleted: false });
    // The other station's item made from the same file came off its log too, and can't air.
    const log = await kai.get(`/v1/stations/${beatId}/log?from=2026-09-23T00:00:00.000Z&to=2026-09-24T00:00:00.000Z`).expect(200);
    expect(log.body.entries).toEqual([]);
    expect((await h.services.library.itemsByIds([theirs.id])).get(theirs.id)?.contentUnavailable).toBe(true);
    // Locked, not deleted: it can come back.
    expect(await exists(path.join(objectsDir(), cid))).toBe(true);
    await jess.post(`/v1/claims/${filed.body.claimId}/answer`, { basis: "made_it", attest: true }).expect(200);
    expect((await h.services.library.content.info([cid])).get(cid)?.locked).toBe(false);
  });

  it("deletes the file from storage when the claim is resolved against it, and never stores it again", async () => {
    const clip = await testClip(8);
    const item = await itemFixture(h, reelId, { location: clip, title: "Pulled" });
    const cid = (await h.services.library.contentOfItems([item.id]))[0];
    const filed = await anon(h).post("/v1/claims").send({ itemId: item.id, claimantName: "Studio", claimantContact: "x@example.com", claimText: "Ours.", swornStatement: true }).expect(201);
    await jess.post(`/v1/claims/${filed.body.claimId}/remove`).expect(200);
    expect(await exists(path.join(objectsDir(), cid))).toBe(false);
    expect((await h.services.library.content.info([cid])).get(cid)).toMatchObject({ deleted: true });
    await expect(h.services.library.content.store(clip, { storageClass: "standard" })).rejects.toThrow(/taken down/);
  });
});

describe("IPFS", () => {
  it("exports a station's own original only when its owner says so, knowing it's public for good", async () => {
    const clip = await testClip(5);
    const up = await jess.post(`/v1/stations/${reelId}/library/uploads`).attach("file", clip).field("title", "Our film").expect(201);
    await h.services.library.settle();
    const operator = await h.signIn("Op");
    await h.db.insert(schema.stationMemberships).values({ stationId: reelId, userId: operator.id, role: "operator" });
    await operator.post(`/v1/library/${up.body.id}/export-ipfs`, { understandPublicAndPermanent: true }).expect(403);
    await jess.post(`/v1/library/${up.body.id}/export-ipfs`, {}).expect(400);
    const done = await jess.post(`/v1/library/${up.body.id}/export-ipfs`, { understandPublicAndPermanent: true }).expect(200);
    expect(done.body.ipfsCid).toMatch(/^bafy/);
    const item = await jess.get(`/v1/library/${up.body.id}`).expect(200);
    expect(item.body.storage.ipfs).toMatchObject({ reason: "export", cid: done.body.ipfsCid });
    // A link import isn't the station's own work.
    const link = await itemFixture(h, reelId, { source: "link", location: await testClip(4) });
    await jess.post(`/v1/library/${link.id}/export-ipfs`, { understandPublicAndPermanent: true }).expect(422);
  }, 60_000);
});

describe("items not prepared for air", () => {
  it("air the usual fill, and say what was missing", async () => {
    const item = await itemFixture(h, beatId, { location: await testClip(10), title: "Not prepared yet" });
    await kai.post(`/v1/stations/${beatId}/log`, { kind: "program", startsAt: "2026-09-24T03:00:00.000Z", itemId: item.id }).expect(201);
    const cid = (await h.services.library.currentContent([item.id])).get(item.id)!;
    const prepared = new Set<string>();
    const planner = createPlanner({ deps: h.deps, services: h.services }, { isReady: (ref) => Boolean(ref.contentId && prepared.has(ref.contentId)) });
    const sheet = await planner.plan(beatId, new Date("2026-09-24T03:00:00.000Z"), new Date("2026-09-24T03:01:00.000Z"));
    expect(sheet.some((s) => s.code === "PGM")).toBe(false);
    expect(sheet[0].missing).toMatchObject({ itemId: item.id, title: "Not prepared yet" });
    // Once prepared, the program airs (by its content ID).
    prepared.add(cid);
    const aired = await planner.plan(beatId, new Date("2026-09-24T03:00:00.000Z"), new Date("2026-09-24T03:01:00.000Z"));
    expect(aired[0]).toMatchObject({ code: "PGM", source: { kind: "file", contentId: cid } });
  });

  it("tells the station and Network desk when an item due within the hour isn't prepared", async () => {
    await h.signIn("Dee", { admin: true });
    h.deps.bus.emit("station.file_not_ready", { stationId: beatId, itemId: "00000000-0000-4000-8000-000000000001", title: "Late Crate, ep. 15", airsAt: "2026-09-22T19:40:00.000Z", missedAtAir: false });
    await h.deps.bus.settle();
    const notices = await h.db.select().from(schema.notices).where(eq(schema.notices.kind, "file_not_ready"));
    const users = new Set(notices.map((n) => n.userId));
    expect(users.has(kai.id)).toBe(true);
    expect(notices.length).toBe(2);
    expect(notices[0].title).toMatch(/Late Crate, ep. 15 isn't ready for/);
  });
});
