// A station's page and a program's page.

import { http } from "msw";
import { libraryApi, stationsApi } from "@opencast/contracts";
import { StationPageX } from "../../api/ext";
import { now } from "../../lib/clock";
import { AIRINGS, PROGRAMS, airingsFor, nowNext } from "../fixtures/schedule";
import { STATIONS, playbackFor, stationByRef } from "../fixtures/stations";
import { fail, path, reply } from "../respond";
import { airingX, identX } from "../view";

export const stationHandlers = [
  http.get(path(stationsApi.getStation), ({ params }) => {
    const s = stationByRef(String(params.stationRef));
    if (!s) return fail(404, "not_found", "That station wasn't found.");
    const t = now();
    const nn = nowNext(s.ident.id, t);
    const upcoming = airingsFor(s.ident.id).filter((a) => a.start > t.toISOString());
    const programs = Object.values(PROGRAMS).filter((p) => p.maker === s.ident.callSign).map((p) => ({ id: p.id, title: p.title, description: p.description, live: !!p.live }));
    return reply(StationPageX, {
      station: identX(s),
      description: s.description,
      onAir: !!nn.now,
      now: nn.now ? airingX(nn.now) : null,
      upNext: upcoming.slice(0, 3).map(airingX),
      programs,
      claimable: s.ident.kind === "claimable" ? { runFor: "Marcus Reyes", claimed: false, escrowContract: "0x5ee2000000000000000000000000000000a41d", escrowStationId: 101 } : null,
      pledgesTaxDeductible: s.ident.callSign === "CIVC" ? true : null,
      playback: nn.now ? playbackFor(s) : null,
      about: s.about ?? null,
      members: s.members,
      onDialSince: s.onDialSince ?? null,
      hours: s.hours ?? null,
      schedule: airingsFor(s.ident.id).map(airingX)
    });
  }),

  http.get(path(libraryApi.getProgram), ({ params }) => {
    const p = Object.values(PROGRAMS).find((x) => x.id === params.programId);
    if (!p) return fail(404, "not_found", "That program wasn't found.");
    const maker = stationByRef(p.maker)!;
    const t = now().toISOString();
    const upcoming = AIRINGS.filter((a) => a.programId === p.id && a.end > t && !a.listed).sort((a, b) => a.start.localeCompare(b.start));
    return reply(libraryApi.getProgram.response, {
      id: p.id,
      station: maker.ident,
      title: p.title,
      description: p.description,
      category: p.category,
      advisory: "none",
      live: !!p.live,
      attribution: null,
      rightsNote: null,
      episodeCount: 0,
      listingStatus: "complete",
      episodes: [],
      upcoming: upcoming.map((a) => ({ logEntryId: a.id, startsAt: a.start, station: STATIONS.find((s) => s.ident.id === a.stationId)!.ident }))
    });
  })
];
