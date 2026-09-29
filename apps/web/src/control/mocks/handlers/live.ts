// live sources, hosts, speakers, lower thirds, ending early, listings (with library.ts, which this
// area also owns). The Live and programming area owns this file.

import { http, type HttpHandler } from "msw";
import { stationsApi } from "@opencast/contracts";
import {
  endEarly,
  getLiveBlock,
  getLowerThird,
  listHosts,
  listListings,
  LiveSourcesExt,
  setLowerThird,
  updateListing,
  updateProgramCaptions,
  type Listing
} from "../../api/ext/live";
import { now } from "../../../lib/clock";
import { dbStation, getDb, membership, saveDb, stationLog } from "../db";
import type { DbLogEntry } from "../fixtures/evening";
import {
  ensureLiveSeed,
  entryListingStatus,
  keyPrefix,
  liveState,
  maskKey,
  newStreamKey,
  ownDescription,
  saveLive,
  SOURCE_PREVIEW,
  SOURCE_QUALITY
} from "../fixtures/live";
import { PEOPLE, type MockPerson } from "../fixtures/people";
import { fail, needsUser, path, reply } from "../respond";

// Every handler here reads the week this area adds to the log; add it as soon as the mocks load.
try {
  ensureLiveSeed();
} catch {
  // No storage (tests): each handler seeds on first use.
}

const INGEST = "rtmps://ingest.useopencast.org/live";

function roleOn(stationId: string, p: MockPerson) {
  return membership(stationId, p.id) ?? null;
}

/** Owners and operators set up sources, hosts and listings. */
function manages(stationId: string, p: MockPerson): Response | null {
  const m = roleOn(stationId, p);
  if (!m) return fail(403, "forbidden", "That station isn't one of yours.");
  if (m.role === "host") return fail(403, "forbidden", "Hosts see their own live blocks.");
  return null;
}

/** Going live, lower thirds, speakers: owners, operators, and the program's hosts. */
function goesLive(stationId: string, programId: string | null, p: MockPerson): Response | null {
  const m = roleOn(stationId, p);
  if (!m) return fail(403, "forbidden", "That station isn't one of yours.");
  if (m.role === "host" && (!programId || !m.hostProgramIds.includes(programId))) return fail(403, "not_your_block", "Hosts see their own live blocks.");
  return null;
}

function sourcesOf(stationId: string, hostView: boolean) {
  // The mock keeps one station's sources (BEAT's); other stations have none yet.
  if (stationId !== getDb().stations.find((s) => s.ident.callSign === "BEAT")?.ident.id) return [];
  return getDb().liveSources.map((s) => ({
    ...s,
    ...(hostView ? { server: null, streamKeyPreview: null } : {}),
    quality: s.signal === "receiving" ? SOURCE_QUALITY[s.id] ?? null : null,
    previewUrl: s.signal === "receiving" ? SOURCE_PREVIEW[s.id] ?? null : null,
    ingest: null
  }));
}

function liveEntry(stationId: string, entryId: string): DbLogEntry | Response {
  const e = getDb().log.find((x) => x.id === entryId && x.stationId === stationId);
  if (!e) return fail(404, "not_found", "That block isn't on the log.");
  if (e.kind !== "live") return fail(409, "not_live", "That isn't a live block.");
  return e;
}

export function listingOf(e: DbLogEntry): Listing {
  const db = getDb();
  const item = e.itemId ? db.library.items.find((i) => i.id === e.itemId) : null;
  const program = e.programId ? db.library.programs.find((p) => p.id === e.programId) : null;
  const { stationId: _s, ...rest } = e;
  return {
    entryId: e.id,
    kind: rest.kind,
    code: rest.code,
    startsAt: rest.startsAt,
    endsAt: rest.endsAt,
    title: rest.title,
    episodeTitle: rest.episodeTitle,
    episodeDescription: ownDescription(e),
    localNote: rest.localNote,
    carriedFrom: rest.carriedFrom,
    itemId: rest.itemId,
    imported: item?.source === "link",
    status: entryListingStatus(e),
    program: program ? { ...program, captions: liveState().captions[program.id] ?? null } : null
  };
}

