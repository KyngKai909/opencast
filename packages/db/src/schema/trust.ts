import { boolean, index, integer, text, uuid } from "drizzle-orm/pg-core";
import { at, createdAt, id, millis } from "./columns.js";
import { trust, rightsBasis } from "./namespaces.js";
import { assets, contents, stations } from "./broadcast.js";
import { users } from "./accounts.js";

export const claimStatus = trust.enum("claim_status", [
  /** Off air, days to answer. */
  "open",
  /** Back on air; the claimant has 10 business days to respond. */
  "answered",
  "upheld",
  /** The station took it down. */
  "removed",
  /** No answer by the deadline: removed from the library. Counts as removed, not upheld. */
  "expired",
  "withdrawn",
  "restored"
]);

/**
 * Added 2026-09-29 (migration 0028): a privacy complaint (someone shown without consent) comes off
 * air like a copyright claim but has no answer window, is reviewed by Opencast, and never counts
 * toward the repeat limit. Every claim from before is copyright.
 */
export const claimKind = trust.enum("claim_kind", ["copyright", "privacy"]);

export const claims = trust.table(
  "claims",
  {
    id: id(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    /** The station that made the item. */
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    claimantName: text("claimant_name").notNull(),
    claimantRole: text("claimant_role"),
    claimantContact: text("claimant_contact").notNull(),
    workKind: text("work_kind"),
    claimText: text("claim_text").notNull(),
    rangeStartMs: millis("range_start_ms"),
    rangeEndMs: millis("range_end_ms"),
    swornStatement: boolean("sworn_statement").notNull(),
    kind: claimKind("kind").notNull().default("copyright"),
    status: claimStatus("status").notNull().default("open"),
    receivedAt: at("received_at").notNull().defaultNow(),
    answerDueAt: at("answer_due_at").notNull(),
    closedAt: at("closed_at")
  },
  (t) => [index("claims_station").on(t.stationId, t.receivedAt)]
);

export const answers = trust.table("answers", {
  id: id(),
  claimId: uuid("claim_id")
    .notNull()
    .unique()
    .references(() => claims.id),
  basis: rightsBasis("basis").notNull(),
  note: text("note"),
  attachmentUrl: text("attachment_url"),
  attestedBy: uuid("attested_by")
    .notNull()
    .references(() => users.id),
  /** The station's legal name and contact, sent to the claimant with the answer. */
  legalName: text("legal_name").notNull(),
  legalContact: text("legal_contact").notNull(),
  answeredAt: at("answered_at").notNull().defaultNow(),
  claimantReplyDueAt: at("claimant_reply_due_at").notNull()
});

/** Where a claimed item was pulled: the maker and every carrier. */
export const takedowns = trust.table("takedowns", {
  id: id(),
  claimId: uuid("claim_id")
    .notNull()
    .references(() => claims.id),
  stationId: uuid("station_id")
    .notNull()
    .references(() => stations.id),
  pulledAt: at("pulled_at").notNull().defaultNow(),
  airingsReplaced: integer("airings_replaced").notNull().default(0),
  replacedWithAssetId: uuid("replaced_with_asset_id").references(() => assets.id),
  restoredAt: at("restored_at"),
  carrierNotifiedAt: at("carrier_notified_at")
});

/** The threshold that pauses a station's carriage offers (placeholder: 3 upheld in a year). */
export const policy = trust.table("policy", {
  id: integer("id").primaryKey().default(1),
  upheldPerYearToPauseOffers: integer("upheld_per_year_to_pause_offers").notNull().default(3),
  answerDays: integer("answer_days").notNull().default(14),
  claimantReplyBusinessDays: integer("claimant_reply_business_days").notNull().default(10),
  createdAt: createdAt()
});

/** B6 (added 2026-09-29): a file that backs an answer (the permission, the licence), stored by content ID. */
export const claimAttachments = trust.table("claim_attachments", {
  id: id(),
  claimId: uuid("claim_id")
    .notNull()
    .references(() => claims.id),
  contentId: text("content_id")
    .notNull()
    .references(() => contents.cid),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  bytes: integer("bytes").notNull(),
  uploadedBy: uuid("uploaded_by")
    .notNull()
    .references(() => users.id),
  createdAt: createdAt()
});
