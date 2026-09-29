// Off air and stand by (tv 05.2): which station to offer instead, and when this one is back.
// The rule (decided): the nearest on-air, non-listed station in dial order, looking up the dial
// first, on the same band; the other band only if this one has nothing on.

import type { DialRowX } from "../../api/ext";

/** S13's `signal` is on the contract's dial row now. */
export type Row = Pick<DialRowX, "station" | "onAir" | "now" | "next" | "playback"> & { signal?: DialRowX["signal"] };

/** "REEL 24.1", kept on one line (a no-break space). */
export function identText(s: Pick<Row["station"], "callSign" | "channel" | "name">): string {
  return [s.callSign, s.channel].filter(Boolean).join("\u00a0") || s.name;
}

/** Something a viewer can be sent to: on air, playing our own stream (not a city's listed player), not waiting for its signal. */
export function canSuggest(r: Row): boolean {
  return r.onAir && r.playback?.kind === "hls" && r.station.kind !== "listed" && r.now?.kind !== "listed" && r.signal !== "standby";
}

/** The station to offer from an off-air (or standing-by) one. Null when nothing else is on. */
export function suggestion<R extends Row>(rows: R[], currentId: string | null): R | null {
  const cur = rows.find((r) => r.station.id === currentId);
  if (!cur) return null;
  const band = rows.filter((r) => r.station.band === cur.station.band);
  const i = band.indexOf(cur);
  for (let d = 1; d < band.length; d++) {
    for (const j of [i + d, i - d]) {
      const r = band[j];
      if (r && canSuggest(r)) return r;
    }
  }
  return rows.find((r) => r.station.band !== cur.station.band && canSuggest(r)) ?? null;
}

/** When an off-air station signs on again: the end of its off-air block, or its next airing. */
export function signOnAt(r: Row): string | null {
  if (r.now?.kind === "off_air") return r.now.endsAt;
  return r.next?.startsAt ?? null;
}

/** Which screen shows over the picture on "/": off air, stand by, or none. */
export function airState(r: Row | undefined, status: string): "off_air" | "standby" | null {
  if (!r) return null;
  if (status === "off_air" || !r.onAir) return "off_air";
  if (r.signal === "standby") return "standby";
  return null;
}

/**
 * The weekday to add when the sign-on isn't within the day ahead ("signs on again Tuesday at
 * 7:00 pm"); null when the time alone is clear.
 */
export function signOnDay(at: string, now: Date, timeZone: string): string | null {
  const ms = Date.parse(at) - now.getTime();
  if (!(ms > 20 * 3600_000)) return null;
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone }).format(new Date(at));
}
