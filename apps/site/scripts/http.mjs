// How the site is served, in one place: SITE-SPEC §1's redirects, the security headers with a CSP
// that allows only the site's own origin and PUBLIC_API_URL, and the cache rules. Two hosts read
// it: scripts/serve.mjs (local production preview and the Playwright suite) and vercel.json, which
// scripts/vercel-json.mjs writes from it (Vercel hosts the site).

/** SITE-SPEC §1. */
export const REDIRECTS = { "/spot-market": "/spots", "/about": "/network", "/stations": "/run" };

/** The API's origin, or "" when the site runs on its mocks. */
export function apiOrigin(url = process.env.PUBLIC_API_URL) {
  try {
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
}

export function csp(origin = apiOrigin()) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    // Grid spans and station colours are inline style attributes.
    "style-src 'self' 'unsafe-inline'",
    // The grain is a canvas turned into a data: URL.
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${origin ? ` ${origin}` : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'"
  ].join("; ");
}

export function securityHeaders(origin = apiOrigin()) {
  return {
    "Content-Security-Policy": csp(origin),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains"
  };
}

/** Hashed assets for a year; pages for a minute, then checked; everything else a day. */
export const CACHE = {
  hashed: "public, max-age=31536000, immutable",
  page: "public, max-age=60, must-revalidate",
  other: "public, max-age=86400"
};