export const liveHandlers: HttpHandler[] = [
  http.get(path(stationsApi.listLiveSources), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    ensureLiveSeed();
    const id = String(params.stationId);
    const m = roleOn(id, p);
    if (!m) return fail(403, "forbidden", "That station isn't one of yours.");
    return reply(LiveSourcesExt, sourcesOf(id, m.role === "host"));
  }),

  http.post(path(stationsApi.addLiveSource), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const denied = manages(id, p);
    if (denied) return denied;
    const st = dbStation(id);
    if (!st) return fail(404, "not_found", "That station wasn't found.");
    const parsed = stationsApi.addLiveSource.body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(400, "invalid", "Give the source a name.");
    const { kind, name } = parsed.data;
    if (kind === "browser" && getDb().liveSources.some((s) => s.kind === "browser")) return fail(409, "one_browser", "BEAT already has a browser source. It works from any computer or phone.".replace("BEAT", st.ident.callSign ?? st.ident.name));
    const key = kind === "encoder" ? newStreamKey(keyPrefix(st.ident.callSign ?? st.ident.name, name)) : null;
    const source = { id: crypto.randomUUID(), kind, name, server: kind === "encoder" ? INGEST : null, streamKeyPreview: key ? maskKey(key) : null, signal: "not_connected" as const, createdAt: now().toISOString() };
    getDb().liveSources.push(source);
    saveDb();
    return reply(stationsApi.addLiveSource.response, { source, streamKey: key }, 201);
  }),

  http.post(path(stationsApi.resetLiveSourceKey), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const denied = manages(id, p);
    if (denied) return denied;
    const source = getDb().liveSources.find((s) => s.id === String(params.sourceId));
    if (!source) return fail(404, "not_found", "That source wasn't found.");
    if (source.kind !== "encoder") return fail(409, "no_key", "A browser source has no key.");
    const st = dbStation(id)!;
    const key = newStreamKey(keyPrefix(st.ident.callSign ?? st.ident.name, source.name));
    source.streamKeyPreview = maskKey(key);
    // The old key stops working: whatever was sending on it drops.
    source.signal = "not_connected";
    saveDb();
    return reply(stationsApi.resetLiveSourceKey.response, { source, streamKey: key });
  }),

  http.delete(path(stationsApi.removeLiveSource), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const denied = manages(id, p);
    if (denied) return denied;
    const sid = String(params.sourceId);
    if (!getDb().liveSources.some((s) => s.id === sid)) return fail(404, "not_found", "That source wasn't found.");
    const t = now().toISOString();
    const blocks = stationLog(id).filter((e) => e.liveSourceId === sid && e.endsAt > t).length;
    if (blocks) return fail(409, "in_use", `It feeds ${blocks} live ${blocks === 1 ? "block" : "blocks"}. Give ${blocks === 1 ? "it" : "them"} another source first.`);
    getDb().liveSources = getDb().liveSources.filter((s) => s.id !== sid);
    saveDb();
    return reply(stationsApi.removeLiveSource.response, { ok: true });
  }),

  http.get(path(listHosts), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    ensureLiveSeed();
    const id = String(params.stationId);
    const m = roleOn(id, p);
    if (!m) return fail(403, "forbidden", "That station isn't one of yours.");
    const members = getDb().members.filter((x) => x.stationId === id);
    const programs = getDb()
      .library.programs.filter((pr) => pr.station.id === id && pr.live)
      .filter((pr) => m.role !== "host" || m.hostProgramIds.includes(pr.id))
      .map((pr) => ({
        programId: pr.id,
        title: pr.title,
        hosts: members.filter((x) => x.hostProgramIds.includes(pr.id)).map((x) => ({ userId: x.personId, displayName: PEOPLE.find((pp) => pp.id === x.personId)?.displayName ?? null }))
      }));
    return reply(listHosts.response, { programs });
  }),

  http.put(path(stationsApi.setHosts), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const denied = manages(id, p);
    if (denied) return denied;
    const programId = String(params.programId);
    const program = getDb().library.programs.find((pr) => pr.id === programId && pr.station.id === id);
    if (!program) return fail(404, "not_found", "That program wasn't found.");
    if (!program.live) return fail(409, "not_live", "Only live programs have hosts.");
    const parsed = stationsApi.setHosts.body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(400, "invalid", "Choose who hosts it.");
    const members = getDb().members.filter((x) => x.stationId === id);
    const unknown = parsed.data.userIds.find((u) => !members.some((x) => x.personId === u));
    if (unknown) return fail(400, "not_on_team", "Hosts have to be on the station's team first.");
    for (const x of members) {
      const on = parsed.data.userIds.includes(x.personId);
      x.hostProgramIds = on ? Array.from(new Set([...x.hostProgramIds, programId])) : x.hostProgramIds.filter((pid) => pid !== programId);
    }
    saveDb();
    return reply(stationsApi.setHosts.response, { userIds: parsed.data.userIds });
  }),

  http.get(path(stationsApi.getSpeakers), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const programId = String(params.programId);
    const program = getDb().library.programs.find((pr) => pr.id === programId);
    if (!program) return fail(404, "not_found", "That program wasn't found.");
    const denied = goesLive(program.station.id, programId, p);
    if (denied) return denied;
    return reply(stationsApi.getSpeakers.response, liveState().speakers[programId] ?? []);
  }),

  http.put(path(stationsApi.setSpeakers), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const programId = String(params.programId);
    const program = getDb().library.programs.find((pr) => pr.id === programId);
    if (!program) return fail(404, "not_found", "That program wasn't found.");
    const denied = goesLive(program.station.id, programId, p);
    if (denied) return denied;
    const parsed = stationsApi.setSpeakers.body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(400, "invalid", "A speaker needs a name.");
    const before = liveState().speakers[programId] ?? [];
    // The list is replaced; a speaker with the same name and title keeps its id.
    const list = parsed.data.map((s, position) => ({
      id: before.find((b) => b.name === s.name && b.title === s.title)?.id ?? crypto.randomUUID(),
      name: s.name,
      title: s.title,
      position
    }));
    liveState().speakers[programId] = list;
    saveLive();
    return reply(stationsApi.setSpeakers.response, list);
  }),

  http.get(path(getLowerThird), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const e = liveEntry(id, String(params.entryId));
    if (e instanceof Response) return e;
    const denied = goesLive(id, e.programId, p);
    if (denied) return denied;
    const saved = liveState().lowerThirds[e.id];
    if (saved) return reply(getLowerThird.response, saved);
    const first = (e.programId ? liveState().speakers[e.programId] : undefined)?.[0];
    return reply(getLowerThird.response, { entryId: e.id, hidden: false, speakerId: first?.id ?? null, name: first?.name ?? "", title: first?.title ?? null });
  }),

  http.put(path(setLowerThird), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const e = liveEntry(id, String(params.entryId));
    if (e instanceof Response) return e;
    const denied = goesLive(id, e.programId, p);
    if (denied) return denied;
    const parsed = setLowerThird.body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(400, "invalid", "A name fits in 80 characters, a title in 120.");
    const next = { entryId: e.id, ...parsed.data };
    liveState().lowerThirds[e.id] = next;
    saveLive();
    return reply(setLowerThird.response, next);
  }),

  http.get(path(getLiveBlock), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const e = liveEntry(id, String(params.entryId));
    if (e instanceof Response) return e;
    const denied = goesLive(id, e.programId, p);
    if (denied) return denied;
    return reply(getLiveBlock.response, { entryId: e.id, endedEarlyAt: liveState().endedEarly[e.id] ?? null });
  }),

  http.post(path(endEarly), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const e = liveEntry(id, String(params.entryId));
    if (e instanceof Response) return e;
    const denied = goesLive(id, e.programId, p);
    if (denied) return denied;
    const t = now().toISOString();
    if (!(e.startsAt <= t && t < e.endsAt)) return fail(409, "not_on_air", "It can end early only while it's on air.");
    if (liveState().endedEarly[e.id]) return fail(409, "ended", "It has already ended.");
    liveState().endedEarly[e.id] = t;
    saveLive();
    return reply(endEarly.response, { entryId: e.id, endedAt: t });
  }),

  http.get(path(listListings), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    ensureLiveSeed();
    const id = String(params.stationId);
    const denied = manages(id, p);
    if (denied) return denied;
    const q = new URL(request.url).searchParams;
    const from = q.get("from");
    const to = q.get("to");
    if (!from || !to) return fail(400, "window", "Give a from and a to.");
    const listings = stationLog(id, from, to)
      .filter((e) => e.kind !== "off_air" && e.code === "PGM" && e.startsAt >= from)
      .map(listingOf);
    return reply(listListings.response, { listings, needDescription: listings.filter((l) => l.status === "needs_description").length });
  }),

  http.patch(path(updateListing), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const denied = manages(id, p);
    if (denied) return denied;
    const e = getDb().log.find((x) => x.id === String(params.entryId) && x.stationId === id);
    if (!e) return fail(404, "not_found", "That airing isn't on the log.");
    const parsed = updateListing.body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(400, "too_long", "A description fits in 160 characters.");
    const b = parsed.data;
    if (e.carriedFrom && (b.episodeTitle !== undefined || b.episodeDescription !== undefined)) {
      return fail(409, "from_the_maker", `Listings for ${e.title} come from ${e.carriedFrom.callSign ?? e.carriedFrom.name}. Add a local note instead.`);
    }
    if (b.episodeTitle !== undefined) e.episodeTitle = b.episodeTitle || null;
    if (b.localNote !== undefined) e.localNote = b.localNote || null;
    if (b.episodeDescription !== undefined) liveState().descriptions[e.id] = b.episodeDescription || null;
    saveLive();
    return reply(updateListing.response, listingOf(e));
  }),

  http.patch(path(updateProgramCaptions), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const program = getDb().library.programs.find((pr) => pr.id === String(params.programId));
    if (!program) return fail(404, "not_found", "That program wasn't found.");
    const denied = manages(program.station.id, p);
    if (denied) return denied;
    const parsed = updateProgramCaptions.body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(400, "invalid", "Choose how it's captioned.");
    liveState().captions[program.id] = parsed.data;
    saveLive();
    return reply(updateProgramCaptions.response, parsed.data);
  })
];
