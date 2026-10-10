// The dial in other apps (programming Phase 5): every Opencast station on the air as a channel list
// (M3U) and a guide (XMLTV), public, cached and read-only, so TiviMate, Jellyfin, Channels DVR, Kodi
// and VLC can tune Opencast. Independent, claimable and catalog stations; never External stations
// (their permission covers Opencast's own apps only) or waitlist numbers (they're not stations).
//
// There's no "log publish" to rebuild on: log rows are public as soon as they're written. So each
// file is built when asked for and kept a minute, with an ETag from its bytes (docs/open-decisions.md,
// programming Phase 5). This module owns no tables: everything comes through the other services.

import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { Band, Market } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import { notFound } from "../../errors.js";
import { publicUrl } from "../../lib/url.js";
import { episodeNumOf, foldBreaks, offAirDesc, ratingOf, writeM3u, writeXmltv, type IptvChannel, type IptvProgramme } from "./format.js";

/** The guide reaches back two hours and seven days ahead. */
export const GUIDE_BACK_MS = 2 * 3_600_000;
export const GUIDE_AHEAD_MS = 7 * 86_400_000;
/** How long a built file is kept. */
export const IPTV_CACHE_MS = 60_000;
/** Station kinds in the channel list: independent, claimable and the catalog station. */
const KINDS = ["station", "claimable", "catalog"] as const;

export interface IptvFilter {
  /** A market's slug. */
  market?: string;
  band?: Band;
}

export interface IptvFile {
  body: string;
  /** The guide's, gzipped once (`.xml.gz`, and `.xml` to an app that takes gzip). */
  gzip?: Buffer;
  etag: string;
}

export interface IptvService {
  /** The stations in the channel list, in market, band and channel order. 404 for a market that doesn't exist. */
  channels(filter: IptvFilter, origin: string): Promise<IptvChannel[]>;
  /** `channels.m3u`. `origin` makes paths full URLs when the API has no public origin set (development). */
  channelList(filter: IptvFilter, origin: string): Promise<IptvFile>;
  /** `xmltv.xml`. */
  guide(filter: IptvFilter, origin: string): Promise<IptvFile>;
}

/** `"…"`, from the bytes. */
export function etagOf(body: string | Buffer): string {
  return `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"`;
}

/** Dial order: 2.1 before 12.1 before 12.2. */
function dialOrder(a: string, b: string): number {
  const [am, an] = a.split(".").map(Number);
  const [bm, bn] = b.split(".").map(Number);
  return am - bm || an - bn;
}

