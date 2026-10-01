// A238 (the user's decision, with the relay's extension to CORS-blocked streams): stream links that
// work only by using another app's access are never relayed, and never on the dial. They wait
// (`waiting: "platform_feed"`), whatever their CORS, and stay listed (not removed): the desk asks the
// channel's licensor for its own feed. One place, here, and docs/open-decisions.md (A238) lists them:
//
// Only addresses that carry another app's access token (narrowed 2026-10-01 at the user's request:
// an address that merely names a partner, like AMC's own `…/samsungheadend_us/…` feed, isn't
// using anyone's access and plays like any other):
// - `jmp2.uk` (any address on it): a redirector that hands out Pluto feeds with Samsung TV Plus's token.
// - Pluto's stitcher (`*.pluto.tv`, a `stitch` host or path) carrying an app's session token
//   (`authToken`, `jwt`); the partner's parameters only name it in the desk's words.
// - Any address with an `authToken=`, `token=` or `jwt=` that's a JWT whose payload names a partner
//   (`partner`, `partnerId`, `partnerName`, `embedPartner`, `distributionPartner`, or a `deviceType`
//   or `appName` that's a partner's).
//
// The match is by the address alone (nothing fetched), so it applies at listing, on a change (A215),
// and to every listing at the checks' next pass. The label goes in the desk's words: "Uses another
// app's access (Pluto via Samsung TV Plus). Ask the channel's licensor for its own feed."

/** Partner apps by how their names show up in parameters and tokens, and how the desk says them. */
const PARTNERS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /samsung|tvplus|tizen/i, name: "Samsung TV Plus" },
  { pattern: /roku/i, name: "The Roku Channel" },
  { pattern: /vizio|watchfree/i, name: "Vizio WatchFree+" },
  { pattern: /xumo|comcast|xfinity/i, name: "Xumo" },
  { pattern: /^lg|lgchannels|webos/i, name: "LG Channels" },
  { pattern: /firetv|fire-tv|amazon/i, name: "Amazon Fire TV" },
  { pattern: /tcl|hisense|verizon|sling|plex/i, name: "" }
];

/** A partner app's name for a parameter or token value; null when it isn't one we know. */
function partnerName(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const known = PARTNERS.find((p) => p.pattern.test(v));
  if (!known) return null;
  return known.name || v;
}

/** The payload of a JWT (three base64url parts, a JSON header with `alg`), or null. Never verified: only read. */
export function jwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p)) || !parts[0] || !parts[1]) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as unknown;
    if (!header || typeof header !== "object" || !("alg" in header)) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as unknown;
    return payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const PARTNER_CLAIMS = ["partner", "partnerId", "partnerName", "embedPartner", "distributionPartner"];
const DEVICE_CLAIMS = ["deviceType", "appName"];

/** The partner a JWT's payload names, or null. A partner claim names one outright; a device or app claim only when it's a partner's. */
export function jwtPartner(token: string): string | null {
  const payload = jwtPayload(token);
  if (!payload) return null;
  for (const claim of PARTNER_CLAIMS) {
    const v = payload[claim];
    if (typeof v === "string" && v.trim()) return partnerName(v) ?? v.trim();
  }
  for (const claim of DEVICE_CLAIMS) {
    const v = payload[claim];
    if (typeof v === "string") {
      const name = partnerName(v);
      if (name) return name;
    }
  }
  return null;
}

const TOKEN_PARAMS = ["authToken", "token", "jwt"];

/** A query parameter by name, ignoring case. */
function param(url: URL, name: string): string | null {
  for (const [k, v] of url.searchParams) if (k.toLowerCase() === name.toLowerCase()) return v;
  return null;
}

export interface PlatformFeedPattern {
  id: "jmp2" | "pluto_partner" | "partner_token";
  /** The pattern, in words (docs and tests). */
  about: string;
  /** The desk's words for what it uses, when the address matches; null otherwise. */
  match(url: URL): string | null;
}

/** The patterns, in the order they're tried. */
export const PLATFORM_FEED_PATTERNS: readonly PlatformFeedPattern[] = [
  {
    id: "jmp2",
    about: "jmp2.uk, a redirector to other apps' channel feeds",
    match: (u) => (u.hostname === "jmp2.uk" || u.hostname.endsWith(".jmp2.uk") ? "jmp2.uk, which forwards to other apps' feeds" : null)
  },
  {
    id: "pluto_partner",
    about: "Pluto's stitcher (*.pluto.tv, a stitch host or path) carrying an app's authToken or jwt",
    match: (u) => {
      if (!(u.hostname === "pluto.tv" || u.hostname.endsWith(".pluto.tv"))) return null;
      if (!/stitch/i.test(u.hostname) && !/stitch/i.test(u.pathname)) return null;
      // Only with a token: partner parameters alone carry nobody's access.
      const token = TOKEN_PARAMS.map((n) => param(u, n)).find((v) => !!v);
      if (!token) return null;
      const embed = param(u, "embedPartner");
      const device = param(u, "deviceType");
      const partner = jwtPartner(token) || (embed && (partnerName(embed) ?? embed)) || (device && partnerName(device));
      return partner ? `Pluto via ${partner}` : "Pluto via a partner app";
    }
  },
  {
    id: "partner_token",
    about: "an authToken, token or jwt that's a JWT whose payload names a partner",
    match: (u) => {
      for (const n of TOKEN_PARAMS) {
        const v = param(u, n);
        const partner = v ? jwtPartner(v) : null;
        if (partner) return partner;
      }
      return null;
    }
  }
];

/** What another app's access a stream address uses, in the desk's words ("Pluto via Samsung TV Plus"); null when it's the source's own. */
export function platformFeedOf(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return null;
  }
  for (const p of PLATFORM_FEED_PATTERNS) {
    const found = p.match(url);
    if (found) return found;
  }
  return null;
}
