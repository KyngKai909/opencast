// Files by content ID. Storing a file the platform already has stores nothing new;
// the last reference to a file going is what deletes it, unless a rights claim has
// it locked. A claim resolved against it deletes it whatever still points at it.
// Previews (low-bitrate HLS) exist only while something needs one.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { Executor, ModuleContext } from "../../context.js";
import { refused } from "../../errors.js";
import { contentIdOf, contentTypeOf, objectKey, sha256FromCid, type StorageClass } from "../../storage.js";

const C = schema.contents;
const REF = schema.contentRefs;
const PV = schema.contentPreviews;
const NEED = schema.contentPreviewNeeds;

export type ContentOwner = "asset_file" | "asset_original" | "spot_file" | "order_file" | "claim_attachment" | "business_logo";
export type PreviewReason = "offer" | "review" | "order";

export interface ContentInfo {
  cid: string;
  bytes: number;
  locked: boolean;
  deleted: boolean;
  /** How many files point at it: 1 means only this one. */
  references: number;
  ipfs: { cid: string; reason: "catalog" | "export"; url: string } | null;
}

export function createContent({ deps }: ModuleContext) {
  const { db } = deps;
  const objects = deps.storage.objects;
  const renders = new Set<Promise<unknown>>();

  async function gc(cids: string[]) {
    for (const cid of new Set(cids)) {
      const [row] = await db.select().from(C).where(eq(C.cid, cid));
      if (!row || row.deletedAt || row.lockedAt) continue;
      const [ref] = await db.select().from(REF).where(eq(REF.cid, cid)).limit(1);
      if (ref) continue;
      await dropPreviewObjects(cid);
      await objects.delete(objectKey.file(cid));
      await db.update(C).set({ deletedAt: deps.clock.now(), deletedReason: "unreferenced" }).where(eq(C.cid, cid));
    }
  }

  async function dropPreviewObjects(cid: string) {
    await objects.deletePrefix(objectKey.preview(cid)).catch(() => undefined);
    await db.delete(PV).where(eq(PV.cid, cid));
  }

  async function renderPreview(cid: string) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencast-preview-"));
    try {
      const source = path.join(dir, "source");
      await objects.download(objectKey.file(cid), source, sha256FromCid(cid));
      const out = path.join(dir, "hls");
      await fs.mkdir(out);
      // Low bitrate: enough to judge a program, a spot or a delivery, not to air it.
      const code = await new Promise<number>((resolve) => {
        const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", source, "-vf", "scale=-2:360", "-c:v", "libx264", "-preset", "veryfast", "-b:v", "500k", "-maxrate", "600k", "-bufsize", "1200k", "-c:a", "aac", "-b:a", "64k", "-ac", "2", "-f", "hls", "-hls_time", "6", "-hls_playlist_type", "vod", "-hls_segment_filename", path.join(out, "seg_%04d.ts"), path.join(out, "index.m3u8")]);
        child.on("close", (c) => resolve(c ?? 1));
        child.on("error", () => resolve(1));
      });
      if (code !== 0) throw new Error(`ffmpeg ${code}`);
      // Previews are read now and again while they last: Standard.
      await objects.putDir(objectKey.preview(cid), out, "standard");
      await db.update(PV).set({ status: "ready" }).where(eq(PV.cid, cid));
    } catch (error) {
      console.error(`[content] preview for ${cid} failed`, error);
      await db.update(PV).set({ status: "failed" }).where(eq(PV.cid, cid));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
    // It may no longer be needed by the time it's done.
    const [need] = await db.select().from(NEED).where(eq(NEED.cid, cid)).limit(1);
    if (!need) await dropPreviewObjects(cid);
  }

  const content = {
    /**
     * Stores a file under its content ID (unless it's stored already) and records who
     * points at it. Uploading happens before the transaction; the reference inside it.
     */
    async store(file: string, input: { storageClass: StorageClass; contentType?: string }): Promise<{ cid: string; bytes: number }> {
      const { cid, sha256, bytes } = await contentIdOf(file);
      const [existing] = await db.select().from(C).where(eq(C.cid, cid));
      if (existing?.deletedReason === "takedown") throw refused("taken_down", "That file was taken down after a rights claim and can't be stored again.");
      const needsPut = !existing || existing.deletedAt || (input.storageClass === "standard" && existing.storageClass === "infrequent") || !(await objects.has(objectKey.file(cid)));
      if (needsPut) await objects.put(objectKey.file(cid), file, { contentType: input.contentType ?? contentTypeOf(file), storageClass: input.storageClass, sha256 });
      await db
        .insert(C)
        .values({ cid, bytes, contentType: input.contentType ?? contentTypeOf(file), storageClass: input.storageClass, store: objects.name })
        .onConflictDoUpdate({
          target: C.cid,
          // Brought back if it had gone (nothing referenced it); promoted to Standard if playout now airs it.
          set: {
            deletedAt: null,
            deletedReason: null,
            storageClass: input.storageClass === "standard" ? "standard" : sql`${C.storageClass}`,
            store: objects.name
          }
        });
      return { cid, bytes };
    },

    async addRef(tx: Executor, cid: string, owner: ContentOwner, ownerId: string) {
      await tx.insert(REF).values({ cid, owner, ownerId }).onConflictDoNothing();
    },

    /** Drops what an owner points at; files nothing else points at are deleted. */
    async release(owner: ContentOwner, ownerIds: string[]) {
      if (!ownerIds.length) return;
      const refs = await db.delete(REF).where(and(eq(REF.owner, owner), inArray(REF.ownerId, ownerIds))).returning({ cid: REF.cid });
      await gc(refs.map((r) => r.cid));
    },

    /** A rights claim is open: kept, so it can come back, but never aired. */
    async lock(cids: string[], claimId: string) {
      if (!cids.length) return;
      await db
        .update(C)
        .set({ lockedAt: deps.clock.now(), lockReason: `claim:${claimId}` })
        .where(and(inArray(C.cid, cids), isNull(C.lockedAt)));
    },

    /** The claim was answered or withdrawn. Anything that lost its last reference meanwhile goes now. */
    async unlock(cids: string[], claimId: string) {
      if (!cids.length) return;
      await db
        .update(C)
        .set({ lockedAt: null, lockReason: null })
        .where(and(inArray(C.cid, cids), eq(C.lockReason, `claim:${claimId}`)));
      await gc(cids);
    },

    /** The claim was resolved against it: deleted from storage, whatever else points at it. */
    async takeDown(cids: string[]) {
      for (const cid of new Set(cids)) {
        const [row] = await db.select().from(C).where(eq(C.cid, cid));
        if (!row || row.deletedReason === "takedown") continue;
        await dropPreviewObjects(cid);
        await objects.delete(objectKey.file(cid));
        await db.update(C).set({ deletedAt: deps.clock.now(), deletedReason: "takedown", lockedAt: null, lockReason: null }).where(eq(C.cid, cid));
      }
    },

    async info(cids: string[]): Promise<Map<string, ContentInfo>> {
      const unique = [...new Set(cids)];
      if (!unique.length) return new Map();
      const [rows, counts] = await Promise.all([
        db.select().from(C).where(inArray(C.cid, unique)),
        db
          .select({ cid: REF.cid, n: sql<number>`count(*)::int` })
          .from(REF)
          .where(inArray(REF.cid, unique))
          .groupBy(REF.cid)
      ]);
      const countBy = new Map(counts.map((c) => [c.cid, c.n]));
      const gateway = (process.env.PINATA_GATEWAY_BASE ?? "https://gateway.pinata.cloud/ipfs").replace(/\/+$/, "");
      return new Map(
        rows.map((r) => [
          r.cid,
          {
            cid: r.cid,
            bytes: r.bytes,
            locked: r.lockedAt !== null,
            deleted: r.deletedAt !== null,
            references: countBy.get(r.cid) ?? 0,
            ipfs: r.ipfsCid && r.ipfsReason ? { cid: r.ipfsCid, reason: r.ipfsReason, url: `${gateway}/${r.ipfsCid}` } : null
          }
        ])
      );
    },

    /** Copies a stored file to a local path (the worker cache), checking its hash. */
    async fetch(cid: string, dest: string) {
      await objects.download(objectKey.file(cid), dest, sha256FromCid(cid));
    },

    async url(cid: string) {
      return objects.url(objectKey.file(cid));
    },

    // --- Previews ---------------------------------------------------------------

    async needPreview(cids: string[], reason: PreviewReason, subjectId: string) {
      for (const cid of new Set(cids)) {
        await db.insert(NEED).values({ cid, reason, subjectId }).onConflictDoNothing();
        const [created] = await db.insert(PV).values({ cid, status: "rendering" }).onConflictDoNothing().returning();
        if (created) {
          const work = renderPreview(cid).finally(() => renders.delete(work));
          renders.add(work);
        }
      }
    },

    async dropPreview(reason: PreviewReason, subjectId: string) {
      const gone = await db.delete(NEED).where(and(eq(NEED.reason, reason), eq(NEED.subjectId, subjectId))).returning({ cid: NEED.cid });
      for (const { cid } of gone) {
        const [still] = await db.select().from(NEED).where(eq(NEED.cid, cid)).limit(1);
        const [preview] = await db.select().from(PV).where(eq(PV.cid, cid));
        // One still rendering drops itself when it finishes.
        if (!still && preview && preview.status !== "rendering") await dropPreviewObjects(cid);
      }
    },

    async previewUrl(cid: string | null | undefined): Promise<string | null> {
      if (!cid) return null;
      const [row] = await db.select().from(PV).where(eq(PV.cid, cid));
      return row?.status === "ready" ? objects.url(`${objectKey.preview(cid)}/index.m3u8`) : null;
    },

    // --- IPFS ---------------------------------------------------------------------

    /** Publishes a stored file to IPFS on purpose. Public, and it can't be taken back. */
    async publishToIpfs(cid: string, reason: "catalog" | "export", name: string) {
      const [row] = await db.select().from(C).where(eq(C.cid, cid));
      if (!row || row.deletedAt) throw refused("not_stored", "That file isn't stored any more.");
      if (row.lockedAt) throw refused("locked", "A rights claim is open against that file.");
      if (row.ipfsCid) return { ipfsCid: row.ipfsCid, url: `${(process.env.PINATA_GATEWAY_BASE ?? "https://gateway.pinata.cloud/ipfs").replace(/\/+$/, "")}/${row.ipfsCid}` };
      if (!deps.storage.ipfs.configured) throw refused("ipfs_off", "IPFS publishing isn't set up on this server.");
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencast-ipfs-"));
      try {
        const file = path.join(dir, name.replace(/[^\w.-]+/g, "-") || "file");
        await objects.download(objectKey.file(cid), file, sha256FromCid(cid));
        const pinned = await deps.storage.ipfs.pin(file, name);
        await db.update(C).set({ ipfsCid: pinned.ipfsCid, ipfsPinId: pinned.pinId, ipfsReason: reason, ipfsPublishedAt: deps.clock.now() }).where(eq(C.cid, cid));
        return { ipfsCid: pinned.ipfsCid, url: pinned.url };
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    },

    /** Everything stored, for the storage report. */
    async totals() {
      const rows = await db
        .select({ storageClass: C.storageClass, n: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(${C.bytes}), 0)::float8` })
        .from(C)
        .where(isNull(C.deletedAt))
        .groupBy(C.storageClass);
      const [ipfs] = await db.select({ n: sql<number>`count(*)::int` }).from(C).where(isNotNull(C.ipfsCid));
      return { byClass: rows, onIpfs: ipfs.n };
    },

    async settle() {
      while (renders.size) await Promise.all([...renders]);
    }
  };
  return content;
}

export type Content = ReturnType<typeof createContent>;
