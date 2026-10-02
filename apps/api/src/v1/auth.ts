// Privy sign-in. The apps send Privy's access token (a JWT signed with the app's
// ES256 key) as `Authorization: Bearer <token>` or the `privy-token` cookie.
// We verify it against the app's verification key, or its JWKS when no key is set.
//
// Opencast has its own Privy app, separate from Clear's: its ID and secret come from
// configuration (PRIVY_APP_ID, PRIVY_APP_SECRET), so anyone self-hosting uses their own. Only
// tokens issued to that app verify (the audience is the app ID). Embedded wallets are created by
// Privy only for people who sign in; the API never makes or shares one. Clear is reached as a
// global wallet the person links (docs/clear-integration.md), never through Opencast's app.

import { createRemoteJWKSet, importSPKI, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface AuthConfig {
  privyAppId: string;
  /** PEM from the Privy dashboard. Falls back to Privy's JWKS for the app. */
  verificationKey?: string;
  /** For linked accounts (emails, wallets). Optional. */
  privyAppSecret?: string;
}

export interface VerifiedToken {
  privyDid: string;
  sessionId: string | null;
  /** When Privy issued the token (its `iat`), for "sign out everywhere". */
  issuedAt: Date | null;
}

export interface LinkedAccount {
  kind: "email" | "apple" | "google" | "wallet";
  value: string;
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedToken>;
  /** The user's linked accounts, when Privy's API is configured. */
  linkedAccounts(privyDid: string): Promise<LinkedAccount[]>;
}

export function privyVerifier(config: AuthConfig): TokenVerifier {
  let key: CryptoKey | JWTVerifyGetKey | undefined;
  const getKey = async () => {
    if (!key) {
      key = config.verificationKey
        ? await importSPKI(config.verificationKey.replace(/\\n/g, "\n"), "ES256")
        : createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${config.privyAppId}/jwks.json`));
    }
    return key;
  };

  return {
    async verify(token) {
      const k = await getKey();
      const options = { issuer: "privy.io", audience: config.privyAppId };
      const { payload } = typeof k === "function" ? await jwtVerify(token, k, options) : await jwtVerify(token, k, options);
      if (typeof payload.sub !== "string" || !payload.sub.startsWith("did:privy:")) {
        throw new Error("Token has no Privy user");
      }
      return {
        privyDid: payload.sub,
        sessionId: typeof payload.sid === "string" ? payload.sid : null,
        issuedAt: typeof payload.iat === "number" ? new Date(payload.iat * 1000) : null
      };
    },
    async linkedAccounts(privyDid) {
      if (!config.privyAppSecret) {
        return [];
      }
      const response = await fetch(`https://auth.privy.io/api/v1/users/${encodeURIComponent(privyDid)}`, {
        headers: {
          authorization: `Basic ${Buffer.from(`${config.privyAppId}:${config.privyAppSecret}`).toString("base64")}`,
          "privy-app-id": config.privyAppId
        }
      });
      if (!response.ok) {
        return [];
      }
      const user = (await response.json()) as { linked_accounts?: Array<Record<string, string>> };
      return (user.linked_accounts ?? []).flatMap((account): LinkedAccount[] => {
        switch (account.type) {
          case "email":
            return [{ kind: "email", value: account.address.toLowerCase() }];
          case "wallet":
            return [{ kind: "wallet", value: account.address.toLowerCase() }];
          case "google_oauth":
            return [{ kind: "google", value: account.email ?? account.subject }];
          case "apple_oauth":
            return [{ kind: "apple", value: account.email ?? account.subject }];
          default:
            return [];
        }
      });
    }
  };
}

export function tokenFrom(headers: { authorization?: string; cookie?: string }): string | undefined {
  const bearer = headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) {
    return bearer.trim();
  }
  const cookie = headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("privy-token="));
  return cookie ? decodeURIComponent(cookie.slice("privy-token=".length)) : undefined;
}
