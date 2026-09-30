// Builds the v1 API from the environment: the API server and the worker both use this.
import { createDb } from "@opencast/db";
import { privyVerifier } from "./auth.js";
import { clearLookupFromEnv } from "./clearLink.js";
import type { Deps } from "./context.js";
import { EventBus } from "./events.js";
import { createV1 } from "./index.js";
import { createJobs } from "./jobs.js";
import { ffmpegPipeline } from "./media.js";
import { paymentsFromEnv } from "./payments/index.js";
import { storageFromEnv } from "./storage.js";
import { chainFromEnv } from "./chain/index.js";
import { geoFromEnv } from "./geo.js";
import { placesFromEnv } from "./places.js";
import { relayFromEnv } from "./relay.js";
import { emailFromEnv } from "./email.js";

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
  // The business app: business invites and business notices link there.
  const businessOrigin = (env.BUSINESS_ORIGIN?.trim() || (env.NODE_ENV === "production" ? appOrigin : "http://localhost:5177")).replace(/\/+$/, "");
  if (env.NODE_ENV === "production" && !env.BUSINESS_ORIGIN?.trim()) {
    console.warn("[v1] BUSINESS_ORIGIN isn't set: business invites link to APP_ORIGIN, which has no business pages.");
  }
  const chain = chainFromEnv(env);
  const publicBase = publicBaseFromEnv(env);
  return {
    db,
    bus: new EventBus(),
    clock,
    media: ffmpegPipeline(storageRoot),
    storage: storageFromEnv(env, storageRoot, publicBase),
    chain,
    notifier: {
      push: async (userId, n) => console.log(`[notify] push to ${userId}: ${n.title}`),
      // Resend with RESEND_API_KEY (EMAIL_FROM, EMAIL_REPLY_TO), else the log.
      email: emailFromEnv(env)
    },
    payments: paymentsFromEnv(env, clock, appOrigin),
    auth: privyVerifier({
      privyAppId: env.PRIVY_APP_ID ?? "unset",
      verificationKey: env.PRIVY_VERIFICATION_KEY || undefined,
      privyAppSecret: env.PRIVY_APP_SECRET || undefined
    }),
    clear: clearLookupFromEnv(env),
    geo: geoFromEnv(env),
    places: placesFromEnv(env),
    relay: relayFromEnv(env),
    config: {
      storageRoot,
      appOrigin,
      businessOrigin,
      inviteEmailMatch: env.INVITE_EMAIL_MATCH?.trim().toLowerCase() !== "off",
      escrowContractAddress: chain?.escrow ?? (env.ESCROW_CONTRACT_ADDRESS || null),
      usdc: env.CHAIN_ID && env.USDC_ADDRESS ? { chainId: Number(env.CHAIN_ID), address: env.USDC_ADDRESS } : null,
      production: env.NODE_ENV === "production",
      publicBase,
      hlsBase: env.HLS_PUBLIC_URL?.trim().replace(/\/+$/, "") || null
    }
  };
}

/** A117: the API's public origin: API_PUBLIC_URL (or PUBLIC_BASE_URL), else Railway's public domain. */
export function publicBaseFromEnv(env: NodeJS.ProcessEnv): string | null {
  const configured = (env.API_PUBLIC_URL ?? env.PUBLIC_BASE_URL)?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const railway = env.RAILWAY_PUBLIC_DOMAIN?.trim();
  return railway ? `https://${railway}` : null;
}

/** The API server's v1. The jobs tick belongs to the worker now; JOBS=on runs it here instead. */
export function bootV1(env: NodeJS.ProcessEnv, storageRoot: string) {
  const v1 = createV1(createDeps(env, storageRoot));
  if (env.JOBS === "on") {
    createJobs(v1.deps, v1.services).start();
  }
  return v1;
}
