import { z } from "zod";
import { endpoint } from "./core.js";
import { BlockBand, BumperRole, DateOnly, Id, LogCode, Millis, Ok, StationIdent, Timestamp } from "./common.js";
import { Captions, Program } from "./library.js";
import { BlockSpan, DayTemplateBlock } from "./blocks.js";
import { BreakRule } from "./stations.js";

export const LogEntry = z.object({
  id: Id,
  kind: z.enum(["program", "live", "off_air"]),
  code: LogCode,
  startsAt: Timestamp,
  endsAt: Timestamp,
  title: z.string(),
  episodeTitle: z.string().nullable(),
  itemId: Id.nullable(),
  programId: Id.nullable(),
  liveSourceId: Id.nullable(),
  /** "Carried from REEL 24.1" */
  carriedFrom: StationIdent.nullable(),
  carriageAgreementId: Id.nullable(),
  repeatGroupId: Id.nullable(),
  localNote: z.string().nullable(),
  /** G5 (added 2026-09-29): this airing's own description, else its item's (up to 160 characters). */
  episodeDescription: z.string().nullable().optional(),
  /** G3 (added 2026-09-29): a live block ended early at this moment (`endsAt` is then the same). */
  endedEarlyAt: Timestamp.nullable().optional(),
  /**
   * G18 (added 2026-10-03): "Keep at this time": the station marked it as a fixed point. Moving the
   * rows around it in master control stops here, and a live block ending early doesn't move it up.
   * Left out: false.
   */
  keepTime: z.boolean().optional()
});
export type LogEntry = z.infer<typeof LogEntry>;

/**
 * G1 (added 2026-09-29): one thing in a break, in the order it airs. Spots placed in the break
 * (held, so they air), the maker's barter time, the station's credit and bumpers, and the station
 * ID, which is always last. Before spots are placed (up to 20 minutes ahead) a break holds only
 * the maker's time and the station's fill.
 */
export const BreakRow = z.object({
  code: LogCode,
  title: z.string(),
  lengthMs: Millis,
  /** Whose time: the station's, the maker's under barter, or the backup rotation's. */
  whose: z.enum(["station", "producer", "backup"]),
  /** "REEL's break time, barter". */
  note: z.string().nullable(),
  /**
   * A243 (added 2026-10-02): a bumper from the station's sequences, as `BreakContent.element`: where
   * it airs, its role, what up next names, and whether it fits (one that doesn't has no length).
   */
  element: z
    .object({
      position: z.enum(["open", "close", "between", "boundary"]),
      role: BumperRole,
      announces: z.object({ title: z.string(), startsAt: Timestamp }).nullable(),
      fits: z.boolean()
    })
    .optional(),
  /** A244 (added 2026-10-02): a programming block's intro, outro, ID or bumper, as `BreakContent.block`. */
  block: z.object({ id: Id, name: z.string(), part: z.enum(["intro", "outro", "id", "bumper"]), fits: z.boolean() }).optional()
});
export type BreakRow = z.infer<typeof BreakRow>;

export const BreakSlot = z.object({
  id: Id.nullable(),
  startsAt: Timestamp,
  lengthMs: Millis,
  /** "After Late Crate, ep. 14" / "During Saturday Reel". */
  context: z.string(),
  origin: z.enum(["rule", "cued_live", "carried_barter"]),
  /** Break time the producer fills under barter; the station can't sell it. */
  producerShareMs: Millis,
  filledMs: Millis,
  openMs: Millis,
  /** G1 (added 2026-09-29): what's in it, in order. */
  rows: z.array(BreakRow).optional()
});

export const Gap = z.object({ startsAt: Timestamp, endsAt: Timestamp });

/** "Every Saturday" (weekly), "Weekdays" (Monday to Friday, added 2026-09-29), "Every day", "Once". */
export const RepeatPattern = z.enum(["once", "daily", "weekly", "weekdays"]);
export type RepeatPattern = z.infer<typeof RepeatPattern>;

/** "HH:MM", 24-hour, in the station's market time zone. */
export const WallClock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM");

/**
 * Off air hours (added 2026-09-29): planned time off air, from the standing rule (`hours`) or a
 * one-off sign-off entry on the log (`sign_off`, with its entry). Planned off air isn't dead air:
 * no warnings, nothing fills it, and viewers see `backAt`, the end of the off air time it's part of
 * (a sign-off at 11:40 pm running into 2:00 to 6:00 am hours is back at 6:00 am).
 */
export const OffAirSpan = z.object({
  startsAt: Timestamp,
  endsAt: Timestamp,
  backAt: Timestamp,
  source: z.enum(["hours", "sign_off"]),
  logEntryId: Id.nullable()
});
export type OffAirSpan = z.infer<typeof OffAirSpan>;

/** One standing off air rule: "Every night, 2:00 am to 6:00 am". */
export const OffAirRule = z.object({
  id: Id,
  /** The weekdays the sign-off falls on, 0 = Sunday. All seven reads "Every night". */
  days: z.array(z.number().int().min(0).max(6)).min(1),
  signOffAt: WallClock,
  /** At or before `signOffAt`: back the next day. */
  backAt: WallClock,
  /** "Every night, 2:00 am to 6:00 am", "Weeknights, 11:00 pm to 6:00 am". */
  label: z.string()
});
export type OffAirRule = z.infer<typeof OffAirRule>;

export const OffAirRuleInput = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  signOffAt: WallClock,
  backAt: WallClock
});

