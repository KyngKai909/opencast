// The menu rail's band item. Channel up and down stay on one band (unless Settings says to include
// the radio band), so the rail is how you cross: "Radio band" tunes the radio station you last
// heard (or the first one on the air) and closes; on the radio band the same item reads "TV band"
// and goes back. The last station heard on each band is kept on the device (in memory on a Cast
// receiver).

import { useEffect } from "react";
import type { DialRowX } from "../../api/ext";

export type Band = "tv" | "radio";

const KEY = "oc-tv-band-last";
let memory: Partial<Record<Band, string>> = {};
let persist = true;

/** On a Cast receiver: nothing stored between sessions. */
export function bandsInMemory() {
  persist = false;
}

export function lastOnBand(band: Band): string | null {
  if (persist) {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Record<Band, string>>;
      return v[band] ?? null;
    } catch {
      /* fall through to memory */
    }
  }
  return memory[band] ?? null;
}

export function rememberOnBand(band: Band, stationId: string) {
  memory = { ...memory, [band]: stationId };
  if (!persist) return;
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Record<Band, string>>;
    localStorage.setItem(KEY, JSON.stringify({ ...v, [band]: stationId }));
  } catch {
    /* storage off: memory only */
  }
}

/** Keeps the last station on each band as the channel changes. */
export function useRememberBand(current: DialRowX | undefined) {
  const id = current?.station.id;
  const band = current?.station.band;
  useEffect(() => {
    if (id && (band === "tv" || band === "radio")) rememberOnBand(band, id);
  }, [id, band]);
}

/** The station to tune on a band: the last heard there, if it's on the dial; else the first on the air; else the first. */
export function bandTarget<R extends Pick<DialRowX, "station" | "onAir">>(rows: R[], band: Band, lastId: string | null): R | null {
  const on = rows.filter((r) => r.station.band === band);
  return on.find((r) => r.station.id === lastId) ?? on.find((r) => r.onAir) ?? on[0] ?? null;
}

/** The band the rail's item crosses to from here. */
export function otherBand(current: Pick<DialRowX, "station"> | undefined): Band {
  return current?.station.band === "radio" ? "tv" : "radio";
}
