-- 2026-10-02: A243, bumper roles and chained sequences (the user's decision; Build A of
-- design-bumpers-blocks). A bumper's role (`into_break`, `out_of_break`, `up_next`, `any`; null reads
-- as Any, every bumper before it), when an item may air (broadcast dates and a time of day in the
-- market's time zone), the station's bumper sequences on its break rule (null: the defaults, one
-- into the break and one out of it, none between programs, which is today's run sheet), and what
-- the channel's rows and the as-run log record about each bumper (its role, where it aired, and for
-- up next what it announced). Up next's title is drawn by the player over the clip, from the
-- guide's own data (an `org.useopencast.up-next` DATERANGE); nothing here is burned in.
-- No new log codes and no enum values: bumpers stay `BMP`. Additive: nullable columns, checks
-- that every existing row passes, and an index for "least recently aired". `as_run` stays
-- append-only (its trigger doesn't care about ADD COLUMN). No foreign key on the announced entry:
-- the as-run log is append-only, and an entry announced in its last seconds can still come off.
-- Named by hand after 0047 (0038 is reserved, see 0040), so drizzle-kit's numbering isn't relied on.
ALTER TABLE "broadcast"."as_run" ADD COLUMN "bumper_role" text;--> statement-breakpoint
ALTER TABLE "broadcast"."as_run" ADD COLUMN "position" text;--> statement-breakpoint
ALTER TABLE "broadcast"."as_run" ADD COLUMN "announced_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "broadcast"."as_run" ADD COLUMN "announced_title" text;--> statement-breakpoint
ALTER TABLE "broadcast"."assets" ADD COLUMN "bumper_role" text;--> statement-breakpoint
ALTER TABLE "broadcast"."assets" ADD COLUMN "airs_from" date;--> statement-breakpoint
ALTER TABLE "broadcast"."assets" ADD COLUMN "airs_until" date;--> statement-breakpoint
ALTER TABLE "broadcast"."assets" ADD COLUMN "daily_from" time;--> statement-breakpoint
ALTER TABLE "broadcast"."assets" ADD COLUMN "daily_until" time;--> statement-breakpoint
ALTER TABLE "broadcast"."break_rules" ADD COLUMN "bumper_sequences" jsonb;--> statement-breakpoint
ALTER TABLE "broadcast"."channel_items" ADD COLUMN "bumper_role" text;--> statement-breakpoint
ALTER TABLE "broadcast"."channel_items" ADD COLUMN "position" text;--> statement-breakpoint
ALTER TABLE "broadcast"."channel_items" ADD COLUMN "announced_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "broadcast"."channel_items" ADD COLUMN "announced_title" text;--> statement-breakpoint
CREATE INDEX "as_run_station_asset_time" ON "broadcast"."as_run" USING btree ("station_id","asset_id","started_at") WHERE "broadcast"."as_run"."asset_id" is not null;--> statement-breakpoint
ALTER TABLE "broadcast"."as_run" ADD CONSTRAINT "as_run_position" CHECK ("broadcast"."as_run"."position" is null or "broadcast"."as_run"."position" in ('open', 'close', 'between', 'boundary', 'open_time', 'sign_on'));--> statement-breakpoint
ALTER TABLE "broadcast"."assets" ADD CONSTRAINT "assets_bumper_role" CHECK ("broadcast"."assets"."bumper_role" is null or ("broadcast"."assets"."code" = 'BMP' and "broadcast"."assets"."bumper_role" in ('into_break', 'out_of_break', 'up_next', 'any')));--> statement-breakpoint
ALTER TABLE "broadcast"."assets" ADD CONSTRAINT "assets_air_dates" CHECK ("broadcast"."assets"."airs_from" is null or "broadcast"."assets"."airs_until" is null or "broadcast"."assets"."airs_until" >= "broadcast"."assets"."airs_from");--> statement-breakpoint
ALTER TABLE "broadcast"."assets" ADD CONSTRAINT "assets_daily_window" CHECK (("broadcast"."assets"."daily_from" is null) = ("broadcast"."assets"."daily_until" is null) and ("broadcast"."assets"."daily_from" is null or "broadcast"."assets"."daily_from" <> "broadcast"."assets"."daily_until"));