// Station colours carry white text everywhere, so each must hold 4.5:1 against white
// (style guide, Colour). The API checks it too; the apps check it wherever a colour is chosen.

export const STATION_COLOUR_MIN = 4.5;

function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a #rrggbb colour (WCAG 2). */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1], 16);
  const r = channelLuminance((n >> 16) & 255);
  const g = channelLuminance((n >> 8) & 255);
  const b = channelLuminance(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The contrast ratio between two colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Whether a station colour can carry white text: at least 4.5:1 against white. */
export function stationColourPasses(hex: string): boolean {
  return contrastRatio(hex, "#FFFFFF") >= STATION_COLOUR_MIN;
}

/** "6.9:1", to the nearest tenth as the style guide writes it. A failing colour never reads 4.5:1. */
export function ratioLabel(ratio: number): string {
  const tenth = Math.round(ratio * 10) / 10;
  const shown = ratio < STATION_COLOUR_MIN && tenth >= STATION_COLOUR_MIN ? STATION_COLOUR_MIN - 0.1 : tenth;
  return `${shown.toFixed(1)}:1`;
}
