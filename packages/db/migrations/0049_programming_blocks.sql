-- 2026-10-02: A244, programming blocks (the user's decision; Build B of design-bumpers-blocks). A block
-- is a named, branded stretch of a station's log ("Late Crate Nights", Saturdays 9:00 pm to 1:00 am):
-- its own look (colour, logo, what the bug shows), an intro and an outro (A242's `OPN` and `CLS`
-- items assigned to it, else an automatic card in its look), an ID (`SID` items assigned to it, which
-- air where the station ID would) and bumpers (`BMP` items by role), and optionally its own bumper
-- order. The block (`program_blocks`) is the library's; where it airs is the log's: spans on a date's
-- log (`program_block_spans`, never overlapping on a station) and blocks in a day template
-- (`day_template_blocks`, ending by 6:00 am, checked by the service). Programs and live blocks that
-- start inside a span are its members. The channel's rows and the as-run log record the block
-- something aired in (`program_block_id`).
-- Syndication readiness (the market is later): `owner_station_id` (who makes it), `source_block_id`
-- (a carrier's copy points at the maker's block), `carriage_agreement_id` (its block agreement, the
-- foreign key added with the market) and `reskin` (whether a carrier may use its own elements). Every
-- block made now is its station's own (`own_block_is_owners`).
-- No new log codes and no enum values: block items keep `BMP`, `SID`, `OPN` and `CLS`. Additive: new
-- tables, nullable columns, checks every existing row passes; `as_run` stays append-only (its
-- trigger doesn't care about ADD COLUMN). `content_refs.owner` gains `block_logo` (a text column: no
-- change here). Named by hand after 0048 (0038 is reserved, see 0040), so drizzle-kit's numbering
-- isn't relied on; the exclusion constraint and the guard below are by hand, as 0002's are.
CREATE TABLE "broadcast"."day_template_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"start_minute" smallint NOT NULL,
	"length_ms" integer NOT NULL,
	CONSTRAINT "template_block_start_minute" CHECK ("broadcast"."day_template_blocks"."start_minute" between 0 and 1439),
	CONSTRAINT "template_block_length" CHECK ("broadcast"."day_template_blocks"."length_ms" > 0)
);
--> statement-breakpoint
CREATE TABLE "broadcast"."program_block_spans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"repeat_group_id" uuid,
	"template_date" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "program_block_span_length" CHECK ("broadcast"."program_block_spans"."ends_at" > "broadcast"."program_block_spans"."starts_at" and "broadcast"."program_block_spans"."ends_at" - "broadcast"."program_block_spans"."starts_at" <= interval '24 hours')
);
--> statement-breakpoint
CREATE TABLE "broadcast"."program_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"owner_station_id" uuid NOT NULL,
	"source_block_id" uuid,
	"carriage_agreement_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"colour" text,
	"logo_content_id" text,
	"bug" text DEFAULT 'logo' NOT NULL,
	"intro" boolean DEFAULT true NOT NULL,
	"outro" boolean DEFAULT true NOT NULL,
	"sequences" jsonb,
	"reskin" text DEFAULT 'owner_only' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "program_block_name_length" CHECK (char_length("broadcast"."program_blocks"."name") between 1 and 60),
	CONSTRAINT "program_block_description_length" CHECK ("broadcast"."program_blocks"."description" is null or char_length("broadcast"."program_blocks"."description") <= 160),
	CONSTRAINT "program_block_colour_contrast" CHECK ("broadcast"."program_blocks"."colour" is null or public.contrast_on_white("broadcast"."program_blocks"."colour") >= 4.5),
	CONSTRAINT "own_block_is_owners" CHECK ("broadcast"."program_blocks"."source_block_id" is not null or "broadcast"."program_blocks"."owner_station_id" = "broadcast"."program_blocks"."station_id")
);
--> statement-breakpoint
ALTER TABLE "broadcast"."as_run" ADD COLUMN "program_block_id" uuid;--> statement-breakpoint
ALTER TABLE "broadcast"."assets" ADD COLUMN "program_block_id" uuid;--> statement-breakpoint
ALTER TABLE "broadcast"."channel_items" ADD COLUMN "program_block_id" uuid;--> statement-breakpoint
ALTER TABLE "broadcast"."day_template_blocks" ADD CONSTRAINT "day_template_blocks_template_id_repeat_groups_id_fk" FOREIGN KEY ("template_id") REFERENCES "broadcast"."repeat_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."day_template_blocks" ADD CONSTRAINT "day_template_blocks_block_id_program_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "broadcast"."program_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."program_block_spans" ADD CONSTRAINT "program_block_spans_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."program_block_spans" ADD CONSTRAINT "program_block_spans_block_id_program_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "broadcast"."program_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."program_block_spans" ADD CONSTRAINT "program_block_spans_repeat_group_id_repeat_groups_id_fk" FOREIGN KEY ("repeat_group_id") REFERENCES "broadcast"."repeat_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."program_block_spans" ADD CONSTRAINT "program_block_spans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."program_blocks" ADD CONSTRAINT "program_blocks_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."program_blocks" ADD CONSTRAINT "program_blocks_owner_station_id_stations_id_fk" FOREIGN KEY ("owner_station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."program_blocks" ADD CONSTRAINT "program_blocks_source_block_id_program_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "broadcast"."program_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."program_blocks" ADD CONSTRAINT "program_blocks_logo_content_id_contents_cid_fk" FOREIGN KEY ("logo_content_id") REFERENCES "broadcast"."contents"("cid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "day_template_blocks_template" ON "broadcast"."day_template_blocks" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "program_block_spans_station_time" ON "broadcast"."program_block_spans" USING btree ("station_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "program_blocks_name" ON "broadcast"."program_blocks" USING btree ("station_id",lower("name")) WHERE "broadcast"."program_blocks"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "broadcast"."as_run" ADD CONSTRAINT "as_run_program_block_id_program_blocks_id_fk" FOREIGN KEY ("program_block_id") REFERENCES "broadcast"."program_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."assets" ADD CONSTRAINT "assets_program_block_id_program_blocks_id_fk" FOREIGN KEY ("program_block_id") REFERENCES "broadcast"."program_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."assets" ADD CONSTRAINT "assets_block_kinds" CHECK ("broadcast"."assets"."program_block_id" is null or "broadcast"."assets"."code"::text in ('BMP', 'SID', 'OPN', 'CLS'));
--> statement-breakpoint
-- Spans never overlap on a station (as log_entries_no_overlap, 0002).
ALTER TABLE "broadcast"."program_block_spans" ADD CONSTRAINT "program_block_spans_no_overlap"
  EXCLUDE USING gist ("station_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&);
--> statement-breakpoint
-- assets_guard (0002) gains: an item assigned to a block is on the block's station; for a carried
-- copy (later, the market), only when the maker lets carriers use their own elements.
CREATE OR REPLACE FUNCTION broadcast.assets_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  station_kind broadcast.station_kind;
  block_station uuid;
  block_source uuid;
BEGIN
  IF NEW.source = 'link' AND NEW.program_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM catalog.offers WHERE program_id = NEW.program_id AND status = 'offered'
  ) THEN
    RAISE EXCEPTION 'link imports stay local: this program is offered for carriage' USING ERRCODE = 'check_violation';
  END IF;

  SELECT kind INTO station_kind FROM broadcast.stations WHERE id = NEW.station_id;
  IF station_kind = 'claimable' THEN
    IF NEW.source <> 'creator_work' THEN
      RAISE EXCEPTION 'a claimable station only airs the creator''s covered works' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT broadcast.work_is_covered(NEW.creator_work_id) THEN
      RAISE EXCEPTION 'this work has no permission or licence record' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.program_block_id IS NOT NULL THEN
    SELECT station_id, source_block_id INTO block_station, block_source FROM broadcast.program_blocks WHERE id = NEW.program_block_id;
    IF block_station IS DISTINCT FROM NEW.station_id OR (block_source IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM broadcast.program_blocks m WHERE m.id = block_source AND m.reskin = 'carrier_may_reskin'
    )) THEN
      RAISE EXCEPTION 'a block''s items are its station''s own' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