export const OffAirHours = z.object({
  /** The market's time zone the rules are in. */
  timezone: z.string(),
  rules: z.array(OffAirRule),
  /** The off air time on now, or the next one within 8 days. */
  next: OffAirSpan.nullable()
});
export type OffAirHours = z.infer<typeof OffAirHours>;

/** One thing in a day template, at its local time. */
export const DayTemplateEntry = z.object({
  id: Id,
  /**
   * Local wall-clock start, "20:00". A template's day is a broadcast day (6:00 am to 6:00 am): a
   * time before 06:00 is after midnight, on the calendar day after the date (G10).
   */
  startTime: WallClock,
  lengthMs: Millis,
  kind: z.enum(["program", "live", "off_air"]),
  code: LogCode,
  title: z.string(),
  itemId: Id.nullable(),
  programId: Id.nullable(),
  liveSourceId: Id.nullable(),
  carriageAgreementId: Id.nullable(),
  episodeTitle: z.string().nullable(),
  episodeDescription: z.string().nullable(),
  localNote: z.string().nullable(),
  /** G18 (added 2026-10-03): "Keep at this time", copied to each date it makes. Left out: false. */
  keepTime: z.boolean().optional()
});
export type DayTemplateEntry = z.infer<typeof DayTemplateEntry>;

export const DayTemplateEntryInput = z.object({
  startTime: WallClock,
  /** Programs default to the item's length, rounded up to whole minutes. */
  lengthMs: Millis.optional(),
  kind: z.enum(["program", "live", "off_air"]),
  itemId: Id.optional(),
  programId: Id.optional(),
  liveSourceId: Id.optional(),
  carriageAgreementId: Id.optional(),
  episodeTitle: z.string().max(200).optional(),
  episodeDescription: z.string().max(160).optional(),
  localNote: z.string().max(160).optional(),
  /** G18 (added 2026-10-03): "Keep at this time". Left out: false. */
  keepTime: z.boolean().optional()
});
export type DayTemplateEntryInput = z.infer<typeof DayTemplateEntryInput>;

/**
 * Day templates (added 2026-09-29): a day built once and repeated. Its days (`fromDay`, `onDate`,
 * `until`, `dates`, `weekday`) are broadcast days, 6:00 am to 6:00 am local, as the log draws them
 * (G10): Saturday is Saturday 6:00 am to Sunday 6:00 am, after-midnight programs included. Each
 * future date the pattern covers (from the day after `fromDay`, through `until`) gets its log
 * generated from `entries`, three weeks ahead. Editing one date's log makes it an exception
 * (`edited`); editing the template makes every future date that isn't one again. Where two
 * templates cover a date the more specific wins: once, then a weekday, then weekdays, then every
 * day (the newest among equals).
 */
export const DayTemplate = z.object({
  id: Id,
  name: z.string().nullable(),
  pattern: RepeatPattern,
  /** For `weekly`: 0 = Sunday. */
  weekday: z.number().int().min(0).max(6).nullable(),
  /** "Every Saturday", "Weekdays", "Every day", "Once, Sat Oct 10". */
  label: z.string(),
  /** The day it was built from (its own log is the station's, not generated). */
  fromDay: DateOnly,
  /** For `once`: the date it's for. */
  onDate: DateOnly.nullable(),
  /** The last date it repeats on; null until it's taken off. */
  until: DateOnly.nullable(),
  timezone: z.string(),
  entries: z.array(DayTemplateEntry),
  /** Dates from tomorrow on that were generated from it, and whether each was edited since. */
  dates: z.array(z.object({ date: DateOnly, edited: z.boolean(), entries: z.number().int(), skipped: z.number().int() })),
  createdAt: Timestamp,
  updatedAt: Timestamp.nullable(),
  /**
   * A244 (added 2026-10-02): the programming blocks in it, generated onto each date with its entries
   * (a date edited by hand keeps its own). Each ends by 6:00 am, when the next broadcast day starts.
   */
  blocks: z.array(DayTemplateBlock).optional()
});
export type DayTemplate = z.infer<typeof DayTemplate>;

/** What a template write generated: dates made (or made again), entries placed, removed and skipped. */
export const TemplateGeneration = z.object({
  dates: z.number().int(),
  created: z.number().int(),
  removed: z.number().int(),
  skippedForConflicts: z.number().int(),
  /** Dates left alone because they were edited by hand. */
  exceptions: z.number().int()
});
export type TemplateGeneration = z.infer<typeof TemplateGeneration>;

/** G11: a broadcast day on the log and the day template that made it. */
export const LogDay = z.object({
  /** The broadcast day: "2026-10-31" runs from 6:00 am that day to 6:00 am the next. */
  date: DateOnly,
  templateId: Id.nullable(),
  /** The template's name ("After work"), null when it has none. */
  templateName: z.string().nullable(),
  /** The template's label ("Every Saturday", "Weekdays"); null with no template. */
  label: z.string().nullable(),
  /** Changed by hand since the template made it (an exception); false with no template. */
  edited: z.boolean()
});
export type LogDay = z.infer<typeof LogDay>;

