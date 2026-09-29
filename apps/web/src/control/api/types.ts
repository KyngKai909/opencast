// Named parts of the contracts' shapes, as master control passes them around. Everything here is
// the contract's own (@opencast/contracts): master control's proposed fields and endpoints landed
// on 2026-09-29 (docs/contracts-changelog.md). What's still proposed stays in api/ext/*.

import type { AudienceReport, CarriageRequest, catalogApi, Offer, spotsApi, Statement } from "@opencast/contracts";
import type { z } from "zod";

// ---- earnings and audience (E2, E3, U1) ----

/** A statement line (E3: `group`, `airings`). */
export type StatementLine = Statement["lines"][number];
/** How a statement groups its lines. */
export type StatementGroup = NonNullable<StatementLine["group"]>;
/** U1: a row of "By program". */
export type AudienceProgram = NonNullable<AudienceReport["byProgram"]>[number];

// ---- the market (L1, C1 to C9) ----

/** L1: a program's format, as an offer carries it. */
export type ProgramFormat = NonNullable<Offer["program"]["format"]>;
/** C7: the asking station, as the maker sees it. */
export type CarrierProfile = NonNullable<CarriageRequest["carrierProfile"]>;
/** The browse query (C2: `maker`, `makerKind`, `gap`), with `fitsSchedule` as the flag it's sent as. */
export type BrowseQuery = Omit<z.input<typeof catalogApi.browse.query>, "fitsSchedule"> & { fitsSchedule?: boolean };
/** offerProgram's and updateOffer's terms (C3: `cashPlusBarter`, `barterFill`). */
export type TermsBody = z.input<typeof catalogApi.offerProgram.body>;

// ---- spots ----

/** P24: what a finished spot is listed at. */
export type ListedRate = NonNullable<z.infer<typeof spotsApi.tellMeWhenListed.response>["listedRate"]>;
