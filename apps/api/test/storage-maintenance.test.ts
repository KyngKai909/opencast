// Storage maintenance (Network desk Settings, 2026-09-29): the one-off storage steps run on the
// server from the desk. Admins only; a check only reports, an apply changes what the check said;
// one run of a job at a time (a stopped one doesn't hold it); each run kept with who, when, the
// mode, its counts and the scripts' JSON report, and each apply in the change log. Pinata unset:
// nothing to copy. Pinata set: pins are copied in and checked, never unpinned; originals stay.
import { promises as fs } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { contentIdOf } from "../src/v1/storage.js";
import { createPreparer, type Preparer } from "../src/v1/modules/playout/engine/prepare.js";
import { pinataAccount } from "../src/v1/storageMaintenance.js";
import { createHarness, dummyFile, fakeTranscoder, market, prepareQueued, stationFixture, testClip, type Harness, type User } from "./harness.js";

let h: Harness;
let dee: User;
let rae: User;
let pat: User;
let kai: User;
let beatId: string;
let preparer: Preparer;

const objectsDir = () => path.join(h.deps.config.storageRoot, "objects");
const exists = (file: string) =>
  fs.access(file).then(
    () => true,
    () => false
  );

/** Starts a run as someone, waits for it, and returns it as the desk reads it. */
async function runJob(job: string, mode: "check" | "apply", as = dee) {
  const started = await as.post("/v1/admin/storage/runs", { job, mode });
  expect(started.status).toBe(202);
  expect(started.body).toMatchObject({ job, mode, status: "running", counts: null, hasReport: false });
  await h.services.maintenance.settle();
  const run = await as.get(`/v1/admin/storage/runs/${started.body.id}`).expect(200);
  return run.body;
}

async function storageLog() {
  return (await dee.get("/v1/admin/change-log?kind=storage").expect(200)).body as Array<{ kind: string; summary: string; by: { name: string } | null; subject: string }>;
}

/** A legacy item: an asset with one file row from before content IDs. */
async function legacyItem(file: Partial<typeof schema.assetFiles.$inferInsert>, title = "From before") {
  const [item] = await h.db.insert(schema.assets).values({ stationId: beatId, title, code: "PGM", source: "upload", mediaKind: "video", durationMs: 6_000, status: "ready" }).returning();
  await h.db.insert(schema.rightsConfirmations).values({ assetId: item.id, basis: "made_it" });
  const [row] = await h.db.insert(schema.assetFiles).values({ assetId: item.id, version: 1, ...file }).returning();
  return { item, row };
}

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-10-01T19:00:00.000Z");
  const ie = await market(h);
  dee = await h.signIn("Dee A.", { admin: true });
  rae = await h.signIn("Rae T.");
  pat = await h.signIn("Pat O.");
  kai = await h.signIn("Kai");
  await h.db.update(schema.users).set({ email: "rae@opencast.test" }).where(eq(schema.users.id, rae.id));
  await dee.post("/v1/admin/desk/team", { email: "rae@opencast.test", roles: [{ role: "rights_reviewer" }] }).expect(200);
  beatId = (await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId: ie.id, tenths: 121, signedOn: true })).id;
  preparer = createPreparer({ deps: h.deps, services: h.services }, { transcoder: fakeTranscoder(), scratchDir: await fs.mkdtemp(path.join(os.tmpdir(), "opencast-maintenance-")) });
  await preparer.init();
}, 60_000);
afterAll(() => h.close());

describe("who", () => {
  it("is admins only: a rights reviewer or a market lead gets 403, and so does anyone off the team", async () => {
    expect((await pat.get("/v1/admin/storage")).status).toBe(403);
    for (const call of [rae.get("/v1/admin/storage"), rae.get("/v1/admin/storage?check=all"), rae.post("/v1/admin/storage/runs", { job: "relinkLocations", mode: "check" })]) {
      const res = await call;
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("desk_role");
    }
    expect(await h.db.select().from(schema.storageRuns)).toEqual([]);
    const state = await dee.get("/v1/admin/storage").expect(200);
    expect(state.body).toEqual({
      pinataConnected: false,
      jobs: [
        { job: "relinkLocations", running: null, lastCheck: null, lastApply: null, canApply: true },
        { job: "copyPinata", running: null, lastCheck: null, lastApply: null, canApply: false },
        { job: "prepareFromOriginals", running: null, lastCheck: null, lastApply: null, canApply: true }
      ]
    });
    expect((await dee.post("/v1/admin/storage/runs", { job: "everything", mode: "apply" })).status).toBe(400);
  });
});

