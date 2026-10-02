import { z } from "zod";

export const Id = z.uuid();

/** ISO 8601 with offset, e.g. `2026-10-01T20:28:30.000Z`. */
export const Timestamp = z.iso.datetime({ offset: true });

/** `YYYY-MM-DD`. */
export const DateOnly = z.iso.date();

/** Money in micro-dollars (1 USDC base unit). $8.00 is 8_000_000. */
export const Micros = z.number().int();

/** Durations in milliseconds. `:30` is 30_000. */
export const Millis = z.number().int().nonnegative();

export const Band = z.enum(["tv", "radio"]);
export type Band = z.infer<typeof Band>;

/** As shown on the dial: `12.1`, `88.4`. Radio is `88.2` to `107.8` in even tenths (the API checks the band). */
export const ChannelNumber = z.string().regex(/^\d{1,3}\.\d$/);

export const CallSign = z.string().regex(/^[A-Z]{3,5}$/, "Three to five capital letters");

/** A station colour: `#rrggbb`, holding 4.5:1 against white (checked by the API). */
export const Colour = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const LogCode = z.enum(["PGM", "SPT", "UND", "BMP", "SID", "OPEN"]);
export type LogCode = z.infer<typeof LogCode>;

export const StationKind = z.enum(["station", "studio", "claimable", "listed", "catalog"]);

export const StationRole = z.enum(["owner", "operator", "host"]);
export const BusinessRole = z.enum(["owner", "manager", "viewer"]);

/** Where a player is. `mirror` (added 2026-09-28): TV mode on the iPhone's second screen. */
export const Platform = z.enum(["phone", "cast", "web", "tv_app", "mirror"]);

/** Cursor pagination for long lists. */
export const PageQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

export const page = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable()
  });

export const Ok = z.object({ ok: z.literal(true) });

/** The station ident everywhere a station is named: call sign, channel, colour. */
export const StationIdent = z.object({
  id: Id,
  kind: StationKind,
  callSign: CallSign.nullable(),
  handle: z.string().nullable(),
  name: z.string(),
  colour: Colour.nullable(),
  band: Band.nullable(),
  channel: ChannelNumber.nullable(),
  marketSlug: z.string().nullable(),
  homeCity: z.string().nullable(),
  // ---- Added 2026-09-30: shared call signs (A229) ----
  /**
   * The station's part of its addresses (`/watch/{slug}`, the station page `/{slug}`, master
   * control `/control/{slug}/…`): its call sign in lower case (`sbco`), or, for a station sharing
   * X.1's call sign, the call sign and its channel (`sbco-15-2`). Absent from an older API: an app
   * then uses the call sign in lower case, as before. Every address that worked keeps working.
   */
  slug: z.string().optional(),
  /**
   * True when this call sign is shared (X.1 with a family, or X.n sharing X.1's). Where only a call
   * sign would show, add the channel ("SBCO 15.2") so the family's streams are told apart.
   */
  sharesCallSign: z.boolean().optional()
});
export type StationIdent = z.infer<typeof StationIdent>;

export const Market = z.object({
  id: Id,
  slug: z.string(),
  name: z.string(),
  timezone: z.string(),
  open: z.boolean()
});
export type Market = z.infer<typeof Market>;

export type Id = z.infer<typeof Id>;
export type Timestamp = z.infer<typeof Timestamp>;
export type DateOnly = z.infer<typeof DateOnly>;
export type Micros = z.infer<typeof Micros>;
export type Millis = z.infer<typeof Millis>;
export type ChannelNumber = z.infer<typeof ChannelNumber>;
export type CallSign = z.infer<typeof CallSign>;
export type Colour = z.infer<typeof Colour>;
export type StationKind = z.infer<typeof StationKind>;
export type StationRole = z.infer<typeof StationRole>;
export type BusinessRole = z.infer<typeof BusinessRole>;
export type Platform = z.infer<typeof Platform>;
export type PageQuery = z.infer<typeof PageQuery>;
export type Ok = z.infer<typeof Ok>;
