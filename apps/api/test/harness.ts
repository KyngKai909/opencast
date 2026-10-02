// A v1 API on a throwaway database, with real Privy-style tokens signed by a test key.
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import request from "supertest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { freshDatabase } from "@opencast/db/testing";
import { privyVerifier, type LinkedAccount } from "../src/v1/auth.js";
import { fakeClearLookup, type FakeClearLookup } from "../src/v1/clearLink.js";
import { EventBus } from "../src/v1/events.js";
import { createV1 } from "../src/v1/index.js";
import { ffmpegPipeline } from "../src/v1/media.js";
import { fakePayments } from "../src/v1/payments/index.js";
import { localObjectStore, type IpfsPublisher } from "../src/v1/storage.js";
import type { Deps, Services } from "../src/v1/context.js";
import { noGeoLookup } from "../src/v1/geo.js";
import { memoryRelayBus } from "../src/v1/relay.js";

export const APP_ID = "test-app";

/** IPFS that records what was pinned instead of publishing it. */
export function fakeIpfs(): IpfsPublisher & { pins: Map<string, string> } {
  const pins = new Map<string, string>();
  return {
    configured: true,
    pins,
    async pin(file, name) {
      const id = `pin-${pins.size + 1}`;
      pins.set(id, name);
      return { ipfsCid: `bafybeifake${pins.size}`, pinId: id, url: `https://gateway.test/ipfs/bafybeifake${pins.size}` };
    },
    async unpin(pinId) {
      pins.delete(pinId);
    }
  };
}

export interface Harness {
  app: express.Express;
  deps: Deps;
  services: Services;
  db: Deps["db"];
  clock: { set(iso: string): void; now(): Date; advance(ms: number): void };
  /** Pushes and emails sent, in order (an email's link, idempotency key and words too). */
  sent: Array<{ channel: "push" | "email"; to: string; title: string; link?: string | null; key?: string; body?: string }>;
  /** Linked accounts Privy would report for a did. */
  linked: Map<string, LinkedAccount[]>;
  /** Clear cross-app accounts Privy would report for a did, and the access Clear grants. */
  clear: FakeClearLookup;
  token(did: string): Promise<string>;
  /** Signs in (creating the user on first use) and returns their id. */
  signIn(name?: string, options?: { admin?: boolean; linked?: LinkedAccount[] }): Promise<User>;
  close(): Promise<void>;
}

export interface User {
  id: string;
  did: string;
  token: string;
  get(url: string): request.Test;
  post(url: string, body?: object): request.Test;
  put(url: string, body?: object): request.Test;
  patch(url: string, body?: object): request.Test;
  delete(url: string): request.Test;
}

