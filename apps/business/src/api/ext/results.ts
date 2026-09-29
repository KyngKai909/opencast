// The Results area's proposed fields and endpoints (docs/contract-requests.md), as optional
// extensions of the contract schemas. The mocks fill them in; against the real API they're absent
// until each request lands, and the screens hide what depends on them (or fall back).
//
//   S1  A station's kind ("Music", "Public affairs"), under its call sign in the results table.
//   P4  "Once per customer" on a code, and how long a saved offer keeps ("Until October 10").
//   P12 The Redeem tool: whether it's on, and how many codes were redeemed today.
//   P13 Codes by code: scans, saves and uses of each, and how the uses were counted.
//   P14 Results periods: a week and all time, not only a month, and the dates they cover so far.
//   P15 Why an airing was short, and when its proof frame was captured.
//   P20 Which counters are connected (Clear Pay, an online checkout).
//   B5  Check a code before redeeming it, without counting the use.
//   E3  A statement's line groups (the balance, spent by spot and station), in progress or final,
//       and the closing figure split into available and held.

import { DateOnly, Id, Micros, Results, ResultsAiring, Statement, StationIdent, Timestamp, endpoint, spotsApi } from "@opencast/contracts";
import { z } from "zod";

// ---- Results (P14, S1, P13, P15) ----

export const ResultsPeriod = z.enum(["week", "month", "all"]);
export type ResultsPeriod = z.infer<typeof ResultsPeriod>;

/** P15: why an airing ran short ("The town hall ran over"), and when its proof frame was captured. */
export const ResultsAiringX = ResultsAiring.extend({
  shortReason: z.string().nullable().optional(),
  proofCapturedAt: Timestamp.nullable().optional()
});
export type ResultsAiringX = z.infer<typeof ResultsAiringX>;

/** P13 (with P4 and P20): one code's funnel and how its uses were counted. */
export const ResultsCode = z.object({
  code: z.string(),
  spotId: Id,
  spotTitle: z.string(),
  offer: z.string(),
  /** Counts as a customer if used within this many days of an airing. */
  windowDays: z.number().int(),
  /** P4: "10% off, once per customer". */
  oncePerCustomer: z.boolean(),
  /** P4: how long a saved offer keeps on the customer's phone ("Until October 10"). */
  savedForDays: z.number().int(),
  scans: z.number().int(),
  saves: z.number().int(),
  uses: z.number().int(),
  /** P13 and P20: uses by where they were counted; null where that counter isn't connected. */
  usesBy: z.object({ clearPay: z.number().int().nullable(), marked: z.number().int(), online: z.number().int().nullable() }),
  /** The station most saves came from, for the saved-offer preview ("Saved from BEAT 12.1"). */
  savedMostFrom: StationIdent.nullable()
});
export type ResultsCode = z.infer<typeof ResultsCode>;

export const ResultsX = Results.extend({
  /** P14: the period these results cover, and its dates so far. */
  period: ResultsPeriod.optional(),
  from: DateOnly.optional(),
  to: DateOnly.optional(),
  /** S1: each station's kind. */
  byStation: z.array(Results.shape.byStation.element.extend({ category: z.string().nullable().optional() })),
  codes: z.array(ResultsCode).optional(),
  airings: z.array(ResultsAiringX)
});
export type ResultsX = z.infer<typeof ResultsX>;

export const SpotAiringsX = spotsApi.listSpotAirings.response.extend({ aired: z.array(ResultsAiringX) });
export type SpotAiringsX = z.infer<typeof SpotAiringsX>;

// ---- Redeeming (B5, P12) ----

/** What a check or a redemption says, plus B5's offer text, when it was saved, and the spot. */
export const RedeemAnswer = spotsApi.redeemCode.response.extend({
  code: z.string().optional(),
  offer: z.string().nullable().optional(),
  savedAt: Timestamp.nullable().optional(),
  spotTitle: z.string().nullable().optional(),
  /** P12: after a redemption, today's count. */
  redeemedToday: z.number().int().optional()
});
export type RedeemAnswer = z.infer<typeof RedeemAnswer>;

/** B5: check a code at the counter without counting the use. */
export const redeemCheck = endpoint({
  method: "POST",
  path: "/businesses/:businessId/redeem/check",
  auth: "user",
  summary: "Check a code before redeeming: valid, first use for this customer, where it was saved (owner, manager). Counts nothing.",
  params: z.object({ businessId: Id }),
  body: spotsApi.redeemCode.body,
  response: RedeemAnswer
});

/** P12: whether the Redeem tool is on for this business, and today's count. */
export const redeemToday = endpoint({
  method: "GET",
  path: "/businesses/:businessId/redeem/today",
  auth: "user",
  summary: "The Redeem tool: on or off, and how many codes were marked used today (owner, manager)",
  params: z.object({ businessId: Id }),
  response: z.object({ on: z.boolean(), redeemedToday: z.number().int(), clearPay: z.boolean() })
});

// ---- Statements (E3) ----

export const StatementLineGroup = z.enum(["balance", "spent"]);

export const BizStatementLine = Statement.shape.lines.element.extend({
  /** E3: the balance lines, or spent by spot and station. */
  group: StatementLineGroup.optional(),
  kind: z.enum(["added", "aired", "returned", "fees", "sponsorship", "order", "withdrawn", "refund", "spot_station"]).optional(),
  airings: z.number().int().optional(),
  /** Shown, not added in: short-airing returns are already netted into what was spent. */
  includedAbove: z.boolean().optional()
});
export type BizStatementLine = z.infer<typeof BizStatementLine>;

export const BizStatementX = Statement.extend({
  lines: z.array(BizStatementLine),
  /** E3: the month isn't over ("so far; the final statement is ready October 1"). */
  inProgress: z.boolean().optional(),
  /** The last day the statement covers so far. */
  asOf: DateOnly.optional(),
  finalOn: DateOnly.nullable().optional(),
  /** E3: the closing figure, split. */
  closingAvailableMicros: Micros.optional(),
  closingHeldMicros: Micros.optional()
});
export type BizStatementX = z.infer<typeof BizStatementX>;
export const BizStatementsX = z.array(BizStatementX);
