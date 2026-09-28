// Markets and the dial (home, the radio band, first visit, thin markets).

import { http } from "msw";
import { stationsApi } from "@opencast/contracts";
import { DialX, MarketsX } from "../../api/ext";
import { now } from "../../lib/clock";
import { AIRINGS, PROGRAMS, nowNext } from "../fixtures/schedule";
import { MARKETS, STATIONS, ZIPS, inMarket, stationByRef } from "../fixtures/stations";
import { path, reply, fail } from "../respond";
import { airingX, dialRow, identX, marketOf, milesBetween } from "../view";

const THIN = 3; // Fewer stations than this and the dial shows the nearest market too.

export const dialHandlers = [
  http.get(path(stationsApi.listMarkets), () => reply(MarketsX, MARKETS.map(({ lat: _a, lng: _b, ...m }) => m))),

  http.get(path(stationsApi.marketForZip), ({ params }) => {
    const slug = ZIPS[String(params.zip)];
    const market = slug ? marketOf(slug) : null;
    const nearby = MARKETS.filter((m) => m.slug !== slug).map((m) => ({ market: marketOf(m.slug)!, miles: slug ? milesBetween(slug, m.slug) : 30 })).sort((a, b) => a.miles - b.miles).slice(0, 2);
    return reply(stationsApi.marketForZip.response, { market, nearby });
  }),

  http.get(path(stationsApi.getDial), ({ params, request }) => {
    const slug = String(params.marketSlug);
    const market = marketOf(slug);
    if (!market) return fail(404, "not_found", "That market wasn't found.");
    const band = (new URL(request.url).searchParams.get("band") ?? "tv") as "tv" | "radio";
    const t = now();
    const rows = inMarket(slug, band).map((s) => dialRow(s, t));
    const all = inMarket(slug);
    const thin = all.length < THIN;
    const nearest = MARKETS.filter((m) => m.slug !== slug).sort((a, b) => milesBetween(slug, a.slug) - milesBetween(slug, b.slug))[0];
    const nearby = thin && nearest ? [{ market: marketOf(nearest.slug)!, miles: milesBetween(slug, nearest.slug), rows: inMarket(nearest.slug, band).map((s) => dialRow(s, t)) }] : [];

    // Carried widely: programs made here that other stations carry (counts are illustrations).
    const carriedCounts: Record<string, number> = { "saturday-reel": 12, "council-watch": 6, "producers-hour": 9, "night-desk": 4 };
    const carriedWidely = Object.entries(carriedCounts).flatMap(([key, carriers]) => {
      const p = PROGRAMS[key];
      const maker = stationByRef(p.maker);
      if (!maker || maker.ident.marketSlug !== slug) return [];
      const airings = AIRINGS.filter((a) => a.programId === p.id || (key === "night-desk" && a.stationId === maker.ident.id)).filter((a) => a.end > t.toISOString()).sort((x, y) => x.start.localeCompare(y.start));
      const nowing = airings.find((a) => a.start <= t.toISOString());
      const pick = nowing ?? airings[0];
      const st = pick && STATIONS.find((s) => s.ident.id === pick.stationId);
      return [{ program: { id: p.id, title: p.title }, maker: identX(maker), carriers, where: pick && st ? { station: identX(st), airing: airingX(pick), onNow: !!nowing } : null }];
    });

    // Coming up live: live airings in this market from now, past the guide's day.
    const comingUpLive = AIRINGS.filter((a) => a.live && a.start > t.toISOString())
      .map((a) => ({ a, s: STATIONS.find((s) => s.ident.id === a.stationId)! }))
      .filter(({ s }) => s.ident.marketSlug === slug)
      .sort((x, y) => x.a.start.localeCompare(y.a.start))
      .slice(0, 5)
      .map(({ a, s }) => ({ station: identX(s), airing: airingX(a), listed: !!a.listed }));

    const takenTv = new Set(inMarket(slug, "tv").map((s) => s.ident.channel!.split(".")[0]));
    const openTv = Array.from({ length: 68 }, (_, i) => String(i + 2)).filter((c) => !takenTv.has(c));
    const takenRadio = new Set(inMarket(slug, "radio").map((s) => s.ident.channel!));
    const openRadio = Array.from({ length: 100 }, (_, i) => (88.1 + i * 0.2).toFixed(1)).filter((c) => !takenRadio.has(c));

    void nowNext;
    return reply(DialX, { market, band, rows, nearby, carriedWidely, comingUpLive, openChannels: { tv: openTv, radio: openRadio } });
  })
];
