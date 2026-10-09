// library: items, folders, programs, uploads and link imports, rights, IPFS export; an item's
// history (L5) and replacing its file (L6). The Live and programming area owns this file.

import { http } from "msw";
import { blockById } from "../blocks";
import { IDENT_LEGACY_CODE, isIdentCode, libraryApi, type GeneratedStationId, type LibraryItem, type Program } from "@opencast/contracts";
import { now } from "../../../lib/clock";
import { inWindow } from "../../components/live/bumpers";
import { dbStation, getDb, membership, saveDb, stationLog } from "../db";
import { advancePreparing, ensureLiveSeed, entryListingStatus, extraAired, listingWindow, liveState, PROGRAM_CARRIAGE, saveLive } from "../fixtures/live";
import type { MockPerson } from "../fixtures/people";
import { preparationOf } from "../prepared";
import { fail, needsUser, path, reply } from "../respond";

/** The generated station ID (added 2026-09-29): ten seconds over a soft sound bed. */
export const GENERATED_SID_MS = 10_000;
/** How the mock's breaks name it. */
export const GENERATED_SID_TITLE = "Generated station ID";

/**
 * A station's generated station ID, while it has none of its own that can air (a station ID
 * prepared, with its rights confirmed). The mock's is always prepared; it has no stream to preview.
 */
function generatedStationIdOf(stationId: string, items: LibraryItem[]): GeneratedStationId | null {
  if (items.some((i) => i.code === "SID" && i.status === "ready" && i.rights)) return null;
  const st = dbStation(stationId);
  if (!st) return null;
  const s = st.ident;
  return { code: "SID", durationMs: GENERATED_SID_MS, sound: "bed", status: "ready", look: { callSign: s.callSign, channel: s.channel, name: s.name, city: s.homeCity ?? null, colour: s.colour }, playbackUrl: null };
}

type Role = "owner" | "operator" | "host";

function roleOn(stationId: string, p: MockPerson): Role | null {
  return membership(stationId, p.id)?.role ?? null;
}

/** Library, log, listings: owners and operators. */
function programs(stationId: string, p: MockPerson): Response | null {
  const r = roleOn(stationId, p);
  if (!r) return fail(403, "forbidden", "That station isn't one of yours.");
  if (r === "host") return fail(403, "forbidden", "Hosts see their own live blocks.");
  return null;
}

function itemById(id: string) {
  return getDb().library.items.find((i) => i.id === id);
}

function audioLayout(i: LibraryItem) {
  return i.status === "ready" ? ("stereo" as const) : null;
}

/** L5, L7: the audio layout and caption language, as the API adds them. */
const withProbe = (i: LibraryItem): LibraryItem => ({
  ...i,
  audioLayout: audioLayout(i),
  captionLanguage: i.captions === "none" ? null : "en",
  // A243: a bumper's role (none reads as Any), and whether it's inside its window now.
  bumperRole: i.code === "BMP" ? (i.bumperRole ?? null) : null,
  airs: i.airs ?? null,
  airingNow: inWindow(i.airs, now()),
  // A244: the programming block it belongs to.
  programBlockId: i.programBlockId ?? null
});

/** Programs with their listing status computed from what they air this week. */
function programsOf(stationId: string): Program[] {
  const { from, to } = listingWindow();
  const log = stationLog(stationId, from, to);
  return getDb()
    .library.programs.filter((pr) => pr.station.id === stationId)
    .map((pr) => {
      const airings = log.filter((e) => e.programId === pr.id);
      const needs = airings.some((e) => entryListingStatus(e) === "needs_description");
      return { ...pr, episodeCount: getDb().library.items.filter((i) => i.programId === pr.id).length, listingStatus: needs ? "needs_description" : airings.length || pr.description ? "complete" : "needs_description" };
    });
}

/** What uses an item: future log entries, and stations carrying it. */
export function usage(i: LibraryItem) {
  const t = now().toISOString();
  const logEntries = getDb().log.filter((e) => e.itemId === i.id && e.endsAt > t).length;
  const carriers = i.programId ? PROGRAM_CARRIAGE[i.programId]?.carriers ?? 0 : 0;
  return { logEntries, carriers };
}

