// Live and programming's mock state (live-listings 01 to 05; master-control A.2, A.3), on top of
// the shared evening in db.ts.
//
// What this adds to the shared db, once, keyed by fixed ids so it's never added twice:
// - BEAT's week of listings and live blocks (live-listings 01.1 and 03.1), after tonight:
//     Sun Sep 27  6:30 pm  Late Crate, ep. 11 (a repeat, so "Viewers are watching Late Crate until 7:00")
//     Sun Sep 27  7:00 pm  Crate Talk, live from the browser source, hosted by Marcus (02.1, 05.x: the STOP's
//                          live block; open it at 6:57:46 pm with ?clock=2026-09-28T01:57:46Z)
//     Mon Sep 28  8:00 pm  Crate Session 03 (imported from a link, no description)
//     Wed Sep 30  7:00 pm  Crate Talk, live from the browser, weekly
//     Thu Oct 1   8:00 pm  Late Crate, ep. 16 (no file yet, no episode description)
//     Sat Oct 3   8:30 pm  Saturday Reel, carried from REEL; 9:00 pm Beat Tape Live from Studio A, weekly
// - The live sources as 01.1 draws them: "Studio A" (rtmps://ingest.useopencast.org/live) and
//   "Browser". The foundation's extra "Jen's phone" browser source is taken out: a station's
//   browser source is one, used from any computer or phone.
// - Episode descriptions for the earlier Late Crate episodes and Crate Sessions 01 and 02, so the
//   only airings missing one are the two the Listings frame flags.
//
// Its own state (speakers, lower thirds, ended-early blocks, per-airing descriptions, captions,
// link imports) is kept under its own key: localStorage "oc-mock-control-live".

import type { Captions, LowerThirdState } from "../../api/ext/live";
import type { z } from "zod";
import type { ImportJob, LibraryItem, LogEntry } from "@opencast/contracts";
import { now } from "../../../lib/clock";
import { getDb, saveDb } from "../db";
import { LIVE_SOURCE_IDS, type DbLogEntry } from "./evening";
import { PROGRAM_IDS } from "./library";
import { BEAT, HALL, stationByRef, uid } from "./stations";
import { at } from "./time";

export const LIVE_ENTRY_IDS = {
  sundayLateCrate: uid(430001),
  crateTalkSunday: uid(430002),
  crateSession03: uid(430003),
  crateTalkWednesday: uid(430004),
  lateCrate16: uid(430005),
  saturdayReelNext: uid(430006),
  beatTapeLiveNext: uid(430007)
};

export const REPEAT_GROUPS = { crateTalk: uid(431001), beatTapeLive: uid(431002), saturdayReel: uid(431003) };

/** How long a mock upload or link import takes to be prepared for air. */
export const PREP_MS = 20_000;

export interface Speaker {
  id: string;
  name: string;
  title: string | null;
  position: number;
}

export interface LiveState {
  version: number;
  speakers: Record<string, Speaker[]>;
  lowerThirds: Record<string, LowerThirdState>;
  endedEarly: Record<string, string>;
  /** Per airing (log entry id): its own description (G5). */
  descriptions: Record<string, string | null>;
  captions: Record<string, z.infer<typeof Captions>>;
  imports: (ImportJob & { stationId: string })[];
  /** Items being prepared for air: when their preparation started (ms). */
  preparing: Record<string, number>;
}

const KEY = "oc-mock-control-live";
export const LIVE_VERSION = 1;

