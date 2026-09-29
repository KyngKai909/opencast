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
  /** Pushes and emails sent, in order. */
  sent: Array<{ channel: "push" | "email"; to: string; title: string }>;
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
  options: { realTime?: boolean; payments?: (clock: { now(): Date }) => Deps["payments"]; chain?: Deps["chain"]; geo?: Deps["geo"]; relay?: Deps["relay"]; sseHeartbeatMs?: number } = {}
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
    storage: { objects: localObjectStore(path.join(storageRoot, "objects")), ipfs: fakeIpfs() },
    chain: options.chain ?? null,
    payments: options.payments ? options.payments(clock) : fakePayments(clock),
    notifier: {
      push: async (userId, n) => void sent.push({ channel: "push", to: userId, title: n.title }),
      email: async (to, n) => void sent.push({ channel: "email", to, title: n.title })
    },
    bus: new EventBus(),
    clock,
    auth: verifier,
    clear,
    geo: options.geo ?? noGeoLookup,
    relay: options.relay ?? memoryRelayBus(),
    config: {
      storageRoot,
      appOrigin: "https://app.opencast.test",
      escrowContractAddress: options.chain?.escrow ?? null,
      // Base Sepolia's test USDC: only its address is used here, nothing is sent.
      usdc: { chainId: 84532, address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" },
      production: false,
      sseHeartbeatMs: options.sseHeartbeatMs
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
      // Background work (preparing uploads, rendering previews) finishes before the database goes.
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
        const file = path.join(dir, `clip-${key}.${kind === "video" ? "mp4" : "m4a"}`);
        const args =
          kind === "video"
            ? ["-y", "-f", "lavfi", "-i", `testsrc=duration=${seconds}:size=640x360:rate=24`, "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file]
            : ["-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`, "-c:a", "aac", file];
        await new Promise<void>((resolve, reject) => {
          const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args]);
          child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
        });
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
    // A real file: stored by its content ID, as an upload would be.
    const { cid } = await h.services.library.content.store(fields.location, { storageClass: "standard" });
    const [file] = await h.db.insert(schema.assetFiles).values({ assetId: item.id, version: 1, contentId: cid }).returning();
    await h.services.library.content.addRef(h.db, cid, "asset_file", file.id);
  } else {
    await h.db.insert(schema.assetFiles).values({ assetId: item.id, version: 1, storage: "local", location: `/fixtures/${item.id}.mp4` });
  }
  return item;
}
