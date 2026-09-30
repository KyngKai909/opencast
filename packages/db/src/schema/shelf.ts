import { sql } from "drizzle-orm";
import { bigint, check, index, integer, jsonb, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { at, createdAt, id, millis } from "./columns.js";
import { catalog } from "./namespaces.js";
import { assets, contents, programs, stations } from "./broadcast.js";
import { users } from "./accounts.js";

// The Opencast catalog's shelf (added 2026-09-29, follow-up Phase 0 item 10): series, the items they
// are built from (each a library file by content ID, with its own rights record and evidence),
// and episodes composed from items. `catalog.offers` and the rest of this schema are the syndication
// market; a series is offered there like any program (its `program_id` on the catalog station).

/** Where a series' rights come from, as the shelf and the market's "Rights" line say it. */
export const shelfBasis = ["us_government", "published_before_cutoff", "not_renewed", "mixed", "sound_recording", "licence"] as const;

export const shelfSeries = catalog.table(
  "shelf_series",
  {
    id: id(),
    title: text("title").notNull(),
    description: text("description"),
    /** The catalog station it's made on, and its program there (what carriage attaches to). */
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    programId: uuid("program_id")
      .notNull()
      .unique()
      .references(() => programs.id),
    mediaKind: text("media_kind", { enum: ["video", "audio"] }).notNull().default("video"),
    rightsBasis: text("rights_basis", { enum: shelfBasis }).notNull(),
    /** The small line under the basis: "Public domain by law", "Before 1931, or not renewed". */
    basisNote: text("basis_note"),
    notes: text("notes"),
    /** Episode length it's built to (30 min, 2 hr); null: whatever its items add up to. */
    episodeLengthMs: millis("episode_length_ms"),
    colour: text("colour"),
    /** coming: on the shelf, not offered yet (licensed catalogs). */
    state: text("state", { enum: ["building", "coming"] }).notNull().default("building"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt()
  },
  (t) => [
    check("series_basis", sql`${t.rightsBasis} in ('us_government', 'published_before_cutoff', 'not_renewed', 'mixed', 'sound_recording', 'licence')`),
    check("series_state", sql`${t.state} in ('building', 'coming')`)
  ]
);

/**
 * One film or recording, with its own rights record. `state`: checking (the checklist is being
 * filled), second_check (sent, waiting for someone else), passed (two people said yes), failed
 * (a check failed, before or after it passed: it comes out of every episode).
 */
export const shelfItems = catalog.table(
  "shelf_items",
  {
    id: id(),
    seriesId: uuid("series_id")
      .notNull()
      .references(() => shelfSeries.id),
    title: text("title").notNull(),
    /** "1932, original print, Library of Congress". */
    source: text("source").notNull(),
    workKind: text("work_kind", { enum: ["film", "sound_recording"] }).notNull().default("film"),
    publishedYear: integer("published_year"),
    /** Where it was first published. The rules are US rules; anything else is checked by hand. */
    country: text("country").notNull().default("US"),
    basis: text("basis", { enum: ["us_government", "published_before_cutoff", "not_renewed", "no_notice", "sound_recording_term"] }),
    /** The library item it's a file of, on the catalog station, and the file by content ID. */
    libraryItemId: uuid("library_item_id").references(() => assets.id),
    contentId: text("content_id")
      .notNull()
      .references(() => contents.cid),
    durationMs: millis("duration_ms"),
    state: text("state", { enum: ["checking", "second_check", "passed", "failed"] }).notNull().default("checking"),
    firstCheckedBy: uuid("first_checked_by").references(() => users.id),
    firstCheckedAt: at("first_checked_at"),
    secondCheckedBy: uuid("second_checked_by").references(() => users.id),
    secondCheckedAt: at("second_checked_at"),
    failedBy: uuid("failed_by").references(() => users.id),
    failedAt: at("failed_at"),
    failedReason: text("failed_reason"),
    addedBy: uuid("added_by").references(() => users.id),
    createdAt: createdAt()
  },
  (t) => [
    check("item_state", sql`${t.state} in ('checking', 'second_check', 'passed', 'failed')`),
    check("item_kind", sql`${t.workKind} in ('film', 'sound_recording')`),
    // Two people: the second check is never the first checker's.
    check("second_check_is_someone_else", sql`${t.secondCheckedBy} is null or ${t.secondCheckedBy} <> ${t.firstCheckedBy}`),
    check("passed_has_both_checks", sql`${t.state} <> 'passed' or (${t.firstCheckedBy} is not null and ${t.secondCheckedBy} is not null)`),
    check("sent_has_first_check", sql`${t.state} <> 'second_check' or ${t.firstCheckedBy} is not null`),
    index("shelf_items_series").on(t.seriesId),
    index("shelf_items_content").on(t.contentId)
  ]
);

/** One line of an item's checklist ("Why it's free to air"), with its answer and written record. */
export const shelfItemChecks = catalog.table(
  "shelf_item_checks",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => shelfItems.id),
    line: text("line", { enum: ["source", "published", "renewal", "soundtrack", "trademarks"] }).notNull(),
    /** ok: yes, with evidence. warn: fine to air, with a caution. fail: it isn't free to air. not_needed: the rules say so. */
    state: text("state", { enum: ["todo", "ok", "warn", "fail", "not_needed"] }).notNull().default("todo"),
    /** What the checker found, one line. */
    detail: text("detail"),
    /** A written record, when the evidence isn't a file ("Copyright Office renewal records searched, none found"). */
    record: text("record"),
    setBy: uuid("set_by").references(() => users.id),
    setAt: at("set_at")
  },
  (t) => [primaryKey({ columns: [t.itemId, t.line] }), check("item_check_state", sql`${t.state} in ('todo', 'ok', 'warn', 'fail', 'not_needed')`)]
);