export const ProgramLog = z.object({
  from: Timestamp,
  to: Timestamp,
  entries: z.array(LogEntry),
  breaks: z.array(BreakSlot),
  /** Dead air: time with nothing on the log. */
  gaps: z.array(Gap),
  /**
   * G7 (added 2026-09-29): what "Repeat this day" set up and still has entries from the start of
   * the window on: the day copied, how, until when, and how many entries are still to come.
   * `removeRepeat` takes them off.
   */
  repeats: z
    .array(
      z.object({
        id: Id,
        day: DateOnly,
        /** G7's three. A `weekdays` template is listed by `listTemplates` only. */
        pattern: z.enum(["once", "daily", "weekly"]),
        until: DateOnly.nullable(),
        entries: z.number().int(),
        /** Added 2026-09-29: a day template (see `listTemplates`), rather than a one-time copy. */
        template: z.boolean().optional(),
        weekday: z.number().int().min(0).max(6).nullable().optional(),
        label: z.string().optional()
      })
    )
    .optional(),
  /**
   * Added 2026-09-29: planned off air time overlapping the window (off air hours, and sign-off
   * entries), drawn differently from dead air and never warned about. `gaps` leaves it out.
   */
  offAir: z.array(OffAirSpan).optional(),
  /**
   * G11 (added 2026-09-29): every broadcast day (6:00 am to 6:00 am local) the window touches, in
   * order, with the day template that made it (null for a day no template made) and whether it
   * was edited by hand since. Today and past days too.
   */
  days: z.array(LogDay).optional(),
  /**
   * Edit mode (added 2026-09-29): the window's version, a hash of its entries (their times, what
   * airs and a live block ended early). An edit sends it back (`applyLogChanges`'s `base`); if the
   * log changed in the window since, the edit is refused with 409 `log_changed`.
   */
  version: z.string().optional(),
  /**
   * A244 (added 2026-10-02): programming blocks on the log in the window: where each is placed,
   * where it airs (its members), and what to look at (a member running past its end, nothing in
   * it yet, no room for its intro).
   */
  blocks: z.array(BlockSpan).optional()
});

/**
 * A246 (added 2026-10-03): `previewBreakRule`'s answer: the rule as it would be saved (after the
 * same checks and merging as `setBreakRule`), and the window's entries and breaks rebuilt with it,
 * each break with its rows (G1), as `getLog` would answer after saving. `keeps`: the break keeps
 * what it has whatever the rule says (spots already placed in it, about 20 minutes before air, or
 * it has started), so a new rule doesn't change what's sold in it. `blocks` as `getLog`'s.
 */
export const BreakRulePreview = z.object({
  rule: BreakRule,
  from: Timestamp,
  to: Timestamp,
  entries: z.array(LogEntry),
  breaks: z.array(BreakSlot.extend({ keeps: z.boolean() })),
  blocks: z.array(BlockSpan).optional()
});
export type BreakRulePreview = z.infer<typeof BreakRulePreview>;

export const DeadAirStatus = z.object({
  /** Over the next 24 hours. */
  gaps: z.array(Gap),
  nextGapAt: Timestamp.nullable(),
  /** "Log runs until Sun 8:42 pm". */
  logRunsUntil: Timestamp.nullable(),
  warnings: z.array(z.object({ gapStartsAt: Timestamp, warnedAt: Timestamp, minutesBefore: z.union([z.literal(30), z.literal(12)]) })),
  /** Added 2026-09-29: planned off air time in the next 24 hours (not gaps: never warned or filled). */
  offAir: z.array(OffAirSpan).optional()
});

const StationParams = z.object({ stationId: Id });
const EntryParams = z.object({ stationId: Id, entryId: Id });

/** G5: how an airing's listing stands. */
export const ListingStatus = z.enum(["complete", "needs_description", "from_the_maker"]);
export type ListingStatus = z.infer<typeof ListingStatus>;

/**
 * G5 (added 2026-09-29): an airing with its listing, as the viewer's frames draw it: the episode
 * title and description (the airing's own, else its item's), the local note, and its status.
 * A carried program's listing comes from the maker (`from_the_maker`): only the local note is the
 * carrier's.
 */
export const Listing = z.object({
  entryId: Id,
  kind: z.enum(["program", "live", "off_air"]),
  code: LogCode,
  startsAt: Timestamp,
  endsAt: Timestamp,
  title: z.string(),
  episodeTitle: z.string().nullable(),
  episodeDescription: z.string().nullable(),
  localNote: z.string().nullable(),
  carriedFrom: StationIdent.nullable(),
  itemId: Id.nullable(),
  /** Imported from a link. */
  imported: z.boolean(),
  status: ListingStatus,
  program: Program.extend({ captions: Captions.nullable().optional() }).nullable()
});
export type Listing = z.infer<typeof Listing>;

const EntryInput = z.object({
  kind: z.enum(["program", "live", "off_air"]),
  startsAt: Timestamp,
  /** Programs default to the item's length, rounded up to whole minutes. */
  endsAt: Timestamp.optional(),
  itemId: Id.optional(),
  programId: Id.optional(),
  liveSourceId: Id.optional(),
  carriageAgreementId: Id.optional(),
  episodeTitle: z.string().max(200).optional(),
  episodeDescription: z.string().max(160).optional(),
  localNote: z.string().max(160).optional(),
  /** G18 (added 2026-10-03): "Keep at this time". Left out: false (on `updateEntry`: as it is). */
  keepTime: z.boolean().optional()
});

/**
 * Edit mode (added 2026-09-29): how long before an entry starts it can still change on air. The
 * channel is assembled this far ahead of the clock (the playout assembler's `LEAD_MS`): an entry
 * on air now, or starting sooner than this, is locked ("Airs in 20 s, too late to change").
 */
export const LOG_EDIT_LEAD_MS = 20_000;