function titleFrom(name: string) {
  const base = name.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[-_]+/g, " ").trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : "Untitled";
}

function newItem(stationId: string, o: Partial<LibraryItem> & Pick<LibraryItem, "title">): LibraryItem {
  return {
    id: crypto.randomUUID(),
    stationId,
    programId: null,
    folderId: null,
    episodeNumber: null,
    seasonNumber: null,
    partOf: null,
    partNumber: null,
    episodeDescription: null,
    code: "PGM",
    source: "upload",
    sourceUrl: null,
    mediaKind: "video",
    durationMs: null,
    status: "preparing",
    prepProgress: 0,
    picture: null,
    loudnessLufs: null,
    captions: "generated",
    originalFilename: null,
    rights: null,
    offerable: true,
    breakPointsMs: [],
    storage: null,
    createdAt: now().toISOString(),
    ...o
  };
}

/**
 * Programming Phase 2, as the API: what aired (the mock's log before now stands in for the as-run
 * log), and where each program's episodes come, In order, picking up after its last airing.
 */
export function airedFacts(items: LibraryItem[]): Map<string, Pick<LibraryItem, "neverAired" | "lastAiredAt" | "upNext" | "nextEpisode">> {
  const t = now().toISOString();
  const last = new Map<string, string>();
  for (const e of getDb().log) if (e.itemId && e.endsAt <= t && (last.get(e.itemId) ?? "") < e.startsAt) last.set(e.itemId, e.startsAt);
  const facts = new Map(items.map((i) => [i.id, { neverAired: !last.has(i.id), lastAiredAt: last.get(i.id) ?? null, upNext: null as number | null, nextEpisode: false }]));
  const nulls = (a: number | null | undefined, b: number | null | undefined) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : a - b);
  for (const programId of new Set(items.flatMap((i) => (i.programId && i.code === "PGM" ? [i.programId] : [])))) {
    const all = getDb().library.items.filter((i) => i.programId === programId && i.code === "PGM");
    const ready = all
      .filter((i) => i.status === "ready" && i.rights && i.durationMs)
      .sort((a, b) => nulls(a.seasonNumber, b.seasonNumber) || nulls(a.episodeNumber, b.episodeNumber) || a.createdAt.localeCompare(b.createdAt) || nulls(a.partNumber, b.partNumber));
    const latest = all.reduce<LibraryItem | null>((m, i) => ((last.get(i.id) ?? "") > (m ? (last.get(m.id) ?? "") : "") ? i : m), null);
    const from = latest ? ready.findIndex((i) => i.id === latest.id) + 1 : 0;
    ready.forEach((_, n) => {
      const i = ready[(from + n) % ready.length];
      const f = facts.get(i.id);
      if (f) Object.assign(f, { upNext: n, nextEpisode: n === 0 || (!!i.partOf && i.partOf === ready[from % ready.length].partOf) });
    });
  }
  return facts;
}

/** A242: an item's type as the API stores it, as `code` (what apps built before read) and `identCode`. */
export function typed(code: string): Pick<LibraryItem, "code" | "identCode"> {
  if (isIdentCode(code)) return { code: IDENT_LEGACY_CODE[code], identCode: code };
  return { code: code as LibraryItem["code"], identCode: null };
}

/** A file as the mocks see it. */
export type MockFile = Pick<File, "name" | "type" | "size">;

