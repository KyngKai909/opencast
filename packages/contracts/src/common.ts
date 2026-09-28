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

/** As shown on the dial: `12.1`, `88.3`. */
export const ChannelNumber = z.string().regex(/^\d{1,3}\.\d$/);

export const CallSign = z.string().regex(/^[A-Z]{3,5}$/, "Three to five capital letters");

/** A station colour: `#rrggbb`, holding 4.5:1 against white (checked by the API). */
export const Colour = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const LogCode = z.enum(["PGM", "SPT", "UND", "BMP", "SID", "OPEN"]);
export type LogCode = z.infer<typeof LogCode>;

export const StationKind = z.enum(["station", "studio", "claimable", "listed", "catalog"]);

export const StationRole = z.enum(["owner", "operator", "host"]);
export const BusinessRole = z.enum(["owner", "manager", "viewer"]);

export const Platform = z.enum(["phone", "cast", "web", "tv_app"]);

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
  homeCity: z.string().nullable()
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