/**
 * Edit mode (added 2026-09-29): one change to the log, drafted and published with others in one
 * batch (`applyLogChanges`). Times are snapped to 4-second segments, as `updateEntry` snaps them.
 * Breaks aren't changed directly: they're generated from the break rule and follow the programs.
 *
 * - `move`: a new start; the entry keeps its length.
 * - `replace`: another item airs in the entry's place, from its start; the slot becomes the item's
 *   length rounded up to whole minutes, as `updateEntry` does with a new item. Programs only.
 * - `resize`: a new end (a live block's length, a sign-off's back-on time, a program's slot).
 * - `remove`: off the log.
 * - `insert`: a new entry, as `addEntry` takes it. `key` is the app's own name for it, echoed back.
 * - `block_add` (A244, 2026-10-02): a programming block placed on the log from `startsAt` to
 *   `endsAt` (up to 24 hours; it may cross 6:00 am on a date). Programs starting inside it are its.
 * - `block_resize` (A244): a span's new start or end. One on air can only change its end, and not
 *   to sooner than `LOG_EDIT_LEAD_MS` from now (`block_locked`).
 * - `block_remove` (A244): the span comes off (its programs stay). Not while it's on air.
 * Blocks never overlap (`block_overlap`).
 * - `keep` (G18, 2026-10-03): marks an entry "Keep at this time" (`keep: true`), or clears the mark.
 *   A kept entry is a fixed point: a `move` of it in the same batch is refused (`kept`) unless the
 *   batch clears the mark first. Its line: "Saturday Reel keeps its time".
 */
export const LogChange = z.discriminatedUnion("op", [
  z.object({ op: z.literal("move"), entryId: Id, startsAt: Timestamp }),
  z.object({ op: z.literal("replace"), entryId: Id, itemId: Id, carriageAgreementId: Id.optional() }),
  z.object({ op: z.literal("resize"), entryId: Id, endsAt: Timestamp }),
  z.object({ op: z.literal("remove"), entryId: Id }),
  z.object({ op: z.literal("insert"), key: z.string().max(64).optional(), entry: EntryInput }),
  // A244 (added 2026-10-02): programming blocks on this date's log.
  z.object({ op: z.literal("block_add"), key: z.string().max(64).optional(), blockId: Id, startsAt: Timestamp, endsAt: Timestamp }),
  z.object({ op: z.literal("block_resize"), spanId: Id, startsAt: Timestamp.optional(), endsAt: Timestamp.optional() }),
  z.object({ op: z.literal("block_remove"), spanId: Id }),
  // G18 (added 2026-10-03): "Keep at this time".
  z.object({ op: z.literal("keep"), entryId: Id, keep: z.boolean() })
]);
export type LogChange = z.infer<typeof LogChange>;

/** Edit mode (added 2026-09-29): a published batch of changes, who published it and when. */
export const LogChangeRecord = z.object({
  id: Id,
  at: Timestamp,
  by: z.object({ userId: Id.nullable(), name: z.string().nullable() }),
  /** "3 changes: Late Crate moves to 9:10 pm, …". */
  summary: z.string(),
  /** One line per change: "Late Crate moves to 9:10 pm". */
  lines: z.array(z.string()),
  count: z.number().int()
});
export type LogChangeRecord = z.infer<typeof LogChangeRecord>;

/**
 * Edit mode (added 2026-09-29): what a batch of changes does, checked together (a dry run) or
 * published. `problems` refuse the batch (nothing is published while there's one): an overlap, a
 * locked entry, rights, a carriage limit, a slot shorter than its item. `warnings` don't: dead air
 * the batch leaves, and held spots moving to the next break.
 */
export const LogChangesResult = z.object({
  /** True once published. A dry run, or a batch with problems, is never applied. */
  applied: z.boolean(),
  /** The window's version after (for `base.from`/`base.to`; absent without a `base`). */
  version: z.string().optional(),
  /** "3 changes: Late Crate moves to 9:10 pm, Slow Hours comes off the log, …". */
  summary: z.string(),
  changes: z.array(
    z.object({
      index: z.number().int(),
      /** A244 (2026-10-02): `block_add`, `block_resize`, `block_remove` too; G18 (2026-10-03): `keep` (only for batches that send them). */
      op: z.enum(["move", "replace", "resize", "remove", "insert", "block_add", "block_resize", "block_remove", "keep"]),
      /** The entry (an insert's once published; null before, and for block changes). */
      entryId: Id.nullable(),
      /** A244 (added 2026-10-02): a block change's span (a `block_add`'s once published). */
      spanId: Id.nullable().optional(),
      key: z.string().nullable(),
      /** "Late Crate moves to 9:10 pm". */
      line: z.string(),
      /** Where it airs after the change (null for a removal). */
      startsAt: Timestamp.nullable(),
      endsAt: Timestamp.nullable()
    })
  ),
  problems: z.array(
    z.object({
      /** The change it's about (null: the batch as a whole). */
      index: z.number().int().nullable(),
      /** `locked`, `overlap`, `not_found`, `too_soon`, or the rule's own code (`rights_unconfirmed`, a carriage limit…). A244: `block_overlap`, `block_locked`, `block_archived`. G18: `kept` (a move of an entry kept at its time). */
      code: z.string(),
      message: z.string()
    })
  ),
  warnings: z.array(
    z.object({
      index: z.number().int().nullable(),
      /**
       * `dead_air`: time left with nothing on the log. `held_spots`: a break with spots held in it goes, and they move to the next break. `held_spots_kept`: they couldn't move and are returned if they don't air.
       * `reminders` (added 2026-09-29): viewers set reminders for an entry coming off; on publish each is moved to the program's next airing on the station within a week (and told), or cancelled (and told).
       */
      code: z.enum(["dead_air", "held_spots", "held_spots_kept", "reminders"]),
      message: z.string()
    })
  ),
  /** Dead air in the changed stretch after the batch. */
  gaps: z.array(Gap),
  /** Whether an on-air station was told to read its log again (once per batch). */
  replanned: z.boolean(),
  /** The history record, once published. */
  record: LogChangeRecord.nullable()
});
export type LogChangesResult = z.infer<typeof LogChangesResult>;

