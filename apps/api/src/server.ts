import { gzipSync } from "node:zlib";
import fsSync from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import { API_PORT, STORAGE_ROOT, HLS_ROOT, UPLOAD_ROOT, WEB_DIST_DIR, WEB_ORIGIN } from "./config.js";
import { bootV1 } from "./v1/boot.js";
import { checkoutWebhookHandler, webhookHandler } from "./v1/webhooks.js";

const app = express();
// The API (mounted at /v1 below).
const v1 = bootV1(process.env, STORAGE_ROOT);

function addCorsOriginWithAliases(input: string, allowed: Set<string>) {
  const trimmed = input.trim();
  if (!trimmed) {
    return;
  }
  try {
    const base = new URL(trimmed);
    allowed.add(base.origin);
    if (base.hostname === "localhost") {
      const alias = new URL(trimmed);
      alias.hostname = "127.0.0.1";
      allowed.add(alias.origin);
    } else if (base.hostname === "127.0.0.1") {
      const alias = new URL(trimmed);
      alias.hostname = "localhost";
      allowed.add(alias.origin);
    }
  } catch {
    allowed.add(trimmed);
  }
}

function allowedCorsOrigins(): { allowAnyOrigin: boolean; allowedOrigins: Set<string> } {
  const allowed = new Set<string>();
  const configured = WEB_ORIGIN.trim();
  if (!configured || configured === "*") {
    return { allowAnyOrigin: true, allowedOrigins: allowed };
  }

  let allowAnyOrigin = false;
  for (const origin of configured.split(",")) {
    const trimmed = origin.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed === "*") {
      allowAnyOrigin = true;
      continue;
    }
    addCorsOriginWithAliases(trimmed, allowed);
  }

  return { allowAnyOrigin, allowedOrigins: allowed };
}

const corsConfig = allowedCorsOrigins();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || corsConfig.allowAnyOrigin || corsConfig.allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS.`));
    }
  })
);
// Provider webhooks (Stripe, Clear) need the raw body to check the signature, so they come first.
app.post("/v1/webhooks/checkout/:hookToken", ...checkoutWebhookHandler(v1.deps, v1.services));
app.post("/v1/webhooks/:provider", ...webhookHandler(v1.deps, v1.services));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// A channel's playlists (prepare once, then assemble): master.m3u8 and one per rendition, rendered
// from its assembled timeline, with a short cache. Segments come from object storage.
app.get("/hls/:stationId/:file", async (req, res, next) => {
  // The subtitle rendition's empty segment (empty.vtt) is served here too (X2).
  if (!/^[0-9a-f-]{36}$/.test(req.params.stationId) || !/^([a-z0-9]+\.m3u8|empty\.vtt)$/.test(req.params.file)) return next();
  try {
    const playlist = await v1.services.playout.playlist(req.params.stationId, req.params.file);
    if (playlist === null) return next();
    res.setHeader("Content-Type", playlist.contentType ?? "application/vnd.apple.mpegurl");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", `public, max-age=${playlist.maxAge}`);
    res.setHeader("Vary", "Accept-Encoding");
    // A 30-minute window is tens of kilobytes of repetitive lines: gzip takes it to a few.
    if (/\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""))) {
      res.setHeader("Content-Encoding", "gzip");
      res.send(gzipSync(playlist.body));
    } else res.send(playlist.body);
  } catch (error) {
    next(error);
  }
});
// Prepared segments when object storage has no public domain (local disk, or R2 without one): passed through.
app.get("/hls/prepared/:key/:rendition/:file", async (req, res, next) => {
  const { key, rendition, file } = req.params;
  // A prepared item's own playlist too (index.m3u8: the library previews the generated station ID with it).
  if (!/^[\w-]+$/.test(key) || !/^[a-z0-9]+$/.test(rendition) || !/^(seg_\d{5}\.(ts|vtt)|index\.m3u8)$/.test(file) || !v1.deps.storage.objects.open) return next();
  try {
    const stream = await v1.deps.storage.objects.open(`prepared/${key}/${rendition}/${file}`);
    // Caption segments (X2) are WebVTT.
    res.setHeader("Content-Type", file.endsWith(".vtt") ? "text/vtt" : file.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  } catch {
    next();
  }
});

app.use(
  "/hls",
  express.static(HLS_ROOT, {
    setHeaders: (res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "no-store");
    }
  })
);
app.use("/uploads", express.static(UPLOAD_ROOT));
// Objects by content ID when storage is local disk (development); R2 serves its own in production.
app.use("/objects", express.static(path.join(STORAGE_ROOT, "objects"), { immutable: true, maxAge: "365d" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "opencast-api", at: new Date().toISOString() });
});

app.use("/v1", v1.router);

const serveWebApp = String(process.env.SERVE_WEB_APP ?? "true") !== "false";
const webIndexPath = path.join(WEB_DIST_DIR, "index.html");
if (serveWebApp && fsSync.existsSync(webIndexPath)) {
  app.use(express.static(WEB_DIST_DIR));
  app.get(/.*/, (req, res, next) => {
    if (req.method !== "GET") {
      return next();
    }

    if (
      req.path === "/api" ||
      req.path.startsWith("/v1/") ||
      req.path.startsWith("/api/") ||
      req.path.startsWith("/hls/") ||
      req.path.startsWith("/uploads/")
    ) {
      return next();
    }

    res.sendFile(webIndexPath);
  });
} else if (serveWebApp) {
  console.warn(`[api] Web dist not found at ${webIndexPath}; frontend static hosting disabled.`);
}

app.listen(API_PORT, () => {
  console.log(`Opencast API listening on port ${API_PORT}`);
  console.log(`Serving HLS output from ${HLS_ROOT}`);
  if (serveWebApp) {
    console.log(`Serving web build from ${WEB_DIST_DIR}`);
  }
});
