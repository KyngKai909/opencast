// The market board's figures. The API answers per band (getBoard ?band=tv, ?band=radio); the frame
// shows one set for the market. Counts add up across bands; the local share can't be added without
// hours, so it's the market-wide figure when the API sends one (N7), otherwise the TV band's.

import { type MarketBoard, SLOT_STATE_LABELS, type StationIdent } from "@opencast/contracts";
import type { BoardSlot } from "../../api/types";

export interface Coverage {
  localSharePercent: number | null;
  claimableOnAir: number;
  saidYesNotSetUp: number;
  deadAirComing: StationIdent[];
  waitlistHere: number;
  /** Independent stations (slot state `station`), subchannels counted. */
  stations: number;
  /** External city streams (slot state `listed`), subchannels counted. */
  listed: number;
  catalog: number;
  claimable: number;
}

export function coverage(tv: MarketBoard | undefined, radio: MarketBoard | undefined): Coverage {
  const boards = [tv, radio].filter((b): b is MarketBoard => !!b);
  const count = (state: BoardSlot["state"]) => boards.reduce((n, b) => n + b.slots.filter((s) => s.state === state).reduce((m, s) => m + Math.max(1, s.stations.length), 0), 0);
  const market = tv?.stats.market ?? radio?.stats.market;
  const deadAir = market?.deadAirComing ?? boards.flatMap((b) => b.stats.deadAirComing);
  return {
    localSharePercent: market ? market.localShareOfTonightPercent : (tv?.stats.localShareOfTonightPercent ?? radio?.stats.localShareOfTonightPercent ?? null),
    claimableOnAir: market?.claimableOnAir ?? boards.reduce((n, b) => n + b.stats.claimableOnAir, 0),
    // Market-wide already: the same in both answers.
    saidYesNotSetUp: (tv ?? radio)?.stats.saidYesNotSetUp ?? 0,
    deadAirComing: deadAir,
    waitlistHere: (tv ?? radio)?.stats.waitlistHere ?? 0,
    stations: count("station"),
    listed: count("listed"),
    catalog: count("catalog"),
    claimable: count("claimable")
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "8 stations, 2 claimable stations on air, 3 external city streams and the catalog station. 26 people on the waitlist here." */
export function marketLine(c: Coverage): string {
  const parts: string[] = [];
  if (c.stations) parts.push(plural(c.stations, "station", "stations"));
  if (c.claimableOnAir) parts.push(plural(c.claimableOnAir, "claimable station on air", "claimable stations on air"));
  if (c.listed) parts.push(plural(c.listed, "external city stream", "external city streams"));
  if (c.catalog) parts.push("the catalog station");
  const what = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "No stations yet");
  const waitlist = c.waitlistHere ? ` ${c.waitlistHere === 1 ? "1 person" : `${c.waitlistHere} people`} on the waitlist here.` : "";
  return `${what[0]!.toUpperCase()}${what.slice(1)}.${waitlist}`;
}

/** "HALL 90.8" */
export function callAndChannel(s: Pick<StationIdent, "callSign" | "channel" | "name">): string {
  return [s.callSign ?? s.name, s.channel].filter(Boolean).join(" ");
}

/** The four stats' captions, as drawn. */
export function statCaptions(c: Coverage) {
  const dead = c.deadAirComing.map(callAndChannel);
  return {
    local: "Of tonight's station hours are local programming",
    claimable: c.claimableOnAir === 1 ? "Claimable station on air, waiting to be claimed" : "Claimable stations on air, waiting to be claimed",
    saidYes: c.saidYesNotSetUp === 1 ? "Creator who said yes, not set up yet" : "Creators who said yes, not set up yet",
    deadAir: dead.length === 0 ? "Stations with dead air coming" : `${dead.length === 1 ? "Station" : "Stations"} with dead air coming, ${dead.join(", ")}`
  };
}

/** A slot's number as the board writes it: "33", "9.1–3" (subchannels), "88.4" (radio: major is tenths). */
export function slotNumber(slot: Pick<BoardSlot, "major" | "stations">, band: "tv" | "radio"): string {
  if (band === "radio") return (slot.major / 10).toFixed(1);
  const minors = slot.stations.map((s) => Number(s.channel?.split(".")[1] ?? 1)).sort((a, b) => a - b);
  if (minors.length > 1) return `${slot.major}.${minors[0]}–${minors[minors.length - 1]}`;
  return String(slot.major);
}

/** The slot's address in `?ch=`: "33" on TV, "88.4" on radio. */
export function slotKey(slot: Pick<BoardSlot, "major">, band: "tv" | "radio"): string {
  return band === "radio" ? (slot.major / 10).toFixed(1) : String(slot.major);
}

/** Which band a `?ch=` value is on: radio frequencies have a tenth and run 88.2 to 107.8. */
export function bandOfKey(key: string): "tv" | "radio" {
  return key.includes(".") ? "radio" : "tv";
}

/** The call sign on a slot: the station's, or the held one. */
export function slotCallSign(slot: BoardSlot): string | null {
  if (slot.state === "held") return slot.heldFor;
  if (slot.stations.length > 1) return slot.stations[0]!.callSign;
  return slot.stations[0]?.callSign ?? null;
}

/** A screen reader's words for a slot: "Channel 33, LUPE, Claimable, run by Opencast". */
export function slotLabel(slot: BoardSlot, band: "tv" | "radio"): string {
  const cs = slotCallSign(slot);
  const n = slotNumber(slot, band).replace("–", " to ");
  return [`${band === "radio" ? "" : "Channel "}${n}`, cs, SLOT_STATE_LABELS[slot.state]].filter(Boolean).join(", ");
}
