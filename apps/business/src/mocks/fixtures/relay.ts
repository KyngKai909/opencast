// Relay viewers in the mock (follow-up Phase 3; contracts in platforms.ts): BEAT relays to YouTube
// and Twitch, both signed in, from September 14. Orange Street Coffee is a local business, so:
//
// - YouTube's relay viewers are billed only for the share YouTube's viewer geography places inside
//   its area (60% for the mock's Redlands broadcasts), settled a day or two late: airings of the last
//   two days are still "Relay viewers, waiting for YouTube's location data"; one in six had no
//   location data (not billed); one's data never came within 7 days (returned).
// - Twitch doesn't say where viewers are: its viewers are shown, never billed.
//
// Money-neutral by construction: an airing's recorded cost (the seed's, which the balance and
// statements reconcile to) is split into Opencast's viewers and the relay viewers billed, so every
// total stays where it was. A waiting relay part's held amount is shown, not added to the balance's
// held (a mock simplification).

import { relayViewersLabel, relayWaitingLabel, type RelayViewersLine, type RelayViewersPart } from "@opencast/contracts";
import { money } from "@opencast/ui";
import { now } from "../../lib/clock";
import { STATIONS } from "./stations";
import { airingCost, type AsRun } from "./results";

const BEAT_ID = STATIONS.find((s) => s.callSign === "BEAT")!.id;
/** BEAT's relays began then (the mock's Monday, September 14, Los Angeles). */
const RELAYING_FROM = Date.parse("2026-09-14T07:00:00Z");
const WAITING_MS = 2 * 86_400_000;
const SHARE = 0.6;

function hash(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

export interface RelayView {
  parts: RelayViewersPart[];
  /** Opencast's own viewers and what they cost (the rest of the airing's recorded cost is the relay viewers billed). */
  opencastTunedIn: number;
  opencastCostMicros: number;
  relayCostMicros: number;
  waitingMicros: number;
}

/** An airing's relay parts, or null when it wasn't relayed (not BEAT, before September 14, or a flat rate). */
export function relayOf(a: AsRun, at: Date = now()): RelayView | null {
  const started = Date.parse(a.startedAt);
  if (a.stationId !== BEAT_ID || a.rate.kind !== "per_thousand" || started < RELAYING_FROM || started > at.getTime()) return null;
  const h = hash(a.id);
  const youtube = Math.max(1, Math.round(a.tunedIn * 0.35));
  const twitch = Math.max(1, Math.round(a.tunedIn * 0.1));
  const fraction = Math.min(a.airedSec, a.lengthSec) / a.lengthSec;
  const rate = `${money(a.rate.micros)} ÷ 1,000${fraction < 1 ? ` × ${Math.round(fraction * 100)}% aired` : ""}`;
  const twitchPart: RelayViewersPart = {
    platform: "twitch",
    label: relayViewersLabel("twitch"),
    status: "not_billed",
    reason: "Twitch doesn't report where viewers are, so they aren't billed to local businesses",
    viewers: twitch,
    shareInArea: null,
    billedViewers: null,
    costMicros: 0,
    heldMicros: 0,
    working: null
  };
  const whole = { opencastTunedIn: a.tunedIn, opencastCostMicros: a.costMicros, relayCostMicros: 0 };
  if (at.getTime() - started < WAITING_MS) {
    const held = airingCost(a.rate, youtube, a.airedSec, a.lengthSec);
    return {
      ...whole,
      waitingMicros: held,
      parts: [
        { platform: "youtube", label: relayWaitingLabel("youtube"), status: "waiting_location", reason: null, viewers: youtube, shareInArea: null, billedViewers: null, costMicros: 0, heldMicros: held, working: null },
        twitchPart
      ]
    };
  }
  if (h % 6 === 0) {
    return {
      ...whole,
      waitingMicros: 0,
      parts: [
        { platform: "youtube", label: relayViewersLabel("youtube"), status: "not_billed", reason: "YouTube had no location data for these viewers, so they aren't billed", viewers: youtube, shareInArea: null, billedViewers: null, costMicros: 0, heldMicros: 0, working: null },
        twitchPart
      ]
    };
  }
  if (h % 17 === 1) {
    return {
      ...whole,
      waitingMicros: 0,
      parts: [
        {
          platform: "youtube",
          label: relayViewersLabel("youtube"),
          status: "returned",
          reason: "YouTube's location data didn't arrive in time, so this wasn't charged",
          viewers: youtube,
          shareInArea: null,
          billedViewers: null,
          costMicros: 0,
          heldMicros: 0,
          returnedMicros: airingCost(a.rate, youtube, a.airedSec, a.lengthSec),
          working: null
        },
        twitchPart
      ]
    };
  }
  // Settled: the share in the area, carved out of what the airing cost in all.
  const billed = Math.min(a.tunedIn - 1, Math.round(youtube * SHARE));
  const opencastTunedIn = a.tunedIn - billed;
  const opencastCostMicros = airingCost(a.rate, opencastTunedIn, a.airedSec, a.lengthSec);
  const relayCostMicros = Math.max(0, a.costMicros - opencastCostMicros);
  return {
    opencastTunedIn,
    opencastCostMicros: a.costMicros - relayCostMicros,
    relayCostMicros,
    waitingMicros: 0,
    parts: [
      {
        platform: "youtube",
        label: relayViewersLabel("youtube"),
        status: "settled",
        reason: null,
        viewers: youtube,
        shareInArea: SHARE,
        billedViewers: billed,
        costMicros: relayCostMicros,
        heldMicros: 0,
        working: `${youtube} × ${Math.round(SHARE * 100)}% in your area × ${rate} = ${money(relayCostMicros)}`
      },
      twitchPart
    ]
  };
}

/** A period's relay viewers per platform, as results and statements add them up. */
export function relayLines(views: RelayView[]): RelayViewersLine[] {
  const by = new Map<"youtube" | "twitch", RelayViewersLine>();
  for (const v of views) {
    for (const p of v.parts) {
      const line = by.get(p.platform) ?? { platform: p.platform, label: relayViewersLabel(p.platform), airings: 0, viewersAddedUp: 0, billedViewersAddedUp: 0, spentMicros: 0, waitingMicros: 0, waitingAirings: 0, returnedMicros: 0 };
      line.airings++;
      line.viewersAddedUp += p.viewers ?? 0;
      line.billedViewersAddedUp += p.billedViewers ?? 0;
      line.spentMicros += p.costMicros;
      line.returnedMicros += p.returnedMicros ?? 0;
      if (p.status === "waiting_location") {
        line.waitingMicros += p.heldMicros;
        line.waitingAirings++;
      }
      by.set(p.platform, line);
    }
  }
  return [...by.values()].sort((a) => (a.platform === "youtube" ? -1 : 1));
}
