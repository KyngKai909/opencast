-- 2026-09-29: Watch data (follow-up Phase 1). Each minute a tuned-in session counted (session_minutes)
-- and each "Not for me" vote (one per session per log entry) are kept only to work out each airing's
-- numbers: 30 days by the rules registry's watch_data.retention, votes until their airing is final.
-- airing_stats keeps each airing's numbers for good, with no session or person in it. `external` is
-- the seam for Phase 6's external stations (labelled, never read by anything that pays).
CREATE TABLE "audience"."airing_stats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"airing_key" text NOT NULL,
	"station_id" uuid NOT NULL,
	"log_entry_id" uuid,
	"as_run_id" uuid,
	"program_id" uuid,
	"maker_station_id" uuid,
	"carried" boolean DEFAULT false NOT NULL,
	"band" text NOT NULL,
	"external" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"minutes" integer NOT NULL,
	"watch_seconds" bigint NOT NULL,
	"audience_at_start" integer NOT NULL,
	"peak_audience" integer NOT NULL,
	"audience_at_end" integer NOT NULL,
	"stayed_to_end" integer NOT NULL,
	"tune_aways" integer[] NOT NULL,
	"not_for_me" integer DEFAULT 0 NOT NULL,
	"final" boolean DEFAULT false NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "airing_stats_counts" CHECK ("audience"."airing_stats"."minutes" > 0 and "audience"."airing_stats"."watch_seconds" >= 0 and "audience"."airing_stats"."audience_at_start" >= 0 and "audience"."airing_stats"."peak_audience" >= "audience"."airing_stats"."audience_at_start" and "audience"."airing_stats"."peak_audience" >= "audience"."airing_stats"."audience_at_end" and "audience"."airing_stats"."stayed_to_end" <= "audience"."airing_stats"."audience_at_start" and "audience"."airing_stats"."not_for_me" >= 0)
);
--> statement-breakpoint
CREATE TABLE "audience"."not_for_me_votes" (
	"session_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"log_entry_id" uuid NOT NULL,
	"voted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "not_for_me_votes_session_id_log_entry_id_pk" PRIMARY KEY("session_id","log_entry_id")
);
--> statement-breakpoint
CREATE TABLE "audience"."session_minutes" (
	"session_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	CONSTRAINT "session_minutes_session_id_minute_pk" PRIMARY KEY("session_id","minute")
);
--> statement-breakpoint
ALTER TABLE "audience"."airing_stats" ADD CONSTRAINT "airing_stats_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience"."airing_stats" ADD CONSTRAINT "airing_stats_as_run_id_as_run_id_fk" FOREIGN KEY ("as_run_id") REFERENCES "broadcast"."as_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience"."airing_stats" ADD CONSTRAINT "airing_stats_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "broadcast"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience"."airing_stats" ADD CONSTRAINT "airing_stats_maker_station_id_stations_id_fk" FOREIGN KEY ("maker_station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience"."not_for_me_votes" ADD CONSTRAINT "not_for_me_votes_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "audience"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience"."not_for_me_votes" ADD CONSTRAINT "not_for_me_votes_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience"."session_minutes" ADD CONSTRAINT "session_minutes_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "audience"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience"."session_minutes" ADD CONSTRAINT "session_minutes_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "airing_stats_key" ON "audience"."airing_stats" USING btree ("airing_key");--> statement-breakpoint
CREATE INDEX "airing_stats_station_time" ON "audience"."airing_stats" USING btree ("station_id","started_at");--> statement-breakpoint
CREATE INDEX "airing_stats_program_time" ON "audience"."airing_stats" USING btree ("program_id","started_at");--> statement-breakpoint
CREATE INDEX "not_for_me_votes_entry" ON "audience"."not_for_me_votes" USING btree ("log_entry_id");--> statement-breakpoint
CREATE INDEX "session_minutes_station_minute" ON "audience"."session_minutes" USING btree ("station_id","minute");