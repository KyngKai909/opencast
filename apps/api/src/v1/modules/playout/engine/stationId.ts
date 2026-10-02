// The generated station ID (added 2026-09-29): for a station with no station ID of its own that
// can air. Ten seconds, full screen in the station's colour with its call sign, channel, name and
// city (slates.ts, `stationIdCard`), over a soft sound bed (prepare.ts, `SOUND_BED`); on the radio
// band, the bed alone. It's prepared once like any item, under a key made from what it shows, so a
// change to the station's name, call sign, channel, city or colour is a new key, prepared again
// (as underwriting credits are). An uploaded station ID, once it can air, always wins.

import { createHash } from "node:crypto";
import type { Band } from "./ladder.js";
import type { StationLook } from "./slates.js";

export const GENERATED_SID_MS = 10_000;
/** Bumped when the picture or the bed changes: every station's is made again. */
const VERSION = 1;

/** What the generated station ID shows, as its prepared key (`sid-…`). */
export function generatedStationIdKey(look: StationLook, band: Band): string {
  const content = { callSign: look.callSign, channel: look.channel, name: look.name, city: look.homeCity, colour: look.colour, band, v: VERSION };
  return `sid-${createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 40)}`;
}

export const isGeneratedStationId = (key: string) => key.startsWith("sid-");

// The automatic opener and closer (A242, added 2026-10-02): for a station with no opener (or no
// closer) of its own that can air. A few seconds, full screen in the station's colour (slates.ts,
// `identCard`): "12.1 BEAT · Signing on", and "12.1 BEAT · Signing off · Back at 6:00 am", over
// the same soft bed as the generated station ID (the bed alone on the radio band). Prepared like
// it, under a key made from what it shows (the closer's includes when the station is back, on the
// TV band), so a change to the station's look, or another back time, is a new one.

export const GENERATED_IDENT_MS = 5_000;
/** Bumped when the picture or the bed changes. */
const IDENT_VERSION = 1;

export type IdentKind = "opener" | "closer";

/** What the automatic opener or closer shows, as its prepared key (`opn-…`, `cls-…`). */
export function generatedIdentKey(look: StationLook, band: Band, kind: IdentKind, backAt: string | null): string {
  // The radio band has no picture: one closer whenever the station is back.
  const back = kind === "closer" && band === "tv" ? backAt : null;
  const content = { kind, callSign: look.callSign, channel: look.channel, name: look.name, colour: look.colour, back, band, v: IDENT_VERSION };
  return `${kind === "opener" ? "opn" : "cls"}-${createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 40)}`;
}

/** Anything Opencast makes over the soft bed: the generated station ID, the automatic opener and closer. */
export const isGeneratedIdent = (key: string) => /^(sid|opn|cls)-/.test(key);