/** The library upload's work (the form endpoint's, and a direct upload's once its parts are in). */
export function mockLibraryUpload(request: Request, stationId: string, file: MockFile | null, fields: { title?: string; code?: string; folderId?: string | null }): Response {
  const p = needsUser(request);
  if (p instanceof Response) return p;
  const denied = programs(stationId, p);
  if (denied) return denied;
  if (!dbStation(stationId)) return fail(404, "not_found", "That station wasn't found.");
  if (!file) return fail(400, "no_file", "Choose a video or audio file.");
  // A242: an off-air card can be a picture.
  const still = fields.code === "OFF" && (/^image\/(png|jpeg|webp)$/.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name));
  if (!still && !/^(video|audio)\//.test(file.type) && !/\.(mp4|mov|m4v|mkv|webm|mp3|wav|m4a|aac|flac|ogg)$/i.test(file.name)) {
    return fail(415, "not_media", fields.code === "OFF" ? "That file isn't a picture, video or audio." : "That file isn't video or audio.");
  }
  const audio = file.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(file.name);
  // Under a minute is guessed as a bumper. The mock can't read the length: small files are short.
  const code = fields.code ?? (file.size < 8_000_000 ? "BMP" : "PGM");
  const item = newItem(stationId, { title: fields.title ?? titleFrom(file.name), ...typed(code), ...(still ? { still: true } : {}), mediaKind: audio ? "audio" : "video", originalFilename: file.name, folderId: fields.folderId ?? null });
  getDb().library.items.push(item);
  liveState().preparing[item.id] = Date.now();
  saveLive();
  return reply(libraryApi.upload.response, item, 201);
}

/** L6's work: a new file for an item. */
export function mockReplaceFile(request: Request, itemId: string, file: MockFile | null): Response {
  const p = needsUser(request);
  if (p instanceof Response) return p;
  const item = itemById(itemId);
  if (!item) return fail(404, "not_found", "That item wasn't found.");
  const denied = programs(item.stationId, p);
  if (denied) return denied;
  if (!file) return fail(400, "no_file", "Choose a video or audio file.");
  if (item.source === "link") return fail(409, "not_an_upload", "It came from a link, so there's no file of ours to replace.");
  if (item.status === "preparing") return fail(409, "preparing", "It's still being prepared. Replace it once it's ready.");
  Object.assign(item, { originalFilename: file.name, status: "preparing", prepProgress: 0, storage: null });
  liveState().preparing[item.id] = Date.now();
  saveLive();
  return reply(libraryApi.getItem.response, withProbe(item));
}

