// Signatures and addresses (A237). A relay address carries HMAC-SHA256 over the upstream's origin
// (`http://host[:port]`, as `URL.origin` writes it) with STREAM_RELAY_SECRET, base64url without
// padding: the API's `relaySignature` (apps/api/src/v1/lib/streamRelay.ts) makes the same one.

const encoder = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();

function keyFor(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    keys.set(secret, key);
  }
  return key;
}

function bytesToB64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** Text as base64url (UTF-8, no padding). */
export function b64urlEncode(text: string): string {
  return bytesToB64url(encoder.encode(text));
}

/** base64url back to text; null when it isn't base64url or valid UTF-8. */
export function b64urlDecode(text: string): string | null {
  const bytes = b64urlToBytes(text);
  if (!bytes) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
}

/** The signature for one origin. */
export async function signOrigin(secret: string, origin: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await keyFor(secret), encoder.encode(origin));
  return bytesToB64url(new Uint8Array(sig));
}

/** Whether `sig` is the signature for `origin` (compared in constant time by Web Crypto). */
export async function verifyOrigin(secret: string, origin: string, sig: string): Promise<boolean> {
  const bytes = b64urlToBytes(sig);
  if (!bytes || bytes.byteLength !== 32) return false;
  return crypto.subtle.verify("HMAC", await keyFor(secret), bytes, encoder.encode(origin));
}