describe("Pinata", () => {
  it("unset: the check says it isn't connected, with nothing to copy, and an apply is refused", async () => {
    const run = await runJob("copyPinata", "check");
    expect(run).toMatchObject({ status: "done", by: { name: "Dee A." }, counts: { connected: 0, pins: 0, moving: 0 }, hasReport: true, error: null });
    const report = await dee.get(`/v1/admin/storage/runs/${run.id}/report`).expect(200);
    expect(report.body).toMatchObject({ connected: false, note: "Pinata isn't connected here (PINATA_JWT isn't set on the API), so there's nothing to copy.", copies: [] });
    const apply = await dee.post("/v1/admin/storage/runs", { job: "copyPinata", mode: "apply" });
    expect(apply.status).toBe(422);
    expect(apply.body.error.code).toBe("pinata_not_connected");
    expect(await storageLog()).toEqual([]);
  });

  it("set: copies each pin but the catalog's in, checks it and relinks its rows; never unpins", async () => {
    const clip = await testClip(6);
    const pinCid = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
    // A catalog item pinned for good stays on IPFS.
    const catalog = await h.services.library.content.store(await dummyFile(), { storageClass: "infrequent" });
    const catalogPin = "bafybeibwzifw52ttrkqlikfzext5akxu7lz4xiwjgwzmqcpdzmp3n5vnbe";
    await h.db.update(schema.contents).set({ ipfsCid: catalogPin, ipfsReason: "catalog", ipfsPublishedAt: h.clock.now() }).where(eq(schema.contents.cid, catalog.cid));
    const requests: string[] = [];
    const server = http.createServer(async (req, res) => {
      requests.push(`${req.method} ${req.url} ${req.headers.authorization ?? ""}`);
      const url = new URL(req.url!, "http://x");
      if (url.pathname === "/v3/files/public")
        res.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({ data: { files: [{ id: "f-1", cid: pinCid, size: (await fs.stat(clip)).size, name: "Pinned" }, { id: "f-2", cid: catalogPin, size: 64, name: "Catalog" }] } })
        );
      else if (url.pathname === "/v3/files/private") res.writeHead(403).end();
      else if (url.pathname === "/data/pinList") res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ rows: [] }));
      else if (url.pathname === `/ipfs/${pinCid}`) res.writeHead(200).end(await fs.readFile(clip));
      else res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    h.deps.pinata = pinataAccount({ jwt: "test-jwt", apiBase: base, gatewayBase: `${base}/ipfs` });
    try {
      const { row } = await legacyItem({ storage: "ipfs", location: `${base}/ipfs/${pinCid}`, ipfsCid: pinCid }, "Pinned");
      expect((await dee.get("/v1/admin/storage").expect(200)).body).toMatchObject({ pinataConnected: true, jobs: [{}, { job: "copyPinata", canApply: true }, {}] });

      const check = await runJob("copyPinata", "check");
      expect(check.counts).toMatchObject({ connected: 1, pins: 2, moving: 1, staying: 1, copied: 0, errors: 0 });
      const checked = (await dee.get(`/v1/admin/storage/runs/${check.id}/report`).expect(200)).body;
      expect(checked).toMatchObject({ connected: true, copy: false, listings: { "v3 public": "read", "v3 private": expect.stringContaining("403"), legacy: "read" }, stayingOnIpfs: { files: 1, cids: [catalogPin] }, copies: [] });
      expect((await h.db.select().from(schema.assetFiles).where(eq(schema.assetFiles.id, row.id)))[0].contentId).toBeNull();
      expect(await storageLog()).toEqual([]);

      const apply = await runJob("copyPinata", "apply");
      const { cid } = await contentIdOf(clip);
      expect(apply).toMatchObject({ status: "done", counts: { connected: 1, moving: 1, copied: 1, relinked: 1, errors: 0 } });
      const report = (await dee.get(`/v1/admin/storage/runs/${apply.id}/report`).expect(200)).body;
      expect(report.copies).toEqual([expect.objectContaining({ ipfsCid: pinCid, contentId: cid, verified: true, relinked: [{ table: "asset_files", id: row.id, carried: [] }] })]);
      expect(report.copies[0].unpinned).toBeUndefined();
      expect((await h.db.select().from(schema.assetFiles).where(eq(schema.assetFiles.id, row.id)))[0]).toMatchObject({ contentId: cid, ipfsCid: pinCid });
      // Only reads, all with the key: never a DELETE, never an unpin.
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.every((r) => r.startsWith("GET "))).toBe(true);
      expect(requests.filter((r) => !r.startsWith("GET /ipfs/")).every((r) => r.endsWith("Bearer test-jwt"))).toBe(true);
      expect(requests.some((r) => /unpin/i.test(r))).toBe(false);
      // The catalog's pin was never fetched: it stays where it is.
      expect(requests.some((r) => r.includes(catalogPin))).toBe(false);
      expect(await storageLog()).toEqual([
        expect.objectContaining({ kind: "storage", subject: apply.id, by: expect.objectContaining({ name: "Dee A." }), summary: "Pinata pins: Copied 1 Pinata pin of 1 into storage, checked by hash, and relinked 1 row. Nothing unpinned" })
      ]);
    } finally {
      h.deps.pinata = null;
      server.close();
    }
  }, 60_000);
});

