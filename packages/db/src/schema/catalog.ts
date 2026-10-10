import { sql } from "drizzle-orm";
import { boolean, check, date, integer, jsonb, primaryKey, smallint, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { at, createdAt, id, micros, millis } from "./columns.js";
import { catalog } from "./namespaces.js";
import { programs, stations, channels } from "./broadcast.js";
import { users } from "./accounts.js";

/** Barter, Cash, Cash plus barter; Free is the Opencast catalog's term. */
export const carriageTerm = catalog.enum("carriage_term", ["barter", "cash", "cash_plus_barter", "free"]);

/** The deal terms, copied onto each agreement so later changes apply to new carriers only. */
const termsColumns = () => ({
  cashPriceMicros: micros("cash_price_micros"),
  cashPriceUnit: text("cash_price_unit", { enum: ["per_airing", "per_hour"] }),
  /** Break time the maker fills under barter, per hour of the program ("REEL fills 2:00 of 4:00"). */
  barterMakerMsPerHour: millis("barter_maker_ms_per_hour"),
  /** 1, 2 or 3; null is Any. */
  airingsPerEpisode: smallint("airings_per_episode"),
  windowDays: smallint("window_days").notNull().default(7),
  liveOnly: boolean("live_only").notNull().default(false),
  noticeDays: smallint("notice_days").notNull().default(7),
  /**
   * Programming Phase 6 (migration 0065): where the carrier may send it besides its own channel
   * (contracts' `Outlet`; `opencast` is always in). Offers and agreements made before it have
   * `opencast` and `relays`, which relays already carried.
   */
  outlets: text("outlets").array().notNull().default(sql`'{opencast,relays}'::text[]`)
});

/**
 * An offer to carry a program. A program with any link-imported episode can
 * never be offered (trigger), because link imports stay on their station.
 */
export const offers = catalog.table(
  "offers",
  {
    id: id(),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id),
    makerStationId: uuid("maker_station_id")
      .notNull()
      .references(() => stations.id),
    /** The deals the maker allows, 1 to 3 of them, each priced in the columns below. */
    termsOffered: jsonb("terms_offered").$type<string[]>().notNull(),
    ...termsColumns(),
    approval: text("approval", { enum: ["any_station", "i_approve"] }).notNull().default("i_approve"),
    radioBandAllowed: boolean("radio_band_allowed").notNull().default(true),
    /** C3 (added 2026-09-29): cash plus barter's own price and split; null: the cash columns above. */
    cpbPriceMicros: micros("cpb_price_micros"),
    cpbPriceUnit: text("cpb_price_unit", { enum: ["per_airing", "per_hour"] }),
    cpbMakerMsPerHour: millis("cpb_maker_ms_per_hour"),
    /** C3: what the maker's barter time carries: its spots, or only its underwriting credit. */
    barterFill: text("barter_fill", { enum: ["spots", "credit_only"] }).notNull().default("spots"),
    status: text("status", { enum: ["offered", "withdrawn"] }).notNull().default("offered"),
    createdAt: createdAt(),
    updatedAt: at("updated_at").notNull().defaultNow()
  },
  (t) => [
    check("airings_per_episode_range", sql`${t.airingsPerEpisode} is null or ${t.airingsPerEpisode} between 1 and 3`),
    uniqueIndex("offers_one_per_program").on(t.programId).where(sql`${t.status} = 'offered'`)
  ]
);

export const requests = catalog.table("requests", {
  id: id(),
  offerId: uuid("offer_id")
    .notNull()
    .references(() => offers.id),
  carrierStationId: uuid("carrier_station_id")
    .notNull()
    .references(() => stations.id),
  term: carriageTerm("term").notNull(),
  /** "Weeknights at 1:00 am", as structured slots. */
  slots: jsonb("slots").notNull(),
  startsOn: date("starts_on").notNull(),
  audioOnly: boolean("audio_only").notNull().default(false),
  status: text("status", { enum: ["asked", "approved", "declined", "withdrawn"] }).notNull().default("asked"),
  declineReason: text("decline_reason", { enum: ["not_right_fit", "time_slot", "terms"] }),
  decidedAt: at("decided_at"),
  decidedBy: uuid("decided_by").references(() => users.id),
  createdAt: createdAt()
});

export const agreements = catalog.table(
  "agreements",
  {
    id: id(),
    requestId: uuid("request_id")
      .notNull()
      .unique()
      .references(() => requests.id),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => offers.id),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id),
    makerStationId: uuid("maker_station_id")
      .notNull()
      .references(() => stations.id),
    carrierStationId: uuid("carrier_station_id")
      .notNull()
      .references(() => stations.id),
    term: carriageTerm("term").notNull(),
    ...termsColumns(),
    audioOnly: boolean("audio_only").notNull().default(false),
    /** For 24/7 carriage on a subchannel. */
    subchannelId: uuid("subchannel_id").references(() => channels.id),
    startedAt: at("started_at").notNull(),
    endNoticeGivenAt: at("end_notice_given_at"),
    endNoticeGivenBy: text("end_notice_given_by", { enum: ["maker", "carrier"] }),
    endsAt: at("ends_at"),
    createdAt: createdAt()
  },
  (t) => [check("maker_is_not_carrier", sql`${t.makerStationId} <> ${t.carrierStationId}`)]
);

/** Previews are counted, not who; they don't use up an airing. */
export const offerPreviews = catalog.table(
  "offer_previews",
  {
    offerId: uuid("offer_id")
      .notNull()
      .references(() => offers.id),
    day: date("day").notNull(),
    count: integer("count").notNull().default(0)
  },
  (t) => [primaryKey({ columns: [t.offerId, t.day] })]
);