function seedState(): LiveState {
  return {
    version: LIVE_VERSION,
    speakers: {
      [PROGRAM_IDS.crateTalk]: [
        { id: uid(440001), name: "Marcus Reyes", title: "Host, Crate Talk", position: 0 },
        { id: uid(440002), name: "Rosa Vega", title: "Producer, San Bernardino", position: 1 }
      ],
      [PROGRAM_IDS.beatTapeLive]: [{ id: uid(440011), name: "Jen Park", title: "Host, Beat Tape Live", position: 0 }]
    },
    lowerThirds: {},
    endedEarly: {},
    descriptions: {
      [LIVE_ENTRY_IDS.crateTalkSunday]: "Marcus and two local producers on clearing samples, what fair use does and doesn't cover, and where to find records nobody owns."
    },
    captions: {
      [PROGRAM_IDS.crateTalk]: { mode: "generated_live", language: "English" },
      [PROGRAM_IDS.beatTapeLive]: { mode: "generated_live", language: "English" },
      [PROGRAM_IDS.lateCrate]: { mode: "generated", language: "English" },
      [PROGRAM_IDS.crateSession]: { mode: "generated", language: "English" }
    },
    imports: [],
    preparing: {}
  };
}

let state: LiveState | null = null;

export function liveState(): LiveState {
  if (state) return state;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    const saved = raw ? (JSON.parse(raw) as LiveState) : null;
    state = saved && saved.version === LIVE_VERSION ? saved : seedState();
  } catch {
    state = seedState();
  }
  return state;
}

export function saveLive() {
  try {
    localStorage.setItem(KEY, JSON.stringify(liveState()));
  } catch {
    // Private windows: kept for this visit.
  }
  saveDb();
}

/** Tests: start again. */
export function resetLive() {
  state = seedState();
}

function entry(id: string, o: Partial<LogEntry> & Pick<LogEntry, "startsAt" | "endsAt" | "title">): DbLogEntry {
  return {
    id,
    stationId: BEAT.id,
    kind: "program",
    code: "PGM",
    episodeTitle: null,
    itemId: null,
    programId: null,
    liveSourceId: null,
    carriedFrom: null,
    carriageAgreementId: null,
    repeatGroupId: null,
    localNote: null,
    ...o
  };
}

/** The week's entries this area adds (see the header). */
export function weekEntries(items: LibraryItem[]): DbLogEntry[] {
  const item = (t: string) => items.find((i) => i.title === t);
  const ep11 = item("Late Crate, ep. 11");
  const cs03 = item("Crate Session 03");
  const REEL = stationByRef("REEL")!;
  return [
    entry(LIVE_ENTRY_IDS.sundayLateCrate, { title: "Late Crate, ep. 11", episodeTitle: "ep. 11", startsAt: at("+1 18:30"), endsAt: at("+1 19:00"), itemId: ep11?.id ?? null, programId: PROGRAM_IDS.lateCrate }),
    entry(LIVE_ENTRY_IDS.crateTalkSunday, { kind: "live", title: "Crate Talk", episodeTitle: "Sampling records you don't own", startsAt: at("+1 19:00"), endsAt: at("+1 20:00"), programId: PROGRAM_IDS.crateTalk, liveSourceId: LIVE_SOURCE_IDS.browser }),
    entry(LIVE_ENTRY_IDS.crateSession03, { title: "Crate Session 03", episodeTitle: "ep. 3", startsAt: at("+2 20:00"), endsAt: at("+2 21:00"), itemId: cs03?.id ?? null, programId: PROGRAM_IDS.crateSession }),
    entry(LIVE_ENTRY_IDS.crateTalkWednesday, { kind: "live", title: "Crate Talk", startsAt: at("+4 19:00"), endsAt: at("+4 20:00"), programId: PROGRAM_IDS.crateTalk, liveSourceId: LIVE_SOURCE_IDS.browser, repeatGroupId: REPEAT_GROUPS.crateTalk }),
    entry(LIVE_ENTRY_IDS.lateCrate16, { title: "Late Crate, ep. 16", episodeTitle: "ep. 16", startsAt: at("+5 20:00"), endsAt: at("+5 20:30"), programId: PROGRAM_IDS.lateCrate }),
    entry(LIVE_ENTRY_IDS.saturdayReelNext, { title: "Saturday Reel", startsAt: at("+7 20:30"), endsAt: at("+7 20:59"), programId: PROGRAM_IDS.saturdayReel, carriedFrom: REEL, carriageAgreementId: uid(270001), repeatGroupId: REPEAT_GROUPS.saturdayReel }),
    entry(LIVE_ENTRY_IDS.beatTapeLiveNext, { kind: "live", title: "Beat Tape Live", startsAt: at("+7 21:00"), endsAt: at("+7 22:00"), programId: PROGRAM_IDS.beatTapeLive, liveSourceId: LIVE_SOURCE_IDS.studioA, repeatGroupId: REPEAT_GROUPS.beatTapeLive, localNote: "Live from the Redlands studio" })
  ];
}

