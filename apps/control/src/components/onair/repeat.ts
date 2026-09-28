// "Repeat from your library" (A.4, P.2): which programs fill a gap. The newest series the station
// can air, its latest episodes in order, as few as cover the gap (the log places them in whole
// minutes with the break rule, and cuts the last one where the next program starts).

import type { LibraryItem, Program } from "@opencast/contracts";
import { clock } from "@opencast/ui";
import { STATION_TZ } from "../../lib/clock";
import { wholeMinutes } from "./time";

export interface RepeatPlan {
  itemIds: string[];
  /** "Late Crate episodes 12 to 15, in order, with your break rule" (the log's pane). */
  long: string;
  /** "Late Crate 12 to 15, until 2:00 am" (the phone's sheet). */
  short: string;
}

/** Items that can go on the log: programs, ready for air, with their rights confirmed. */
export function airable(items: LibraryItem[]): LibraryItem[] {
  return items.filter((i) => i.code === "PGM" && i.status === "ready" && i.rights !== null && i.durationMs);
}

export function planRepeat(items: LibraryItem[], programs: Pick<Program, "id" | "title">[], gap: { startsAt: string; endsAt: string }, breakMs: number, tz = STATION_TZ): RepeatPlan | null {
  const pool = airable(items);
  if (!pool.length) return null;
  const groups = new Map<string, LibraryItem[]>();
  for (const i of pool) {
    const k = i.programId ?? i.id;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  const newest = (g: LibraryItem[]) => Math.max(...g.map((i) => Date.parse(i.createdAt)));
  const [key, group] = [...groups.entries()].sort((a, b) => newest(b[1]) - newest(a[1]))[0];
  const series = [...group].sort((a, b) => (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0) || Date.parse(a.createdAt) - Date.parse(b.createdAt));

  // The fewest latest episodes that cover the gap; the whole series (repeated) when none do.
  const gapMs = Date.parse(gap.endsAt) - Date.parse(gap.startsAt);
  let chosen = series;
  let total = 0;
  for (let n = 1; n <= series.length; n++) {
    total += wholeMinutes(series[series.length - n].durationMs ?? 0) + breakMs;
    if (total >= gapMs) {
      chosen = series.slice(series.length - n);
      break;
    }
  }

  const until = clock(gap.endsAt, { timeZone: tz });
  const title = programs.find((p) => p.id === key)?.title ?? null;
  const eps = chosen.map((i) => i.episodeNumber);
  const numbered = title && eps.every((n): n is number => n !== null) && eps.every((n, i) => i === 0 || n === (eps[i - 1] as number) + 1);
  if (chosen.length === 1) {
    const one = chosen[0].title;
    return { itemIds: [chosen[0].id], long: `${one}, repeated, with your break rule`, short: `${one}, until ${until}` };
  }
  if (numbered) {
    const range = `${eps[0]} to ${eps[eps.length - 1]}`;
    return { itemIds: chosen.map((i) => i.id), long: `${title} episodes ${range}, in order, with your break rule`, short: `${title} ${range}, until ${until}` };
  }
  return { itemIds: chosen.map((i) => i.id), long: `${chosen.length} programs from your library, in order, with your break rule`, short: `${chosen.length} programs from your library, until ${until}` };
}