export async function createHarness(
  options: {
    realTime?: boolean;
    payments?: (clock: { now(): Date }) => Deps["payments"];
    chain?: Deps["chain"];
    geo?: Deps["geo"];
    places?: Deps["places"];
    relay?: Deps["relay"];
    sseHeartbeatMs?: number;
    /** The API's public origin (A117): paths it serves come back as full URLs. */
    publicBase?: string;
    /** Platform connections (follow-up Phase 3): fake YouTube and Twitch, and the secrets key. */
    platforms?: Deps["platforms"];
    /** Another object store (the direct-upload demo's MinIO); local disk by default. */
    objects?: (storageRoot: string) => Deps["storage"]["objects"];
    /** A237: Opencast's HTTPS relay for http:// stream links; none by default. */
    streamRelay?: Deps["config"]["streamRelay"];
    /** A237: the desk's fetch for external addresses (the https check). Default: no network, every fetch fails. */
    externalFetch?: Deps["externalFetch"];
  } = {}
): Promise<Harness> {
  const database = await freshDatabase();
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const linked = new Map<string, LinkedAccount[]>();
  const clear = fakeClearLookup();
  const sent: Harness["sent"] = [];
  const verifier = privyVerifier({ privyAppId: APP_ID, verificationKey: await exportSPKI(publicKey) });
  verifier.linkedAccounts = async (did) => linked.get(did) ?? [];

  // Frozen unless a test needs real time (playout runs ffmpeg in real time).
  let now = new Date("2026-10-01T19:00:00.000Z");
  let offset = 0;
  const clock = options.realTime
    ? {
        now: () => new Date(Date.now() + offset),
        set: (iso: string) => {
          offset = Date.parse(iso) - Date.now();
        },
        advance: (ms: number) => {
          offset += ms;
        }
      }
    : {
        now: () => new Date(now),
        set: (iso: string) => {
          now = new Date(iso);
        },
        advance: (ms: number) => {
          now = new Date(now.getTime() + ms);
        }
      };

  const storageRoot = path.join(os.tmpdir(), `opencast-test-${randomUUID()}`);
  const deps: Deps = {
    db: database.db,
    media: ffmpegPipeline(storageRoot),
    storage: { objects: options.objects?.(storageRoot) ?? localObjectStore(path.join(storageRoot, "objects"), `${options.publicBase ?? ""}/objects`), ipfs: fakeIpfs() },
    chain: options.chain ?? null,
    payments: options.payments ? options.payments(clock) : fakePayments(clock),
    notifier: {
      push: async (userId, n) => void sent.push({ channel: "push", to: userId, title: n.title }),
      email: async (to, n) => void sent.push({ channel: "email", to, title: n.title, link: n.link, key: n.key, body: n.body })
    },
    bus: new EventBus(),
    clock,
    auth: verifier,
    clear,
    geo: options.geo ?? noGeoLookup,
    places: options.places,
    relay: options.relay ?? memoryRelayBus(),
    platforms: options.platforms,
    // No network in tests: an https check fails unless a test passes a fake.
    externalFetch: options.externalFetch ?? (async () => Promise.reject(new TypeError("fetch failed"))),
    config: {
      storageRoot,
      appOrigin: "https://app.opencast.test",
      businessOrigin: "https://business.opencast.test",
      escrowContractAddress: options.chain?.escrow ?? null,
      // Base Sepolia's test USDC: only its address is used here, nothing is sent.
      usdc: { chainId: 84532, address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" },
      production: false,
      sseHeartbeatMs: options.sseHeartbeatMs,
      publicBase: options.publicBase ?? null,
      streamRelay: options.streamRelay ?? null
    }
  };
  const { router, services } = createV1(deps);
  const app = express();
  app.use("/v1", router);

  const token = (did: string) =>
    new SignJWT({ sid: randomUUID() })
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer("privy.io")
      .setAudience(APP_ID)
      .setSubject(did)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

  const harness: Harness = {
    app,
    deps,
    services,
    db: database.db,
    clock,
    linked,
    clear,
    sent,
    token,
    async signIn(name, options = {}) {
      const did = `did:privy:${randomUUID()}`;
      if (options.linked) linked.set(did, options.linked);
      const jwt = await token(did);
      const user = await services.accounts.userForToken(jwt);
      if (name || options.admin) {
        await database.db
          .update(schema.users)
          .set({ displayName: name ?? null, isAdmin: options.admin ?? false })
          .where(eq(schema.users.id, user.id));
      }
      const auth = (test: request.Test) => test.set("authorization", `Bearer ${jwt}`);
      return {
        id: user.id,
        did,
        token: jwt,
        get: (url) => auth(request(app).get(url)),
        post: (url, body) => (body ? auth(request(app).post(url)).send(body) : auth(request(app).post(url))),
        put: (url, body) => (body ? auth(request(app).put(url)).send(body) : auth(request(app).put(url))),
        patch: (url, body) => (body ? auth(request(app).patch(url)).send(body) : auth(request(app).patch(url))),
        delete: (url) => auth(request(app).delete(url))
      };
    },
    async close() {
      // Background work (storing uploads, imports) finishes before the database goes.
      await services.shelf.settle();
      await services.uploads.settle();
      await services.library.settle();
      await deps.bus.settle();
      await deps.relay.close();
      await database.drop();
    }
  };
  return harness;
}

/** Anonymous requests. */
export const anon = (h: Harness) => request(h.app);

// Fixtures written straight to the database, for tests of modules that need them.

export async function market(h: Harness, slug = "inland-empire", name = "Inland Empire") {
  const [row] = await h.db.insert(schema.markets).values({ slug, name, openedAt: h.clock.now() }).returning();
  return row;
}

export async function stationFixture(
  h: Harness,
  fields: { callSign?: string; name?: string; kind?: "station" | "studio" | "claimable" | "listed" | "catalog"; ownerId?: string; marketId?: string; tenths?: number; band?: "tv" | "radio"; signedOn?: boolean; colour?: string } = {}
) {
  const [station] = await h.db
    .insert(schema.stations)
    .values({
      kind: fields.kind ?? "station",
      callSign: fields.callSign ?? null,
      name: fields.name ?? "Test station",
      colour: fields.colour ?? null,
      firstSignedOnAt: fields.signedOn ? h.clock.now() : null,
      status: fields.signedOn ? "on_air" : "setting_up"
    })
    .returning();
  if (fields.marketId && fields.tenths) {
    await h.db.insert(schema.channels).values({ stationId: station.id, marketId: fields.marketId, band: fields.band ?? "tv", tenths: fields.tenths });
  }
  if (fields.ownerId) {
    await h.db.insert(schema.stationMemberships).values({ stationId: station.id, userId: fields.ownerId, role: "owner" });
  }
  return station;
}

/**
 * A radio channel number (tenths) the database takes: the band's numbering is moving from odd
 * tenths (88.1 to 107.9) to even ones (88.2 to 107.8), so this reads the rule rather than
 * assuming it. `n` picks the nth channel from the bottom of the band.
 */
export async function radioTenths(h: Harness, n = 0): Promise<number> {
  const { sql } = await import("drizzle-orm");
  const result = (await h.db.execute(sql`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'channel_number_in_band'`)) as unknown as { rows?: Array<{ def: string }> } | Array<{ def: string }>;
  const rows = Array.isArray(result) ? result : (result.rows ?? []);
  const even = /%\s*2\)?\s*=\s*0/.test(rows[0]?.def ?? "");
  return (even ? 882 : 881) + 2 * n;
}

