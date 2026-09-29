// Tonight on BEAT (master-control T, RD and BK; live-listings): Crate Session 02 from 6:00,
// Late Crate ep. 14 at 8:00, Saturday Reel carried from REEL at 8:30 (on air at 8:42:12), Beat
// Tape Live at 9:01 from the studio, Late Crate ep. 15 at 10:00, Slow Hours carried from HALL
// at 10:30:30, then dead air from 11:40 pm to 2:00 am (P.2: "the log runs short"), overnight
// repeats, and the off air hours. Tomorrow night a sign-off at 11:00 pm.
// Breaks are as "Breaks tonight" (C.1) draws them, before the spot market fills them.

import type { LibraryItem, LiveSource, LogEntry } from "@opencast/contracts";
import { PROGRAM_IDS } from "./library";
import { BEAT, HALL, stationByRef, uid } from "./stations";
import { MIN, SEC, at } from "./time";

/** A log entry with its station (the contract's LogEntry doesn't repeat it; replies strip it). */
export type DbLogEntry = LogEntry & { stationId: string };

/** One thing in a break. `open` is time nothing fills yet (it airs the station ID slate). */
export interface DbFill {
  id: string;
  kind: "producer" | "station_id" | "bumper" | "underwriting" | "spot" | "sponsor" | "open";
  title: string;
  lengthMs: number;
  itemId?: string | null;
  spotId?: string | null;
  business?: string | null;
  /** "REEL's break time, barter" */
  note?: string | null;
}

export interface DbBreak {
  id: string;
  stationId: string;
  startsAt: string;
  lengthMs: number;
  /** "After Late Crate, ep. 14" / "During Saturday Reel" */
  context: string;
  origin: "rule" | "cued_live" | "carried_barter";
  /** Break time the producer fills under barter; the station can't sell it. */
  producerShareMs: number;
  fills: DbFill[];
}

let n = 0;
const fillId = () => uid(420000 + ++n);

export const LIVE_SOURCE_IDS = { studioA: uid(260001), browser: uid(260002), phone: uid(260003) };

export function seedLiveSources(): LiveSource[] {
  return [
    { id: LIVE_SOURCE_IDS.studioA, kind: "encoder", name: "Studio A, OBS", server: "rtmp://ingest.opencast.tv/live", streamKeyPreview: "beat-••••-7f2q", signal: "receiving", createdAt: at("-60 12:00") },
    { id: LIVE_SOURCE_IDS.browser, kind: "browser", name: "Crate Talk, from this browser", server: null, streamKeyPreview: null, signal: "not_connected", createdAt: at("-30 12:00") },
    { id: LIVE_SOURCE_IDS.phone, kind: "browser", name: "Jen's phone", server: null, streamKeyPreview: null, signal: "not_connected", createdAt: at("-14 12:00") }
  ];
}