export const logApi = {
  getLog: endpoint({
    method: "GET",
    path: "/stations/:stationId/log",
    auth: "user",
    summary: "The program log for a window (day, evening or week), with generated breaks and dead air, and (G11) the day template that made each broadcast day in it",
    params: StationParams,
    query: z.object({ from: Timestamp, to: Timestamp }),
    response: ProgramLog
  }),
  addEntry: endpoint({
    method: "POST",
    path: "/stations/:stationId/log",
    auth: "user",
    summary: "Put something on the log. Items need confirmed rights; another station's program needs a carriage agreement.",
    params: StationParams,
    body: EntryInput,
    response: LogEntry,
    status: 201
  }),
  updateEntry: endpoint({
    method: "PATCH",
    path: "/stations/:stationId/log/:entryId",
    auth: "user",
    summary: "Move or change an entry",
    params: z.object({ stationId: Id, entryId: Id }),
    body: EntryInput.partial(),
    response: LogEntry
  }),
  removeEntry: endpoint({
    method: "DELETE",
    path: "/stations/:stationId/log/:entryId",
    auth: "user",
    summary: "Take an entry off the log",
    params: z.object({ stationId: Id, entryId: Id }),
    response: Ok
  }),
  repeatDay: endpoint({
    method: "POST",
    path: "/stations/:stationId/log/repeat",
    auth: "user",
    summary:
      "Build one day and repeat it: every day, every week on that day, or once. Since 2026-09-29 this makes a day template (see `createTemplate`, which also does weekdays) running until `until`: dates are generated three weeks ahead, the rest as they come.",
    params: StationParams,
    body: z.object({
      day: z.iso.date(),
      /** For weekdays, use `createTemplate`. */
      pattern: z.enum(["once", "daily", "weekly"]),
      until: z.iso.date(),
      /** For "once": the day to copy to. */
      onto: z.iso.date().optional()
    }),
    response: z.object({
      created: z.number().int(),
      skippedForConflicts: z.number().int(),
      /** Added 2026-09-29: the day template it made. */
      templateId: Id.optional()
    })
  }),
  fillGap: endpoint({
    method: "POST",
    path: "/stations/:stationId/log/fill",
    auth: "user",
    summary: "Fill a gap: repeat from the library (in order, with the break rule), or sign off until a time",
    params: StationParams,
    body: z.discriminatedUnion("with", [
      z.object({ with: z.literal("repeat"), startsAt: Timestamp, endsAt: Timestamp, itemIds: z.array(Id).min(1) }),
      z.object({ with: z.literal("sign_off"), startsAt: Timestamp, endsAt: Timestamp })
    ]),
    response: z.array(LogEntry)
  }),
  getDeadAir: endpoint({
    method: "GET",
    path: "/stations/:stationId/dead-air",
    auth: "user",
    summary: "Gaps in the next 24 hours and warnings sent",
    params: StationParams,
    response: DeadAirStatus
  }),

  // ---- Added 2026-09-29: G3, G5, G7 ----

  // ---- Added 2026-09-29: day templates and off air hours ----

  listTemplates: endpoint({
    method: "GET",
    path: "/stations/:stationId/log/templates",
    auth: "user",
    summary: "Day templates still repeating (owner, operator)",
    params: StationParams,
    response: z.object({ templates: z.array(DayTemplate) })
  }),
  getTemplate: endpoint({
    method: "GET",
    path: "/stations/:stationId/log/templates/:templateId",
    auth: "user",
    summary: "One day template, with the dates generated from it (owner, operator)",
    params: z.object({ stationId: Id, templateId: Id }),
    response: DayTemplate
  }),
  createTemplate: endpoint({
    method: "POST",
    path: "/stations/:stationId/log/templates",
    auth: "user",
    summary:
      "Repeat this day: make a day template from `fromDay`'s log, its broadcast day from 6:00 am to 6:00 am, and generate the dates it covers (owner, operator). `weekly` repeats on `fromDay`'s weekday unless `weekday` says otherwise; `once` needs `onto`. Entries that overlap something already on a date are skipped there.",
    params: StationParams,
    body: z.object({
      fromDay: DateOnly,
      pattern: RepeatPattern,
      weekday: z.number().int().min(0).max(6).optional(),
      onto: DateOnly.optional(),
      until: DateOnly.nullable().optional(),
      name: z.string().max(60).optional()
    }),
    response: z.object({ template: DayTemplate, generated: TemplateGeneration }),
    status: 201
  }),
  updateTemplate: endpoint({
    method: "PATCH",
    path: "/stations/:stationId/log/templates/:templateId",
    auth: "user",
    summary:
      "Change a day template (owner, operator): its entries (`entries` replaces them; `fromDay` takes them from that day's log again), when it repeats, or its name. Every future date made from it that nobody edited is made again; edited dates stay as they are.",
    params: z.object({ stationId: Id, templateId: Id }),
    body: z
      .object({
        name: z.string().max(60).nullable(),
        pattern: RepeatPattern,
        weekday: z.number().int().min(0).max(6),
        onto: DateOnly,
        until: DateOnly.nullable(),
        fromDay: DateOnly,
        entries: z.array(DayTemplateEntryInput).max(200),
        /**
         * A244 (added 2026-10-02): replaces its programming blocks. Each ends by 6:00 am (400
         * `block_crosses_day`), and they don't overlap.
         */
        blocks: z.array(z.object({ blockId: Id, startTime: WallClock, lengthMs: Millis })).max(24)
      })
      .partial(),
    response: z.object({ template: DayTemplate, generated: TemplateGeneration })
  }),
  removeTemplate: endpoint({
    method: "DELETE",
    path: "/stations/:stationId/log/templates/:templateId",
    auth: "user",
    summary:
      "Stop repeating a day template (owner, operator): the same as `removeRepeat`. Its entries come off the dates ahead that weren't edited, which another template may take; edited dates stay as they are.",
    params: z.object({ stationId: Id, templateId: Id }),
    response: z.object({ removed: z.number().int() })
  }),
  /**
   * A246 (added 2026-10-03): "Reset to template". One date a template made, and that was edited
   * by hand since (an exception), made again from the template: what's on that broadcast day from
   * now on that the template didn't make comes off (an entry with spots held in its break stays, as
   * when a template changes), the template's entries and blocks go back on, and the date stops
   * being an exception. A date that wasn't edited is left as it is (`generated` all zeros). Dates
   * from tomorrow on only: 409 `date_started` for today or before. 404 when the date isn't one
   * this template made.
   */
  resetTemplateDate: endpoint({
    method: "POST",
    path: "/stations/:stationId/log/templates/:templateId/dates/:date/reset",
    auth: "user",
    summary:
      "Reset one edited date to its day template (owner, operator): what the template didn't make comes off that broadcast day, the template's entries and blocks go back on, and the date is no longer an exception. Dates from tomorrow on (409 `date_started`); a date the template didn't make is 404.",
    params: z.object({ stationId: Id, templateId: Id, date: DateOnly }),
    response: z.object({ template: DayTemplate, generated: TemplateGeneration }),
    status: 200
  }),
  getOffAirHours: endpoint({
    method: "GET",
    path: "/stations/:stationId/off-air-hours",
    auth: "user",
    summary: "The station's off air hours, in its market's time zone (owner, operator)",
    params: StationParams,
    response: OffAirHours
  }),
  setOffAirHours: endpoint({
    method: "PUT",
    path: "/stations/:stationId/off-air-hours",
    auth: "user",
    summary:
      "Set the off air hours (owner, operator): replaces every rule; an empty list means none. A program or live block on the log inside them still airs (the hours cover what's otherwise empty). 400 when a rule signs off and back at the same time.",
    params: StationParams,
    body: z.object({ rules: z.array(OffAirRuleInput).max(7) }),
    response: OffAirHours
  }),

  /** G7: undo "Repeat this day". */
  removeRepeat: endpoint({
    method: "DELETE",
    path: "/stations/:stationId/log/repeats/:repeatId",
    auth: "user",
    summary: "G7: take a repeat's entries off the log from now on (owner, operator). What already aired stays in the as-run log.",
    params: z.object({ stationId: Id, repeatId: Id }),
    response: z.object({ removed: z.number().int() })
  }),
  /** G3: end a live block now. */
  endEarly: endpoint({
    method: "POST",
    path: "/stations/:stationId/log/:entryId/end-early",
    auth: "user",
    summary:
      "G3: end a live block now (owner, operator, or its host). The block ends here, the programs after it move up, and playout hands back to the log at once; the as-run log records the live airing to this moment. Only while it's on air: 409 `not_on_air`, `ended`; 409 `not_live` for anything else.",
    params: EntryParams,
    response: z.object({ entryId: Id, endedAt: Timestamp, movedUp: z.number().int() })
  }),
  /** G3: a live block's state. */
  getLiveBlock: endpoint({
    method: "GET",
    path: "/stations/:stationId/log/:entryId/live",
    auth: "user",
    summary: "G3: a live block's state: ended early or not, and whether its signal is in (owner, operator, its host)",
    params: EntryParams,
    response: z.object({
      entryId: Id,
      endedEarlyAt: Timestamp.nullable(),
      startsAt: Timestamp.optional(),
      endsAt: Timestamp.optional(),
      /** While it's on air: `receiving`, or `standby` (the stand-by slate, waiting for the signal). Null otherwise. */
      signal: z.enum(["receiving", "standby"]).nullable().optional()
    })
  }),
  /** G5: listings per airing. */
  listListings: endpoint({
    method: "GET",
    path: "/stations/:stationId/listings",
    auth: "user",
    summary: "G5: every program and live airing in a window (at most 8 days) with its listing and status (owner, operator)",
    params: StationParams,
    query: z.object({ from: Timestamp, to: Timestamp }),
    response: z.object({ listings: z.array(Listing), needDescription: z.number().int() })
  }),
  updateListing: endpoint({
    method: "PATCH",
    path: "/stations/:stationId/listings/:entryId",
    auth: "user",
    summary:
      "G5: an airing's episode title and description, or a carried program's local note (owner, operator). A carried program's title and description are the maker's: 409 `from_the_maker`.",
    params: EntryParams,
    body: z
      .object({ episodeTitle: z.string().max(200).nullable(), episodeDescription: z.string().max(160).nullable(), localNote: z.string().max(160).nullable() })
      .partial(),
    response: Listing
  }),

  // ---- Added 2026-09-29: edit mode ----

  applyLogChanges: endpoint({
    method: "POST",
    path: "/stations/:stationId/log/changes",
    auth: "user",
    summary:
      "Edit mode (owner, operator): check a batch of changes together (`dryRun`) or publish them all at once, in one transaction: moves, replacing an item, a new end, removals and inserts, with the same rules as `addEntry`, `updateEntry` and `removeEntry`. A problem refuses the whole batch (422 `log_changes_refused`, nothing applied); a dry run answers them instead. `base` is the window and version the draft began from: 409 `log_changed` if the log changed there since. On air, the entry airing now and anything starting within `LOG_EDIT_LEAD_MS` is locked. Publishing tells an on-air station to read its log again (once), marks template dates edited, moves spots held in a break that goes to the next break, and records the batch in the log's history.",
    params: StationParams,
    body: z.object({
      dryRun: z.boolean().default(false),
      base: z.object({ from: Timestamp, to: Timestamp, version: z.string() }).optional(),
      changes: z.array(LogChange).min(1).max(200)
    }),
    response: LogChangesResult
  }),
  listLogChanges: endpoint({
    method: "GET",
    path: "/stations/:stationId/log/changes",
    auth: "user",
    summary: "Edit mode: the log's published batches of changes, newest first, with who and when (owner, operator)",
    params: StationParams,
    query: z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) }),
    response: z.object({ changes: z.array(LogChangeRecord) })
  }),
  previewBreakRule: endpoint({
    method: "POST",
    path: "/stations/:stationId/break-rule/preview",
    auth: "user",
    summary:
      "A246 (added 2026-10-03): the breaks in a window rebuilt with a break rule that isn't saved (owner, operator): the rule as `setBreakRule` would save it (the same checks and 400s, the same merging of what's left out), and the window's entries and breaks with their rows, exactly as `getLog` would answer after saving it. Nothing is saved, placed, stored or sent. `to` is at most three hours after `from`. A break that keeps what it has (`keeps`: spots already placed in it, or it has started) reads as it will air",
    params: StationParams,
    body: z.object({ rule: BreakRule, from: Timestamp, to: Timestamp }),
    response: BreakRulePreview
  })
};

