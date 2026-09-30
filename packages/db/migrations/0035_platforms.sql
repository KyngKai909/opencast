-- 2026-09-30: Built-in multistreaming, the platforms half (follow-up Phase 3). Platform connections
-- for relays (broadcast.platform_connections: YouTube and Twitch signed in, anything else by address
-- and key; keys and tokens only sealed, AES-256-GCM, erased on removal), sign-ins on their way, what
-- happened to each (events), the viewers connected platforms report each minute, and YouTube's viewer
-- geography per broadcast and day. Relay viewers billed for per-thousand spots: each airing's relay
-- part per platform (spots.relay_charges) and the relay estimate in its hold (airings.
-- relay_estimate_micros). Opencast viewers placed by market for local businesses (audience.sessions.
-- market_id, audience.minute_markets). Additive: eight tables, one enum, two columns.
CREATE TYPE "broadcast"."platform_kind" AS ENUM('youtube', 'twitch', 'facebook', 'kick', 'custom');--> statement-breakpoint
CREATE TABLE "spots"."relay_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"airing_id" uuid NOT NULL,
	"platform_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"audience" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"fraction" real NOT NULL,
	"cap_micros" bigint,
	"status" text DEFAULT 'counting' NOT NULL,
	"reason" text,
	"viewers" real,
	"broadcast_ref" text,
	"share_in_area" real,
	"billed_viewers" real,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"held_micros" bigint DEFAULT 0 NOT NULL,
	"returned_micros" bigint DEFAULT 0 NOT NULL,
	"working" text,
	"due_by" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relay_charges_fraction" CHECK ("spots"."relay_charges"."fraction" >= 0 and "spots"."relay_charges"."fraction" <= 1),
	CONSTRAINT "relay_charges_cost" CHECK ("spots"."relay_charges"."cost_micros" >= 0 and "spots"."relay_charges"."held_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "audience"."minute_markets" (
	"station_id" uuid NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"market_id" uuid NOT NULL,
	"tuned_in" integer NOT NULL,
	CONSTRAINT "minute_markets_station_id_minute_market_id_pk" PRIMARY KEY("station_id","minute","market_id")
);
--> statement-breakpoint
CREATE TABLE "broadcast"."platform_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"station_id" uuid NOT NULL,
	"kind" "broadcast"."platform_kind" NOT NULL,
	"method" text NOT NULL,
	"name" text NOT NULL,
	"account_name" text,
	"external_account_id" text,
	"rtmp_url" text NOT NULL,
	"stream_key_enc" text,
	"access_token_enc" text,
	"refresh_token_enc" text,
	"token_expires_at" timestamp with time zone,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"live_stream_id" text,
	"current_broadcast_id" text,
	"next_broadcast_id" text,
	"broadcast_title" text,
	"broadcast_description" text,
	"paid_promotion" boolean DEFAULT false NOT NULL,
	"connected_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "platform_connections_secrets_gone" CHECK ("broadcast"."platform_connections"."removed_at" is null or ("broadcast"."platform_connections"."stream_key_enc" is null and "broadcast"."platform_connections"."access_token_enc" is null and "broadcast"."platform_connections"."refresh_token_enc" is null))
);
--> statement-breakpoint
CREATE TABLE "broadcast"."platform_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"detail" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast"."platform_geography" (
	"platform_id" uuid NOT NULL,
	"broadcast_ref" text NOT NULL,
	"day" date NOT NULL,
	"status" text NOT NULL,
	"places" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"placed_share" real DEFAULT 0 NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_geography_platform_id_broadcast_ref_day_pk" PRIMARY KEY("platform_id","broadcast_ref","day")
);
--> statement-breakpoint
CREATE TABLE "broadcast"."platform_geography_checks" (
	"platform_id" uuid NOT NULL,
	"broadcast_ref" text NOT NULL,
	"day" date NOT NULL,
	"wanted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "platform_geography_checks_platform_id_broadcast_ref_day_pk" PRIMARY KEY("platform_id","broadcast_ref","day")
);
--> statement-breakpoint
CREATE TABLE "broadcast"."platform_sign_ins" (
	"state" text PRIMARY KEY NOT NULL,
	"station_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"user_id" uuid NOT NULL,
	"verifier_enc" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"return_to" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "broadcast"."platform_viewer_samples" (
	"platform_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"kind" "broadcast"."platform_kind" NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"viewers" integer NOT NULL,
	"broadcast_ref" text,
	CONSTRAINT "platform_viewer_samples_platform_id_minute_pk" PRIMARY KEY("platform_id","minute"),
	CONSTRAINT "platform_viewer_samples_viewers" CHECK ("broadcast"."platform_viewer_samples"."viewers" >= 0)
);
--> statement-breakpoint
ALTER TABLE "spots"."airings" ADD COLUMN "relay_estimate_micros" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "audience"."sessions" ADD COLUMN "market_id" uuid;--> statement-breakpoint
ALTER TABLE "spots"."relay_charges" ADD CONSTRAINT "relay_charges_airing_id_airings_id_fk" FOREIGN KEY ("airing_id") REFERENCES "spots"."airings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."relay_charges" ADD CONSTRAINT "relay_charges_platform_id_platform_connections_id_fk" FOREIGN KEY ("platform_id") REFERENCES "broadcast"."platform_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience"."minute_markets" ADD CONSTRAINT "minute_markets_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience"."minute_markets" ADD CONSTRAINT "minute_markets_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "network"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."platform_connections" ADD CONSTRAINT "platform_connections_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."platform_connections" ADD CONSTRAINT "platform_connections_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."platform_events" ADD CONSTRAINT "platform_events_platform_id_platform_connections_id_fk" FOREIGN KEY ("platform_id") REFERENCES "broadcast"."platform_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."platform_events" ADD CONSTRAINT "platform_events_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."platform_geography" ADD CONSTRAINT "platform_geography_platform_id_platform_connections_id_fk" FOREIGN KEY ("platform_id") REFERENCES "broadcast"."platform_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."platform_geography_checks" ADD CONSTRAINT "platform_geography_checks_platform_id_platform_connections_id_fk" FOREIGN KEY ("platform_id") REFERENCES "broadcast"."platform_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."platform_sign_ins" ADD CONSTRAINT "platform_sign_ins_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."platform_sign_ins" ADD CONSTRAINT "platform_sign_ins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."platform_viewer_samples" ADD CONSTRAINT "platform_viewer_samples_platform_id_platform_connections_id_fk" FOREIGN KEY ("platform_id") REFERENCES "broadcast"."platform_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."platform_viewer_samples" ADD CONSTRAINT "platform_viewer_samples_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "relay_charges_airing_platform" ON "spots"."relay_charges" USING btree ("airing_id","platform_id");--> statement-breakpoint
CREATE INDEX "relay_charges_open" ON "spots"."relay_charges" USING btree ("status","due_by");--> statement-breakpoint
CREATE INDEX "platform_connections_station" ON "broadcast"."platform_connections" USING btree ("station_id");--> statement-breakpoint
CREATE INDEX "platform_events_platform" ON "broadcast"."platform_events" USING btree ("platform_id","at");--> statement-breakpoint
CREATE INDEX "platform_viewer_samples_station" ON "broadcast"."platform_viewer_samples" USING btree ("station_id","minute");--> statement-breakpoint
ALTER TABLE "audience"."sessions" ADD CONSTRAINT "sessions_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "network"."markets"("id") ON DELETE no action ON UPDATE no action;