export function seedEvening(items: LibraryItem[]): { log: DbLogEntry[]; breaks: DbBreak[] } {
  const byTitle = (t: string) => items.find((i) => i.title === t)!;
  let e = 0;
  const entry = (o: Partial<LogEntry> & Pick<LogEntry, "startsAt" | "endsAt" | "title">): DbLogEntry => ({
    id: uid(410000 + ++e),
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
  });
  const fromItem = (title: string, startsAt: string, endsAt: string, o: Partial<LogEntry> = {}) => {
    const it = byTitle(title);
    return entry({ title, startsAt, endsAt, itemId: it.id, programId: it.programId, episodeTitle: it.episodeNumber ? `ep. ${it.episodeNumber}` : null, ...o });
  };
  const REEL = stationByRef("REEL")!;

  const log: DbLogEntry[] = [
    fromItem("Crate Session 02", at("18:00"), at("20:00")),
    fromItem("Late Crate, ep. 14", at("20:00"), at("20:28:30")),
    entry({ title: "Saturday Reel", episodeTitle: "Cartoons from 1928 to 1934", startsAt: at("20:30"), endsAt: at("20:59"), programId: PROGRAM_IDS.saturdayReel, carriedFrom: REEL, carriageAgreementId: uid(270001) }),
    entry({ kind: "live", title: "Beat Tape Live", startsAt: at("21:01"), endsAt: at("21:58"), programId: PROGRAM_IDS.beatTapeLive, liveSourceId: LIVE_SOURCE_IDS.studioA, localNote: "Live from the Redlands studio" }),
    fromItem("Late Crate, ep. 15", at("22:00"), at("22:28:30"), { localNote: "Beat showcase" }),
    entry({ title: "Slow Hours", startsAt: at("22:30:30"), endsAt: at("23:40"), programId: PROGRAM_IDS.slowHours, carriedFrom: HALL, carriageAgreementId: uid(270002) }),
    // 11:40 pm to 2:00 am: nothing. Dead air.
    // Overnight repeats until 4:00 am, inside the off air hours (2:00 to 6:00 am, fixtures/offair.ts):
    // what's on the log still airs, and the hours cover the rest, so BEAT is off air 4:00 to 6:00 am.
    ...[12, 13, 14, 15].map((ep, i) => fromItem(`Late Crate, ep. ${ep}`, at(`${26 + Math.floor(i / 2)}:${i % 2 ? "30" : "00"}`), at(`${26 + Math.floor((i + 1) / 2)}:${(i + 1) % 2 ? "30" : "00"}`), { localNote: "Overnight repeat" })),
    // Tomorrow night BEAT signs off early, at 11:00 pm: the sign-off runs into the off air hours,
    // so it's back at 6:00 am (A.4's "Sign off at 11:40 pm", "Back at 6:00 am").
    entry({ kind: "off_air", code: "OPEN", title: "Off air", startsAt: at("+1 23:00"), endsAt: at("+1 26:00") })
  ];

  const f = (kind: DbFill["kind"], title: string, lengthSec: number, o: Partial<DbFill> = {}): DbFill => ({ id: fillId(), kind, title, lengthMs: lengthSec * SEC, ...o });
  const lib = (title: string) => byTitle(title).id;
  const breaks: DbBreak[] = [
    // Aired: 1:30 of 1:30 filled.
    { id: uid(400001), stationId: BEAT.id, startsAt: at("20:28:30"), lengthMs: 90 * SEC, context: "After Late Crate, ep. 14", origin: "rule", producerShareMs: 0, fills: [f("station_id", "BEAT station ID", 5, { itemId: lib("BEAT station ID") }), f("underwriting", "Made possible by members", 15, { itemId: lib("Made possible by members") }), f("spot", "Inland Tire and Wheel", 30, { business: "Inland Tire and Wheel" }), f("spot", "Cypress Dental", 30, { business: "Cypress Dental" }), f("bumper", "Back to the reel", 10, { itemId: lib("Back to the reel") })] },
    // During Saturday Reel, carried under barter: REEL fills 1:00, 1:00 open.
    { id: uid(400002), stationId: BEAT.id, startsAt: at("20:44"), lengthMs: 2 * MIN, context: "During Saturday Reel", origin: "carried_barter", producerShareMs: MIN, fills: [f("producer", "Mission Soda", 30, { note: "REEL's break time, barter", business: "Mission Soda" }), f("producer", "Old Town Cinema", 30, { note: "REEL's break time, barter", business: "Old Town Cinema" })] },
    // After Saturday Reel: ID and bumper only, 1:30 open.
    { id: uid(400003), stationId: BEAT.id, startsAt: at("20:59"), lengthMs: 2 * MIN, context: "After Saturday Reel", origin: "rule", producerShareMs: 0, fills: [f("station_id", "BEAT station ID", 5, { itemId: lib("BEAT station ID") }), f("bumper", "Beat Tape Live, trailer", 10, { itemId: lib("Beat Tape Live, trailer") }), f("station_id", "BEAT station ID, night", 5, { itemId: lib("BEAT station ID, night") }), f("bumper", "Back to the reel", 10, { itemId: lib("Back to the reel") })] },
    // During Beat Tape Live, cued by the host: underwriting only, 1:45 open.
    { id: uid(400004), stationId: BEAT.id, startsAt: at("21:29"), lengthMs: 2 * MIN, context: "During Beat Tape Live", origin: "cued_live", producerShareMs: 0, fills: [f("underwriting", "Made possible by members", 15, { itemId: lib("Made possible by members") })] }
  ];
  return { log, breaks };
}

/** A break as the contract's BreakSlot. */
export function breakSlot(b: DbBreak) {
  const station = b.fills.filter((x) => x.kind !== "producer" && x.kind !== "open").reduce((a, x) => a + x.lengthMs, 0);
  const producer = b.fills.filter((x) => x.kind === "producer").reduce((a, x) => a + x.lengthMs, 0);
  const filledMs = station + producer;
  return {
    id: b.id,
    startsAt: b.startsAt,
    lengthMs: b.lengthMs,
    context: b.context,
    origin: b.origin,
    producerShareMs: b.producerShareMs,
    filledMs,
    openMs: Math.max(0, b.lengthMs - Math.max(filledMs, b.producerShareMs + station))
  };
}
