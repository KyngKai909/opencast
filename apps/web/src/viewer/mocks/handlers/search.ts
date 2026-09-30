// Search: a channel or frequency tunes; a call sign, name or what a station is finds the station;
// anything else finds programs, airing next first (what's on now comes first), with your market's
// own before carried copies elsewhere. The rules are search's own (components/search/searchLogic).

import { http } from "msw";
import { stationsApi } from "@opencast/contracts";
import { SearchFull } from "../../api/ext/station";
import { matchChannel, numberQuery, orderAirings } from "../../components/search/searchLogic";
import { channelValue } from "../../components/station/when";
import { now } from "../../../lib/clock";
import { extraOf, programById, weekAirings } from "../fixtures/station";
import { STATIONS, stationById } from "../fixtures/stations";
import { path, reply } from "../respond";
import { airingX, identX } from "../view";
import { offTheDial } from "../external";

/** At most this many programs. */
const PROGRAMS_MAX = 12;

export function searchResults(qRaw: string, market: string | null) {
  const q = qRaw.trim().toLowerCase();
  // External stations down 5 minutes aren't found (follow-up Phase 6).
  const inMkt = STATIONS.filter((s) => (!market || s.ident.marketSlug === market) && !offTheDial(s.ident.id));
  const m = matchChannel(q, inMkt.map((s) => s.ident.channel ?? ""));
  const tuneTo = m?.found ? identX(inMkt.find((s) => s.ident.channel === m.channel)!) : null;

  const lineOf = (s: (typeof STATIONS)[number]) => extraOf(s.ident)?.searchLine ?? `${s.category}. ${s.description.replace(/\.$/, "")}`;
  const stations = inMkt
    .filter((s) => [s.ident.callSign, s.ident.name, s.ident.handle, s.category, lineOf(s), s.description].some((v) => v?.toLowerCase().includes(q)) || (s.ident.channel ?? "").startsWith(q))
    .sort((a, b) => channelValue(a.ident.channel) - channelValue(b.ident.channel))
    .map((s) => ({ ...identX(s), description: lineOf(s) }));

  const t = now();
  const iso = t.toISOString();
  const seen = new Set<string>();
  // A number is a channel first: it finds programs only by a name that starts with it ("24 Hours",
  // not "Planning Commission, Sept 24").
  const numeric = numberQuery(q) !== null;
  const hits = weekAirings()
    .filter((a) => a.end > iso && !offTheDial(a.stationId))
    .filter((a) => {
      const p = a.programId ? programById(a.programId) : undefined;
      if (numeric) return !!p?.title.toLowerCase().startsWith(q) || a.title.toLowerCase().startsWith(q);
      return a.title.toLowerCase().includes(q) || !!p?.title.toLowerCase().includes(q);
    })
    .map((a) => {
      const s = stationById(a.stationId)!;
      const p = a.programId ? programById(a.programId) : undefined;
      return { station: identX(s), airing: airingX(a), listed: !!a.listed, program: p ? { id: p.id, title: p.title } : null };
    });
  // The next airing of each program on each station, not every repeat.
  const airings = orderAirings(hits, t, market)
    .filter((r) => {
      const k = `${r.station.id}:${r.program?.id ?? r.airing.title}`;
      return seen.has(k) ? false : (seen.add(k), true);
    })
    .slice(0, PROGRAMS_MAX);
  return { tuneTo, stations, airings };
}

export const searchHandlers = [
  http.get(path(stationsApi.search), ({ request }) => {
    const u = new URL(request.url);
    return reply(SearchFull, searchResults(u.searchParams.get("q") ?? "", u.searchParams.get("market")));
  })
];
