// Files by content ID. Storing a file the platform already has stores nothing new;
// the last reference to a file going is what deletes it, unless a rights claim has
// it locked. A claim resolved against it deletes it whatever still points at it.
// Every file here is an original (uploads, spots, deliveries, briefs, attachments): playout
// prepares from it once, and what it prepares (`prepared/<content ID>/…`) goes when the file does.
// Previews play those prepared segments (the playout service); there are no separate renditions.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { Executor, ModuleContext } from "../../context.js";
import type { UploadedFile } from "../../http.js";
import { refused } from "../../errors.js";
import { contentIdOf, contentTypeOf, objectKey, sha256FromCid, type StorageClass } from "../../storage.js";

const C = schema.contents;
const REF = schema.contentRefs;
/** Retired 2026-09-29 (previews play prepared segments): read only to delete what's left. */
const PV = schema.contentPreviews;
const NEED = schema.contentPreviewNeeds;

/** Who points at a file. `catalog_item` and `catalog_evidence` (added 2026-09-29): the catalog shelf's items and the evidence behind their rights checks. */
export type ContentOwner = "asset_file" | "asset_original" | "spot_file" | "order_file" | "claim_attachment" | "business_logo" | "caption_track" | "relay_background" | "catalog_item" | "catalog_evidence" | "block_logo";

export interface ContentInfo {
  cid: string;
  bytes: number;
  locked: boolean;
  deleted: boolean;
  /** How many files point at it: 1 means only this one. */
  references: number;
  ipfs: { cid: string; reason: "catalog" | "export"; url: string } | null;
}

