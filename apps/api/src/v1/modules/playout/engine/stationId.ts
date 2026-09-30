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