/** A file backing one line of the checklist, stored by content ID for as long as the item is in the catalog. */
export const shelfItemEvidence = catalog.table(
  "shelf_item_evidence",
  {
    id: id(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => shelfItems.id),
    line: text("line", { enum: ["source", "published", "renewal", "soundtrack", "trademarks"] }).notNull(),
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
  },
  (t) => [index("shelf_item_evidence_item").on(t.itemId)]
);

/**
 * An episode: a sequence of items, composed into one file and handed to the library as an item of
 * the series' program on the catalog station, so it's prepared once like any program. A rebuild that
 * changes its items composes a new file, a new version of that library item: carriers air it from
 * their next airing. `composition` is a hash of the content IDs in order, so a rebuild that changes
 * nothing composes nothing.
 */
export const shelfEpisodes = catalog.table(
  "shelf_episodes",
  {
    id: id(),
    seriesId: uuid("series_id")
      .notNull()
      .references(() => shelfSeries.id),
    number: integer("number").notNull(),
    title: text("title"),
    libraryItemId: uuid("library_item_id").references(() => assets.id),
    composition: text("composition"),
    version: integer("version").notNull().default(0),
    status: text("status", { enum: ["draft", "composing", "ready", "failed"] }).notNull().default("draft"),
    error: text("error"),
    composedAt: at("composed_at"),
    createdAt: createdAt()
  },
  (t) => [uniqueIndex("shelf_episodes_number").on(t.seriesId, t.number), check("episode_status", sql`${t.status} in ('draft', 'composing', 'ready', 'failed')`)]
);

/** An item in an episode. Taken out (a failed check) keeps the row, with when and why, and no position. */
export const shelfEpisodeItems = catalog.table(
  "shelf_episode_items",
  {
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => shelfEpisodes.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => shelfItems.id),
    position: integer("position"),
    addedAt: at("added_at").notNull().defaultNow(),
    removedAt: at("removed_at"),
    removedReason: text("removed_reason")
  },
  (t) => [primaryKey({ columns: [t.episodeId, t.itemId] }), check("removed_has_no_position", sql`(${t.removedAt} is null) = (${t.position} is not null)`)]
);

/** What a rebuild did: the item that came out, and the episodes composed again (the rest untouched). */
export const shelfRebuilds = catalog.table("shelf_rebuilds", {
  id: id(),
  /** Order among rebuilds made at the same moment. */
  seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
  seriesId: uuid("series_id")
    .notNull()
    .references(() => shelfSeries.id),
  itemId: uuid("item_id").references(() => shelfItems.id),
  reason: text("reason").notNull(),
  by: uuid("by").references(() => users.id),
  at: at("at").notNull().defaultNow(),
  /** [{ episodeId, number, fromVersion, toVersion, status }] */
  episodes: jsonb("episodes").$type<Array<{ episodeId: string; number: number; fromVersion: number; toVersion: number; status: string }>>().notNull(),
  unchanged: integer("unchanged").notNull().default(0)
});
