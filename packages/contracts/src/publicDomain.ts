// The public-domain rules (added 2026-09-29, the catalog's shelf): the shapes of the rules registry's
// `rights.public_domain_us` and `rights.sound_recordings_us` (Open, set in Network desk Settings),
// what they say about one item at a date, and the rights checklist they pre-fill. US works only:
// anything published elsewhere is checked by hand. Shared by the API and the desk's mocks.

import { z } from "zod";
import type { ChecklistLineName, LineState, PublicDomainReading } from "./catalogShelf.js";

export const SoundTier = z.object({ from: z.number().int(), through: z.number().int(), years: z.number().int().positive().optional(), endsOn: z.iso.date().optional() });

export const PublicDomainUs = z.object({
  jurisdiction: z.literal("US"),
  /** Works are public domain this many years after publication, from the January 1 after. */
  termYears: z.number().int().min(1).max(200),
  /** Published up to this year: public domain unless the copyright was renewed (a renewal search). */
  renewalRequiredThrough: z.number().int(),
  /** Published up to this year: public domain if published without a notice. */
  noticeRequiredThrough: z.number().int()
});
export type PublicDomainUs = z.infer<typeof PublicDomainUs>;

export const SoundRecordingsUs = z.object({
  jurisdiction: z.literal("US"),
  /** Recordings published before this year are public domain. */
  allBefore: z.number().int(),
  tiers: z.array(SoundTier)
});
export type SoundRecordingsUs = z.infer<typeof SoundRecordingsUs>;

/** The rules as migration 0027 starts them. */
export const PUBLIC_DOMAIN_US_DEFAULT: PublicDomainUs = { jurisdiction: "US", termYears: 95, renewalRequiredThrough: 1963, noticeRequiredThrough: 1977 };
export const SOUND_RECORDINGS_US_DEFAULT: SoundRecordingsUs = {
  jurisdiction: "US",
  allBefore: 1923,
  tiers: [
    { from: 1923, through: 1946, years: 100 },
    { from: 1947, through: 1956, years: 110 },
    { from: 1957, through: 1972, endsOn: "2067-02-15" }
  ]
};

/** The US public-domain cut-off at a moment: works published in this year or earlier. Moves every January 1. */
export function cutoffYear(rule: PublicDomainUs, at: Date): number {
  return at.getUTCFullYear() - rule.termYears - 1;
}

/** Sound recordings published in this year or earlier are public domain at `at` (only the leading, contiguous years count). */
export function soundCutoffYear(rule: SoundRecordingsUs, at: Date): number {
  const year = at.getUTCFullYear();
  let cutoff = rule.allBefore - 1;
  for (const tier of [...rule.tiers].sort((a, b) => a.from - b.from)) {
    for (let y = tier.from; y <= tier.through; y++) {
      const free = tier.years !== undefined ? year > y + tier.years : tier.endsOn !== undefined ? at.getTime() > Date.parse(`${tier.endsOn}T23:59:59Z`) : false;
      if (!free) return cutoff;
      cutoff = y;
    }
  }
  return cutoff;
}

export interface ItemFacts {
  workKind: "film" | "sound_recording";
  publishedYear: number | null;
  country: string;
  usGovernment: boolean;
}

