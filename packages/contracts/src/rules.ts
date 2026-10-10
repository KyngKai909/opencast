// The rules registry's definitions (added 2026-09-29, Network desk Settings): every Open rule the
// platform reads, its value's shape (the API checks every write against it), the value in effect
// before the registry (the first version, set by migration 0027), and how it reads on the Rules
// page. Adding a rule is adding it here, and a first version. Shared by the API and the desk's mocks.

import { z } from "zod";
import { Numbering, type RuleGroup } from "./desk.js";
import { PUBLIC_DOMAIN_US_DEFAULT, PublicDomainUs, SOUND_RECORDINGS_US_DEFAULT, SoundRecordingsUs, cutoffYear, soundCutoffYear } from "./publicDomain.js";
import { CALL_SIGN_RULES_DEFAULT, CallSignRules } from "./callSigns.js";

const Bps = z.number().int().min(0).max(10_000);
const PriceOrUnset = z.number().int().min(0).nullable();
const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export interface RuleDef<S extends z.ZodType = z.ZodType> {
  group: RuleGroup;
  title: string;
  /** The line under the title. A function when it follows the value (platform limits). */
  detail: string | ((value: z.infer<S>) => string);
  schema: S;
  /** The value in effect before the registry, when no version exists at all. */
  fallback: z.infer<S>;
  /** How it reads at a moment (the public-domain cut-off year depends on the date). */
  display(value: z.infer<S>, at: Date): string;
  /** False: "Not set yet" (an Open rule nobody has decided). */
  isSet?(value: z.infer<S>): boolean;
  /** Per market (numbering): a market's own versions win over the Opencast-wide ones. */
  scoped?: boolean;
  /** Changed only another way (escrow signers: a proposal the other admins approve). */
  readOnly?: boolean;
}

const def = <S extends z.ZodType>(d: RuleDef<S>) => d;

const dollars = (micros: number) => {
  const d = micros / 1_000_000;
  return `$${d < 1 ? d.toFixed(d < 0.01 ? 4 : d < 0.1 ? 3 : 2) : d.toFixed(2)}`.replace(/(\.\d*?[1-9])0+$/, "$1");
};
const pct = (bps: number) => `${bps % 100 ? (bps / 100).toFixed(2).replace(/0+$/, "") : String(bps / 100)}%`;