/** Adds this area's data to the shared db, once (safe to call on every request). */
export function ensureLiveSeed() {
  const db = getDb();
  let changed = false;
  const have = new Set(db.log.map((e) => e.id));
  for (const e of weekEntries(db.library.items)) {
    if (!have.has(e.id)) {
      db.log.push(e);
      changed = true;
    }
  }
  const studio = db.liveSources.find((s) => s.id === LIVE_SOURCE_IDS.studioA);
  if (studio && studio.name === "Studio A, OBS") {
    Object.assign(studio, { name: "Studio A", server: "rtmps://ingest.useopencast.org/live", streamKeyPreview: "beat-studio-a-········" });
    changed = true;
  }
  const browser = db.liveSources.find((s) => s.id === LIVE_SOURCE_IDS.browser);
  if (browser && browser.name === "Crate Talk, from this browser") {
    browser.name = "Browser";
    changed = true;
  }
  if (db.liveSources.some((s) => s.id === LIVE_SOURCE_IDS.phone)) {
    db.liveSources = db.liveSources.filter((s) => s.id !== LIVE_SOURCE_IDS.phone);
    changed = true;
  }
  for (const i of db.library.items) {
    if (i.episodeDescription === null && i.stationId === BEAT.id && i.source !== "link" && i.code === "PGM" && i.episodeNumber !== null && (i.programId === PROGRAM_IDS.lateCrate || i.programId === PROGRAM_IDS.crateSession)) {
      i.episodeDescription = i.programId === PROGRAM_IDS.lateCrate ? `Episode ${i.episodeNumber}: one producer, one crate of records.` : `Session ${i.episodeNumber} from the Inland Beat library.`;
      changed = true;
    }
  }
  if (changed) saveDb();
}

// ---- Live sources ----

/** S14: what the mock says is arriving. */
export const SOURCE_QUALITY: Record<string, string> = { [LIVE_SOURCE_IDS.studioA]: "1080p" };
/** S14: a stand-in for the encoder's private preview (a mock stream). */
export const SOURCE_PREVIEW: Record<string, string> = { [LIVE_SOURCE_IDS.studioA]: "/mock-hls/civc/master.m3u8" };

export function newStreamKey(prefix: string): string {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 12; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return `${prefix}-${s}`;
}

