// TV settings as rules, apart from the screen: the five sections, each row's options in order,
// stepping with ◀ ▶, and where each value is kept (this TV, and the account when signed in).

import type { ViewerSettings } from "@opencast/contracts";
import { TvAccountSettings } from "../../api/ext/signIn";
import type { TvSettings } from "../../tv/device";

/** The device's settings, plus the one this area keeps beside them (asked for in tv/device.ts). */
export type TvSettingsX = TvSettings & { othersOnWifiCanChange?: boolean };

export type SectionId = "watching" | "remote" | "picture" | "account" | "about";

/** The five sections, in the order the frame draws them (tv-update 04.1). */
export const SECTIONS: Array<{ id: SectionId; label: string }> = [
  { id: "watching", label: "Watching" },
  { id: "remote", label: "Remote and phones" },
  { id: "picture", label: "Picture and sound" },
  { id: "account", label: "Account" },
  { id: "about", label: "About this TV" }
];

export function isSection(s: string | undefined): s is SectionId {
  return SECTIONS.some((x) => x.id === s);
}

export interface Option<V> {
  value: V;
  label: string;
}

/** The settings a row steps through with ◀ ▶ (a switch is two options, off and on). */
export type StepKey = "captions" | "captionSize" | "channelUp" | "bannerSeconds" | "numberWaitSeconds" | "includeRadioBand" | "quality" | "eveningOut" | "othersOnWifiCanChange";

const seconds = (n: number) => `${n} ${n === 1 ? "second" : "seconds"}`;

export const OPTIONS: { [K in StepKey]: Array<Option<NonNullable<TvSettingsX[K]>>> } = {
  captions: [
    { value: "off", label: "Off" },
    { value: "on", label: "On" },
    { value: "muted_only", label: "Muted only" }
  ],
  captionSize: [
    { value: "small", label: "Small" },
    { value: "medium", label: "Medium" },
    { value: "large", label: "Large" }
  ],
  channelUp: [
    { value: "up_the_dial", label: "Up the dial" },
    { value: "down_the_dial", label: "Down the dial" }
  ],
  bannerSeconds: ([3, 5, 8] as const).map((n) => ({ value: n, label: seconds(n) })),
  numberWaitSeconds: ([1, 1.5, 2, 3] as const).map((n) => ({ value: n, label: seconds(n) })),
  includeRadioBand: [
    { value: false, label: "Off" },
    { value: true, label: "On" }
  ],
  quality: [
    { value: "auto", label: "Auto" },
    { value: "data_saver", label: "Data saver" },
    { value: "best", label: "Best" }
  ],
  eveningOut: [
    { value: false, label: "Off" },
    { value: true, label: "On" }
  ],
  othersOnWifiCanChange: [
    { value: true, label: "Any phone" },
    { value: false, label: "The phone that started" }
  ]
};

/**
 * ◀ (-1) or ▶ (+1) on a row: the next option, stopping at the ends (the arrow at an end dims).
 * OK steps forward and goes round (`wrap`). An unknown value starts from the first option.
 */
export function step<V>(options: Array<Option<V>>, value: V, dir: -1 | 1, wrap = false): V {
  const i = options.findIndex((o) => o.value === value);
  if (i < 0) return options[0]!.value;
  let j = i + dir;
  if (wrap) j = (j + options.length) % options.length;
  else j = Math.max(0, Math.min(options.length - 1, j));
  return options[j]!.value;
}

/** Which ends a value sits at, for the dimmed arrows. */
export function ends<V>(options: Array<Option<V>>, value: V): { first: boolean; last: boolean } {
  const i = options.findIndex((o) => o.value === value);
  return { first: i <= 0, last: i === options.length - 1 };
}

export function labelOf<V>(options: Array<Option<V>>, value: V): string {
  return options.find((o) => o.value === value)?.label ?? options[0]!.label;
}

/** "Up the dial, 7.1 to 9.1, like most TVs": the first two channels on this market's TV band. */
export function channelUpHelp(dir: TvSettings["channelUp"], channels: string[]): string {
  const [a, b] = channels;
  if (dir === "down_the_dial") return a && b ? `Down the dial, ${b} to ${a}` : "Down the dial";
  return a && b ? `Up the dial, ${a} to ${b}, like most TVs` : "Up the dial, like most TVs";
}

/** Caption preview sizes: the frame's 34px is Large; the others keep the player's proportions, none under 21px. */
export const CAPTION_PREVIEW_PX: Record<TvSettings["captionSize"], number> = { small: 22, medium: 27, large: 34 };

// ---------- Where values are kept ----------

/** The account's settings, as this TV's (only what the account has; the rest stays as it is). */
export function fromAccount(s: ViewerSettings | undefined): Partial<TvSettingsX> {
  if (!s) return {};
  const out: Partial<TvSettingsX> = {};
  if (s.watching?.captions) out.captions = s.watching.captions;
  if (s.watching?.captionSize) out.captionSize = s.watching.captionSize;
  if (typeof s.tvs?.othersOnWifiCanChange === "boolean") out.othersOnWifiCanChange = s.tvs.othersOnWifiCanChange;
  const tv = TvAccountSettings.safeParse((s as Record<string, unknown>).tv ?? {});
  if (tv.success) for (const [k, v] of Object.entries(tv.data)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

/** A change on this TV, as the account's settings patch (updateMe merges sections). */
export function toAccount(patch: Partial<TvSettingsX>): ViewerSettings {
  const out: Record<string, Record<string, unknown>> = {};
  const put = (section: string, key: string, v: unknown) => {
    if (v === undefined) return;
    (out[section] ??= {})[key] = v;
  };
  put("watching", "captions", patch.captions);
  put("watching", "captionSize", patch.captionSize);
  put("tvs", "othersOnWifiCanChange", patch.othersOnWifiCanChange);
  for (const k of ["channelUp", "bannerSeconds", "numberWaitSeconds", "includeRadioBand", "quality", "eveningOut"] as const) put("tv", k, patch[k]);
  return out as ViewerSettings;
}

/** Only the keys whose value differs: what an account sync would change on this TV. */
export function changed(current: TvSettingsX, next: Partial<TvSettingsX>): Partial<TvSettingsX> {
  const out: Partial<TvSettingsX> = {};
  for (const [k, v] of Object.entries(next)) if ((current as unknown as Record<string, unknown>)[k] !== v) (out as Record<string, unknown>)[k] = v;
  return out;
}
