// Stream keys and sign-in tokens, encrypted at rest (follow-up Phase 3). AES-256-GCM with a key
// from configuration, a fresh 12-byte IV each time, and the row and field as additional data, so a
// sealed value can't be moved to another row or field. Sealed values read
// `v1.<key id>.<iv>.<tag>.<ciphertext>` (base64url), so the key can be rotated:
//
//   PLATFORM_SECRETS_KEY       the key new values are sealed with: 32 bytes, base64 or hex,
//                              optionally named `<id>:<key>` (the id defaults to a hash of the key)
//   PLATFORM_SECRETS_OLD_KEYS  earlier keys, comma separated, `<id>:<key>`: still opened, never used
//                              to seal. The platforms tick re-seals anything under an old key with
//                              the current one; once none is left, drop the old key.
//
// Plain values exist only in memory, for as long as a call needs them. Nothing here logs, and no
// error message carries a value. Without PLATFORM_SECRETS_KEY a development server uses a fixed
// development key (and says so once); production refuses to store keys until it's set.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface SecretBox {
  /** A real key from configuration (false: the development key). */
  readonly configured: boolean;
  /** Keys can be stored (a configured key, or not production). */
  readonly usable: boolean;
  readonly keyId: string;
  seal(plain: string, context: string): string;
  open(sealed: string, context: string): string;
  /** Sealed with a key other than the current one. */
  needsRotation(sealed: string): boolean;
}

export class SecretsUnavailable extends Error {
  constructor() {
    super("PLATFORM_SECRETS_KEY isn't set, so stream keys can't be stored.");
  }
}

const VERSION = "v1";
const b64u = (buf: Buffer) => buf.toString("base64url");

function parseKey(text: string): Buffer {
  const t = text.trim();
  const buf = /^[0-9a-fA-F]{64}$/.test(t) ? Buffer.from(t, "hex") : Buffer.from(t, "base64");
  if (buf.length !== 32) throw new Error("A platform secrets key is 32 bytes, base64 or hex.");
  return buf;
}

function named(entry: string): { id: string; key: Buffer } {
  const at = entry.indexOf(":");
  const hasId = at > 0 && /^[A-Za-z0-9_-]{1,32}$/.test(entry.slice(0, at));
  const key = parseKey(hasId ? entry.slice(at + 1) : entry);
  const id = hasId ? entry.slice(0, at) : createHash("sha256").update(key).digest("hex").slice(0, 8);
  return { id, key };
}

export function secretBox(current: { id: string; key: Buffer }, old: Array<{ id: string; key: Buffer }> = [], options: { configured?: boolean; usable?: boolean } = {}): SecretBox {
  const keys = new Map([...old.map((k) => [k.id, k.key] as const), [current.id, current.key] as const]);
  return {
    configured: options.configured ?? true,
    usable: options.usable ?? true,
    keyId: current.id,
    seal(plain, context) {
      if (options.usable === false) throw new SecretsUnavailable();
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", current.key, iv);
      cipher.setAAD(Buffer.from(context, "utf8"));
      const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return [VERSION, current.id, b64u(iv), b64u(cipher.getAuthTag()), b64u(body)].join(".");
    },
    open(sealed, context) {
      const parts = sealed.split(".");
      if (parts.length !== 5 || parts[0] !== VERSION) throw new Error("That sealed secret isn't in a known format.");
      const key = keys.get(parts[1]);
      if (!key) throw new Error(`No key "${parts[1]}" to open that secret (PLATFORM_SECRETS_OLD_KEYS).`);
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[2], "base64url"));
      decipher.setAAD(Buffer.from(context, "utf8"));
      decipher.setAuthTag(Buffer.from(parts[3], "base64url"));
      try {
        return Buffer.concat([decipher.update(Buffer.from(parts[4], "base64url")), decipher.final()]).toString("utf8");
      } catch {
        // Never the value, never the key: just that it didn't open.
        throw new Error("A sealed secret didn't open (wrong key, or moved from another row).");
      }
    },
    needsRotation(sealed) {
      return sealed.split(".")[1] !== current.id;
    }
  };
}

/** The development key: fixed, so a local database keeps working across restarts. Never for production. */
const DEV_KEY = { id: "dev", key: createHash("sha256").update("opencast development platform secrets").digest() };
let warned = false;

export function secretBoxFromEnv(env: NodeJS.ProcessEnv): SecretBox {
  const production = env.NODE_ENV === "production";
  const old = (env.PLATFORM_SECRETS_OLD_KEYS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(named);
  const configured = env.PLATFORM_SECRETS_KEY?.trim();
  if (configured) return secretBox(named(configured), old);
  if (!warned && !env.VITEST) {
    warned = true;
    if (production) console.warn("[v1] PLATFORM_SECRETS_KEY isn't set: stream keys and platform sign-ins can't be stored until it is.");
    else console.warn("[v1] PLATFORM_SECRETS_KEY isn't set: stream keys are sealed with the development key.");
  }
  return secretBox(DEV_KEY, old, { configured: false, usable: !production });
}

/** What a sealed value is bound to: its row and field. */
export const secretContext = (table: string, rowId: string, field: string) => `${table}:${rowId}:${field}`;
