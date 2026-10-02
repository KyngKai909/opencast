// Named parts of the contract's spots and ledger types, as the business app passes them around.
// Everything here is the contract's own shape (@opencast/contracts): the business app's proposed
// fields and endpoints landed on 2026-09-29 (docs/contracts-changelog.md). What's still the app's
// own (the legacy hand-pause reading, the mock-only spot actions) is in api/ext/spots.ts.

import type { CreditCheck, ledgerApi, ProductionOrder, Results, SpotPauseStory, spotsApi, Statement } from "@opencast/contracts";
import type { z } from "zod";

/** A maker that takes orders (P18: `history` with `businessId`, and `specialty`). */
export type Maker = z.infer<typeof spotsApi.listMakers.response>[number];
/** One of the credit check's flags (P17: `quote`). */
export type CreditFlag = CreditCheck["flags"][number];
/** What checking or redeeming a code says (B5, P12). */
export type RedeemAnswer = z.infer<typeof spotsApi.redeemCode.response>;
/** A results period (P14). */
export type ResultsPeriod = NonNullable<Results["period"]>;
/** A statement's line (E3: business statements' `group` is `balance` or `spent`). */
export type StatementLine = Statement["lines"][number];
/** What a station put in a paused spot's place (P6). */
export type FilledWith = SpotPauseStory["stations"][number]["filledWith"];
/** A deposit's quote (E6: `basis`). */
export type DepositQuote = z.infer<typeof ledgerApi.quoteDeposit.response>;
/** One delivery of a production order (P19). */
export type Delivery = ProductionOrder["deliveries"][number];
