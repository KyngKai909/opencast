// A station's page and a program's page (and, passing through, reminders on the week's airings).

import { http } from "msw";
import { accountsApi, libraryApi, stationsApi } from "@opencast/contracts";
import { ProgramPageX, StationPageFull, type EpisodeX, type WhereToWatch } from "../../api/ext/station";
import { now } from "../../lib/clock";
import { type MockAiring } from "../fixtures/schedule";
import { PROGRAM_EXTRA, STATION_EXTRA, atDay, outsideIdent, programById, programByKey, registerReminded, weekAirings } from "../fixtures/station";
import { STATIONS, inMarket, playbackFor, stationById, stationByRef } from "../fixtures/stations";
import { syncStreamSignOff } from "../fixtures/signoff";
import { fail, path, reply } from "../respond";
import { airingX, identX } from "../view";
import { hiddenExternal } from "../external";

function nowNextIn(list: MockAiring[], t: string) {
  return { now: list.find((x) => x.start <= t && t < x.end) ?? null, next: list.find((x) => x.start > t) ?? null };
}

/** The station page (S5 to S8). `from`/`to` choose the schedule's range; without them, the next day. */
export function stationPage(ref: string, from?: string | null, to?: string | null) {
  const s = stationByRef(ref);
  if (!s) return null;
  const t = now();
  const iso = t.toISOString();
  const mine = weekAirings().filter((a) => a.stationId === s.ident.id);
  const nn = nowNextIn(mine, iso);
  const x = STATION_EXTRA[s.ident.callSign ?? ""] ?? {};
  const listed = s.ident.kind === "listed";
  const down = hiddenExternal(s.ident.id, t);
  const lo = from ?? new Date(t.getTime() - 12 * 3600e3).toISOString();
  const hi = to ?? new Date(t.getTime() + 24 * 3600e3).toISOString();
  const programs = [...new Set(mine.map((a) => a.programId).filter(Boolean))]
    .map((id) => programById(id!))
    .filter((p): p is NonNullable<typeof p> => !!p && p.maker === s.ident.callSign)
    .map((p) => ({ id: p.id, title: p.title, description: p.description, live: !!p.live }));
  const members = listed ? undefined : s.members;
  return {
    station: identX(s),
    description: x.line ?? s.description,
    // Planned off air (G9) is its `off_air` airing on now: not on air. An external station is on
    // while its stream is up, whatever its schedule says (follow-up Phase 6).
    onAir: s.external ? !down : !!nn.now && !nn.now.offAir,
    now: nn.now ? airingX(nn.now) : null,
    upNext: mine.filter((a) => a.start > iso).slice(0, 3).map(airingX),
    programs,
    claimable: s.ident.kind === "claimable" ? { runFor: "Marcus Reyes", claimed: false, escrowContract: "0x5ee2000000000000000000000000000000a41d", escrowStationId: 101 } : null,
    pledgesTaxDeductible: s.ident.callSign === "CIVC" ? true : null,
    playback: s.external ? (down ? null : playbackFor(s)) : nn.now && !nn.now.offAir ? playbackFor(s) : null,
    ...(s.external ? { external: { ...s.external, down } } : {}),
    about: x.about ?? s.about ?? null,
    members,
    onDialSince: x.onDialSince ?? s.onDialSince ?? null,
    hours: s.hours ?? null,
    schedule: mine.filter((a) => a.end > lo && a.start < hi).map(airingX),
    // A listed city stream carries nothing and makes nothing for others: Opencast only lists it.
    carries: listed
      ? []
      : (x.carries ?? []).map((c) => {
          const from = stationByRef(c.from)!;
          const p = programByKey(c.program);
          return { from: identX(from), program: { id: p?.id ?? null, title: p?.title ?? c.program }, slot: c.slot };
        }),
    madeHere: listed ? [] : (x.madeHere ?? []).map((m) => ({ program: { id: programByKey(m.program)!.id, title: programByKey(m.program)!.title }, carriers: m.carriers })),
    madePossibleBy: [...(members ? [{ kind: "members" as const, text: `Members of ${s.ident.name}` }] : []), ...(x.underwriters ?? []).map((text) => ({ kind: "underwriter" as const, text }))]
  };
}