export const SignOnCheck = z.object({
  /**
   * `off_air_hours` (added 2026-09-29): informational, never blocking; there when off air time is planned in the next 24 hours.
   * `items_prepared` (added 2026-09-29, prepare once): never blocking; how many items on the next 24 hours of the log are prepared for air (with `preparation`, G14).
   * `held_by_opencast` (added 2026-10-07): blocking, there only while Opencast has taken the station off the air from the desk; `detail` is why.
   */
  key: z.enum(["log_covers_24h", "station_id_hourly", "rights_confirmed", "listings_complete", "live_sources_connected", "channel_chosen", "call_sign_chosen", "output", "off_air_hours", "items_prepared", "held_by_opencast"]),
  label: z.string(),
  passed: z.boolean(),
  /** Blockers stop sign-on; warnings don't. */
  blocking: z.boolean(),
  detail: z.string().nullable(),
  /** G6 (added 2026-09-29): where to watch what this check is about (the output's playback, once there is one). */
  watchUrl: z.string().nullable().optional(),
  /**
   * G14 (added 2026-09-29): on `items_prepared` only. The items on the next 24 hours of the log
   * (each counted once, however often it airs), how many are prepared, how many couldn't be
   * (`failed`: the file needs replacing, so there's something to fix), and how many are still on
   * their way (`preparing`: queued, being prepared, or not asked for yet; nothing to do). `firstFailed`
   * is the earliest-airing item that couldn't be prepared, for a link to it in the library.
   */
  preparation: z
    .object({
      items: z.number().int(),
      ready: z.number().int(),
      failed: z.number().int(),
      preparing: z.number().int(),
      firstFailed: z.object({ itemId: Id, title: z.string(), airsAt: Timestamp, entryId: Id }).nullable()
    })
    .nullable()
    .optional()
});

