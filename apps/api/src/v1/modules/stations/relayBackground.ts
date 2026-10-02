// A radio station's relay background (added 2026-09-29): the picture its translators air under its
// sound, since YouTube, Twitch and the like want video. Relays only; the apps never show it.
//
// An upload (an image, a GIF, or a video up to 30 s) is stored by content ID and prepared once,
// in the background, into a loop at the relay's size (playout/engine/background.ts):
// `relay-backgrounds/<content ID>-<W>x<H>/loop.mp4` and `still.jpg`. The same file uploaded again
// (by this station or another) isn't prepared again. Relays pick it up once it's ready (their
// signature includes the loop). Without one, relays use the station ID picture in its colour.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq, ne } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { ModuleContext } from "../../context.js";
import { conflict, badRequest, refused } from "../../errors.js";
import type { UploadedFile } from "../../http.js";
import { publicUrl } from "../../lib/url.js";
import { objectKey, sha256FromCid } from "../../storage.js";
import { prepareBaseLoop, probeBackground, type BackgroundKind } from "../playout/engine/background.js";
import { LADDER, scaledLadder } from "../playout/engine/ladder.js";

const RB = schema.relayBackgrounds;
const MAX_BYTES = 100 * 1024 ** 2;
const TYPES = /^(image\/(png|jpeg|webp|gif)|video\/(mp4|quicktime|webm|x-m4v))$/;
const EXTENSIONS = /\.(png|jpe?g|webp|gif|mp4|m4v|mov|webm)$/i;

export interface RelayBackgroundView {
  kind: BackgroundKind;
  fileName: string | null;
  status: "preparing" | "ready" | "failed";
  error: string | null;
  loopUrl: string | null;
  stillUrl: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  updatedAt: string;
}

/** The relay's picture size: the 720p rendition's (smaller when PREPARE_LADDER_SCALE shrinks the ladder in development). */
export function relayFrame(): { width: number; height: number } {
  const scale = Number(process.env.PREPARE_LADDER_SCALE);
  const r = (scale > 0 ? scaledLadder(scale) : LADDER).v720;
  return { width: r.width, height: r.height };
}