/** The program page (L1 to L4), for a market. */
export function programPage(programId: string, market: string | null) {
  const p = programById(programId);
  if (!p) return null;
  const key = Object.entries(PROGRAM_EXTRA).find(([k]) => programByKey(k)?.id === p.id)?.[0];
  const x = key ? PROGRAM_EXTRA[key]! : {};
  const maker = stationByRef(p.maker)!;
  const t = now();
  const iso = t.toISOString();
  const all = weekAirings();
  const inMkt = market ? inMarket(market) : STATIONS;
  const byId = (cs: string) => stationByRef(cs)!;

  // Where to watch: the drawn slots, or every station in the market with an airing of it this week.
  let where: WhereToWatch[];
  if (x.where) {
    where = x.where
      .map((w) => byId(w.cs))
      .filter((s) => inMkt.includes(s))
      .map((s) => {
        const w = x.where!.find((y) => y.cs === s.ident.callSign)!;
        const list = all.filter((a) => a.stationId === s.ident.id && (w.allDay || a.programId === p.id));
        const nn = nowNextIn(list, iso);
        return { station: identX(s), slot: w.slot, now: nn.now ? airingX(nn.now) : null, next: nn.next ? airingX(nn.next) : null };
      });
  } else {
    where = inMkt.flatMap((s) => {
      const list = all.filter((a) => a.stationId === s.ident.id && a.programId === p.id);
      const nn = nowNextIn(list, iso);
      return nn.now || nn.next ? [{ station: identX(s), slot: null, now: nn.now ? airingX(nn.now) : null, next: nn.next ? airingX(nn.next) : null }] : [];
    });
  }

  const atStation = (cs: string, pick: (list: MockAiring[]) => MockAiring | undefined) => {
    const s = byId(cs);
    const a = pick(all.filter((y) => y.stationId === s.ident.id));
    return a ? { station: identX(s), airing: airingX(a) } : null;
  };
  const episodes: EpisodeX[] = (x.episodes ?? []).map((e) => ({
    id: `${p.id.slice(0, -4)}${String(e.n).padStart(4, "0")}`,
    title: e.title,
    episodeNumber: e.n,
    durationMs: x.typicalLengthMs ?? null,
    description: null,
    aired: !!e.aired,
    lastAiring: e.last ? atStation(e.last.cs, (l) => l.find((a) => a.start === atDay(e.last!.day, e.last!.at))) : null,
    onNow: e.onNow ? atStation(e.onNow.cs, (l) => l.find((a) => a.start <= iso && iso < a.end)) : null,
    nextAiring: e.next ? atStation(e.next.cs, (l) => l.find((a) => a.title === e.next!.title && a.start > iso && a.start.slice(0, 10) >= atDay(e.next!.day, "00:00").slice(0, 10))) : null
  }));

  const madeHere = STATION_EXTRA[p.maker]?.madeHere?.find((m) => programByKey(m.program)?.id === p.id);
  const outside = x.carriers?.outside ?? [];
  const carriers = x.carriers
    ? { total: x.carriers.total, outsideMarket: outside.length, outside: outside.map((c, i) => ({ station: stationByRef(c.callSign) ? identX(stationByRef(c.callSign)!) : outsideIdent(c, i), market: c.market })) }
    : madeHere
      ? { total: madeHere.carriers, outsideMarket: Math.max(0, madeHere.carriers - where.length), outside: [] }
      : undefined;

  return {
    id: p.id,
    station: identX(maker),
    title: p.title,
    description: x.description ?? p.description,
    category: p.category,
    advisory: "none" as const,
    live: !!p.live,
    attribution: null,
    rightsNote: x.rightsNote ?? null,
    episodeCount: episodes.length,
    listingStatus: "complete" as const,
    episodes,
    upcoming: all
      .filter((a) => a.programId === p.id && a.start > iso && !a.listed)
      .slice(0, 10)
      .map((a) => ({ logEntryId: a.id, startsAt: a.start, station: stationById(a.stationId)!.ident })),
    typicalLengthMs: x.typicalLengthMs ?? null,
    carriers,
    whereToWatch: where,
    airedCount: episodes.filter((e) => e.aired || e.onNow).length
  };
}

export const stationHandlers = [
  http.get(path(stationsApi.getStation), async ({ params, request }) => {
    await syncStreamSignOff();
    const q = new URL(request.url).searchParams;
    const page = stationPage(String(params.stationRef), q.get("from"), q.get("to"));
    return page ? reply(StationPageFull, page) : fail(404, "not_found", "That station wasn't found.");
  }),

  http.get(path(libraryApi.getProgram), ({ params, request }) => {
    const page = programPage(String(params.programId), new URL(request.url).searchParams.get("market"));
    return page ? reply(ProgramPageX, page) : fail(404, "not_found", "That program wasn't found.");
  }),

  // A reminder on one of the week's airings: add it to the shared schedule, then let the account's
  // handler (me.ts) take the request. Returning nothing passes it on.
  http.post(path(accountsApi.addReminder), async ({ request }) => {
    const body = (await request.clone().json().catch(() => null)) as { logEntryId?: string; listedAiringId?: string } | null;
    registerReminded([body?.logEntryId, body?.listedAiringId]);
  }),
  http.post(path(accountsApi.mergeDevice), async ({ request }) => {
    const body = (await request.clone().json().catch(() => null)) as { reminders?: Array<{ logEntryId?: string; listedAiringId?: string }> } | null;
    registerReminded((body?.reminders ?? []).flatMap((r) => [r.logEntryId, r.listedAiringId]));
  })
];
