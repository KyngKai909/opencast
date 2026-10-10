-- 2026-10-10: the dial in other apps (programming Phase 5). Viewers in other apps (TiviMate,
-- Jellyfin, Channels DVR, Kodi, VLC) send no heartbeats: a session is a run of playlist polls
-- carrying `via=iptv`, placed by market from the connection. The address is never kept, only a
-- day-salted hash, cleared after a day. Counted apart as "Other apps", never in the minute samples
-- per-thousand billing reads. Additive: a new table.
CREATE TABLE "audience"."other_app_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"market_id" uuid,
	"client_key" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_poll_at" timestamp with time zone DEFAULT now() NOT NULL,
	"polls" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audience"."other_app_sessions" ADD CONSTRAINT "other_app_sessions_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience"."other_app_sessions" ADD CONSTRAINT "other_app_sessions_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "network"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "other_app_sessions_client" ON "audience"."other_app_sessions" USING btree ("client_key","last_poll_at");--> statement-breakpoint
CREATE INDEX "other_app_sessions_station" ON "audience"."other_app_sessions" USING btree ("station_id","last_poll_at");