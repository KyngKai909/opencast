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
import { EventBus } from "../src/v1/events.js";
import { createV1 } from "../src/v1/index.js";
import type { Deps, Services } from "../src/v1/context.js";

export const APP_ID = "test-app";

export interface Harness {
  app: express.Express;
  deps: Deps;
  services: Services;
  db: Deps["db"];
  clock: { set(iso: string): void; now(): Date; advance(ms: number): void };
  /** Linked accounts Privy would report for a did. */
  linked: Map<string, LinkedAccount[]>;
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

export async function createHarness(): Promise<Harness> {
  const database = await freshDatabase();
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const linked = new Map<string, LinkedAccount[]>();
  const verifier = privyVerifier({ privyAppId: APP_ID, verificationKey: await exportSPKI(publicKey) });
  verifier.linkedAccounts = async (did) => linked.get(did) ?? [];

  let now = new Date("2026-10-01T19:00:00.000Z");
  const clock = {
    now: () => new Date(now),
    set: (iso: string) => {
      now = new Date(iso);
    },
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    }
  };

  const deps: Deps = {
    db: database.db,
    bus: new EventBus(),
    clock,
    auth: verifier,
    config: {
      storageRoot: path.join(os.tmpdir(), `opencast-test-${randomUUID()}`),
      appOrigin: "https://app.opencast.test",
      escrowContractAddress: null,
      production: false
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
        post: (url, body) => auth(request(app).post(url)).send(body ?? {}),
        put: (url, body) => auth(request(app).put(url)).send(body ?? {}),
        patch: (url, body) => auth(request(app).patch(url)).send(body ?? {}),
        delete: (url) => auth(request(app).delete(url))
      };
    },
    async close() {
      await deps.bus.settle();
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
