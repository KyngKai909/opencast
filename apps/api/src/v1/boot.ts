// Builds the v1 API from the environment, for the running server.
import { createDb } from "@opencast/db";
import { privyVerifier } from "./auth.js";
import { EventBus } from "./events.js";
import { createV1 } from "./index.js";

export function bootV1(env: NodeJS.ProcessEnv, storageRoot: string) {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  if (!env.PRIVY_APP_ID) {
    console.warn("[v1] PRIVY_APP_ID isn't set: signed-in endpoints will answer 401 until it is.");
  }
  const { db } = createDb(databaseUrl);
  return createV1({
    db,
    bus: new EventBus(),
    clock: { now: () => new Date() },
    auth: privyVerifier({
      privyAppId: env.PRIVY_APP_ID ?? "unset",
      verificationKey: env.PRIVY_VERIFICATION_KEY || undefined,
      privyAppSecret: env.PRIVY_APP_SECRET || undefined
    }),
    config: {
      storageRoot,
      appOrigin: env.APP_ORIGIN ?? "http://localhost:5174",
      escrowContractAddress: env.ESCROW_CONTRACT_ADDRESS || null,
      production: env.NODE_ENV === "production"
    }
  });
}