/** A short test clip made with ffmpeg (a test pattern and a tone), cached per run. */
const clips = new Map<string, Promise<string>>();
export function testClip(seconds: number, kind: "video" | "audio" = "video"): Promise<string> {
  const key = `${seconds}-${kind}`;
  if (!clips.has(key)) {
    clips.set(
      key,
      (async () => {
        const { spawn } = await import("node:child_process");
        const { promises: fs } = await import("node:fs");
        const dir = path.join(os.tmpdir(), "opencast-test-clips");
        await fs.mkdir(dir, { recursive: true });
        const ext = kind === "video" ? "mp4" : "m4a";
        const file = path.join(dir, `clip-${key}.${ext}`);
        // Test files run in parallel workers, each making its own clips: write to a name of this
        // worker's own, then rename into place, so no worker reads a clip another is still writing.
        const partial = path.join(dir, `clip-${key}.${process.pid}-${Math.random().toString(36).slice(2)}.${ext}`);
        const args =
          kind === "video"
            ? ["-y", "-f", "lavfi", "-i", `testsrc=duration=${seconds}:size=640x360:rate=24`, "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", partial]
            : ["-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`, "-c:a", "aac", partial];
        await new Promise<void>((resolve, reject) => {
          const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args]);
          child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
        });
        await fs.rename(partial, file);
        return file;
      })()
    );
  }
  return clips.get(key)!;
}

