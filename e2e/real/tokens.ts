// Privy-style access tokens for the real-API runs, signed with the run's throwaway key: what
// Privy would issue (issuer privy.io, audience the app id, subject did:privy:<person>).

import { randomUUID } from "node:crypto";
import { importJWK, SignJWT } from "jose";
import { PRIVY_APP_ID, didOf, readState } from "./shared.js";

let key: Promise<CryptoKey | Uint8Array> | undefined;

/**
 * A token for someone: a seeded person ("kai") or anyone new ("new-owner-1": their account is made
 * the first time the API sees the token, with the email new-owner-1@example.com).
 */
export async function tokenFor(person: string, o: { expiresIn?: string } = {}): Promise<string> {
  key ??= importJWK(readState().privateJwk as Parameters<typeof importJWK>[0], "ES256");
  return new SignJWT({ sid: randomUUID() })
    .setProtectedHeader({ alg: "ES256" })
    .setIssuer("privy.io")
    .setAudience(PRIVY_APP_ID)
    .setSubject(didOf(person))
    .setIssuedAt()
    .setExpirationTime(o.expiresIn ?? "1h")
    .sign(await key);
}