describe("prepare from originals", () => {
  it("checks without changing anything, applies (queued, then moved), and keeps both runs with their reports", async () => {
    const content = h.services.library.content;
    const copy = (await content.store(await dummyFile(), { storageClass: "standard" })).cid;
    const original = (await content.store(await dummyFile(), { storageClass: "infrequent" })).cid;
    const [item] = await h.db.insert(schema.assets).values({ stationId: beatId, title: "Old upload", code: "PGM", source: "upload", mediaKind: "video", durationMs: 8_000, status: "ready" }).returning();
    await h.db.insert(schema.rightsConfirmations).values({ assetId: item.id, basis: "made_it" });
    const [row] = await h.db.insert(schema.assetFiles).values({ assetId: item.id, version: 1, contentId: copy, originalContentId: original, compression: { tool: "ffmpeg", profile: "720p" } }).returning();
    await content.addRef(h.db, copy, "asset_file", row.id);
    await content.addRef(h.db, original, "asset_original", row.id);
    await preparer.want([{ contentId: copy, mediaKind: "video", band: "tv", durationMs: 8_000 }]);
    await prepareQueued(h, preparer);

    // A check: counts, a report, and nothing changed (nothing queued, still on its copy, no change log).
    const check = await runJob("prepareFromOriginals", "check");
    expect(check).toMatchObject({ mode: "check", status: "done", counts: { items: 1, toPrepare: 1, readyToMove: 0, queued: 0, moved: 0, noOriginal: 0 }, progress: { done: 1, total: 1 }, finishedAt: expect.any(String) });
    expect(await h.db.select().from(schema.preparedItems).where(eq(schema.preparedItems.key, original))).toEqual([]);
    expect((await h.services.library.currentContent([item.id])).get(item.id)).toBe(copy);
    expect(await storageLog()).toHaveLength(1);

    // Applied: queued for the worker, still on its copy until it's prepared.
    const first = await runJob("prepareFromOriginals", "apply");
    expect(first.counts).toMatchObject({ items: 1, queued: 1, moved: 0 });
    expect(await h.db.select({ status: schema.preparedItems.status }).from(schema.preparedItems).where(eq(schema.preparedItems.key, original))).toEqual([{ status: "queued" }]);
    expect((await h.services.library.currentContent([item.id])).get(item.id)).toBe(copy);
    expect((await storageLog())[0]).toMatchObject({ subject: first.id, summary: "Items on their 720p copies: Moved 0 items onto their originals; 1 queued for preparing" });

    // The worker prepares it; applied again, the item moves onto its original.
    await prepareQueued(h, preparer);
    const second = await runJob("prepareFromOriginals", "apply");
    expect(second.counts).toMatchObject({ items: 1, queued: 0, moved: 1 });
    expect((await h.services.library.currentContent([item.id])).get(item.id)).toBe(original);
    // The copy goes; the original stays.
    expect(await exists(path.join(objectsDir(), copy))).toBe(false);
    expect(await exists(path.join(objectsDir(), original))).toBe(true);
    expect((await content.info([original])).get(original)?.deleted).toBeFalsy();
    const report = (await dee.get(`/v1/admin/storage/runs/${second.id}/report`).expect(200)).body;
    expect(report).toMatchObject({ runId: second.id, job: "prepareFromOriginals", mode: "apply", apply: true, moved: 1, entries: [expect.objectContaining({ itemId: item.id, copy, original, state: "moved" })] });

    // Nothing left: a fresh check on request says so.
    const state = await dee.get("/v1/admin/storage?check=prepareFromOriginals").expect(200);
    expect(state.body.jobs[2].running).toMatchObject({ mode: "check", status: "running" });
    await h.services.maintenance.settle();
    const after = (await dee.get("/v1/admin/storage").expect(200)).body.jobs[2];
    expect(after).toMatchObject({ running: null, lastCheck: { mode: "check", status: "done", counts: { items: 0, queued: 0, toPrepare: 0 } }, lastApply: { id: second.id, by: { name: "Dee A." }, hasReport: true } });
    expect(await h.db.select().from(schema.storageRuns).where(eq(schema.storageRuns.job, "prepareFromOriginals"))).toHaveLength(4);
    expect((await storageLog()).map((e) => e.subject)).toEqual([second.id, first.id, expect.any(String)]);
  }, 60_000);
});