export const PlayoutStatus = z.object({
  onAir: z.boolean(),
  now: z.object({ title: z.string(), code: LogCode, startedAt: Timestamp, itemId: Id.nullable() }).nullable(),
  lastError: z.string().nullable(),
  output: z.object({
    livepeerEnabled: z.boolean(),
    playbackUrl: z.string().nullable(),
    /** G2 (added 2026-09-29): not measured yet, always null. */
    bitrateKbps: z.number().int().nullable().optional()
  }),
  nextBreakAt: Timestamp.nullable(),
  /** G2 (added 2026-09-29): when it last signed on ("On air since 6:00 pm"); null off air. */
  onAirSince: Timestamp.nullable().optional(),
  /** G2 (added 2026-09-29): the next thing on the log, for the preview monitor. */
  next: z
    .object({
      title: z.string(),
      /** The line under the title: the episode title, else the program's description. */
      detail: z.string().nullable(),
      code: LogCode,
      startsAt: Timestamp,
      /** A carried program's maker ("next up from REEL"). */
      producer: z.string().nullable(),
      /** The card's colour: the maker's (carried) or the station's. */
      colour: z.string().nullable(),
      /** No stored stills yet: always null. */
      pictureUrl: z.string().nullable(),
      /** A244 (added 2026-10-02): the programming block it's part of, when it enters one ("Late Crate Nights starts at 9:00 pm"); else null. */
      block: BlockBand.nullable().optional()
    })
    .nullable()
    .optional(),
  /** A244 (added 2026-10-02): the programming block on air now ("Late Crate Nights · until 1:00 am"), or null. */
  block: BlockBand.nullable().optional(),
  /**
   * Added 2026-09-29: planned off air time on now (`now` true: the channel shows the sign-off slate,
   * then ends until `backAt`), else the next within 24 hours ("Signs off at 2:00 am"); null for none.
   */
  offAir: OffAirSpan.extend({ now: z.boolean() }).nullable().optional(),
  /**
   * A242 (added 2026-10-02): the channel is airing the station's opener (`on`: at sign-on, or
   * opening the broadcast day) or closer (`off`: at sign-off) right now; null otherwise.
   */
  signing: z.enum(["on", "off"]).nullable().optional(),
  /**
   * Added 2026-09-29 (prepare once, then assemble): the items on the log in the next 48 hours, how
   * many are prepared in every rendition the station's band airs, and the first that isn't
   * (`status`: queued, being prepared, failed, or not asked for yet). Anything not ready at air
   * time airs station ID and bumpers instead, and the station is told an hour before.
   *
   * G13 (2026-09-29): `items` and `ready` count items, not log entries: an item airing twice counts
   * once (before, each entry counted). `firstNotReady` is the earliest airing of an item that isn't
   * prepared, with `entryId`, its log entry, so the Monitor can link to it on the log.
   * G14 (2026-09-29): `failed` (couldn't be prepared: the file needs replacing) and `preparing`
   * (queued, being prepared, or not asked for yet) split `items - ready`.
   */
  readiness: z
    .object({
      items: z.number().int(),
      ready: z.number().int(),
      /** G14 (added 2026-09-29). */
      failed: z.number().int().optional(),
      /** G14 (added 2026-09-29). */
      preparing: z.number().int().optional(),
      firstNotReady: z
        .object({
          itemId: Id,
          title: z.string(),
          airsAt: Timestamp,
          status: z.enum(["queued", "preparing", "failed", "not_asked"]),
          /** G13 (added 2026-09-29): the log entry of that airing. */
          entryId: Id.optional()
        })
        .nullable()
    })
    .nullable()
    .optional()
});

