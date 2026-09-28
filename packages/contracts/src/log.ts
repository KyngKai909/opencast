import { z } from "zod";
import { endpoint } from "./core.js";
import { Id, LogCode, Millis, Ok, StationIdent, Timestamp } from "./common.js";

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
  localNote: z.string().nullable()
});
export type LogEntry = z.infer<typeof LogEntry>;

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
  openMs: Millis
});

export const Gap = z.object({ startsAt: Timestamp, endsAt: Timestamp });

export const ProgramLog = z.object({
  from: Timestamp,
  to: Timestamp,
  entries: z.array(LogEntry),
  breaks: z.array(BreakSlot),
  /** Dead air: time with nothing on the log. */
  gaps: z.array(Gap)
});

export const DeadAirStatus = z.object({
  /** Over the next 24 hours. */
  gaps: z.array(Gap),
  nextGapAt: Timestamp.nullable(),
  /** "Log runs until Sun 8:42 pm". */
  logRunsUntil: Timestamp.nullable(),
  warnings: z.array(z.object({ gapStartsAt: Timestamp, warnedAt: Timestamp, minutesBefore: z.union([z.literal(30), z.literal(12)]) }))
});

const StationParams = z.object({ stationId: Id });

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
  localNote: z.string().max(160).optional()
});

export const logApi = {
  getLog: endpoint({
    method: "GET",
    path: "/stations/:stationId/log",
    auth: "user",
    summary: "The program log for a window (day, evening or week), with generated breaks and dead air",
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
    summary: "Build one day and repeat it: every day, every week on that day, or once",
    params: StationParams,
    body: z.object({
      day: z.iso.date(),
      pattern: z.enum(["once", "daily", "weekly"]),
      until: z.iso.date(),
      /** For "once": the day to copy to. */
      onto: z.iso.date().optional()
    }),
    response: z.object({ created: z.number().int(), skippedForConflicts: z.number().int() })
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
  })
};

export const SignOnCheck = z.object({
  key: z.enum(["log_covers_24h", "station_id_hourly", "rights_confirmed", "listings_complete", "live_sources_connected", "channel_chosen", "call_sign_chosen", "output"]),
  label: z.string(),
  passed: z.boolean(),
  /** Blockers stop sign-on; warnings don't. */
  blocking: z.boolean(),
  detail: z.string().nullable()
});

export const PlayoutStatus = z.object({
  onAir: z.boolean(),
  now: z.object({ title: z.string(), code: LogCode, startedAt: Timestamp, itemId: Id.nullable() }).nullable(),
  lastError: z.string().nullable(),
  output: z.object({ livepeerEnabled: z.boolean(), playbackUrl: z.string().nullable() }),
  nextBreakAt: Timestamp.nullable()
});

export const AsRunRow = z.object({
  id: Id,
  code: LogCode,
  title: z.string(),
  startedAt: Timestamp,
  endedAt: Timestamp,
  reason: z.enum(["planned", "rotation", "backup_rotation", "station_id_fill", "dead_air_fill", "live", "slate"]),
  itemId: Id.nullable(),
  airingId: Id.nullable()
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
