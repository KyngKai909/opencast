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

// A programming block's automatic intro and outro (A244, added 2026-10-02): for a block with no
// intro (or outro) of its own that can air. Five seconds, full screen in the block's colour (else the
// station's) with its logo and name (slates.ts, `blockCard`): "Late Crate Nights" over "on 12.1 BEAT",
// and "That was Late Crate Nights". TV only (the radio band has no automatic cards). Prepared like the
// generated station ID, under a key made from what it shows, so a new name, logo or colour (the
// block's or the station's) is a new one.

export const GENERATED_BLOCK_CARD_MS = 5_000;
/** Bumped when the picture or the bed changes. */
const BLOCK_CARD_VERSION = 1;

/** What a block's automatic intro or outro shows, as its prepared key (`blk-…`). */
export function blockCardKey(look: StationLook, band: Band, block: { name: string; logoContentId: string | null; colour: string | null }, kind: "intro" | "outro"): string {
  const content = { kind, block: block.name, logo: block.logoContentId, colour: block.colour ?? look.colour, callSign: look.callSign, channel: look.channel, band, v: BLOCK_CARD_VERSION };
  return `blk-${createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 40)}`;
}

// The other apps' slate (programming Phase 6, added 2026-10-10): "Airing on Opencast, channel 12.1"
// (slates.ts, `airingOnOpencast`), for other apps (the `via=iptv` playlists), in place of a program not cleared for them. One slate
// per segment length, 1 to 4 seconds (a program's segments are 4 seconds, its last one shorter),
// over silence, prepared once per station look under a key made from what it shows, so the API can
// name it without drawing it. Its keys start `slate-`, like every slate (never planned around).

/** Bumped when the picture changes. */
const ELSEWHERE_VERSION = 1;
/** The slate lengths prepared: one for each whole second a segment rounds to. */
export const ELSEWHERE_SECONDS = [1, 2, 3, 4] as const;

/** The other-apps "Airing on Opencast" slate `seconds` long, as its prepared key (`slate-aoo-…`). */
export function elsewhereSlateKey(look: Pick<StationLook, "callSign" | "channel" | "name" | "colour">, band: Band, seconds: number): string {
  const content = { callSign: look.callSign, channel: look.channel, name: look.name, colour: look.colour, band, seconds, v: ELSEWHERE_VERSION };
  return `slate-aoo-${createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 40)}`;
}

/** The slate length for a segment `ms` long (as the relay's, 1 to 4 seconds). */
export const elsewhereSeconds = (ms: number) => Math.max(1, Math.min(4, Math.round(ms / 1000)));

/** Anything Opencast makes over the soft bed:the generated station ID, the automatic opener and closer, and (A244) a block's automatic cards. */
export const isGeneratedIdent = (key: string) => /^(sid|opn|cls|blk)-/.test(key);
