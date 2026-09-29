// "Watch on" is a table of target kinds, each with the route that works best there (tv-update 02
// note "Choose a TV that fits"): Chromecasts cast, Apple and AirPlay TVs mirror, TVs with the
// Opencast app open the app. A new kind (a Roku's FAST packaging, an Apple TV app) is one entry.

import type { IconName } from "@opencast/ui";
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
  // Through Cast Connect (the Android TV app registered as the receiver), so casting opens the installed app.
  tv_app: { kindLine: "Opencast app", action: "open_app", verb: "Open the app", icon: "tv" }
};

/** The order rows appear in: as found, but a TV with the app first, since it's better than casting. */
export function orderTargets(targets: CastTarget[]): CastTarget[] {
  const rank: Record<TargetKind, number> = { tv_app: 0, chromecast: 1, airplay: 1 };
  return targets.map((t, i) => ({ t, i })).sort((a, b) => rank[a.t.kind] - rank[b.t.kind] || a.i - b.i).map((x) => x.t);
}

/** Drops a second row for the same TV (a Chromecast remembered as a cast target and found again). */
export function uniqueTargets(targets: CastTarget[]): CastTarget[] {
  const seen = new Set<string>();
  return targets.filter((t) => {
    const k = `${t.kind}:${t.name.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export type Choice = { kind: "tv"; target: CastTarget } | { kind: "phone" };

/**
 * The sheet's primary button. The frame's "Play on Living room TV" says the kind's verb instead
 * (the note wins, raise 5): "Cast to Living room TV", "Mirror to Bedroom TV", "Open the app on Den TV".
 */
export function primaryLabel(choice: Choice | null, current: CastTarget | null): string | null {
  if (!choice) return null;
  if (choice.kind === "phone") return "Watch on this phone";
  if (current && current.id === choice.target.id) return "Open the remote";
  const row = TARGET_KINDS[choice.target.kind];
  if (choice.target.picker) return `${row.verb} to a TV`;
  return row.action === "open_app" ? `${row.verb} on ${choice.target.name}` : `${row.verb} to ${choice.target.name}`;
}