export const libraryHandlers = [
  http.get(path(libraryApi.getLibrary), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    ensureLiveSeed();
    advancePreparing();
    const id = String(params.stationId);
    const denied = programs(id, p);
    if (denied) return denied;
    const q = new URL(request.url).searchParams;
    const lib = getDb().library;
    const all = lib.items.filter((i) => i.stationId === id);
    let items = all;
    if (q.get("folderId")) items = items.filter((i) => i.folderId === q.get("folderId"));
    if (q.get("code")) items = items.filter((i) => (i.identCode ?? i.code) === q.get("code"));
    // A243: bumpers by role (Any includes bumpers without one).
    const role = q.get("bumperRole");
    if (role) items = items.filter((i) => i.code === "BMP" && (i.bumperRole ?? "any") === role);
    if (q.get("needsAttention") === "true") items = items.filter((i) => !i.rights || i.status !== "ready");
    // A244: a programming block's items.
    if (q.get("programBlockId")) items = items.filter((i) => i.programBlockId === q.get("programBlockId"));
    const facts = airedFacts(items);
    return reply(libraryApi.getLibrary.response, {
      generatedStationId: generatedStationIdOf(id, all),
      items: items.map(withProbe).map((i) => ({ ...i, ...facts.get(i.id) })),
      folders: lib.folders.map((f) => ({ ...f, itemCount: all.filter((i) => i.folderId === f.id).length })),
      programs: programsOf(id),
      needsAttention: { rightsToConfirm: all.filter((i) => !i.rights).length, preparing: all.filter((i) => i.status === "preparing").length },
      importedFromLinks: all.filter((i) => i.source === "link").length
    });
  }),

  http.post(path(libraryApi.upload), async ({ request, params }) => {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    const field = (k: string) => (typeof form?.get(k) === "string" ? String(form?.get(k)) : undefined);
    return mockLibraryUpload(request, String(params.stationId), file instanceof File ? file : null, { title: field("title"), code: field("code"), folderId: field("folderId") });
  }),

  http.post(path(libraryApi.importLinks), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const denied = programs(id, p);
    if (denied) return denied;
    const parsed = libraryApi.importLinks.body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(400, "bad_link", "Paste a link that starts with https://.");
    const job = { id: crypto.randomUUID(), status: "running" as const, requestedUrls: parsed.data.urls, items: [] as { sourceUrl: string; title: string | null; status: string; progressPct: number; assetId: string | null }[], error: null, createdAt: now().toISOString(), stationId: id };
    for (const url of parsed.data.urls) {
      const title = titleFrom(decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? new URL(url).hostname));
      const item = newItem(id, { title, ...typed(parsed.data.code), source: "link", sourceUrl: url, offerable: false, programId: parsed.data.programId ?? null });
      getDb().library.items.push(item);
      liveState().preparing[item.id] = Date.now();
      job.items.push({ sourceUrl: url, title, status: "running", progressPct: 0, assetId: item.id });
    }
    liveState().imports.push(job);
    saveLive();
    const { stationId: _s, ...out } = job;
    return reply(libraryApi.importLinks.response, out, 202);
  }),

  http.get(path(libraryApi.getImport), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    advancePreparing();
    const job = liveState().imports.find((j) => j.id === String(params.jobId));
    if (!job) return fail(404, "not_found", "That import wasn't found.");
    const { stationId: _s, ...out } = job;
    return reply(libraryApi.getImport.response, out);
  }),

  http.get(path(libraryApi.getItemHistory), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    ensureLiveSeed();
    const item = itemById(String(params.itemId));
    if (!item) return fail(404, "not_found", "That item wasn't found.");
    const denied = programs(item.stationId, p);
    if (denied) return denied;
    const t = now().toISOString();
    const st = dbStation(item.stationId)!.ident;
    const entries = getDb().log.filter((e) => e.itemId === item.id);
    const future = entries.filter((e) => e.startsAt > t).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const past = entries.filter((e) => e.endsAt <= t).map((e) => ({ startedAt: e.startsAt, station: st, carried: false, audioOnly: false, note: e.localNote }));
    const aired = [...past, ...extraAired(item.title)].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const u = usage(item);
    const preparation = preparationOf(item, Date.parse(t));
    const carriage = item.programId ? PROGRAM_CARRIAGE[item.programId] : undefined;
    const program = item.programId ? getDb().library.programs.find((pr) => pr.id === item.programId) : undefined;
    return reply(libraryApi.getItemHistory.response, {
      itemId: item.id,
      scheduled: future.map((e) => ({ entryId: e.id, startsAt: e.startsAt, station: st, note: e.repeatGroupId || /repeat/i.test(e.localNote ?? "") ? e.localNote : null })),
      aired,
      logEntries: u.logEntries,
      carriers: u.carriers,
      // Prepare once, then assemble: prepared for air in every rendition of its band.
      cachedForAir: preparation.status === "ready",
      preparation,
      audioLayout: audioLayout(item),
      captionLanguage: item.captions === "none" ? null : "en",
      carriage: { offered: !!carriage && item.offerable, program: program?.title ?? null, terms: carriage?.terms ?? null }
    });
  }),

  http.post(path(libraryApi.replaceFile), async ({ request, params }) => {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    return mockReplaceFile(request, String(params.itemId), file instanceof File ? file : null);
  }),

  http.get(path(libraryApi.getItem), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    advancePreparing();
    const item = itemById(String(params.itemId));
    if (!item) return fail(404, "not_found", "That item wasn't found.");
    const denied = programs(item.stationId, p);
    if (denied) return denied;
    return reply(libraryApi.getItem.response, withProbe(item));
  }),

  http.patch(path(libraryApi.updateItem), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const item = itemById(String(params.itemId));
    if (!item) return fail(404, "not_found", "That item wasn't found.");
    const denied = programs(item.stationId, p);
    if (denied) return denied;
    const parsed = libraryApi.updateItem.body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(400, "invalid", "Check the item's details and try again.");
    const { code, ...rest } = parsed.data;
    // A243, as the API: a role is a bumper's; a window a bumper's, station ID's, opener's or closer's.
    const type = code ?? item.identCode ?? item.code;
    if (rest.bumperRole != null && type !== "BMP") return fail(400, "bad_request", "Only a bumper has a role.");
    if (rest.airs && (rest.airs.from || rest.airs.until || rest.airs.dailyFrom) && !["BMP", "SID", "OPN", "CLS"].includes(type)) return fail(400, "bad_request", "Only bumpers, station IDs, openers and closers have times they air.");
    if (rest.airs && Boolean(rest.airs.dailyFrom) !== Boolean(rest.airs.dailyUntil)) return fail(400, "bad_request", "Say both times of day, or neither.");
    if (rest.airs?.from && rest.airs.until && rest.airs.until < rest.airs.from) return fail(400, "bad_request", "The last day is before the first.");
    // A244, as the API: bumpers, station IDs, openers and closers can be a block's (the station's own block).
    if (rest.programBlockId && !["BMP", "SID", "OPN", "CLS"].includes(type)) return fail(400, "bad_request", "Only bumpers, station IDs, openers and closers can be part of a block.");
    if (rest.programBlockId && blockById(rest.programBlockId)?.stationId !== item.stationId) return fail(404, "not_found", "That block wasn't found.");
    if (type !== "BMP") rest.bumperRole = null;
    if (!["BMP", "SID", "OPN", "CLS"].includes(type)) {
      rest.airs = null;
      rest.programBlockId = null;
    }
    if (code && code !== (item.identCode ?? item.code)) {
      // A242, as the API: a picture is an off-air card only; openers, closers and cards stay off the log.
      if (item.still) return fail(422, "still_image", "It's a picture, so it can only be an off-air card. Upload a clip to use it as something else.");
      if (isIdentCode(code) && usage(item).logEntries) return fail(409, "on_the_log", "It's on the log. Take it off the log first: openers, closers and off-air cards air at sign-off and sign-on, not from the log.");
      Object.assign(item, typed(code));
    }
    Object.assign(item, rest);
    saveDb();
    return reply(libraryApi.getItem.response, withProbe(item));
  }),

  http.delete(path(libraryApi.deleteItem), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const item = itemById(String(params.itemId));
    if (!item) return fail(404, "not_found", "That item wasn't found.");
    const denied = programs(item.stationId, p);
    if (denied) return denied;
    const u = usage(item);
    if (u.logEntries || u.carriers) {
      const parts = [u.logEntries ? `in ${u.logEntries} log ${u.logEntries === 1 ? "entry" : "entries"}` : null, u.carriers ? `carried by ${u.carriers} ${u.carriers === 1 ? "station" : "stations"}` : null].filter(Boolean);
      return fail(409, "in_use", `It's ${parts.join(" and ")}. Take it out of those first.`);
    }
    const db = getDb();
    db.library.items = db.library.items.filter((i) => i.id !== item.id);
    saveDb();
    return reply(libraryApi.deleteItem.response, { ok: true });
  }),

  http.post(path(libraryApi.exportToIpfs), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const item = itemById(String(params.itemId));
    if (!item) return fail(404, "not_found", "That item wasn't found.");
    if (roleOn(item.stationId, p) !== "owner") return fail(403, "forbidden", "Only the station's owners can export to IPFS.");
    const parsed = libraryApi.exportToIpfs.body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(400, "confirm", "Confirm that IPFS files are public and can't be taken back.");
    if (!item.storage) return fail(409, "not_ready", "It's still being prepared for air.");
    if (item.source === "link") return fail(409, "not_yours", "Only the station's own originals can be exported. This came from a link.");
    const cid = `bafybei${item.id.replace(/-/g, "").slice(-20)}`;
    item.storage.ipfs = { cid, reason: "export", url: `https://ipfs.io/ipfs/${cid}` };
    saveDb();
    return reply(libraryApi.exportToIpfs.response, { contentId: item.storage.contentId, ipfsCid: cid, url: item.storage.ipfs.url });
  }),

  http.post(path(libraryApi.confirmRights), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const item = itemById(String(params.itemId));
    if (!item) return fail(404, "not_found", "That item wasn't found.");
    const denied = programs(item.stationId, p);
    if (denied) return denied;
    const parsed = libraryApi.confirmRights.body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(400, "choose", "Choose which of the three is true.");
    item.rights = { basis: parsed.data.basis, confirmedBy: p.displayName ?? p.email, confirmedAt: now().toISOString(), note: parsed.data.note ?? null };
    saveDb();
    return reply(libraryApi.getItem.response, withProbe(item));
  }),

  http.post(path(libraryApi.createFolder), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const denied = programs(id, p);
    if (denied) return denied;
    const parsed = libraryApi.createFolder.body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(400, "invalid", "Give the folder a name.");
    const folder = { id: crypto.randomUUID(), name: parsed.data.name, parentFolderId: parsed.data.parentFolderId, itemCount: 0 };
    getDb().library.folders.push(folder);
    saveDb();
    return reply(libraryApi.createFolder.response, folder, 201);
  }),

  http.patch(path(libraryApi.updateFolder), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const folder = getDb().library.folders.find((f) => f.id === String(params.folderId));
    if (!folder) return fail(404, "not_found", "That folder wasn't found.");
    const parsed = libraryApi.updateFolder.body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(400, "invalid", "Give the folder a name.");
    Object.assign(folder, parsed.data);
    saveDb();
    return reply(libraryApi.updateFolder.response, folder);
  }),

  http.delete(path(libraryApi.deleteFolder), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const db = getDb();
    const id = String(params.folderId);
    if (!db.library.folders.some((f) => f.id === id)) return fail(404, "not_found", "That folder wasn't found.");
    db.library.folders = db.library.folders.filter((f) => f.id !== id);
    for (const i of db.library.items) if (i.folderId === id) i.folderId = null;
    saveDb();
    return reply(libraryApi.deleteFolder.response, { ok: true });
  }),

  http.post(path(libraryApi.createProgram), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const denied = programs(id, p);
    if (denied) return denied;
    const st = dbStation(id);
    if (!st) return fail(404, "not_found", "That station wasn't found.");
    const parsed = libraryApi.createProgram.body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(400, "invalid", "Give the program a title, and a description of 160 characters or fewer.");
    const d = parsed.data;
    const program: Program = { id: crypto.randomUUID(), station: st.ident, title: d.title, description: d.description ?? null, category: d.category ?? null, advisory: d.advisory, live: d.live, attribution: null, rightsNote: null, episodeCount: 0, listingStatus: d.description ? "complete" : "needs_description" };
    getDb().library.programs.push(program);
    saveDb();
    return reply(libraryApi.createProgram.response, program, 201);
  }),

  http.patch(path(libraryApi.updateProgram), async ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const program = getDb().library.programs.find((pr) => pr.id === String(params.programId));
    if (!program) return fail(404, "not_found", "That program wasn't found.");
    const denied = programs(program.station.id, p);
    if (denied) return denied;
    const parsed = libraryApi.updateProgram.body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(400, "too_long", "A description fits in 160 characters.");
    Object.assign(program, parsed.data);
    saveDb();
    return reply(libraryApi.updateProgram.response, programsOf(program.station.id).find((pr) => pr.id === program.id) ?? program);
  }),

  http.get(path(libraryApi.getProgram), ({ params }) => {
    const program = getDb().library.programs.find((pr) => pr.id === String(params.programId));
    if (!program) return fail(404, "not_found", "That program wasn't found.");
    const t = now().toISOString();
    const items = getDb().library.items.filter((i) => i.programId === program.id);
    return reply(libraryApi.getProgram.response, {
      ...(programsOf(program.station.id).find((pr) => pr.id === program.id) ?? program),
      episodes: items.map((i) => ({ id: i.id, title: i.title, episodeNumber: i.episodeNumber, durationMs: i.durationMs })),
      upcoming: getDb()
        .log.filter((e) => e.programId === program.id && e.startsAt > t)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
        .slice(0, 10)
        .map((e) => ({ logEntryId: e.id, startsAt: e.startsAt, station: dbStation(e.stationId)?.ident ?? program.station }))
    });
  })
];