export function createRelayBackgrounds({ deps, services }: ModuleContext) {
  const { db } = deps;
  const objects = deps.storage.objects;
  const running = new Set<Promise<void>>();

  async function bandOf(stationId: string) {
    const [row] = await db
      .select({ band: schema.channels.band })
      .from(schema.channels)
      .where(and(eq(schema.channels.stationId, stationId), eq(schema.channels.isPrimary, true)));
    return row?.band ?? null;
  }

  const url = async (key: string) => publicUrl(deps, await objects.url(key));

  async function view(row: typeof RB.$inferSelect): Promise<RelayBackgroundView> {
    const ready = row.status === "ready" && row.loopKey;
    return {
      kind: row.kind,
      fileName: row.fileName,
      status: row.status,
      error: row.error,
      loopUrl: ready ? await url(`${row.loopKey}/loop.mp4`) : null,
      stillUrl: ready ? await url(`${row.loopKey}/still.jpg`) : null,
      width: row.width,
      height: row.height,
      durationMs: row.durationMs,
      updatedAt: row.updatedAt.toISOString()
    };
  }

  /** Drops a background's files once nothing uses them (its upload's reference; its loop, if no other station's). */
  async function letGo(row: { contentId: string; loopKey: string | null }, stationId: string) {
    const [other] = await db
      .select({ stationId: RB.stationId })
      .from(RB)
      .where(and(eq(RB.contentId, row.contentId), ne(RB.stationId, stationId)))
      .limit(1);
    if (!other && row.loopKey) await objects.deletePrefix(row.loopKey).catch(() => undefined);
    await services.library.content.releaseOne(row.contentId, "relay_background", stationId);
  }

  /** Prepares the loop once (unless this file already has one at this size), then marks it ready. */
  async function prepare(stationId: string, cid: string, kind: BackgroundKind, durationMs: number | null) {
    const size = relayFrame();
    const loopKey = `relay-backgrounds/${cid}-${size.width}x${size.height}`;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencast-relay-bg-"));
    try {
      let done: { frames: number; durationMs: number } | null = null;
      const [same] = await db
        .select()
        .from(RB)
        .where(and(eq(RB.contentId, cid), eq(RB.loopKey, loopKey), eq(RB.status, "ready")))
        .limit(1);
      if (same?.frames && same.durationMs && (await objects.has(`${loopKey}/loop.mp4`))) done = { frames: same.frames, durationMs: same.durationMs };
      if (!done) {
        const source = path.join(dir, "source");
        await objects.download(objectKey.file(cid), source, sha256FromCid(cid));
        const out = path.join(dir, "out");
        const made = await prepareBaseLoop(source, kind, durationMs, size, out);
        await objects.putDir(loopKey, out, "standard");
        done = { frames: made.frames, durationMs: made.durationMs };
      }
      // Only if it's still this file (a newer upload may have replaced it meanwhile).
      await db
        .update(RB)
        .set({ status: "ready", error: null, loopKey, width: size.width, height: size.height, frames: done.frames, durationMs: done.durationMs, updatedAt: deps.clock.now() })
        .where(and(eq(RB.stationId, stationId), eq(RB.contentId, cid)));
      // Relays that are on start again with it (the worker compares what they were started with).
    } catch (error) {
      console.error(`[relay background] ${stationId} couldn't be prepared`, error);
      await db
        .update(RB)
        .set({ status: "failed", error: "That file couldn't be made into a loop. Try another.", updatedAt: deps.clock.now() })
        .where(and(eq(RB.stationId, stationId), eq(RB.contentId, cid)));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  return {
    async getRelayBackground(stationId: string): Promise<RelayBackgroundView | null> {
      const [row] = await db.select().from(RB).where(eq(RB.stationId, stationId));
      return row ? view(row) : null;
    },

    async setRelayBackground(stationId: string, file: UploadedFile | null): Promise<RelayBackgroundView> {
      if (!file) throw badRequest("Choose an image, a GIF or a short video.", { file: "Required" });
      if ((await bandOf(stationId)) !== "radio") throw conflict("not_radio", "Backgrounds are for radio stations' relays. A TV station relays its own picture.");
      if (!TYPES.test(file.mimeType) && !EXTENSIONS.test(file.originalName)) throw refused("wrong_file_type", "Use a PNG, JPEG or WebP image, a GIF, or an MP4, MOV or WebM video.");
      if (file.size > MAX_BYTES) throw refused("too_big", "Use a file of 100 MB or less.");
      const probed = await probeBackground(file.path);
      if ("error" in probed) {
        if (probed.error === "too_long") throw refused("too_long", "Use a video of 30 seconds or less. It loops.");
        throw refused("unreadable_file", "That file couldn't be read as a picture or a video.");
      }
      const content = services.library.content;
      const stored = await content.keep(file, { storageClass: "standard", contentType: file.mimeType || undefined });
      const [previous] = await db.select().from(RB).where(eq(RB.stationId, stationId));
      const now = deps.clock.now();
      const [row] = await db.transaction(async (tx) => {
        await content.addRef(tx, stored.cid, "relay_background", stationId);
        return tx
          .insert(RB)
          .values({ stationId, kind: probed.kind, contentId: stored.cid, fileName: file.originalName.slice(0, 200), status: "preparing", error: null, loopKey: null, width: null, height: null, durationMs: null, frames: null, updatedAt: now })
          .onConflictDoUpdate({
            target: RB.stationId,
            set: { kind: probed.kind, contentId: stored.cid, fileName: file.originalName.slice(0, 200), status: "preparing", error: null, loopKey: null, width: null, height: null, durationMs: null, frames: null, updatedAt: now }
          })
          .returning();
      });
      if (previous && previous.contentId !== stored.cid) await letGo(previous, stationId);
      const work = prepare(stationId, stored.cid, probed.kind, probed.durationMs).finally(() => running.delete(work));
      running.add(work);
      return view(row);
    },

    async removeRelayBackground(stationId: string): Promise<void> {
      const [row] = await db.delete(RB).where(eq(RB.stationId, stationId)).returning();
      if (!row) return;
      await letGo(row, stationId);
    },

    /** For playout: the prepared loop (its storage prefix and frames), when there's one ready. */
    async relayBackground(stationId: string): Promise<{ loopKey: string; frames: number } | null> {
      const [row] = await db.select().from(RB).where(eq(RB.stationId, stationId));
      return row?.status === "ready" && row.loopKey && row.frames ? { loopKey: row.loopKey, frames: row.frames } : null;
    },

    /** Waits for backgrounds being prepared (tests, shutdown). */
    async settleRelayBackgrounds() {
      while (running.size) await Promise.all([...running]);
    }
  };
}
