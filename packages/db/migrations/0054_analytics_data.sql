-- 2026-10-06: A251, data for the Network desk's analytics (the user's request), collected ahead of
-- the pages so history builds up. On `audience.sessions`: `visit_id` (the tab's or TV app run's id,
-- shared by the sessions of one visit: channel changes), `device_hash` (a hash of the player's
-- device id, for counts of devices; deleted with the session after 30 days), `via` (how it was
-- tuned) and `tune_ms` (press to first picture). `audience.searches`: searches viewers settled on,
-- with no account, device or session, kept 90 days.
-- Additive: one new table, four nullable columns (null for every existing row), three indexes.
CREATE TABLE "audience"."searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term" text NOT NULL,
	"results" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audience"."sessions" ADD COLUMN "visit_id" uuid;--> statement-breakpoint
ALTER TABLE "audience"."sessions" ADD COLUMN "device_hash" text;--> statement-breakpoint
ALTER TABLE "audience"."sessions" ADD COLUMN "via" text;--> statement-breakpoint
ALTER TABLE "audience"."sessions" ADD COLUMN "tune_ms" integer;--> statement-breakpoint
CREATE INDEX "searches_at" ON "audience"."searches" USING btree ("at");--> statement-breakpoint
CREATE INDEX "sessions_visit" ON "audience"."sessions" USING btree ("visit_id","started_at");--> statement-breakpoint
CREATE INDEX "sessions_device" ON "audience"."sessions" USING btree ("device_hash","started_at");