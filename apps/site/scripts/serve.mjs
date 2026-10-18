// The site's production server: serves apps/site/dist with clean URLs (/run → run/index.html,
// /run/ → 301 /run), SITE-SPEC §1's redirects as 301s, the 404 page, long cache headers on hashed
// assets and short ones on HTML, gzip, and security headers with a CSP that allows only the site's
// own origin and PUBLIC_API_URL. No dependencies. Run: `node scripts/serve.mjs` (PORT, default 8080).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const DIST = resolve(process.env.DIST ?? fileURLToPath(new URL("../dist", import.meta.url)));
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";

/** SITE-SPEC §1. */
const REDIRECTS = { "/spot-market": "/spots", "/about": "/network", "/stations": "/run" };

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff"
};
const COMPRESS = new Set([".html", ".js", ".css", ".json", ".webmanifest", ".xml", ".txt", ".svg"]);

function apiOrigin() {
  try {
    return process.env.PUBLIC_API_URL ? new URL(process.env.PUBLIC_API_URL).origin : "";
  } catch {
    return "";
  }
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Grid spans and station colours are inline style attributes.
  "style-src 'self' 'unsafe-inline'",
  // The grain is a canvas turned into a data: URL.
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${apiOrigin() ? ` ${apiOrigin()}` : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'"
].join("; ");

const SECURITY = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains"
};

const cacheFor = (path) => (path.startsWith("/_astro/") ? "public, max-age=31536000, immutable" : extname(path) === ".html" ? "public, max-age=60, must-revalidate" : "public, max-age=86400");

/** In-memory copies, gzipped once. dist doesn't change while the server runs. */
const memo = new Map();
async function load(file) {
  if (memo.has(file)) return memo.get(file);
  const body = await readFile(file);
  const ext = extname(file);
  const entry = { body, gz: COMPRESS.has(ext) && body.length > 1024 ? gzipSync(body) : null, type: TYPES[ext] ?? "application/octet-stream" };
  memo.set(file, entry);
  return entry;
}

async function isFile(p) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

/** A URL path to a file in dist, or null. */
async function resolveFile(path) {
  const safe = normalize(decodeURIComponent(path)).replace(/^(\.\.[/\\])+/, "");
  const base = join(DIST, safe);
  if (!base.startsWith(DIST)) return null;
  if (extname(safe) && (await isFile(base))) return base;
  if (await isFile(join(base, "index.html"))) return join(base, "index.html");
  if (await isFile(`${base}.html`)) return `${base}.html`;
  return null;
}

async function send(req, res, status, file, path) {
  const f = await load(file);
  const gz = f.gz && /\bgzip\b/.test(req.headers["accept-encoding"] ?? "");
  res.writeHead(status, {
    ...SECURITY,
    "Content-Type": f.type,
    "Cache-Control": status === 404 ? "no-store" : cacheFor(path),
    Vary: "Accept-Encoding",
    ...(gz ? { "Content-Encoding": "gzip" } : {}),
    "Content-Length": (gz ? f.gz : f.body).length
  });
  res.end(req.method === "HEAD" ? undefined : gz ? f.gz : f.body);
}

const server = createServer(async (req, res) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { ...SECURITY, Allow: "GET, HEAD" });
      return res.end();
    }
    const url = new URL(req.url ?? "/", "http://site");
    let path = url.pathname;
    if (path === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
      return res.end("ok");
    }
    const target = REDIRECTS[path.replace(/\/$/, "")];
    if (target) {
      res.writeHead(301, { ...SECURITY, Location: target + url.search, "Cache-Control": "public, max-age=3600" });
      return res.end();
    }
    // Clean URLs: no trailing slash, no .html.
    if (path.length > 1 && (path.endsWith("/") || path.endsWith(".html"))) {
      const clean = path.replace(/\/index\.html$|\.html$|\/$/, "") || "/";
      if (clean !== path && (await resolveFile(clean))) {
        res.writeHead(301, { ...SECURITY, Location: clean + url.search });
        return res.end();
      }
    }
    const file = await resolveFile(path);
    if (file) return send(req, res, 200, file, file.endsWith(".html") ? "/page.html" : path);
    return send(req, res, 404, join(DIST, "404.html"), "/404.html");
  } catch (e) {
    console.error(e);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Server error");
  }
});

server.listen(PORT, HOST, () => console.log(`Dial site on http://${HOST}:${PORT} (dist: ${DIST})`));
