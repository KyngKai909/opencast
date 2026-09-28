// Builds the v1 API from the environment: the API server and the worker both use this.
import { createDb } from "@opencast/db";
import { privyVerifier } from "./auth.js";
import type { Deps } from "./context.js";
import { EventBus } from "./events.js";
import { createV1 } from "./index.js";
import { createJobs } from "./jobs.js";
import { ffmpegPipeline } from "./media.js";
import { paymentsFromEnv } from "./payments/index.js";
import { storageFromEnv } from "./storage.js";
import { chainFromEnv } from "./chain/index.js";

export function createDeps(env: NodeJS.ProcessEnv, storageRoot: string): Deps {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  if (!env.PRIVY_APP_ID) {
    console.warn("[v1] PRIVY_APP_ID isn't set: signed-in endpoints will answer 401 until it is.");
  }
  if (env.PRIVY_APP_ID && env.PRIVY_APP_ID === env.CLEAR_PRIVY_PROVIDER_APP_ID) {
    // Opencast would accept tokens issued to Clear's app. It needs its own.
    throw new Error("PRIVY_APP_ID is Clear's Privy app. Opencast needs its own Privy app (see docs/clear-integration.md).");
  }
  const { db } = createDb(databaseUrl);
  const clock = { now: () => new Date() };
  const appOrigin = env.APP_ORIGIN ?? "http://localhost:5174";
  const chain = chainFromEnv(env);
  return {
    db,
    bus: new EventBus(),
    clock,
    media: ffmpegPipeline(storageRoot),
    storage: storageFromEnv(env, storageRoot),
    chain,
    notifier: {
      push: async (userId, n) => console.log(`[notify] push to ${userId}: ${n.title}`),
      email: async (to, n) => console.log(`[notify] email to ${to}: ${n.title}`)
    },
    payments: paymentsFromEnv(env, clock, appOrigin),
    auth: privyVerifier({
      privyAppId: env.PRIVY_APP_ID ?? "unset",
      verificationKey: env.PRIVY_VERIFICATION_KEY || undefined,
      privyAppSecret: env.PRIVY_APP_SECRET || undefined
    }),
    config: {
      storageRoot,
      appOrigin,
      escrowContractAddress: chain?.escrow ?? (env.ESCROW_CONTRACT_ADDRESS || null),
      production: env.NODE_ENV === "production"
    }
  };
}

/** The API server's v1. The jobs tick belongs to the worker now; JOBS=on runs it here instead. */
export function bootV1(env: NodeJS.ProcessEnv, storageRoot: string) {
  const v1 = createV1(createDeps(env, storageRoot));
  if (env.JOBS === "on") {
    createJobs(v1.deps, v1.services).start();
  }
  return v1;
}
