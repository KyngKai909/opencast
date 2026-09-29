CREATE TABLE "broadcast"."channel_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"run" integer NOT NULL,
	"seq" bigint NOT NULL,
	"disc" integer NOT NULL,
	"discontinuity" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"prepared_key" text,
	"first_segment" integer DEFAULT 0 NOT NULL,
	"segments" integer DEFAULT 0 NOT NULL,
	"segment_ms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"live_uris" jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"reason" text NOT NULL,
	"plan_key" text,
	"in_break" boolean DEFAULT false NOT NULL,
	"log_entry_id" uuid,
	"break_id" uuid,
	"asset_id" uuid,
	"program_id" uuid,
	"airing_id" uuid,
	"agreement_id" uuid,
	"live_source_id" uuid,
	"open" boolean DEFAULT false NOT NULL,
	"as_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast"."prepared_items" (
	"key" text PRIMARY KEY NOT NULL,
	"content_id" text,
	"kind" text DEFAULT 'file' NOT NULL,
	"source_location" text,
	"media_kind" text DEFAULT 'video' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"renditions" text[] DEFAULT '{}'::text[] NOT NULL,
	"duration_ms" bigint,
	"needed_at" timestamp with time zone,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"error" text,
	"prep_ms" integer,
	"bytes" bigint,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"prepared_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "broadcast"."prepared_renditions" (
	"key" text NOT NULL,
	"rendition" text NOT NULL,
	"segments" integer NOT NULL,
	"segment_ms" jsonb NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"prepared_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prepared_renditions_key_rendition_pk" PRIMARY KEY("key","rendition")
);
--> statement-breakpoint
CREATE TABLE "broadcast"."translator_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"translator_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"swaps_breaks" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"bytes_sent" bigint DEFAULT 0 NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broadcast"."channel_items" ADD CONSTRAINT "channel_items_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."prepared_renditions" ADD CONSTRAINT "prepared_renditions_key_prepared_items_key_fk" FOREIGN KEY ("key") REFERENCES "broadcast"."prepared_items"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."translator_sessions" ADD CONSTRAINT "translator_sessions_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_items_station_seq" ON "broadcast"."channel_items" USING btree ("station_id","seq");--> statement-breakpoint
CREATE INDEX "channel_items_station_ends" ON "broadcast"."channel_items" USING btree ("station_id","ends_at");--> statement-breakpoint
CREATE INDEX "prepared_items_queue" ON "broadcast"."prepared_items" USING btree ("status","needed_at");--> statement-breakpoint
CREATE INDEX "prepared_items_content" ON "broadcast"."prepared_items" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "translator_sessions_translator" ON "broadcast"."translator_sessions" USING btree ("translator_id","started_at");