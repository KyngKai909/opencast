-- 2026-10-07: the desk's station file can act (the user's request). An admin can take a station off
-- the air (`held_at`, `held_reason`, `held_by`: it can't sign on again until the desk lifts it) and
-- archive one of its uploads (`archived_by`, `archived_reason`: pulled from every log ahead, its files
-- kept). Additive: five nullable columns.
ALTER TABLE "broadcast"."assets" ADD COLUMN "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "broadcast"."assets" ADD COLUMN "archived_reason" text;--> statement-breakpoint
ALTER TABLE "broadcast"."stations" ADD COLUMN "held_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "broadcast"."stations" ADD COLUMN "held_reason" text;--> statement-breakpoint
ALTER TABLE "broadcast"."stations" ADD COLUMN "held_by" uuid;--> statement-breakpoint
ALTER TABLE "broadcast"."assets" ADD CONSTRAINT "assets_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."stations" ADD CONSTRAINT "stations_held_by_users_id_fk" FOREIGN KEY ("held_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;