export const AsRunRow = z.object({
  id: Id,
  /** An opener or closer (A242) reads `SID` here; `identCode` says which. */
  code: LogCode,
  title: z.string(),
  startedAt: Timestamp,
  endedAt: Timestamp,
  reason: z.enum(["planned", "rotation", "backup_rotation", "station_id_fill", "dead_air_fill", "live", "slate"]),
  itemId: Id.nullable(),
  airingId: Id.nullable(),
  /**
   * A242 (added 2026-10-02): the as-run log records an opener as `OPN` and a closer as `CLS`. They
   * come here, with `code` `SID`, so apps built before it (whose `code` knows six values) still read
   * the log. Null for everything else.
   */
  identCode: z.enum(["OPN", "CLS"]).nullable().optional(),
  /** A243 (added 2026-10-02): a bumper's role as it aired; null for anything else or before it. */
  bumperRole: BumperRole.nullable().optional(),
  /**
   * A243 (added 2026-10-02): where it aired: a break's opening or closing sequence (`open`,
   * `close`), between programs (`between`), a block's intro or outro (`boundary`, later), open
   * time (`open_time`) or sign-on (`sign_on`). Null before it.
   */
  position: z.enum(["open", "close", "between", "boundary", "open_time", "sign_on"]).nullable().optional(),
  /** A243 (added 2026-10-02): up next only: what it announced, as the overlay said it. */
  announced: z.object({ entryId: Id.nullable(), title: z.string() }).nullable().optional(),
  /** A244 (added 2026-10-02): the programming block it aired in, or null. */
  block: z.object({ id: Id, name: z.string() }).nullable().optional()
});

export const playoutApi = {
  getSignOnChecks: endpoint({
    method: "GET",
    path: "/stations/:stationId/sign-on/checks",
    auth: "user",
    summary: "Pre-flight checks before signing on",
    params: StationParams,
    response: z.object({ ready: z.boolean(), checks: z.array(SignOnCheck) })
  }),
  signOn: endpoint({
    method: "POST",
    path: "/stations/:stationId/sign-on",
    auth: "user",
    summary: "Sign on. Refused while a blocking check fails. The first sign-on fixes call sign and channel.",
    params: StationParams,
    response: PlayoutStatus,
    status: 202
  }),
  signOff: endpoint({
    method: "POST",
    path: "/stations/:stationId/sign-off",
    auth: "user",
    summary: "Sign off (owner, operator)",
    params: StationParams,
    body: z.object({ permanently: z.boolean().default(false) }),
    response: PlayoutStatus,
    status: 202
  }),
  cueBreak: endpoint({
    method: "POST",
    path: "/stations/:stationId/cue-break",
    auth: "user",
    summary: "Cue a break now during a live block (owner, operator, or the block's host)",
    params: StationParams,
    response: Ok,
    status: 202
  }),
  getStatus: endpoint({
    method: "GET",
    path: "/stations/:stationId/playout",
    auth: "user",
    summary: "What's on air now, and the output",
    params: StationParams,
    response: PlayoutStatus
  }),
  getAsRun: endpoint({
    method: "GET",
    path: "/stations/:stationId/as-run",
    auth: "user",
    summary: "What actually aired, to the second",
    params: StationParams,
    query: z.object({ from: Timestamp, to: Timestamp }),
    response: z.array(AsRunRow)
  })
};

export type BreakSlot = z.infer<typeof BreakSlot>;
export type Gap = z.infer<typeof Gap>;
export type ProgramLog = z.infer<typeof ProgramLog>;
export type DeadAirStatus = z.infer<typeof DeadAirStatus>;
export type SignOnCheck = z.infer<typeof SignOnCheck>;
export type PlayoutStatus = z.infer<typeof PlayoutStatus>;
export type AsRunRow = z.infer<typeof AsRunRow>;
