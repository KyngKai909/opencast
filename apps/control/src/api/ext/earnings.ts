// Fields the Audience and Earnings pages need that the contracts don't have yet, as optional
// extensions of the contract schemas (docs/contract-requests.md). The mocks fill them in; against
// the real API they're absent until the request lands, and the pages hide what depends on them.

import { AudienceReport, DateOnly, Id, Micros, Statement, StationEarnings, StationIdent, Timestamp } from "@opencast/contracts";
import { z } from "zod";

/**
 * E2: the sponsors by name with their monthly amounts ("Redlands Hardware and Clear, $100.00 a
 * month each"), how many breaks tonight's held airings sit in ("9 airings in 4 breaks"), and the
 * next payout's amount.
 */
export const StationEarningsX = StationEarnings.extend({
  lines: StationEarnings.shape.lines.extend({
    sponsors: StationEarnings.shape.lines.shape.sponsors.extend({
      list: z.array(z.object({ name: z.string(), monthlyMicros: Micros })).optional()
    })
  }),
  held: StationEarnings.shape.held.extend({ tonightBreaks: z.number().int().optional() }),
  nextPayout: StationEarnings.shape.nextPayout.unwrap().extend({ amountMicros: Micros.optional() }).nullable()
});
export type StationEarningsX = z.infer<typeof StationEarningsX>;

/** E3: a statement line's group and, for spots, the numbers behind it (rate, airings, average tuned in). */
export const StatementGroup = z.enum(["spots", "sponsors_pledges", "carriage", "shared", "card_fees", "production", "other"]);
export type StatementGroup = z.infer<typeof StatementGroup>;

export const StatementLineX = Statement.shape.lines.element.extend({
  group: StatementGroup.optional(),
  /** How many airings the line is for. */
  airings: z.number().int().optional(),
  /** What the advertiser pays: per 1,000 tuned in, or per airing. */
  rate: z.object({ kind: z.enum(["per_thousand", "per_airing"]), micros: Micros }).optional(),
  /** Per-thousand lines: the average tuned in across the airings. */
  averageTunedIn: z.number().int().optional()
});
export type StatementLineX = z.infer<typeof StatementLineX>;

/** E3: when and where the statement was paid ("Paid Monday, September 21, to Chase ending 2231"). */
export const StatementX = Statement.extend({
  lines: z.array(StatementLineX),
  paidOn: DateOnly.nullable().optional(),
  destination: z.string().nullable().optional()
});
export type StatementX = z.infer<typeof StatementX>;
export const StatementsX = z.array(StatementX);

/** U1: by program, per airing (or per program over a week or a month). */
export const AudienceProgram = z.object({
  /** The log entry, or the program for a week or a month. */
  key: z.string(),
  programId: Id.nullable(),
  title: z.string(),
  /** When it aired; null when the row adds up several airings. */
  airedAt: Timestamp.nullable(),
  airings: z.number().int(),
  source: z.enum(["library", "carried", "live"]),
  carriedFrom: StationIdent.nullable(),
  averageTunedIn: z.number().int(),
  peakTunedIn: z.number().int(),
  /** Null while it's on (and for a program on now). */
  stayedToTheEnd: z.number().nullable(),
  onNow: z.boolean()
});
export type AudienceProgram = z.infer<typeof AudienceProgram>;

/**
 * U1: by program. U3: the comparison line over the whole window, past now (the contract's
 * `series[].lastWeek` stops where tonight's line does), and every break in the window.
 */
export const AudienceReportX = AudienceReport.extend({
  byProgram: z.array(AudienceProgram).optional(),
  comparison: z.array(z.object({ minute: Timestamp, tunedIn: z.number().int() })).optional(),
  breaks: z.array(z.object({ startsAt: Timestamp, endsAt: Timestamp })).optional()
});
export type AudienceReportX = z.infer<typeof AudienceReportX>;
