// "Watch on" is a table of target kinds, each with the route that works best there (tv-update 02
// note "Choose a TV that fits"): Chromecasts cast, Apple and AirPlay TVs mirror, TVs with the
// Opencast app open the app. A new kind (a Roku's FAST packaging, an Apple TV app) is one entry.

import type { IconName } from "@opencast/ui";
import type { Tv, TvPlatform } from "@opencast/contracts";
import type { Pairing } from "./pairings";
import type { CastTarget, TargetKind } from "./types";

export type TargetAction = "cast" | "mirror" | "open_app";

export interface TargetKindRow {
  /** The row's second line in "Watch on" (06.2). */
  kindLine: string;
  action: TargetAction;
  /** What the note says each kind says. */
  verb: string;
  icon: IconName;
}

export const TARGET_KINDS: Record<TargetKind, TargetKindRow> = {
  chromecast: { kindLine: "Chromecast", action: "cast", verb: "Cast", icon: "tv" },
  airplay: { kindLine: "AirPlay", action: "mirror", verb: "Mirror", icon: "tv" },
  // The Opencast app on the TV, signed in to the account (B2's listTvs) or paired by a code from the
  // TV: driven through the API's relay (relay.ts), so it works from any browser.
  tv_app: { kindLine: "Opencast app", action: "open_app", verb: "Open the app", icon: "tv" }
};

/** The apps' names for a TV app's platform (the contract sends the enum). */
export const PLATFORM_LABELS: Record<TvPlatform, string> = {
  android_tv: "Android TV",
  fire_tv: "Fire TV",
  google_tv: "Google TV",
  tv_browser: "TV browser",
  web: "Web"
};

export function platformLabel(platform: TvPlatform | null | undefined): string | null {
  return platform ? PLATFORM_LABELS[platform] : null;
}

/** A TV app that isn't connected to the relay now. */
export function offlineLine(tvName: string): string {
  return `${tvName} isn't on. Open Opencast on the TV and try again.`;
}

/** The account's TV apps that a phone can drive (signed in), as "Watch on" rows. */
export function tvAppTargets(tvs: readonly Tv[]): CastTarget[] {
  return tvs.filter((t) => t.kind === "tv_app" && t.signedIn).map((t) => ({ id: t.id, name: t.name, kind: "tv_app" as const, online: t.online, platformLabel: platformLabel(t.platform) }));
}

/** TVs this phone paired with by code. Whether they're on isn't known until connecting. */
export function pairedTargets(pairings: readonly Pairing[]): CastTarget[] {
  return pairings.map((p) => ({ id: p.tvId, name: p.tvName, kind: "tv_app" as const, paired: true }));
}

/** A row's second line in "Watch on": the kind, with the TV app's platform, or that it isn't on. */
export function targetLine(t: CastTarget): string {
  if (t.kind === "tv_app") {
    if (t.online === false) return "Opencast app, not on now";
    return t.platformLabel ? `Opencast app on ${t.platformLabel}` : TARGET_KINDS.tv_app.kindLine;
  }
  return TARGET_KINDS[t.kind].kindLine;
}

/**
 * The order rows appear in: as found, but a TV with the app first, since it's better than casting;
 * a TV app that isn't on goes last, since it can't be used until it is.
 */
export function orderTargets(targets: CastTarget[]): CastTarget[] {
  const rank = (t: CastTarget) => (t.kind === "tv_app" ? (t.online === false ? 2 : 0) : 1);
  return targets.map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i).map((x) => x.t);
}

/**
 * Drops a second row for the same TV: a Chromecast remembered as a cast target and found again, or a
 * TV app that's both on the account and paired by code (the account's row wins, coming first).
 */
export function uniqueTargets(targets: CastTarget[]): CastTarget[] {
  const seen = new Set<string>();
  return targets.filter((t) => {
    const k = t.kind === "tv_app" ? `tv_app:${t.id}` : `${t.kind}:${t.name.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** `airplay`: Safari's own AirPlay list (the stream plays on the TV; not a target this app finds). */
export type Choice = { kind: "tv"; target: CastTarget } | { kind: "phone" } | { kind: "airplay"; active: boolean };

/**
 * The sheet's primary button. The frame's "Play on Living room TV" says the kind's verb instead
 * (the note wins, raise 5): "Cast to Living room TV", "Mirror to Bedroom TV", "Open the app on Den TV".
 */
export function primaryLabel(choice: Choice | null, current: CastTarget | null): string | null {
  if (!choice) return null;
  if (choice.kind === "phone") return "Watch on this phone";
  if (choice.kind === "airplay") return choice.active ? "Stop AirPlay" : "AirPlay to a TV";
  if (current && current.id === choice.target.id) return "Open the remote";
  const row = TARGET_KINDS[choice.target.kind];
  if (choice.target.picker) return `${row.verb} to a TV`;
  return row.action === "open_app" ? `${row.verb} on ${choice.target.name}` : `${row.verb} to ${choice.target.name}`;
}