export const RULES = {
  "prices.storage": def({
    group: "pay_as_you_go",
    title: "Storage",
    detail: "Per GB a month, originals and prepared together",
    schema: z.object({ perGbMonthMicros: PriceOrUnset }),
    fallback: { perGbMonthMicros: null },
    display: (v) => (v.perGbMonthMicros === null ? "Not set yet" : `${dollars(v.perGbMonthMicros)} a GB a month`),
    isSet: (v) => v.perGbMonthMicros !== null
  }),
  "prices.relay_everything": def({
    group: "pay_as_you_go",
    title: "Relays, everything a station airs",
    detail: "Per hour relayed, per station",
    schema: z.object({ perHourMicros: PriceOrUnset }),
    fallback: { perHourMicros: null },
    display: (v) => (v.perHourMicros === null ? "Not set yet" : `${dollars(v.perHourMicros)} an hour`),
    isSet: (v) => v.perHourMicros !== null
  }),
  "prices.live_hours": def({
    group: "pay_as_you_go",
    title: "Live hours",
    detail: "Per hour live",
    schema: z.object({ perHourMicros: PriceOrUnset }),
    fallback: { perHourMicros: null },
    display: (v) => (v.perHourMicros === null ? "Not set yet" : `${dollars(v.perHourMicros)} an hour`),
    isSet: (v) => v.perHourMicros !== null
  }),
  // Added 2026-09-29 (follow-up Phase 2): radio live through the worker's own ingest (not Livepeer), its own type so it can be priced apart. Free by default (Open).
  "prices.radio_live": def({
    group: "pay_as_you_go",
    title: "Radio live",
    detail: "Per hour live on the radio band, through Opencast's own ingest rather than Livepeer",
    schema: z.object({ perHourMicros: PriceOrUnset }),
    fallback: { perHourMicros: 0 } as { perHourMicros: number | null },
    display: (v) => (v.perHourMicros === null ? "Not set yet" : v.perHourMicros === 0 ? "Free" : `${dollars(v.perHourMicros)} an hour`),
    isSet: (v) => v.perHourMicros !== null
  }),
  "prices.free_allowance": def({
    group: "pay_as_you_go",
    title: "Free each month",
    detail: "Before anything is charged",
    schema: z.object({ storageGb: z.number().min(0).max(100_000), liveHours: z.number().min(0).max(10_000) }),
    fallback: { storageGb: 10, liveHours: 5 },
    display: (v) => `${v.storageGb} GB, ${v.liveHours} live ${v.liveHours === 1 ? "hour" : "hours"}`
  }),
  // Added 2026-09-29 (follow-up Phase 2): how long a station keeps its relays and live hours after a bill goes unpaid.
  "billing.grace": def({
    group: "pay_as_you_go",
    title: "Grace period",
    detail: "After a month's usage can't be charged, relays and live hours keep going this long, then pause until it's paid. The channel never pauses",
    schema: z.object({ days: z.number().int().min(1).max(60), warnDaysBefore: z.number().int().min(1).max(30) }).refine((v) => v.warnDaysBefore < v.days, { message: "The warning goes before the end" }),
    fallback: { days: 14, warnDaysBefore: 3 },
    display: (v) => `${v.days} ${v.days === 1 ? "day" : "days"}, a warning ${v.warnDaysBefore} ${v.warnDaysBefore === 1 ? "day" : "days"} before`
  }),
  "shares.opencast": def({
    group: "shares",
    title: "Opencast's share of spots and sponsorships",
    detail: "Taken from the station's side",
    schema: z.object({ spotBps: Bps, pledgeBps: Bps, productionBps: Bps }),
    fallback: { spotBps: 0, pledgeBps: 0, productionBps: 0 },
    display: (v) => (!v.spotBps && !v.pledgeBps && !v.productionBps ? "0%, not set yet" : `${pct(v.spotBps)} of spots, ${pct(v.pledgeBps)} of pledges, ${pct(v.productionBps)} of production`),
    isSet: (v) => !!(v.spotBps || v.pledgeBps || v.productionBps)
  }),
  "shares.pool": def({
    group: "shares",
    title: "The pool",
    detail: "Base share, watch-time share, creator fund",
    schema: z.object({ shareBps: Bps, baseBps: Bps, watchTimeBps: Bps, fundBps: Bps }).refine((v) => !v.shareBps || v.baseBps + v.watchTimeBps + v.fundBps === 10_000, {
      message: "Base, watch time and fund add up to 100%"
    }),
    fallback: { shareBps: 0, baseBps: 0, watchTimeBps: 0, fundBps: 0 },
    display: (v) => (!v.shareBps ? "Not set yet" : `${pct(v.shareBps)}: base ${pct(v.baseBps)}, watch time ${pct(v.watchTimeBps)}, fund ${pct(v.fundBps)}`),
    isSet: (v) => !!v.shareBps
  }),
  "money.payout_schedule": def({
    group: "shares",
    title: "Payouts",
    detail: "How often stations are paid what they earned",
    schema: z.enum(["weekly", "monthly"]),
    fallback: "weekly" as "weekly" | "monthly",
    display: (v) => (v === "weekly" ? "Weekly" : "Monthly")
  }),
  "rights.public_domain_us": def({
    group: "rights",
    title: "Public domain in the US",
    detail: "Published this year or earlier. Moves forward every January 1",
    schema: PublicDomainUs,
    fallback: PUBLIC_DOMAIN_US_DEFAULT,
    display: (v, at) => String(cutoffYear(v, at))
  }),
  "rights.sound_recordings_us": def({
    group: "rights",
    title: "Sound recordings in the US",
    detail: "Published this year or earlier. Recordings from before February 15, 1972 have their own terms",
    schema: SoundRecordingsUs,
    fallback: SOUND_RECORDINGS_US_DEFAULT,
    display: (v, at) => String(soundCutoffYear(v, at))
  }),
  "rights.claim_dates": def({
    group: "rights",
    title: "Answer window and counter-notice wait",
    detail: "Placeholders until reviewed by a lawyer",
    schema: z.object({ answerDays: z.number().int().min(1).max(90), counterNoticeBusinessDays: z.number().int().min(1).max(60) }),
    fallback: { answerDays: 14, counterNoticeBusinessDays: 10 },
    display: (v) => `${v.answerDays} ${v.answerDays === 1 ? "day" : "days"}, ${v.counterNoticeBusinessDays} business ${v.counterNoticeBusinessDays === 1 ? "day" : "days"}`
  }),
  "rights.repeat_limit": def({
    group: "rights",
    title: "Repeat limit",
    detail: "Upheld claims in 12 months before a station is reviewed",
    schema: z.object({ upheldIn12Months: z.number().int().min(1).max(100) }),
    fallback: { upheldIn12Months: 3 },
    display: (v) => String(v.upheldIn12Months)
  }),
  "escrow.unclaimed_period": def({
    group: "rights",
    title: "Unclaimed earnings go to the creator fund after",
    detail: "For claimable stations' escrow",
    schema: z.object({ days: z.number().int().min(30).max(36_500) }),
    fallback: { days: 1095 },
    display: (v) => (v.days % 365 === 0 ? `${v.days / 365} ${v.days === 365 ? "year" : "years"}` : `${v.days} days`)
  }),
  // Extended 2026-09-30 (follow-up Phase 3), additively: when YouTube rolls to keep broadcasts saved
  // (`rollEveryHours`), which restarts need a signed-in account (`restartNeedsSignIn`), Kick, and how
  // restarts are timed (`restart`). Versions without the new fields read them from the fallback.
  "relays.platform_limits": def({
    group: "relays",
    title: "Platform limits",
    detail: (v) =>
      v.platforms
        .map((p) => {
          const name = p.platform.charAt(0).toUpperCase() + p.platform.slice(1);
          if (p.maxHours) return `${name} ${p.maxHours} hours`;
          if (p.savesUnderHours) return `${name} saves broadcasts under ${p.savesUnderHours} hours`;
          return `${name}, no known limit`;
        })
        .join(", "),
    schema: z.object({
      platforms: z
        .array(
          z.object({
            platform: z.string().regex(/^[a-z][a-z0-9_]*$/),
            /** One broadcast can't run longer: restarting before it is required. */
            maxHours: z.number().positive().nullable(),
            /** Only broadcasts shorter than this are saved as videos (YouTube). */
            savesUnderHours: z.number().positive().nullable(),
            /** Added 2026-09-30: when the station saves broadcasts as videos, roll to a new one about this often (YouTube 11). */
            rollEveryHours: z.number().positive().nullable().optional(),
            /** Added 2026-09-30: a restart needs the account signed in (Facebook: a pasted key can't be restarted; the station is told when it's due). */
            restartNeedsSignIn: z.boolean().optional()
          })
        )
        .max(20),
      /** Added 2026-09-30: restarts aim for the last break in this many hours before the limit (less `marginMinutes`). */
      restart: z.object({ windowHours: z.number().positive().max(12), marginMinutes: z.number().int().min(1).max(120) }).optional()
    }),
    fallback: {
      platforms: [
        { platform: "twitch", maxHours: 48, savesUnderHours: null, rollEveryHours: null, restartNeedsSignIn: false },
        { platform: "youtube", maxHours: null, savesUnderHours: 12, rollEveryHours: 11, restartNeedsSignIn: true },
        { platform: "facebook", maxHours: 8, savesUnderHours: null, rollEveryHours: null, restartNeedsSignIn: true },
        { platform: "kick", maxHours: null, savesUnderHours: null, rollEveryHours: null, restartNeedsSignIn: false }
      ],
      restart: { windowHours: 2, marginMinutes: 15 }
    } as {
      platforms: Array<{ platform: string; maxHours: number | null; savesUnderHours: number | null; rollEveryHours?: number | null; restartNeedsSignIn?: boolean }>;
      restart?: { windowHours: number; marginMinutes: number };
    },
    display: (v) => `${v.platforms.length} ${v.platforms.length === 1 ? "platform" : "platforms"}`
  }),
  // Added 2026-09-30 (follow-up Phase 3; Open, no first version: the fallback is the value until one is set).
  "relays.location_wait": def({
    group: "relays",
    title: "Waiting for relay viewers' location",
    detail: "How long a local business's relay part stays held for YouTube's viewer geography. If none arrives, it isn't charged and goes back to the business's balance",
    schema: z.object({ days: z.number().int().min(1).max(30) }),
    fallback: { days: 7 },
    display: (v) => `${v.days} ${v.days === 1 ? "day" : "days"}`
  }),
  "numbering.channels": def({
    group: "numbering",
    title: "Channel numbering",
    detail: "Each market's ranges. TV majors with subchannels; radio in even tenths",
    schema: Numbering.refine((n) => n.tv.firstMajor <= n.tv.lastMajor && n.radio.firstTenths <= n.radio.lastTenths, { message: "Each range runs from low to high" }).refine(
      (n) => n.radio.firstTenths % 2 === 0 && n.radio.lastTenths % 2 === 0,
      { message: "Radio is on even tenths (88.2 to 107.8)" }
    ),
    fallback: { tv: { firstMajor: 2, lastMajor: 69 }, radio: { firstTenths: 882, lastTenths: 1078 } },
    display: (v) => `TV ${v.tv.firstMajor} to ${v.tv.lastMajor}, radio ${(v.radio.firstTenths / 10).toFixed(1)} to ${(v.radio.lastTenths / 10).toFixed(1)}`,
    scoped: true
  }),
  // Shared call signs (added 2026-09-30, A230, Open for review). No first version: the fallback holds until one is set.
  "numbering.own_subchannels": def({
    group: "numbering",
    title: "Owners' own subchannels",
    detail: "An owner can put another of their stations on a subchannel beside their own X.1 (12.2 beside 12.1), and it can share X.1's call sign. Off: a station gets X.1 only, and subchannels are for 24/7 carriage and external stations. Stations already on one keep it",
    schema: z.object({ allowed: z.boolean() }),
    fallback: { allowed: true },
    display: (v) => (v.allowed ? "Allowed" : "Not allowed")
  }),
  "escrow.signers": def({
    group: "escrow",
    title: "Escrow signers",
    detail: "The verifier keys. A change needs the other admins' approval, then the timelock",
    schema: z.object({ signers: z.array(Address).nullable(), threshold: z.number().int().min(1).nullable() }),
    fallback: { signers: null, threshold: null } as { signers: string[] | null; threshold: number | null },
    display: (v) => (v.signers ? `${v.threshold} of ${v.signers.length}` : "As deployed"),
    isSet: (v) => v.signers !== null,
    readOnly: true
  }),
  // Reserved call signs (added 2026-09-29, desk-pages 02; first versions in migration 0029).
  "call_signs.hold": def({
    group: "call_signs",
    title: "Reserved call signs are held for",
    detail: "From the day they're reserved, unless the person signs on or the desk extends it. A reminder goes before the end",
    schema: z.object({ days: z.number().int().min(7).max(730), reminderDays: z.number().int().min(1).max(60) }).refine((v) => v.reminderDays < v.days, { message: "The reminder goes before the end" }),
    fallback: { days: 120, reminderDays: 14 },
    display: (v) => `${v.days} days, a reminder ${v.reminderDays} ${v.reminderDays === 1 ? "day" : "days"} before`
  }),
  "call_signs.refused": def({
    group: "call_signs",
    title: "Call signs Opencast won't allow",
    detail: "Checked on the waitlist and at station setup. Stations already on the dial keep theirs",
    schema: CallSignRules,
    fallback: CALL_SIGN_RULES_DEFAULT,
    display: (v) =>
      [v.refuseKwFourLetters ? "K or W and three letters" : null, `${v.impersonation.length} ${v.impersonation.length === 1 ? "brand" : "brands"} and stations`, `${v.denylist.length} on the denylist`].filter(Boolean).join(", ")
  }),
  // Catalog sponsors (added 2026-09-29, desk-pages 03; no first version: the fallback is the value until one is set).
  "catalog.sponsor_prices": def({
    group: "sponsors",
    title: "Catalog sponsorship",
    detail: "A month: one catalog series in a market, or every catalog series in a market. A slot is for sale once its price is set",
    schema: z.object({ seriesMonthlyMicros: PriceOrUnset, everySeriesMonthlyMicros: PriceOrUnset }),
    fallback: { seriesMonthlyMicros: null, everySeriesMonthlyMicros: null } as { seriesMonthlyMicros: number | null; everySeriesMonthlyMicros: number | null },
    display: (v) =>
      v.seriesMonthlyMicros === null && v.everySeriesMonthlyMicros === null
        ? "Not set yet"
        : [v.seriesMonthlyMicros === null ? null : `${dollars(v.seriesMonthlyMicros)} a series`, v.everySeriesMonthlyMicros === null ? null : `${dollars(v.everySeriesMonthlyMicros)} every series`].filter(Boolean).join(", ") + " a month",
    isSet: (v) => v.seriesMonthlyMicros !== null || v.everySeriesMonthlyMicros !== null,
    scoped: true
  }),
  "shares.catalog_sponsorship": def({
    group: "shares",
    title: "Where catalog sponsorship goes",
    detail: "Opencast, the co-op pool and the creator fund. Until it's set, it stays with the catalog station",
    schema: z.object({ opencastBps: Bps, poolBps: Bps, fundBps: Bps }).refine((v) => v.opencastBps + v.poolBps + v.fundBps <= 10_000, { message: "The shares add up to 100% or less" }),
    fallback: { opencastBps: 0, poolBps: 0, fundBps: 0 },
    display: (v) => (!v.opencastBps && !v.poolBps && !v.fundBps ? "Not set yet" : `${pct(v.opencastBps)} Opencast, ${pct(v.poolBps)} the pool, ${pct(v.fundBps)} the creator fund`),
    isSet: (v) => !!(v.opencastBps || v.poolBps || v.fundBps)
  }),
  // Sign-ups (added 2026-10-07, the user's request): invite-only, like Clubhouse while it grew.
  "signups.invite_only": def({
    group: "signups",
    title: "Invite only",
    detail: "New accounts need an invite code (or a team invite) before they can do anything; people already in stay in",
    schema: z.object({ on: z.boolean() }),
    fallback: { on: false },
    display: (v) => (v.on ? "On: new accounts need an invite code" : "Off: anyone can sign up")
  }),
  "signups.codes_per_person": def({
    group: "signups",
    title: "Invite codes each",
    detail: "How many invite codes each person who's in can make and send, one person each",
    schema: z.object({ codes: z.number().int().min(0).max(100) }),
    fallback: { codes: 10 },
    display: (v) => `${v.codes} ${v.codes === 1 ? "code" : "codes"} each`
  }),
  // Costs (added 2026-10-07, A251 Phase 6; no first version): what running Opencast costs, for the
  // desk's "Cost to run, estimated". Prices Opencast pays its own suppliers, not what stations pay;
  // each is "Not set yet" until someone sets it, and the estimate leaves it out until then.
  "costs.storage": def({
    group: "costs",
    title: "Storage",
    detail: "What a GB stored costs Opencast a month, originals and prepared together",
    schema: z.object({ costPerGbMonthMicros: PriceOrUnset }),
    fallback: { costPerGbMonthMicros: null },
    display: (v) => (v.costPerGbMonthMicros === null ? "Not set yet" : `${dollars(v.costPerGbMonthMicros)} a GB a month`),
    isSet: (v) => v.costPerGbMonthMicros !== null
  }),
  "costs.preparing": def({
    group: "costs",
    title: "Preparing",
    detail: "What a minute spent preparing uploads costs Opencast",
    schema: z.object({ costPerMinuteMicros: PriceOrUnset }),
    fallback: { costPerMinuteMicros: null },
    display: (v) => (v.costPerMinuteMicros === null ? "Not set yet" : `${dollars(v.costPerMinuteMicros)} a minute`),
    isSet: (v) => v.costPerMinuteMicros !== null
  }),
  "costs.relays": def({
    group: "costs",
    title: "Relays",
    detail: "What an hour relayed to YouTube or Twitch costs Opencast",
    schema: z.object({ costPerHourMicros: PriceOrUnset }),
    fallback: { costPerHourMicros: null },
    display: (v) => (v.costPerHourMicros === null ? "Not set yet" : `${dollars(v.costPerHourMicros)} an hour`),
    isSet: (v) => v.costPerHourMicros !== null
  }),
  "costs.live": def({
    group: "costs",
    title: "Live (Livepeer)",
    detail: "What an hour live costs Opencast",
    schema: z.object({ costPerHourMicros: PriceOrUnset }),
    fallback: { costPerHourMicros: null },
    display: (v) => (v.costPerHourMicros === null ? "Not set yet" : `${dollars(v.costPerHourMicros)} an hour`),
    isSet: (v) => v.costPerHourMicros !== null
  }),
  "costs.platform": def({
    group: "costs",
    title: "API, database and worker",
    detail: "What running Opencast's own servers costs a week, whatever the stations do",
    schema: z.object({ costPerWeekMicros: PriceOrUnset }),
    fallback: { costPerWeekMicros: null },
    display: (v) => (v.costPerWeekMicros === null ? "Not set yet" : `${dollars(v.costPerWeekMicros)} a week`),
    isSet: (v) => v.costPerWeekMicros !== null
  }),
  // Watch data (added 2026-09-29, follow-up Phase 1; no first version: the fallback is the value until one is set).
  "watch_data.retention": def({
    group: "watch_data",
    title: "Viewing sessions are kept for",
    detail: "Each session's minutes and votes, to work out each airing's numbers. After that only the numbers per airing are kept, with no viewer in them",
    schema: z.object({ days: z.number().int().min(2).max(90) }),
    fallback: { days: 30 },
    display: (v) => `${v.days} days`
  }),
  "watch_data.minimum_audience": def({
    group: "watch_data",
    title: "Numbers are shown from",
    detail: "Viewers at once, at some point in an airing, before its numbers show. A maker sees other stations' airings only added together, and only when they add up to this across at least this many airings",
    schema: z.object({ viewers: z.number().int().min(1).max(10_000), carriedAirings: z.number().int().min(1).max(100) }),
    fallback: { viewers: 20, carriedAirings: 2 },
    display: (v) => `${v.viewers} ${v.viewers === 1 ? "viewer" : "viewers"}, other stations' airings ${v.carriedAirings} or more together`
  }),
  // External stations (added 2026-09-30, follow-up Phase 6; Open, A200 and A201). No first version: the fallback holds until one is set.
  "external.other_markets": def({
    group: "external",
    title: "Other markets' streams",
    detail: "Whether a source from outside a market can be an external station on its dial, for example a county meeting that covers two markets. Off: such a listing is saved but waits",
    schema: z.object({ allowed: z.boolean() }),
    fallback: { allowed: false },
    display: (v) => (v.allowed ? "Allowed" : "Not allowed")
  }),
  "external.dash_stream_links": def({
    group: "external",
    title: "DASH stream links",
    detail: "Played: a DASH stream link plays in Opencast's player, which loads its DASH library only when one is tuned; a device that can't play DASH skips it. Not played: a DASH-only stream link is saved but waits, and the source's official embed or HLS address is listed instead",
    schema: z.object({ played: z.boolean() }),
    fallback: { played: false },
    display: (v) => (v.played ? "Played" : "Not played yet")
  }),
  "features.not_for_me": def({
    group: "features",
    title: "\"Not for me\" in the player",
    detail: "The viewer's vote on what's airing. Votes are taken either way; this shows the control",
    schema: z.object({ enabled: z.boolean() }),
    fallback: { enabled: false },
    display: (v) => (v.enabled ? "On" : "Off")
  })
} as const;

export type RuleKey = keyof typeof RULES;
export type RuleValue<K extends RuleKey> = z.infer<(typeof RULES)[K]["schema"]>;
export const RULE_KEYS = Object.keys(RULES) as RuleKey[];
export const isRuleKey = (key: string): key is RuleKey => key in RULES;

/** The rule's definition, loosely typed, for code that handles every rule alike. */
export function ruleDef(key: RuleKey): RuleDef {
  return RULES[key] as unknown as RuleDef;
}
