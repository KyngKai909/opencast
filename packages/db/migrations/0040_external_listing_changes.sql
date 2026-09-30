-- 2026-09-30: A215, changing an external station's listing and taking it off for good (follow-up
-- Phase 6). Every change is kept (`listed_source_changes`: who, when, each field from → to, what it
-- did); a listing taken off the dial is archived, never deleted (`removed_at`, `removed_by`, where it
-- was on the dial; its channel is held 90 days like a full station's that signs off for good, then
-- freed: `channel_released_at`); a written permission names the listing it was recorded for, and is
-- kept when the address changes; an outage can end because the address changed or the listing was
-- taken off (`external_outages.ended`). An external station's call sign can be changed (the same
-- rules as listing): `broadcast.stations_guard` keeps a full station's fixed after first sign-on.
-- Numbered 0040: 0038 is reserved for the live blocks to R2 work on the same branch.
CREATE TABLE "network"."listed_source_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" serial NOT NULL,
	"listed_source_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"by" uuid,
	"action" text NOT NULL,
	"fields" jsonb NOT NULL,
	"effects" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "network"."external_outages" ADD COLUMN "ended" text;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "lead_stage_before" "network"."creator_stage";--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "removed_by" uuid;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "removed_market_id" uuid;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "removed_band" "broadcast"."band";--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "removed_tenths" integer;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "channel_released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "network"."stream_permissions" ADD COLUMN "listed_source_id" uuid;--> statement-breakpoint
ALTER TABLE "network"."listed_source_changes" ADD CONSTRAINT "listed_source_changes_listed_source_id_listed_sources_id_fk" FOREIGN KEY ("listed_source_id") REFERENCES "network"."listed_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."listed_source_changes" ADD CONSTRAINT "listed_source_changes_by_users_id_fk" FOREIGN KEY ("by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listed_source_changes_source" ON "network"."listed_source_changes" USING btree ("listed_source_id","at");--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD CONSTRAINT "listed_sources_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD CONSTRAINT "listed_sources_removed_market_id_markets_id_fk" FOREIGN KEY ("removed_market_id") REFERENCES "network"."markets"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Permissions recorded before: the listing that names them.
UPDATE "network"."stream_permissions" p SET "listed_source_id" = l."id" FROM "network"."listed_sources" l WHERE l."stream_permission_id" = p."id";--> statement-breakpoint
-- A call sign is fixed after first sign-on, except an external station's (A215): it has no playout,
-- log or bug to carry it, and a change keeps the old one held for it (the API's waitlist hold).
CREATE OR REPLACE FUNCTION broadcast.stations_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.first_signed_on_at IS NOT NULL THEN
    IF NEW.call_sign IS DISTINCT FROM OLD.call_sign AND NOT (OLD.kind = 'listed' AND NEW.kind = 'listed' AND NEW.call_sign IS NOT NULL) THEN
      RAISE EXCEPTION 'call sign % is fixed after first sign-on', OLD.call_sign USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.first_signed_on_at IS DISTINCT FROM OLD.first_signed_on_at THEN
      RAISE EXCEPTION 'first sign-on time can''t change' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.call_sign IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.call_sign IS DISTINCT FROM OLD.call_sign)
     AND EXISTS (
       SELECT 1 FROM network.call_sign_reservations r
       WHERE r.call_sign = NEW.call_sign AND r.released_at IS NULL
         AND r.station_id IS DISTINCT FROM NEW.id
     ) THEN
    RAISE EXCEPTION 'call sign % is held for someone else', NEW.call_sign USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;
