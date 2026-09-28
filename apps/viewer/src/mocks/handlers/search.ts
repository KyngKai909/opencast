// Search: a channel or frequency tunes; a call sign or name finds the station; anything else
// finds programs, airing next first (what's on now comes first).

import { http } from "msw";
import { stationsApi } from "@opencast/contracts";
import { SearchX } from "../../api/ext";
import { now } from "../../lib/clock";
import { AIRINGS } from "../fixtures/schedule";
import { STATIONS } from "../fixtures/stations";
import { path, reply } from "../respond";
import { airingX, identX } from "../view";

export const searchHandlers = [
  http.get(path(stationsApi.search), ({ request }) => {
    const u = new URL(request.url);
    const q = (u.searchParams.get("q") ?? "").trim().toLowerCase();
    const market = u.searchParams.get("market");
    const inMkt = STATIONS.filter((s) => !market || s.ident.marketSlug === market);
    let tuneTo = null;
    if (/^\d{1,3}(\.\d)?$/.test(q)) {
      const want = q.includes(".") ? [q] : [`${q}.1`, q.length >= 3 ? `${q.slice(0, -1)}.${q.slice(-1)}` : ""];
      const hit = inMkt.find((s) => want.includes(s.ident.channel ?? ""));
      tuneTo = hit ? identX(hit) : null;
    }
    const stations = inMkt
      .filter((s) => [s.ident.callSign, s.ident.name, s.ident.handle].some((v) => v?.toLowerCase().includes(q)))
      .map((s) => ({ ...identX(s), description: s.description }));
    const t = now().toISOString();
    const airings = AIRINGS.filter((a) => a.end > t && a.title.toLowerCase().includes(q))
      .map((a) => ({ a, s: STATIONS.find((s) => s.ident.id === a.stationId)! }))
      .filter(({ s }) => !market || s.ident.marketSlug === market)
      .sort((x, y) => x.a.start.localeCompare(y.a.start))
      .slice(0, 20)
      .map(({ a, s }) => ({ station: identX(s), airing: airingX(a), listed: !!a.listed }));
    return reply(SearchX, { tuneTo, stations, airings });
  })
];