describe("files stored by location", () => {
  it("a check reads each one and changes nothing; an apply stores and relinks it", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencast-legacy-"));
    const onDisk = path.join(dir, "old.mp4");
    await fs.copyFile(await dummyFile(), onDisk);
    const { row } = await legacyItem({ storage: "local", location: onDisk }, "On disk");
    const check = await runJob("relinkLocations", "check");
    expect(check.counts).toMatchObject({ rows: 1, unreachable: 0, relinked: 0 });
    expect((await h.db.select().from(schema.assetFiles).where(eq(schema.assetFiles.id, row.id)))[0].contentId).toBeNull();
    const apply = await runJob("relinkLocations", "apply");
    const { cid } = await contentIdOf(onDisk);
    expect(apply.counts).toMatchObject({ rows: 1, relinked: 1, unreachable: 0, errors: 0 });
    expect((await h.db.select().from(schema.assetFiles).where(eq(schema.assetFiles.id, row.id)))[0].contentId).toBe(cid);
    // The file where it was is left alone.
    expect(await exists(onDisk)).toBe(true);
    expect((await storageLog())[0].summary).toBe("Files stored by location: Stored 1 file by content ID of 1 stored by location");
  });
});

describe("one run of a job at a time", () => {
  it("refuses another run of the same job while one runs, lets other jobs run, and a stopped run doesn't hold it", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const server = http.createServer(async (_req, res) => {
      await held;
      res.writeHead(200).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/slow.mp4`;
    try {
      const { row } = await legacyItem({ storage: "local", location: url }, "Slow");
      const first = await dee.post("/v1/admin/storage/runs", { job: "relinkLocations", mode: "check" }).expect(202);
      for (const mode of ["check", "apply"]) {
        const again = await dee.post("/v1/admin/storage/runs", { job: "relinkLocations", mode });
        expect(again.status).toBe(409);
        expect(again.body.error).toMatchObject({ code: "already_running", message: "Files stored by location: Dee A. started a check that's still running. Wait for it to finish." });
      }
      // A fresh check of everything skips the one running.
      const state = await dee.get("/v1/admin/storage?check=all").expect(200);
      expect(state.body.jobs[0].running).toMatchObject({ id: first.body.id, progress: { done: 0, total: 1 } });
      expect((await dee.get(`/v1/admin/storage/runs/${first.body.id}/report`)).status).toBe(409);
      release();
      await h.services.maintenance.settle();
      expect((await dee.get(`/v1/admin/storage/runs/${first.body.id}`).expect(200)).body).toMatchObject({ status: "done", counts: { rows: 1, unreachable: 0 } });
      expect((await dee.get("/v1/admin/storage").expect(200)).body.jobs.map((j: { running: unknown }) => j.running)).toEqual([null, null, null]);
      await h.db.delete(schema.assetFiles).where(eq(schema.assetFiles.id, row.id));
    } finally {
      release();
      server.close();
    }

    // A run nothing has been heard from for 30 minutes (the API restarted) is marked stopped.
    const [stuck] = await h.db
      .insert(schema.storageRuns)
      .values({ job: "prepareFromOriginals", mode: "apply", startedBy: dee.id, startedAt: new Date(h.clock.now().getTime() - 40 * 60_000), heartbeatAt: new Date(h.clock.now().getTime() - 31 * 60_000) })
      .returning();
    const next = await runJob("prepareFromOriginals", "check");
    expect(next.status).toBe("done");
    const [gone] = await h.db.select().from(schema.storageRuns).where(eq(schema.storageRuns.id, stuck.id));
    expect(gone).toMatchObject({ status: "failed", error: expect.stringContaining("nothing heard from it for 30 minutes") });
  }, 60_000);
});
