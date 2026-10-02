// Pledge by QR (tv 05.4): the QR opens the viewer's own pledge page for the station
// (apps/web /:handle/pledge, $10.00 a month selected: the sheet's own default), and money
// happens on the phone. The station's address: its slug ("beat", a call-sign family member's
// "beat-12-2"), or from an older API its handle, or its call sign when it has none.

import { findByRef, stationAddress, type RefIdent } from "../../lib/stationRef";

type S = RefIdent;

/** How the station is named in addresses: its slug, else its handle, else its call sign in lower case, else its id (lib/stationRef). */
export function stationRef(s: S): string {
  return stationAddress(s);
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

/**
 * A station from the dial by the route's ref: its id, slug ("beat-12-2"), call sign (any case; a
 * shared one is X.1's) or handle. Null when it isn't on the dial (the panel asks the API).
 */
export function byRef<T extends { station: S }>(rows: T[], ref: string): T | null {
  return findByRef(rows, ref, (x) => x.station);
}
