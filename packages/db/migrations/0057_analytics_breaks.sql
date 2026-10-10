-- 2026-10-07: A251 Phase 5, break hold for the desk's Programs and breaks tab. One row per aired
-- break (from the as-run log): its length, where it sat and what opened it, and of those tuned in when
-- it started, how many were still there when it ended (session minutes). Kept for good, naming no
-- one; the first run fills in the 30 days of sessions kept.
-- Additive: one new table.
CREATE TABLE "audience"."break_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"break_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"seconds" integer NOT NULL,
	"position" text NOT NULL,
	"first_element" text NOT NULL,
	"spots" integer DEFAULT 0 NOT NULL,
	"tuned_at_start" integer NOT NULL,
	"still_at_end" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audience"."break_stats" ADD CONSTRAINT "break_stats_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "break_stats_aired" ON "audience"."break_stats" USING btree ("break_id","started_at");--> statement-breakpoint
CREATE INDEX "break_stats_station_time" ON "audience"."break_stats" USING btree ("station_id","started_at");