// The On air area's proposed fields (docs/contract-requests.md). Each extends a contract schema
// and is optional: the mocks fill it in; against the real API it's absent until the request
// lands, and the screens hide what depends on it.

import { z } from "zod";
import { BreakSlot, LogCode, Millis, PlayoutStatus, ProgramLog, SignOnCheck, Timestamp, DateOnly } from "@opencast/contracts";

/** G1: one thing in a break, in the order it airs. Station IDs are last (settings 02.1). */
export const BreakRow = z.object({
  code: LogCode,
  title: z.string(),
  lengthMs: Millis,
  /** Whose time it is: the station's, the maker's under barter, or the backup rotation's. */
  whose: z.enum(["station", "producer", "backup"]),
  /** "REEL's break time, barter". */
  note: z.string().nullable()
});
export type BreakRow = z.infer<typeof BreakRow>;

/** G1: a break with its rows. */
export const BreakSlotG1 = BreakSlot.extend({ rows: z.array(BreakRow).optional() });
export type BreakSlotG1 = z.infer<typeof BreakSlotG1>;

/** G7 (new): how a day of the log repeats, for the log's "Repeat this day". */
export const RepeatPattern = z.object({ day: DateOnly, pattern: z.enum(["once", "daily", "weekly"]) });

/** getLog with G1 break rows and G7 repeat patterns. */
export const ProgramLogOnAir = ProgramLog.extend({
  breaks: z.array(BreakSlotG1),
  repeats: z.array(RepeatPattern).optional()
});
export type ProgramLogOnAir = z.infer<typeof ProgramLogOnAir>;

/** G2: what the Monitor needs beyond PlayoutStatus. */
export const PlayoutStatusG2 = PlayoutStatus.extend({
  /** "On air since 6:00 pm". */
  onAirSince: Timestamp.nullable().optional(),
  /** The preview monitor: the next thing to air. */
  next: z
    .object({
      title: z.string(),
      /** The line under the title on its card: "Bottled in Riverside since 1946". */
      detail: z.string().nullable(),
      code: LogCode,
      startsAt: Timestamp,
      /** The maker's barter time ("next up from REEL's break time"). */
      producer: z.string().nullable(),
      /** The card's colour while no picture is stored. */
      colour: z.string().nullable(),
      pictureUrl: z.string().nullable()
    })
    .nullable()
    .optional(),
  output: PlayoutStatus.shape.output.extend({ bitrateKbps: z.number().int().nullable().optional() })
});
export type PlayoutStatusG2 = z.infer<typeof PlayoutStatusG2>;

/** G6: a test signal to watch before sign-on ("Watch it"). */
export const SignOnChecksG6 = z.object({
  ready: z.boolean(),
  checks: z.array(SignOnCheck.extend({ watchUrl: z.string().nullable().optional() }))
});
export type SignOnChecksG6 = z.infer<typeof SignOnChecksG6>;
