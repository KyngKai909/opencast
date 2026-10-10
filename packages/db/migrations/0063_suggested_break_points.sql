-- 2026-10-10: suggested break points (programming Phase 4). Each file's suggestions, found as it's
-- prepared (its chapter marks, or where it's both black and silent), kept apart from a maker's own
-- break points, one row per file once it's been looked at; and on each library item, the file whose
-- suggestions the station used or dismissed. Additive: a new table, one nullable column.
CREATE TABLE "broadcast"."break_suggestions" (
	"content_id" text PRIMARY KEY NOT NULL,
	"source" text,
	"offsets_ms" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"error" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broadcast"."assets" ADD COLUMN "break_suggestions_answered" text;--> statement-breakpoint
ALTER TABLE "broadcast"."break_suggestions" ADD CONSTRAINT "break_suggestions_content_id_contents_cid_fk" FOREIGN KEY ("content_id") REFERENCES "broadcast"."contents"("cid") ON DELETE no action ON UPDATE no action;