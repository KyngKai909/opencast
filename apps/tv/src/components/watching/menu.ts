// The menu rail's items (tv 04.1, with the decisions since): Guide, Presets, Sleep timer (after
// Presets), the band, Your market, Captions, Settings, the station line (Pledge, when the station
// on now takes pledges) and the account. On a Cast receiver or a mirrored iPhone the phone holds
// the settings and the account, so those items aren't there.

import type { StationIdent } from "@opencast/contracts";

export type MenuItemId = "guide" | "presets" | "sleep" | "band" | "market" | "captions" | "settings" | "pledge" | "account";

export function menuItems(o: { mode: "tv" | "cast" | "mirror"; station: Pick<StationIdent, "kind"> | null }): MenuItemId[] {
  const onTv = o.mode === "tv";
  const list: Array<MenuItemId | false> = [
    "guide",
    "presets",
    "sleep",
    "band",
    onTv && "market",
    onTv && "captions",
    onTv && "settings",
    !!o.station && canPledge(o.station) && "pledge",
    onTv && "account"
  ];
  return list.filter((x): x is MenuItemId => !!x);
}

/** Pledges go to stations; listed city streams, catalogs and unclaimed stations take none. */
export function canPledge(s: Pick<StationIdent, "kind">): boolean {
  return s.kind === "station";
}

/** OK on Captions: on goes off; off (or "Muted only") goes on. */
export function toggledCaptions(v: "off" | "on" | "muted_only"): "off" | "on" {
  return v === "on" ? "off" : "on";
}

/** "5 saved", "1 saved"; nothing while loading. */
export function savedText(n: number | null): string | null {
  return n === null ? null : `${n} saved`;
}

/** "4 stations", "1 station". */
export function stationsText(n: number | null): string | null {
  return n === null ? null : `${n} ${n === 1 ? "station" : "stations"}`;
}
