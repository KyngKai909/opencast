-- 2026-09-30: External stations (follow-up Phase 6). A listing plays one of two ways, recorded with
-- its evidence: the source's official embed (terms page and the day it was checked) or its stream link
-- (a written permission in `stream_permissions`, never edited, or a clearly public source's basis).
-- Its "what's on" comes from its feed or checked guide data, or neither. Its stream is checked every
-- minute (`health`); 5 minutes down takes it off the dial until it's back (`external_outages`, the
-- desk's history). IPTV-list channels are creator leads (`creators.lead_source`), never listings.
-- Numbered 0039: 0038 is reserved for the live blocks to R2 work on the same branch.
CREATE TABLE "network"."external_outages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listed_source_id" uuid NOT NULL,
	"down_since" timestamp with time zone NOT NULL,
	"hidden_at" timestamp with time zone,
	"back_at" timestamp with time zone,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network"."stream_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"granted_by" text NOT NULL,
	"granted_on" date NOT NULL,
	"evidence" text NOT NULL,
	"document_url" text,
	"stream_url" text NOT NULL,
	"creator_id" uuid,
	"recorded_by" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "network"."creators" ADD COLUMN "lead_source" text;--> statement-breakpoint
ALTER TABLE "network"."creators" ADD COLUMN "stream_url" text;--> statement-breakpoint
ALTER TABLE "network"."creators" ADD COLUMN "lead_list_url" text;--> statement-breakpoint
ALTER TABLE "network"."creators" ADD COLUMN "lead_details" jsonb;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "plays" text DEFAULT 'embed' NOT NULL;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "stream_format" text;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "basis" text;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "terms_url" text;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "terms_checked_on" date;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "public_basis" text;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "stream_permission_id" uuid;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "waiting_note" text;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "outside_market" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "schedule_source" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "schedule_format" text;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "guide_checked_against" text;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "guide_checked_on" date;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "health" text DEFAULT 'unchecked' NOT NULL;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "health_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "last_check_detail" text;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "creator_id" uuid;--> statement-breakpoint
ALTER TABLE "network"."external_outages" ADD CONSTRAINT "external_outages_listed_source_id_listed_sources_id_fk" FOREIGN KEY ("listed_source_id") REFERENCES "network"."listed_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."stream_permissions" ADD CONSTRAINT "stream_permissions_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "network"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."stream_permissions" ADD CONSTRAINT "stream_permissions_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_outages_source" ON "network"."external_outages" USING btree ("listed_source_id","down_since");--> statement-breakpoint
CREATE UNIQUE INDEX "external_outages_open" ON "network"."external_outages" USING btree ("listed_source_id") WHERE "network"."external_outages"."back_at" is null;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD CONSTRAINT "listed_sources_stream_permission_id_stream_permissions_id_fk" FOREIGN KEY ("stream_permission_id") REFERENCES "network"."stream_permissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD CONSTRAINT "listed_sources_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "network"."creators"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Listings from before: "Allow embedding" was the evidence then, and a calendar was their feed.
UPDATE "network"."listed_sources" SET "basis" = 'embed_terms' WHERE "embed_terms" = 'allowed';--> statement-breakpoint
UPDATE "network"."listed_sources" SET "schedule_source" = 'feed', "schedule_format" = 'ical' WHERE "calendar_url" IS NOT NULL;
