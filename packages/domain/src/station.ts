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
