-- 2026-10-06: A251 Phase 2, the Network desk's analytics totals (the user's request). Worked out
-- from `session_minutes` and `sessions` every ten minutes and kept for good, naming no session,
-- device or person: `station_hours` (tuned-in minutes, busiest minute, by platform, sessions),
-- `station_hour_places` (by where viewers are), `network_hours` (per band and market, with the
-- network's busiest minute), `station_days` (sessions and their lengths, bots by reason, how they
-- were tuned, press to picture), `device_days` (devices counted once, day, 7 and 30 days,
-- returning), `station_flows` (changes between stations). Every station, external ones included.
-- Additive: six new tables.
CREATE TABLE "audience"."device_days" (
	"day" date NOT NULL,
	"scope" text NOT NULL,
	"devices" integer NOT NULL,
	"devices_7" integer NOT NULL,
	"devices_30" integer NOT NULL,
	"returning" integer NOT NULL,
	CONSTRAINT "device_days_day_scope_pk" PRIMARY KEY("day","scope")
);
--> statement-breakpoint
CREATE TABLE "audience"."network_hours" (
	"scope" text NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"tuned_minutes" integer NOT NULL,
	"peak" integer NOT NULL,
	"peak_at" timestamp with time zone,
	CONSTRAINT "network_hours_scope_hour_pk" PRIMARY KEY("scope","hour")
);
--> statement-breakpoint
CREATE TABLE "audience"."station_days" (
	"day" date NOT NULL,
	"station_id" uuid NOT NULL,
	"sessions" integer NOT NULL,
	"lengths" jsonb NOT NULL,
	"median_minutes" integer,
	"bots" integer DEFAULT 0 NOT NULL,
	"bot_reasons" jsonb NOT NULL,
	"via" jsonb NOT NULL,
	"tune_ms_median" integer,
	"tune_ms_p90" integer,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "station_days_day_station_id_pk" PRIMARY KEY("day","station_id")
);
--> statement-breakpoint
CREATE TABLE "audience"."station_flows" (
	"day" date NOT NULL,
	"from_station" text NOT NULL,
	"to_station" text NOT NULL,
	"changes" integer NOT NULL,
	CONSTRAINT "station_flows_day_from_station_to_station_pk" PRIMARY KEY("day","from_station","to_station")
);
--> statement-breakpoint
CREATE TABLE "audience"."station_hour_places" (
	"station_id" uuid NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"market" text NOT NULL,
	"tuned_minutes" integer NOT NULL,
	CONSTRAINT "station_hour_places_station_id_hour_market_pk" PRIMARY KEY("station_id","hour","market")
);
--> statement-breakpoint
CREATE TABLE "audience"."station_hours" (
	"station_id" uuid NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"tuned_minutes" integer NOT NULL,
	"peak" integer NOT NULL,
	"phone" integer DEFAULT 0 NOT NULL,
	"cast" integer DEFAULT 0 NOT NULL,
	"web" integer DEFAULT 0 NOT NULL,
	"tv_app" integer DEFAULT 0 NOT NULL,
	"mirror" integer DEFAULT 0 NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "station_hours_station_id_hour_pk" PRIMARY KEY("station_id","hour")
);
--> statement-breakpoint
ALTER TABLE "audience"."station_days" ADD CONSTRAINT "station_days_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience"."station_hour_places" ADD CONSTRAINT "station_hour_places_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience"."station_hours" ADD CONSTRAINT "station_hours_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "station_hours_hour" ON "audience"."station_hours" USING btree ("hour");