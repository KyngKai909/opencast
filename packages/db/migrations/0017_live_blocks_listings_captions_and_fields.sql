CREATE TABLE "broadcast"."caption_tracks" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"language" text NOT NULL,
	"vtt" text NOT NULL,
	"source" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "caption_track_size" CHECK (octet_length("broadcast"."caption_tracks"."vtt") <= 1048576)
);
--> statement-breakpoint
CREATE TABLE "broadcast"."lower_thirds" (
	"log_entry_id" uuid PRIMARY KEY NOT NULL,
	"station_id" uuid NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"speaker_id" uuid,
	"name" text NOT NULL,
	"title" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trust"."claim_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"content_id" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts"."invites" ADD COLUMN "program_ids" jsonb;--> statement-breakpoint
ALTER TABLE "broadcast"."assets" ADD COLUMN "audio_channels" smallint;--> statement-breakpoint
ALTER TABLE "broadcast"."log_entries" ADD COLUMN "ended_early_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "broadcast"."programs" ADD COLUMN "captions_mode" text;--> statement-breakpoint
ALTER TABLE "broadcast"."programs" ADD COLUMN "captions_language" text;--> statement-breakpoint
ALTER TABLE "catalog"."offers" ADD COLUMN "cpb_price_micros" bigint;--> statement-breakpoint
ALTER TABLE "catalog"."offers" ADD COLUMN "cpb_price_unit" text;--> statement-breakpoint
ALTER TABLE "catalog"."offers" ADD COLUMN "cpb_maker_ms_per_hour" bigint;--> statement-breakpoint
ALTER TABLE "catalog"."offers" ADD COLUMN "barter_fill" text DEFAULT 'spots' NOT NULL;--> statement-breakpoint
ALTER TABLE "spots"."advertisers" ADD COLUMN "short_name" text;--> statement-breakpoint
ALTER TABLE "spots"."production_orders" ADD COLUMN "maker_asked_listed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spots"."spots" ADD COLUMN "last_pause_reason" text;--> statement-breakpoint
ALTER TABLE "spots"."spots" ADD COLUMN "last_paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spots"."spots" ADD COLUMN "resumed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spots"."spots" ADD COLUMN "resume_reason" text;--> statement-breakpoint
ALTER TABLE "broadcast"."caption_tracks" ADD CONSTRAINT "caption_tracks_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "broadcast"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."caption_tracks" ADD CONSTRAINT "caption_tracks_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."lower_thirds" ADD CONSTRAINT "lower_thirds_log_entry_id_log_entries_id_fk" FOREIGN KEY ("log_entry_id") REFERENCES "broadcast"."log_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."lower_thirds" ADD CONSTRAINT "lower_thirds_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."lower_thirds" ADD CONSTRAINT "lower_thirds_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust"."claim_attachments" ADD CONSTRAINT "claim_attachments_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "trust"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust"."claim_attachments" ADD CONSTRAINT "claim_attachments_content_id_contents_cid_fk" FOREIGN KEY ("content_id") REFERENCES "broadcast"."contents"("cid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust"."claim_attachments" ADD CONSTRAINT "claim_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;