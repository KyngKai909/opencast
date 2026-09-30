// Markets and the dial (home, the radio band, first visit, thin markets).

import { http } from "msw";
import { stationsApi } from "@opencast/contracts";
import { DialX, MarketsX, type DialRowX } from "../../api/ext";
import { milesApart } from "../../components/home/logic";
import { now } from "../../../lib/clock";
import { AIRINGS, PROGRAMS } from "../fixtures/schedule";
import { MARKETS, STATIONS, ZIPS, inMarket, stationByRef, type MockStation } from "../fixtures/stations";
import { carriedPick, homeAirings, homeNowNext } from "../fixtures/home";
import { path, reply, fail } from "../respond";
import { syncStreamSignOff } from "../fixtures/signoff";
import { airingX, identX, marketOf, milesBetween, rowOf } from "../view";
import { offTheDial } from "../external";

const THIN = 3; // Fewer stations than this and the dial shows the nearest market too.

/** A dial row from home's schedule (the shared one, plus the radio rows' lines and late airings). */
function dialRow(s: MockStation, t: Date): DialRowX {
  return rowOf(s, homeNowNext(s.ident.id, t));
}

export const dialHandlers = [
  http.get(path(stationsApi.listMarkets), () => reply(MarketsX, MARKETS.map(({ lat: _lat, lng: _lng, ...m }) => m))),

  // S10, "Use my location": the nearest market within 50 miles of its centre (open or not), and the
  // others within 60 miles, nearest first; nothing that close, the open markets by distance.
  http.get(path(stationsApi.marketForLocation), ({ request }) => {
    const q = new URL(request.url).searchParams;
    const here = { lat: Number(q.get("lat")), lng: Number(q.get("lng")) };
    if (!Number.isFinite(here.lat) || !Number.isFinite(here.lng)) return fail(400, "bad_request", "Send lat and lng.");
    const by = MARKETS.map((m) => ({ slug: m.slug, open: m.open, miles: Math.round(milesApart(here, { lat: m.lat, lng: m.lng })) })).sort((a, b) => a.miles - b.miles);
    const near = by[0] && by[0].miles <= 50 ? by[0] : null;
    const nearby = (near ? by.slice(1).filter((m) => m.miles <= 60) : by.filter((m) => m.open)).map((m) => ({ market: marketOf(m.slug)!, miles: m.miles }));
    return reply(stationsApi.marketForLocation.response, { market: near ? marketOf(near.slug)! : null, nearby });
  }),

  http.get(path(stationsApi.marketForZip), ({ params }) => {
    const slug = ZIPS[String(params.zip)];
    const market = slug ? marketOf(slug) : null;
    const nearby = MARKETS.filter((m) => m.slug !== slug).map((m) => ({ market: marketOf(m.slug)!, miles: slug ? milesBetween(slug, m.slug) : 30 })).sort((a, b) => a.miles - b.miles).slice(0, 2);
    return reply(stationsApi.marketForZip.response, { market, nearby });
  }),

  http.get(path(stationsApi.getDial), async ({ params, request }) => {
    await syncStreamSignOff();
    const slug = String(params.marketSlug);
    const market = marketOf(slug);
    if (!market) return fail(404, "not_found", "That market wasn't found.");
    const band = (new URL(request.url).searchParams.get("band") ?? "tv") as "tv" | "radio";
    const t = now();
    // External stations down 5 minutes are off the dial (follow-up Phase 6).
    const onDial = (s: MockStation) => !offTheDial(s.ident.id, t);
    const rows = inMarket(slug, band).filter(onDial).map((s) => dialRow(s, t));
    const all = inMarket(slug);
    const thin = all.length < THIN;
    const nearest = MARKETS.filter((m) => m.slug !== slug).sort((a, b) => milesBetween(slug, a.slug) - milesBetween(slug, b.slug))[0];
    const nearby = thin && nearest ? [{ market: marketOf(nearest.slug)!, miles: milesBetween(slug, nearest.slug), rows: inMarket(nearest.slug, band).filter(onDial).map((s) => dialRow(s, t)) }] : [];

    // Carried widely: programs made here that other stations carry (counts are illustrations).
    const carriedCounts: Record<string, number> = { "saturday-reel": 12, "council-watch": 6, "producers-hour": 9, "night-desk": 4 };
    const carriedWidely = Object.entries(carriedCounts).flatMap(([key, carriers]) => {
      const p = PROGRAMS[key];
      const maker = stationByRef(p.maker);
      if (!maker || maker.ident.marketSlug !== slug) return [];
      const here = new Set(all.map((s) => s.ident.id));
      const airings = homeAirings().filter((a) => here.has(a.stationId) && (a.programId === p.id || (key === "night-desk" && a.stationId === maker.ident.id)));
      const pick = carriedPick(airings, t);
      const st = pick && STATIONS.find((s) => s.ident.id === pick.airing.stationId);
      return [{ program: { id: p.id, title: p.title }, maker: identX(maker), carriers, where: pick && st ? { station: identX(st), airing: airingX(pick.airing), onNow: pick.onNow } : null }];
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
    const openRadio = Array.from({ length: 99 }, (_, i) => ((882 + i * 2) / 10).toFixed(1)).filter((c) => !takenRadio.has(c));

    return reply(DialX, { market, band, rows, nearby, carriedWidely, comingUpLive, openChannels: { tv: openTv, radio: openRadio } });
  })
];