export function createContent({ deps, services }: ModuleContext) {
  const { db } = deps;
  const objects = deps.storage.objects;

  async function gc(cids: string[]) {
    for (const cid of new Set(cids)) {
      const [row] = await db.select().from(C).where(eq(C.cid, cid));
      if (!row || row.deletedAt || row.lockedAt) continue;
      const [ref] = await db.select().from(REF).where(eq(REF.cid, cid)).limit(1);
      if (ref) continue;
      // What was prepared from it goes too; a channel that aired it lately keeps it until the sweep.
      await services.playout.dropPrepared([cid], { evenIfAiring: false });
      await objects.delete(objectKey.file(cid));
      await db.update(C).set({ deletedAt: deps.clock.now(), deletedReason: "unreferenced" }).where(eq(C.cid, cid));
    }
  }

  const content = {
    /**
     * Stores a file under its content ID (unless it's stored already) and records who
     * points at it. Uploading happens before the transaction; the reference inside it.
     *
     * A file stored already keeps its storage class: the same bytes stored again as Standard
     * don't move an Infrequent Access object to Standard. Nothing stored here needs Standard
     * for what it is: it's read to prepare it, or now and then by a person (a brief, a logo, a
     * caption file). What's read all day (prepared and live segments, relay loops) is written
     * straight to object storage in Standard, never through here. A file stored again after it
     * was deleted is stored in the class asked for.
     */
    async store(file: string, input: { storageClass: StorageClass; contentType?: string }): Promise<{ cid: string; bytes: number; storageClass: StorageClass }> {
      const { cid, sha256, bytes } = await contentIdOf(file);
      const [existing] = await db.select().from(C).where(eq(C.cid, cid));
      if (existing?.deletedReason === "takedown") throw refused("taken_down", "That file was taken down after a rights claim and can't be stored again.");
      const needsPut = !existing || existing.deletedAt !== null || !(await objects.has(objectKey.file(cid)));
      const storageClass: StorageClass = needsPut ? input.storageClass : existing!.storageClass;
      if (needsPut) await objects.put(objectKey.file(cid), file, { contentType: input.contentType ?? contentTypeOf(file), storageClass, sha256 });
      await db
        .insert(C)
        .values({ cid, bytes, contentType: input.contentType ?? contentTypeOf(file), storageClass, store: objects.name })
        .onConflictDoUpdate({
          target: C.cid,
          // Brought back if it had gone (nothing referenced it), in the class it was stored in now.
          set: { deletedAt: null, deletedReason: null, storageClass, store: objects.name }
        });
      return { cid, bytes, storageClass };
    },

    /**
     * Keeps a direct upload (added 2026-09-30, follow-up Phase 4) that's in the store already, at
     * `stagedKey`, read once for its content ID: the same rules as `store`, without sending the bytes
     * again. Bytes the platform already has are stored once: the staged copy is deleted and the
     * existing object kept, in its own class. Otherwise the staged object moves to its content ID in
     * the class asked for (server side in R2). Taken-down bytes are refused (and the staged copy goes).
     */
    async adopt(stagedKey: string, input: { cid: string; bytes: number; storageClass: StorageClass; contentType: string }): Promise<{ cid: string; bytes: number; storageClass: StorageClass; duplicate: boolean }> {
      const { cid, bytes } = input;
      const finalKey = objectKey.file(cid);
      const [existing] = await db.select().from(C).where(eq(C.cid, cid));
      if (existing?.deletedReason === "takedown") {
        if (stagedKey !== finalKey) await objects.delete(stagedKey).catch(() => undefined);
        throw refused("taken_down", "That file was taken down after a rights claim and can't be stored again.");
      }
      const present = await objects.has(finalKey);
      const needsMove = !existing || existing.deletedAt !== null || !present;
      const storageClass: StorageClass = needsMove ? input.storageClass : existing!.storageClass;
      // Picked up again after a restart, with the move already made: nothing to move.
      if (stagedKey !== finalKey) {
        if (needsMove && !present) {
          if (!objects.move) throw new Error(`the ${objects.name} store can't move objects`);
          await objects.move(stagedKey, finalKey, { storageClass, contentType: input.contentType });
        } else {
          await objects.delete(stagedKey);
        }
      }
      await db
        .insert(C)
        .values({ cid, bytes, contentType: input.contentType, storageClass, store: objects.name })
        .onConflictDoUpdate({ target: C.cid, set: { deletedAt: null, deletedReason: null, storageClass, store: objects.name } });
      return { cid, bytes, storageClass, duplicate: !needsMove };
    },

    /** Keeps a file: a direct upload's by `adopt`, a form upload's (a local file) by `store`. */
    async keep(file: UploadedFile, input: { storageClass: StorageClass; contentType?: string }): Promise<{ cid: string; bytes: number; storageClass: StorageClass }> {
      if (!file.stored) return content.store(file.path, input);
      const kept = await content.adopt(file.stored.key, { cid: file.stored.cid, bytes: file.stored.bytes, storageClass: input.storageClass, contentType: input.contentType || file.mimeType || contentTypeOf(file.originalName) });
      file.stored.onKept?.({ cid: kept.cid, duplicate: kept.duplicate });
      return kept;
    },

    async addRef(tx: Executor, cid: string, owner: ContentOwner, ownerId: string) {
      // `owner` is plain text in the table; the schema's list predates the catalog's owners.
      await tx.insert(REF).values({ cid, owner: owner as (typeof REF.$inferInsert)["owner"], ownerId }).onConflictDoNothing();
    },

    /** Drops what an owner points at; files nothing else points at are deleted. */
    async release(owner: ContentOwner, ownerIds: string[]) {
      if (!ownerIds.length) return;
      const refs = await db.delete(REF).where(and(eq(REF.owner, owner as (typeof REF.$inferInsert)["owner"]), inArray(REF.ownerId, ownerIds))).returning({ cid: REF.cid });
      await gc(refs.map((r) => r.cid));
    },

    /** Drops one reference (a caption track replaced by another); the file goes if nothing else points at it. */
    async releaseOne(cid: string, owner: ContentOwner, ownerId: string) {
      await db.delete(REF).where(and(eq(REF.cid, cid), eq(REF.owner, owner as (typeof REF.$inferInsert)["owner"]), eq(REF.ownerId, ownerId)));
      await gc([cid]);
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
        // Everything prepared from it, now, whether or not a channel aired it lately: it's pulled.
        await services.playout.dropPrepared([cid], { evenIfAiring: true });
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

    /** Copies a stored file to a local path (scratch space), checking its hash. */
    async fetch(cid: string, dest: string) {
      await objects.download(objectKey.file(cid), dest, sha256FromCid(cid));
    },

    async url(cid: string) {
      return objects.url(objectKey.file(cid));
    },

    /** Which of these content IDs are gone from storage (the storage sweep). */
    async deletedAmong(cids: string[]): Promise<Set<string>> {
      if (!cids.length) return new Set();
      const rows = await db.select({ cid: C.cid }).from(C).where(and(inArray(C.cid, [...new Set(cids)]), isNotNull(C.deletedAt)));
      return new Set(rows.map((r) => r.cid));
    },

    /**
     * The storage sweep (the worker, hourly): what was prepared from files that went while a
     * channel still pointed at it, and the separate 360p previews made before previews played the
     * prepared segments (`previews/<cid>/`, and their rows). Safe to run any time.
     */
    async sweep(): Promise<{ prepared: { dropped: number; deferred: number }; oldPreviews: number }> {
      const prepared = await services.playout.sweepPrepared();
      const old = await db.select({ cid: PV.cid }).from(PV);
      for (const { cid } of old) {
        await objects.deletePrefix(objectKey.preview(cid));
        await db.transaction(async (tx) => {
          await tx.delete(NEED).where(eq(NEED.cid, cid));
          await tx.delete(PV).where(eq(PV.cid, cid));
        });
      }
      // Needs left without a preview row.
      await db.delete(NEED);
      return { prepared, oldPreviews: old.length };
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

    /** Nothing runs in the background here any more (previews aren't rendered). */
    async settle() {}
  };
  return content;
}

export type Content = ReturnType<typeof createContent>;
