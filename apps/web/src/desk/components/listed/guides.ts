// A249 (2026-10-06): large and compressed XMLTV guides, in the desk's words. What was read from a
// guide ("Read 33 airings for ANIME x HIDIVE, one of 427 channels in the guide"), its size ("965 KB
// as it downloads (gzipped), 7.4 MB unzipped"), a guide found for a channel ("Pluto TV (US), via
// i.mjh.nz"), and the guide's problems. Pure, so it's tested alone.

import { GUIDE_LIMITS, type GuideOption, type GuideRead, type ListedSource } from "@opencast/contracts";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** "965 KB", "7.4 MB", "212 bytes". */
export function sizeWords(bytes: number): string {
  if (bytes < 1000) return `${bytes} bytes`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
}

/** "Pluto TV (US), via i.mjh.nz". */
export const optionLabel = (o: Pick<GuideOption, "label" | "via">) => `${o.label}, via ${o.via}`;

/** Whether an option is in its guide now, in words; null when it is. */
export function optionState(o: Pick<GuideOption, "inGuide">): string | null {
  if (o.inGuide === false) return "Not in the guide right now";
  if (o.inGuide === null) return "Couldn't check the guide just now";
  return null;
}

/** The channel read: "ANIME x HIDIVE (6793eaa4bc03978b9bc63db1)", or its id alone. */
export function channelWords(g: Pick<GuideRead, "channel" | "channelName">): string | null {
  if (!g.channel) return null;
  return g.channelName ? `${g.channelName} (${g.channel})` : g.channel;
}

/** "Read 33 airings to come for ANIME x HIDIVE, one of 427 channels in the guide". */
export function guideSummary(g: GuideRead): string {
  const which = g.channelName ?? g.channel;
  const of = g.channels > 1 ? `, one of ${plural(g.channels, "channel")} in the guide` : "";
  return `Read ${plural(g.programmes, "airing")} to come${which ? ` for ${which}` : ""}${of}`;
}

/** "965 KB as it downloads (gzipped), 7.4 MB unzipped" or "212 KB". */
export function guideSize(g: Pick<GuideRead, "gzip" | "bytes" | "compressedBytes">): string {
  return g.gzip ? `${sizeWords(g.compressedBytes)} as it downloads (gzipped), ${sizeWords(g.bytes)} unzipped` : sizeWords(g.bytes);
}

/** How often it's read: a large guide is asked "changed since?" and read at most every 30 minutes while it runs out. */
export const guideCadence = (g: Pick<GuideRead, "large">) =>
  g.large ? "Read every hour (every 30 minutes at most while it runs out), asking first whether it changed." : "Read every hour, asking first whether it changed.";

const MB = (n: number) => `${Math.round(n / 1_000_000)} MB`;

/** A limit a read stopped at, in words. */
export const LIMIT_WORDS: Record<NonNullable<GuideRead["limit"]>, string> = {
  compressed: `It's over ${MB(GUIDE_LIMITS.compressedBytes)} as it downloads`,
  bytes: `It's over ${MB(GUIDE_LIMITS.bytes)} unzipped`,
  programmes: `It lists over ${GUIDE_LIMITS.programmes.toLocaleString("en-US")} airings to come for the channel`,
  time: `It took over ${GUIDE_LIMITS.seconds} seconds to read`
};

/** A guide's problem on a listing, as a note for its details; null when there's none. */
export function guideProblem(s: Pick<ListedSource, "calendarSync" | "schedule">): string | null {
  const g = s.schedule?.guide ?? null;
  if (s.calendarSync === "pick_channel") {
    return `This guide has ${g ? plural(g.channels, "channel") : "several channels"}, and none is picked, so nothing from it is listed. Change, then Find this channel's guide (or add #channel= and its id to the address).`;
  }
  if (s.calendarSync === "not_in_guide") return "The channel in its address isn't in the guide right now: what it listed before stays. Change, then Find this channel's guide for another file.";
  if (s.calendarSync === "too_big") return `${g?.limit ? LIMIT_WORDS[g.limit] : "It's past Opencast's limits"}, so it wasn't read: what it listed before stays.`;
  return null;
}
