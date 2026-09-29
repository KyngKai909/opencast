// A planned sign-off to match the mock stream's. `?signoff=prep` (or `signoff=1`, which means
// PREP) in the app's address makes the mock stream server sign that station off within about a
// minute (packages/player/mock/live-hls.mjs: the slate, `#EXT-X-ENDLIST`, 30 seconds off, then a
// new playlist from its station ID). This asks the stream server for those times once and puts the
// same sign-off in the schedule, in the app's clock, so the dial, the guide, the station page and
// the heartbeat agree with the picture: an "Off air" airing (G9) from the sign-off to when it's
// back, with the program it cut into resuming after.

import { now } from "../../lib/clock";
import { AIRINGS, type MockAiring } from "./schedule";
import { resetHomeAirings } from "./home";
import { stationByRef, uid } from "./stations";

/** The station the address asks to sign off, if any (as live-hls.mjs reads it). */
export function signOffAsked(search: string): string | null {
  const v = new URLSearchParams(search).get("signoff");
  if (!v) return null;
  const first = v.split(",")[0]!.trim().toLowerCase();
  return ["1", "on", "true", "yes"].includes(first) ? "prep" : first === "off" ? null : first;
}

/**
 * Puts a sign-off into the schedule: the station's airings that overlap [from, back) are cut at
 * `from` and resume at `back`, with one off air airing between. Times are ISO in the app's clock.
 */
export function applySignOff(list: MockAiring[], stationId: string, from: string, back: string): void {
  const mine = list.filter((a) => a.stationId === stationId && a.end > from && a.start < back && !a.offAir);
  for (const a of mine) {
    const rest = a.end > back ? { ...a, id: uid(880100 + list.length), start: back } : null;
    if (a.start < from) a.end = from;
    else list.splice(list.indexOf(a), 1);
    if (rest) list.push(rest);
  }
  list.push({ id: uid(880000 + list.length), stationId, title: "Off air", start: from, end: back, programId: null, offAir: true });
}

let pending: Promise<void> | null = null;

/** Once per page: fetch the stream's sign-off (when the address asks for one) and apply it. */
export function syncStreamSignOff(): Promise<void> {
  if (pending) return pending;
  const slug = typeof window === "undefined" ? null : signOffAsked(window.location.search);
  const station = slug ? stationByRef(slug) : null;
  if (!slug || !station) return (pending = Promise.resolve());
  pending = fetch(`/mock-hls/_signoff?station=${encodeURIComponent(slug)}`)
    .then((r) => (r.ok ? (r.json() as Promise<{ slateAt: string; backAt: string }>) : null))
    .then((j) => {
      if (!j) return;
      // The stream runs on the wall clock; the app's mock clock starts at the reference moment.
      const skew = now().getTime() - Date.now();
      const inApp = (iso: string) => new Date(Date.parse(iso) + skew).toISOString();
      applySignOff(AIRINGS, station.ident.id, inApp(j.slateAt), inApp(j.backAt));
      resetHomeAirings();
    })
    .catch(() => {});
  return pending;
}
