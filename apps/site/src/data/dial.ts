// Every call sign and number on the site's demo dial, for "already on the dial" checks: the
// stations every page shows, plus the other markets and carriers the Network and Syndication
// pages name (added as those pages are ported). Demo data.
import { STATIONS } from "./stations";

export interface DialEntry {
  cs: string;
  n: string;
  market: string;
}

export const DIAL: readonly DialEntry[] = [...STATIONS.map((s) => ({ cs: s.cs, n: s.n, market: "Inland Empire" }))];

export const DIAL_CALL_SIGNS: readonly string[] = DIAL.map((d) => d.cs);

/** "12.1 in Inland Empire", or null when nobody has it. */
export function takenBy(cs: string): string | null {
  const d = DIAL.find((x) => x.cs === cs);
  return d ? `${d.n} in ${d.market}` : null;
}

/** Numbers in use in the Inland Empire, for suggestions. */
export const IE_NUMBERS: ReadonlySet<string> = new Set(DIAL.filter((d) => d.market === "Inland Empire").map((d) => d.n));