/** A library item written straight to the database (no file), with rights confirmed. */
export async function itemFixture(
  h: Harness,
  stationId: string,
  fields: { title?: string; durationMs?: number; code?: "PGM" | "SPT" | "UND" | "BMP" | "SID"; programId?: string; source?: "upload" | "link"; rights?: boolean; episodeNumber?: number; location?: string } = {}
) {
  const [item] = await h.db
    .insert(schema.assets)
    .values({
      stationId,
      programId: fields.programId ?? null,
      title: fields.title ?? "Episode",
      episodeNumber: fields.episodeNumber ?? null,
      code: fields.code ?? "PGM",
      source: fields.source ?? "upload",
      sourceUrl: fields.source === "link" ? "https://example.com/v" : null,
      mediaKind: "video",
      durationMs: fields.durationMs ?? 28.5 * 60_000,
      status: "ready"
    })
    .returning();
  if (fields.rights !== false) {
    await h.db.insert(schema.rightsConfirmations).values({ assetId: item.id, basis: "made_it" });
  }
  if (fields.location) {
    // A real file: stored by its content ID, as an upload's original is.
    const { cid } = await h.services.library.content.store(fields.location, { storageClass: "infrequent" });
    const [file] = await h.db.insert(schema.assetFiles).values({ assetId: item.id, version: 1, contentId: cid }).returning();
    await h.services.library.content.addRef(h.db, cid, "asset_file", file.id);
  } else {
    await h.db.insert(schema.assetFiles).values({ assetId: item.id, version: 1, storage: "local", location: `/fixtures/${item.id}.mp4` });
  }
  return item;
}

/** A small file of random bytes (a distinct content ID each time), for items that are never decoded. */
export async function dummyFile(): Promise<string> {
  const { promises: fs } = await import("node:fs");
  const dir = path.join(os.tmpdir(), "opencast-test-dummies");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${randomUUID()}.mp4`);
  await fs.writeFile(file, Buffer.from(randomUUID().repeat(8)));
  return file;
}

/**
 * Prepares without FFmpeg (tests that assemble a channel): each rendition gets a few bytes per
 * segment and a playlist that says each segment is 4 s long (the last one the rest). Keys in
 * `fail` fail, as a broken file would.
 */
export function fakeTranscoder() {
  const jobs: string[] = [];
  const fail = new Set<string>();
  const transcoder = async (job: import("../src/v1/modules/playout/engine/prepare.js").TranscodeJob) => {
    const { promises: fs } = await import("node:fs");
    jobs.push(job.key);
    if (fail.has(job.key)) throw new Error("not a media file");
    const durationMs = job.source.kind === "slate" ? job.source.seconds * 1000 : (job.durationMs ?? 8_000);
    const lengths: number[] = [];
    for (let left = durationMs; left > 0; left -= 4_000) lengths.push(Math.min(4_000, left));
    const renditions: Record<string, { segmentMs: number[] }> = {};
    for (const r of job.renditions) {
      const dir = path.join(job.outDir, r.name);
      await fs.mkdir(dir, { recursive: true });
      await Promise.all(lengths.map((_, i) => fs.writeFile(path.join(dir, `seg_${String(i).padStart(5, "0")}.ts`), Buffer.from(`${job.key}/${r.name}/${i}`))));
      await fs.writeFile(path.join(dir, "index.m3u8"), ["#EXTM3U", ...lengths.flatMap((ms, i) => [`#EXTINF:${(ms / 1000).toFixed(3)},`, `seg_${String(i).padStart(5, "0")}.ts`]), "#EXT-X-ENDLIST", ""].join("\n"));
      renditions[r.name] = { segmentMs: lengths };
    }
    return { durationMs, renditions };
  };
  return Object.assign(transcoder, { jobs, fail });
}

/** Prepares everything queued, until nothing is left. */
export async function prepareQueued(h: Harness, preparer: { pump(): Promise<void>; settle(): Promise<void> }) {
  for (let i = 0; i < 100; i++) {
    await preparer.pump();
    await preparer.settle();
    const [queued] = await h.db.select({ key: schema.preparedItems.key }).from(schema.preparedItems).where(eq(schema.preparedItems.status, "queued")).limit(1);
    if (!queued) return;
  }
}
