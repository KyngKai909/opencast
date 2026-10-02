// Station identity rules. The database enforces the same rules (see
// packages/db); these are the versions the API and apps check before writing.

export type Band = "tv" | "radio";

/** 3 to 5 capital letters, unique platform-wide, fixed after first sign-on. */
export const CALL_SIGN_PATTERN = /^[A-Z]{3,5}$/;

export function isValidCallSign(value: string): boolean {
  return CALL_SIGN_PATTERN.test(value);
}

/**
 * A channel number as it appears on the dial: TV `2.1` to `69.9`, radio
 * `88.2` to `107.8` in even tenths. Stored in tenths so it compares exactly.
 *
 * Real US FM stations are only on odd tenths (88.1 to 107.9), so the radio band
 * keeps to even ones and no Opencast number can match a real station (changed
 * 2026-09-29). TV is Opencast's own network band and may match broadcast numbers.
 */
export interface ChannelNumber {
  band: Band;
  /** The number times ten: `12.2` is 122, `88.2` is 882. */
  tenths: number;
}

export function parseChannelNumber(band: Band, value: string): ChannelNumber | undefined {
  const match = /^(\d{1,3})\.(\d)$/.exec(value.trim());
  if (!match) {
    return undefined;
  }
  const tenths = Number(match[1]) * 10 + Number(match[2]);
  const parsed = { band, tenths };
  return isValidChannelNumber(parsed) ? parsed : undefined;
}

export function isValidChannelNumber({ band, tenths }: ChannelNumber): boolean {
  if (!Number.isInteger(tenths)) {
    return false;
  }
  if (band === "tv") {
    // Every TV channel has a subchannel digit: 12.1 is the main channel, 12.2 a subchannel.
    return tenths >= 21 && tenths <= 699 && tenths % 10 !== 0;
  }
  return tenths >= RADIO_BAND_MIN_TENTHS && tenths <= RADIO_BAND_MAX_TENTHS && tenths % 2 === 0;
}

/** The radio band's ends, in tenths: 88.2 and 107.8. Every even tenth between is a frequency. */
export const RADIO_BAND_MIN_TENTHS = 882;
export const RADIO_BAND_MAX_TENTHS = 1078;

/** Every frequency on the radio band, in tenths, low to high: 882, 884 … 1078 (99 of them). */
export function radioBandTenths(): number[] {
  const out: number[] = [];
  for (let t = RADIO_BAND_MIN_TENTHS; t <= RADIO_BAND_MAX_TENTHS; t += 2) out.push(t);
  return out;
}

export function formatChannelNumber({ tenths }: ChannelNumber): string {
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

/** A subchannel is any TV channel after `.1`; radio has none. */
export function isSubchannel({ band, tenths }: ChannelNumber): boolean {
  return band === "tv" && tenths % 10 !== 1;
}

/**
 * A station that signs off for good (or an external station taken off the dial for good) keeps its
 * channel this long, then the number is freed (A221, A223). Its call sign stays on its row, held a
 * year on the waitlist's side.
 */
export const CHANNEL_HOLD_AFTER_SIGN_OFF_DAYS = 90;
export const CHANNEL_HOLD_AFTER_SIGN_OFF_MS = CHANNEL_HOLD_AFTER_SIGN_OFF_DAYS * 86_400_000;

/** When a channel held after signing off for good is freed. */
export function channelFreedAt(signedOffAt: Date): Date {
  return new Date(signedOffAt.getTime() + CHANNEL_HOLD_AFTER_SIGN_OFF_MS);
}

// ---- Shared call signs (added 2026-09-30, A229) ----
//
// One brand's streams on one channel's subchannels can share a call sign, as real TV does (KCET,
// KCET-DT2): 15.1 SBCO, 15.2 SBCO, 15.3 SBCO. Only X.n (n ≥ 2) beside X.1 in the same market and
// major, and only external stations beside an external X.1 or an owner's own stations beside its
// X.1 (never mixed). The channel tells them apart, so each family member's address carries it:
// X.1 keeps `/watch/sbco`, X.2 is `/watch/sbco-15-2`.

/** The station a family member shares its call sign with sits on X.1 of the same major. */
export function familyHeadTenths(tenths: number): number {
  return Math.floor(tenths / 10) * 10 + 1;
}

/** Whether a TV channel may share X.1's call sign: X.n, n ≥ 2, same major (radio never). */
export function canShareCallSignOn(member: ChannelNumber, head: ChannelNumber): boolean {
  return member.band === "tv" && head.band === "tv" && isSubchannel(member) && head.tenths === familyHeadTenths(member.tenths);
}

/** A station's part of an address: its call sign in lower case ("beat"), a family member's with its channel ("sbco-15-2"). */
export function stationSlugOf(s: { id: string; callSign: string | null; handle?: string | null; channel?: string | null; familyMember?: boolean }): string {
  if (s.callSign && s.familyMember && s.channel) return `${s.callSign.toLowerCase()}-${s.channel.replace(".", "-")}`;
  return (s.callSign ?? s.handle ?? s.id).toLowerCase();
}

/**
 * An address's station part: a call sign ("sbco", "SBCO"), or a call sign with its channel
 * ("sbco-15-2", which also names a station that doesn't share: "beat-12-1"). Null for anything else.
 */
export function parseStationSlug(ref: string): { callSign: string; tenths: number | null } | null {
  const m = /^([a-z]{3,5})(?:-(\d{1,2})-([1-9]))?$/i.exec(ref.trim());
  if (!m) return null;
  return { callSign: m[1].toUpperCase(), tenths: m[2] ? Number(m[2]) * 10 + Number(m[3]) : null };
}

/**
 * How a station is named where only a call sign would show (a notification's title, a compact
 * row, a log line): the call sign, with the channel when it shares it ("SBCO 15.2"), so family
 * members are told apart.
 */
export function callSignLabel(s: { callSign: string | null; channel?: string | null; sharesCallSign?: boolean; name?: string }): string {
  if (!s.callSign) return s.name ?? "";
  return s.sharesCallSign && s.channel ? `${s.callSign} ${s.channel}` : s.callSign;
}

/** Station colours must hold this contrast against white text. */
export const MIN_STATION_COLOUR_CONTRAST = 4.5;

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

function channelLuminance(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#rrggbb` colour. */
export function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** Contrast ratio of a `#rrggbb` colour against white, from 1 to 21. */
export function contrastOnWhite(hex: string): number {
  return 1.05 / (relativeLuminance(hex) + 0.05);
}

export function isValidStationColour(hex: string): boolean {
  return HEX_COLOUR.test(hex) && contrastOnWhite(hex) >= MIN_STATION_COLOUR_CONTRAST;
}