export function readPublicDomain(item: ItemFacts, rules: { works: PublicDomainUs; sound: SoundRecordingsUs }, at: Date): PublicDomainReading {
  const cutoff = cutoffYear(rules.works, at);
  const soundCutoff = soundCutoffYear(rules.sound, at);
  const base = { jurisdiction: "US" as const, asOf: at.toISOString(), cutoffYear: cutoff, soundRecordingsCutoffYear: soundCutoff };
  const y = item.publishedYear;
  if (item.usGovernment) return { ...base, verdict: "us_government", line: "A US government work: public domain by law" };
  if (item.country.toUpperCase() !== "US") return { ...base, verdict: "check_by_hand", line: "Published outside the US: the rules here are US rules. Check that country's by hand" };
  if (y === null) return { ...base, verdict: "check_by_hand", line: "Say the year it was published to read the rules" };
  if (item.workKind === "sound_recording") {
    if (y <= soundCutoff) return { ...base, verdict: "public_domain", line: `Recorded and published ${y}, before ${soundCutoff + 1}` };
    const tier = rules.sound.tiers.find((t) => y >= t.from && y <= t.through);
    if (tier) {
      const until = tier.years !== undefined ? `the end of ${y + tier.years}` : tier.endsOn ? new Date(`${tier.endsOn}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "later";
      return { ...base, verdict: "in_copyright", line: `A recording from ${y}: protected until ${until}` };
    }
    if (y <= rules.works.noticeRequiredThrough) return { ...base, verdict: "needs_notice_check", line: `Published ${y}: public domain only if published without a copyright notice` };
    return { ...base, verdict: "in_copyright", line: `Published ${y}: still in copyright` };
  }
  if (y <= cutoff) return { ...base, verdict: "public_domain", line: `Published ${y}, before ${cutoff + 1}` };
  if (y <= rules.works.renewalRequiredThrough) return { ...base, verdict: "needs_renewal_search", line: `Published ${y}: public domain only if its copyright wasn't renewed` };
  if (y <= rules.works.noticeRequiredThrough) return { ...base, verdict: "needs_notice_check", line: `Published ${y}: public domain only if published without a copyright notice` };
  return { ...base, verdict: "in_copyright", line: `Published ${y}: still in copyright` };
}

export interface LineTemplate {
  line: ChecklistLineName;
  title: string;
  help: string;
  /** Set from the rules: a line the rules answer (not needed), or one they fail. */
  prefill: { state: LineState; detail: string } | null;
}

/** The checklist for an item, with what the rules answer already filled in. */
export function checklistFor(item: ItemFacts, reading: PublicDomainReading): LineTemplate[] {
  const y = item.publishedYear;
  const v = reading.verdict;
  const published: LineTemplate =
    v === "us_government"
      ? { line: "published", title: "A US government work", help: "The agency that made it, and a record showing it was made by the government's own staff", prefill: null }
      : {
          line: "published",
          title: y === null ? "Published, and when" : v === "public_domain" ? `Published ${y}, before ${reading[item.workKind === "sound_recording" ? "soundRecordingsCutoffYear" : "cutoffYear"] + 1}` : v === "needs_notice_check" ? `Published ${y}` : `Published ${y}, with a copyright notice`,
          help: "The title card, label or a catalog record showing the year (and the notice, if there is one)",
          prefill: null
        };
  let renewal: LineTemplate;
  if (v === "public_domain" || v === "us_government") {
    renewal = {
      line: "renewal",
      title: "Copyright not renewed",
      help: "Only for works published after the cut-off",
      prefill: { state: "not_needed", detail: v === "us_government" ? "Government works have no copyright to renew" : `Published before ${reading.cutoffYear + 1}: no renewal search needed` }
    };
  } else if (v === "needs_renewal_search" && y !== null) {
    renewal = {
      line: "renewal",
      title: "Copyright not renewed",
      help: `Renewal would have been due in ${y + 27} or ${y + 28}. Search the Copyright Office renewal records for the title and studio`,
      prefill: null
    };
  } else if (v === "needs_notice_check") {
    renewal = { line: "renewal", title: "Published without a copyright notice", help: "Copies from the time with no notice on them, and the Copyright Office's records", prefill: null };
  } else if (v === "in_copyright") {
    renewal = { line: "renewal", title: "Still in copyright", help: "The rules in Settings say it isn't public domain yet", prefill: { state: "fail", detail: reading.line } };
  } else {
    renewal = { line: "renewal", title: "Copyright status", help: "Check the rules for where and when it was published, by hand", prefill: null };
  }
  return [
    {
      line: "source",
      title: "Source is an original, not a restoration",
      help: "A scan of an original print or archive copy. A modern restoration can carry its own new copyright",
      prefill: null
    },
    published,
    renewal,
    item.workKind === "sound_recording"
      ? { line: "soundtrack", title: "What's recorded", help: "The script or song itself: public domain too, or published with the recording", prefill: null }
      : { line: "soundtrack", title: "Soundtrack", help: "Music in it: published with the film, or public domain on its own", prefill: null },
    { line: "trademarks", title: "Characters and trademarks", help: "A character or logo someone holds a trademark in is fine to air, never to promote the series", prefill: null }
  ];
}

/** The item's basis once it passes, from the reading and what the checker answered. */
export function basisOf(reading: PublicDomainReading, renewalState: LineState): "us_government" | "published_before_cutoff" | "not_renewed" | "no_notice" | "sound_recording_term" | null {
  switch (reading.verdict) {
    case "us_government":
      return "us_government";
    case "public_domain":
      return reading.line.startsWith("Recorded") ? "sound_recording_term" : "published_before_cutoff";
    case "needs_renewal_search":
      return renewalState === "ok" ? "not_renewed" : null;
    case "needs_notice_check":
      return renewalState === "ok" ? "no_notice" : null;
    default:
      return null;
  }
}

/** As stations see it under "Rights". */
export function basisLine(basis: ReturnType<typeof basisOf>, year: number | null, reading: PublicDomainReading): string {
  switch (basis) {
    case "us_government":
      return "US government work. Public domain by law";
    case "published_before_cutoff":
      return `Published ${year}, before ${reading.cutoffYear + 1}`;
    case "sound_recording_term":
      return `Recorded ${year}, before ${reading.soundRecordingsCutoffYear + 1}`;
    case "not_renewed":
      return "Not renewed. Copyright Office records searched";
    case "no_notice":
      return `Published ${year} without a copyright notice`;
    default:
      return reading.line;
  }
}
