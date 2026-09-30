// The presets strip (tv 04.2): six keys, what's on on each, and saving from the TV. An empty key
// offers to save the channel on now; holding OK on a full key replaces it. Signed in, keys are the
// account's (a replaced station moves to More presets, the API's rule); signed out, this TV's.

import type { Command } from "@opencast/player";
import type { DialRowX } from "../../api/ext";

export interface Slot {
  key: number;
  stationId: string | null;
  row: DialRowX | null;
}

/** Keys 1 to 6, empty where nothing is saved. */
export function sixSlots(presets: Array<{ key: number; stationId: string; row: DialRowX | null }>): Slot[] {
  return Array.from({ length: 6 }, (_, i) => {
    const p = presets.find((x) => x.key === i + 1);
    return { key: i + 1, stationId: p?.stationId ?? null, row: p?.row ?? null };
  });
}

/** Where focus starts: the key of the channel on now, or key 1. */
export function firstKey(slots: Slot[], currentId: string | null): number {
  return slots.find((s) => s.stationId && s.stationId === currentId)?.key ?? 1;
}

/** What OK does on a key: tune a full one, save to an empty one. Held: save to either (replace). */
export function okAction(slot: Slot, hold: boolean, currentId: string | null): "tune" | "save" | "none" {
  if (slot.stationId && !hold) return "tune";
  if (!currentId || slot.stationId === currentId) return slot.stationId ? "tune" : "none";
  return "save";
}

/** This TV's presets after saving a station to a key: it leaves any other key it was on. */
export function saveOnDevice(presets: Record<number, string>, key: number, stationId: string): Record<number, string> {
  const next: Record<number, string> = {};
  for (const [k, id] of Object.entries(presets)) if (id !== stationId && Number(k) !== key) next[Number(k)] = id;
  next[key] = stationId;
  return next;
}

/**
 * The line under a key: what's on now ("Live" is drawn before it), or "Off air". An external
 * station with nothing scheduled (follow-up Phase 6): "Live from City of Colton".
 */
export function nowLine(row: DialRowX | null): { live: boolean; text: string } | null {
  if (!row) return null;
  if (row.station.kind === "listed" && row.onAir && !row.now) return { live: true, text: row.external ? `from ${row.external.source}` : "" };
  if (!row.onAir || !row.now || row.now.kind === "off_air") return { live: false, text: "Off air" };
  return { live: row.now.live, text: row.now.title };
}

export type StripAction = { do: "tune"; key: number } | { do: "save"; key: number } | { do: "nothing" };

/**
 * A command while the strip is up. Numbers 1 to 6 (and a phone's preset keys) tune; the other
 * numbers do nothing; a phone's "+" saves to its key; OK held replaces the focused key. Null:
 * not the strip's (arrows, OK, Back and the rest go to the usual routing).
 */
export function stripCommand(c: Command, slots: Slot[], focused: number, currentId: string | null): StripAction | null {
  const tuneKey = (k: number): StripAction => (slots[k - 1]?.stationId ? { do: "tune", key: k } : { do: "nothing" });
  switch (c.type) {
    case "digit":
      return tuneKey(c.digit);
    case "preset":
      return tuneKey(c.key);
    case "savePreset":
      return slots[c.key - 1] && currentId ? { do: "save", key: c.key } : { do: "nothing" };
    case "select": {
      if (!c.hold) return null;
      const slot = slots[focused - 1];
      const act = slot ? okAction(slot, true, currentId) : "none";
      return act === "none" || !slot ? { do: "nothing" } : { do: act, key: slot.key };
    }
    default:
      return null;
  }
}
