// The Audience page's words for a program row.

import { clock } from "@opencast/ui";
import type { AudienceProgram } from "../../api/types";

/** Where a program came from: "From your library", "Carried from REEL 24.1", "Live". */
export function sourceLine(p: Pick<AudienceProgram, "source" | "carriedFrom">): string {
  if (p.source === "carried" && p.carriedFrom) return `Carried from ${p.carriedFrom.callSign ?? p.carriedFrom.name}${p.carriedFrom.channel ? ` ${p.carriedFrom.channel}` : ""}`;
  if (p.source === "live") return "Live";
  return "From your library";
}

/** The Aired column: am/pm on the first time and wherever it changes ("6:00 pm", "8:00", "8:30"). */
export function airedTimes(times: string[], timeZone: string): string[] {
  let last = "";
  return times.map((t) => {
    const full = clock(t, { timeZone });
    const period = full.slice(-2);
    const out = period === last ? clock(t, { timeZone, suffix: false }) : full;
    last = period;
    return out;
  });
}

