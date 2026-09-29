// Pledge by QR (tv 05.4): the QR opens the viewer's own pledge page for the station
// (apps/viewer /:handle/pledge, $10.00 a month selected: the sheet's own default), and money
// happens on the phone. The station's handle, or its call sign when it has none.

import type { StationIdent } from "@opencast/contracts";

type S = Pick<StationIdent, "id" | "handle" | "callSign">;

/** How the station is named in addresses: its handle, else its call sign in lower case, else its id. */
export function stationRef(s: S): string {
  return s.handle || s.callSign?.toLowerCase() || s.id;
}

/** The viewer's pledge page: "/beat/pledge". */
export function pledgePath(s: S): string {
  return `/${encodeURIComponent(stationRef(s))}/pledge`;
}

/** The TV's own route for the panel: "/pledge/beat". */
export function pledgeRoute(s: S): string {
  return `/pledge/${encodeURIComponent(stationRef(s))}`;
}

/** The address the QR holds. */
export function pledgeUrl(viewerUrl: string, s: S): string {
  return viewerUrl.replace(/\/+$/, "") + pledgePath(s);
}

/** The address as the panel prints it, without the scheme: "useopencast.org/beat/pledge". */
export function shownUrl(viewerUrl: string, s: S): string {
  return pledgeUrl(viewerUrl, s).replace(/^https?:\/\//, "").replace(/^www\./, "");
}

/** A station from the dial by the route's ref: its id, call sign or handle (any case). */
export function byRef<T extends { station: S }>(rows: T[], ref: string): T | null {
  const r = ref.toLowerCase();
  return rows.find((x) => x.station.id === ref || x.station.callSign?.toLowerCase() === r || x.station.handle?.toLowerCase() === r) ?? null;
}
