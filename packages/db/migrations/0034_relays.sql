-- 2026-09-30: Built-in multistreaming, the relay half (follow-up Phase 3). One setting for all of a
-- station's relays (broadcast.station_relays: "Live shows only" or "Everything I air", what breaks
-- show, the station bug, saving YouTube videos, and its Livepeer relay stream); each platform's
-- Livepeer multistream target (broadcast.relay_targets); restarts for platform limits, planned for a
-- break and logged (broadcast.relay_restarts). translator_sessions records what each session relayed
-- (`relay_mode`) and to how many platforms, for billing. Additive: three tables, two columns.
-- Platform connections and keys are the platforms module's (migration 0035).
CREATE TABLE "broadcast"."relay_restarts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"platform_id" text NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"during_break" boolean DEFAULT false NOT NULL,
	"break_id" uuid,
	"automatic" boolean DEFAULT true NOT NULL,
	"method" text NOT NULL,
	"done_at" timestamp with time zone,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast"."relay_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"platform_id" text NOT NULL,
	"kind" text NOT NULL,
	"stream" text NOT NULL,
	"livepeer_stream_id" text,
	"livepeer_target_id" text,
	"url_hash" text,
	"disabled" boolean DEFAULT true NOT NULL,
	"broadcast_started_at" timestamp with time zone,
	"broadcast_id" text,
	"paid_promotion_marked_at" timestamp with time zone,
	"paid_promotion_reminder_at" timestamp with time zone,
	"paid_promotion_dismissed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast"."station_relays" (
	"station_id" uuid PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'live_only' NOT NULL,
	"break_handling" text DEFAULT 'air_spots' NOT NULL,
	"bug_on_relays" boolean DEFAULT true NOT NULL,
	"save_youtube_videos" boolean DEFAULT false NOT NULL,
	"livepeer_stream_id" text,
	"livepeer_stream_key" text,
	"livepeer_playback_id" text,
	"status" text DEFAULT 'off' NOT NULL,
	"last_error" text,
	"stopped_at" timestamp with time zone,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broadcast"."translator_sessions" ADD COLUMN "relay_mode" text;--> statement-breakpoint
ALTER TABLE "broadcast"."translator_sessions" ADD COLUMN "platforms" integer;--> statement-breakpoint
ALTER TABLE "broadcast"."relay_restarts" ADD CONSTRAINT "relay_restarts_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."relay_targets" ADD CONSTRAINT "relay_targets_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."station_relays" ADD CONSTRAINT "station_relays_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."station_relays" ADD CONSTRAINT "station_relays_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "relay_restarts_station_at" ON "broadcast"."relay_restarts" USING btree ("station_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "relay_targets_station_platform_stream" ON "broadcast"."relay_targets" USING btree ("station_id","platform_id","stream");--> statement-breakpoint
-- Platform limits for restarts (Open): YouTube rolls about every 11 hours when a station saves its
-- relays as videos, Facebook and YouTube restarts need a signed-in account, Kick has no known limit,
-- and restarts aim for the last break in the 2 hours before a limit, 15 minutes to spare.
INSERT INTO "network"."rules" ("key", "value", "effective_from", "note") VALUES
  ('relays.platform_limits', '{"platforms":[{"platform":"twitch","maxHours":48,"savesUnderHours":null,"rollEveryHours":null,"restartNeedsSignIn":false},{"platform":"youtube","maxHours":null,"savesUnderHours":12,"rollEveryHours":11,"restartNeedsSignIn":true},{"platform":"facebook","maxHours":8,"savesUnderHours":null,"rollEveryHours":null,"restartNeedsSignIn":true},{"platform":"kick","maxHours":null,"savesUnderHours":null,"rollEveryHours":null,"restartNeedsSignIn":false}],"restart":{"windowHours":2,"marginMinutes":15}}', '2026-09-30T00:00:00Z', 'Phase 3 restarts: when YouTube rolls, which restarts need sign-in, Kick. Platforms change these; add limits as they''re found');
--> statement-breakpoint
INSERT INTO "network"."change_log" ("at", "kind", "subject", "summary", "after", "effective_from", "note")
SELECT r.created_at, 'rule', r.key, 'Restarts for platform limits (follow-up Phase 3)', r.value, r.effective_from, r.note
FROM "network"."rules" r
WHERE r.key = 'relays.platform_limits' AND r.effective_from = '2026-09-30T00:00:00Z';
