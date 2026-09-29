// Listings words (live-listings 03.1): the status, and the line under each program.

import type { Listing } from "@opencast/contracts";

/** The categories a listing can be in (one list for now; S17 asks for it from the API). */
export const CATEGORIES = ["Music", "Talk", "Public affairs", "Food", "Classic"];

export const STATUS: Record<Listing["status"], string> = { complete: "Complete", needs_description: "Needs a description", from_the_maker: "From the maker" };

/** L7: a caption language's name ("en" reads "English"); what the API has when the browser can't say. */
export function languageName(code: string | null): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(["en-US"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export const isEpisodeNumber = (t: string | null) => !!t && /^ep\. \d+$/.test(t);

/** The listing line under the program (03.1). */
export function listingLine(l: Listing): string {
  if (l.carriedFrom) return `From ${[l.carriedFrom.callSign ?? l.carriedFrom.name, l.carriedFrom.channel].filter(Boolean).join(" ")}, read-only`;
  if (l.status === "needs_description") return l.imported ? "Imported, no description" : "No episode description";
  const own = !isEpisodeNumber(l.episodeTitle) ? l.episodeTitle : null;
  if (l.kind === "live") return `Live. ${own ?? l.program?.description ?? ""}`.trim();
  return own ?? l.localNote ?? l.episodeDescription ?? l.program?.description ?? "";
}

