// The dial in other apps (programming Phase 5): `GET /v1/iptv/channels.m3u` and `GET
// /v1/iptv/xmltv.xml` (and `.xml.gz`). Public, cached, read-only, and not JSON, so they're mounted
// on the router as files (like previews), not from the contracts. Both take `?market=` (a market's
// slug) and `?band=tv|radio`, answer `If-None-Match` with a 304, and send CORS `*`.

import type { Request, Response } from "express";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";
import { badRequest } from "../../errors.js";
import { IPTV_CACHE_MS, type IptvFile, type IptvFilter } from "./service.js";

function filterOf(req: Request): IptvFilter {
  const { market, band } = req.query;
  if (band !== undefined && band !== "tv" && band !== "radio") throw badRequest("The band is tv or radio.");
  if (market !== undefined && (typeof market !== "string" || !/^[a-z0-9-]{1,80}$/.test(market))) throw badRequest("Choose a market by its slug.");
  return { ...(market ? { market } : {}), ...(band ? { band } : {}) };
}

/** Where the request came in, for full URLs when the API has no public origin set (development). */
function originOf(req: Request): string {
  const proto = String(req.headers["x-forwarded-proto"] ?? req.protocol).split(",")[0].trim() || "http";
  return `${proto}://${req.get("host") ?? "localhost"}`;
}

/** An ETag match (a list, or `*`; a weak one matches too). */
function matches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((t) => {
    const tag = t.trim().replace(/^W\//, "");
    return tag === "*" || tag === etag;
  });
}

function send(req: Request, res: Response, file: IptvFile, type: string, encoding: "gzip-file" | "negotiate" | "plain") {
  const gzipped = encoding === "gzip-file" || (encoding === "negotiate" && Boolean(file.gzip) && /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? "")));
  // The gzipped bytes are another representation: their own tag.
  const etag = encoding === "gzip-file" ? file.etag.replace(/"$/, '-gz"') : file.etag;
  res.set({
    "content-type": type,
    "access-control-allow-origin": "*",
    "cache-control": `public, max-age=${IPTV_CACHE_MS / 1000}`,
    etag,
    ...(encoding === "negotiate" ? { vary: "Accept-Encoding" } : {})
  });
  if (matches(req.headers["if-none-match"], etag)) return void res.status(304).end();
  if (encoding === "gzip-file") return void res.send(file.gzip);
  if (gzipped) return void res.set("content-encoding", "gzip").send(file.gzip);
  res.send(file.body);
}

export function iptvRoutes(r: RouteRegistrar, { services }: ModuleContext) {
  r.router.get("/iptv/channels.m3u", async (req, res, next) => {
    try {
      send(req, res, await services.iptv.channelList(filterOf(req), originOf(req)), "audio/x-mpegurl; charset=utf-8", "plain");
    } catch (error) {
      next(error);
    }
  });
  r.router.get("/iptv/xmltv.xml", async (req, res, next) => {
    try {
      send(req, res, await services.iptv.guide(filterOf(req), originOf(req)), "application/xml; charset=utf-8", "negotiate");
    } catch (error) {
      next(error);
    }
  });
  r.router.get("/iptv/xmltv.xml.gz", async (req, res, next) => {
    try {
      send(req, res, await services.iptv.guide(filterOf(req), originOf(req)), "application/gzip", "gzip-file");
    } catch (error) {
      next(error);
    }
  });
}