export function createIptvService({ deps, services }: ModuleContext): IptvService {
  const cache = new Map<string, { at: number; value: IptvFile }>();

  const full = (origin: string, path: string) => {
    const url = publicUrl(deps, path);
    return url.startsWith("/") ? `${origin.replace(/\/+$/, "")}${url}` : url;
  };

  async function cached(kind: string, filter: IptvFilter, origin: string, build: () => Promise<IptvFile>): Promise<IptvFile> {
    // The request's origin is only in the file when the API has no public origin of its own.
    const key = `${kind}|${filter.market ?? ""}|${filter.band ?? ""}|${full(origin, "/")}`;
    const now = deps.clock.now().getTime();
    const hit = cache.get(key);
    if (hit && Math.abs(now - hit.at) < IPTV_CACHE_MS) return hit.value;
    const value = await build();
    if (cache.size > 500) cache.clear();
    cache.set(key, { at: now, value });
    return value;
  }

  const service: IptvService = {
    async channels(filter, origin) {
      let market: Market | null = null;
      if (filter.market) {
        market = await services.network.marketBySlug(filter.market);
        if (!market) throw notFound("That market");
      }
      const ids = await services.stations.idsOfKinds([...KINDS]);
      const [profiles, onAir] = await Promise.all([services.stations.profiles(ids), services.playout.onAirStations()]);
      const live = new Set(onAir);
      // On the air: signed on (not off the air or signed off for good) and playing out, with a number on the dial.
      const here = [...profiles.values()].filter(
        (p) =>
          p.public &&
          p.status === "on_air" &&
          live.has(p.id) &&
          p.ident.channel &&
          p.ident.band &&
          p.marketId &&
          (!market || p.marketId === market.id) &&
          (!filter.band || p.ident.band === filter.band)
      );
      const [markets, marks] = await Promise.all([services.network.marketsByIds(here.map((p) => p.marketId!)), services.stations.marks(here.map((p) => p.id))]);
      return here
        .flatMap((p): IptvChannel[] => {
          const m = markets.get(p.marketId!);
          if (!m) return [];
          const mark = marks.get(p.id);
          return [
            {
              tvgId: `${p.id}.opencast`,
              number: p.ident.channel!,
              callSign: p.ident.callSign,
              name: p.ident.name,
              band: p.ident.band!,
              market: { slug: m.slug, name: m.name, timezone: m.timezone },
              logo: mark ? full(origin, mark) : null,
              stream: `${full(origin, `/hls/${p.id}/master.m3u8`)}?via=iptv`
            }
          ];
        })
        .sort((a, b) => a.market.name.localeCompare(b.market.name) || (a.band === b.band ? 0 : a.band === "tv" ? -1 : 1) || dialOrder(a.number, b.number));
    },

    async channelList(filter, origin) {
      return cached("m3u", filter, origin, async () => {
        const channels = await service.channels(filter, origin);
        const query = new URLSearchParams({ ...(filter.market ? { market: filter.market } : {}), ...(filter.band ? { band: filter.band } : {}) }).toString();
        const body = writeM3u(channels, `${full(origin, "/v1/iptv/xmltv.xml")}${query ? `?${query}` : ""}`);
        return { body, etag: etagOf(body) };
      });
    },

    async guide(filter, origin) {
      return cached("xmltv", filter, origin, async () => {
        const now = deps.clock.now();
        const from = new Date(now.getTime() - GUIDE_BACK_MS);
        const to = new Date(now.getTime() + GUIDE_AHEAD_MS);
        const channels = await service.channels(filter, origin);
        const stationOf = new Map(channels.map((c) => [c.tvgId, c.tvgId.replace(/\.opencast$/, "")]));
        const feed = await services.log.feed([...stationOf.values()], from, to);
        const airings = [...feed.values()].flat();
        const [items, programs] = await Promise.all([
          services.library.itemsByIds(airings.map((a) => a.itemId).filter((v): v is string => Boolean(v))),
          services.library.programsByIds(airings.map((a) => a.programId).filter((v): v is string => Boolean(v)))
        ]);
        // A first airing: the item has never aired before (the as-run log, through playout), and this is
        // its earliest airing here. One that started airing in the last two hours is still new.
        const first = await services.playout.firstAired([...items.keys()]);
        const earliest = new Map<string, number>();
        for (const a of airings) {
          if (a.itemId && a.kind === "program") earliest.set(a.itemId, Math.min(earliest.get(a.itemId) ?? Infinity, Date.parse(a.startsAt)));
        }

        const programmes = new Map<string, IptvProgramme[]>();
        for (const c of channels) {
          const rows = (feed.get(stationOf.get(c.tvgId)!) ?? []).map((a) => {
            const start = new Date(a.startsAt);
            const stop = new Date(a.endsAt);
            const offAir = a.kind === "off_air";
            const item = a.itemId ? items.get(a.itemId) : undefined;
            const program = a.programId ? programs.get(a.programId) : undefined;
            const aired = a.itemId ? first.get(a.itemId) : undefined;
            const programme: IptvProgramme & { fold: boolean; offAir: boolean } = offAir
              ? { start, stop, title: "Off air", subTitle: null, desc: offAirDesc(start, new Date(a.backAt ?? a.endsAt), c.market.timezone), categories: [], episodeNum: null, live: false, isNew: false, rating: null, fold: false, offAir }
              : {
                  start,
                  stop,
                  title: a.title,
                  subTitle: a.episodeTitle,
                  desc: a.episodeDescription ?? program?.description ?? null,
                  categories: program?.category ? [program.category] : [],
                  episodeNum: episodeNumOf(item ?? null),
                  live: a.live || Boolean(program?.live),
                  isNew: Boolean(a.itemId && a.kind === "program" && earliest.get(a.itemId) === start.getTime() && (!aired || aired.startedAt.getTime() >= start.getTime() - 60_000)),
                  rating: ratingOf(program ?? null),
                  // A break's own entries on the log (spots, bumpers, station IDs, underwriting) fold into the program around them.
                  fold: a.kind === "program" && a.code !== "PGM",
                  offAir
                };
            return programme;
          });
          programmes.set(
            c.tvgId,
            foldBreaks(rows)
              .filter((p) => p.stop.getTime() > from.getTime() && p.start.getTime() < to.getTime())
              .map(({ fold: _fold, offAir: _offAir, ...p }) => p)
          );
        }
        const body = writeXmltv({ channels, programmes, generatedAt: now, sourceUrl: deps.config.appOrigin });
        return { body, gzip: gzipSync(body), etag: etagOf(body) };
      });
    }
  };
  return service;
}