export function keyPrefix(callSign: string, name: string): string {
  return `${callSign}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
}

/** "beat-studio-a-········": the start of the key, the rest masked. */
export function maskKey(key: string): string {
  const cut = key.lastIndexOf("-") + 1;
  return `${key.slice(0, cut)}${"·".repeat(8)}`;
}

// ---- Items being prepared ----

/** Moves preparing items along; a mock upload is ready for air PREP_MS after it arrives. */
export function advancePreparing() {
  const db = getDb();
  const st = liveState();
  const t = Date.now();
  let changed = false;
  for (const i of db.library.items) {
    if (i.status !== "preparing") continue;
    const started = st.preparing[i.id] ?? (st.preparing[i.id] = t);
    const pct = Math.min(100, Math.floor(((t - started) / PREP_MS) * 100));
    if (pct >= 100) {
      i.status = "ready";
      i.prepProgress = null;
      i.picture = i.mediaKind === "video" ? { width: 1280, height: 720 } : null;
      i.loudnessLufs = -24;
      i.durationMs = i.durationMs ?? (i.code === "PGM" ? 28 * 60_000 : 10_000);
      i.storage = { contentId: `bafy${i.id.slice(-8)}`, bytes: 120_000_000, sharedWith: 0, locked: false, ipfs: null };
      delete st.preparing[i.id];
    } else if (i.prepProgress !== pct) i.prepProgress = pct;
    changed = true;
  }
  for (const job of st.imports) {
    if (job.status === "completed" || job.status === "failed") continue;
    const items = job.items.map((x) => {
      const it = db.library.items.find((i) => i.id === x.assetId);
      const pct = it ? (it.status === "ready" ? 100 : it.prepProgress ?? 0) : 100;
      return { ...x, progressPct: pct, status: pct >= 100 ? "completed" : "running" };
    });
    job.items = items;
    job.status = items.every((x) => x.status === "completed") ? "completed" : "running";
    changed = true;
  }
  if (changed) saveLive();
}

// ---- Listings ----

export type ListingStatusValue = "complete" | "needs_description" | "from_the_maker";

/**
 * A listing's status (live-listings 03): a carried program's words are the maker's; an airing with
 * its own description is complete; a live program or a one-off uses the series description; an
 * episode (or anything imported from a link) needs its own.
 */
export function listingStatus(o: { carried: boolean; ownDescription: string | null; live: boolean; episode: boolean; imported: boolean; programDescription: string | null }): ListingStatusValue {
  if (o.carried) return "from_the_maker";
  if (o.ownDescription) return "complete";
  if (o.imported || (o.episode && !o.live)) return "needs_description";
  return o.programDescription ? "complete" : "needs_description";
}

/** The description an airing has of its own: set on the airing, or on its item. */
export function ownDescription(e: DbLogEntry): string | null {
  const st = liveState();
  if (e.id in st.descriptions) return st.descriptions[e.id] ?? null;
  const item = e.itemId ? getDb().library.items.find((i) => i.id === e.itemId) : null;
  return item?.episodeDescription ?? null;
}

export function entryListingStatus(e: DbLogEntry): ListingStatusValue {
  const db = getDb();
  const item = e.itemId ? db.library.items.find((i) => i.id === e.itemId) : null;
  const program = e.programId ? db.library.programs.find((p) => p.id === e.programId) : null;
  return listingStatus({
    carried: !!e.carriedFrom,
    ownDescription: ownDescription(e),
    live: e.kind === "live",
    episode: e.kind !== "live" && (item?.episodeNumber != null || !!e.episodeTitle),
    imported: item?.source === "link",
    programDescription: program?.description ?? null
  });
}

/** The week the Listings page and the rail read: what airs from now to seven days on. */
export function listingWindow(t = now()): { from: string; to: string } {
  return { from: t.toISOString(), to: new Date(t.getTime() + 7 * 86400e3).toISOString() };
}

// ---- Item history (L5) ----

/** Airings the mock's as-run knows beyond tonight's log (live-listings 04.1). */
export function extraAired(itemTitle: string): { startedAt: string; station: typeof BEAT; carried: boolean; audioOnly: boolean; note: string | null }[] {
  if (itemTitle !== "Late Crate, ep. 15") return [];
  return [
    { startedAt: at("03:00"), station: HALL, carried: true, audioOnly: true, note: null },
    { startedAt: at("00:30"), station: BEAT, carried: false, audioOnly: false, note: "first airing, 29:10 in full" }
  ];
}

/** Carriage per program (the market area owns offers; this is what the item page shows). */
export const PROGRAM_CARRIAGE: Record<string, { terms: "cash" | "barter" | "cash_and_barter" | "free"; carriers: number }> = {
  [PROGRAM_IDS.lateCrate]: { terms: "barter", carriers: 2 }
};
