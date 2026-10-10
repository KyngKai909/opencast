-- 2026-10-09: seasons and multi-part episodes (programming Phase 2). A library item gets its season
-- beside its episode number, and a multi-part grouping: what its parts share (`part_of`) and its
-- part number. Uploads guess them from the file's name and title; the station corrects them on the
-- item's page. Additive: three nullable columns, nothing filled in for items already uploaded.
ALTER TABLE "broadcast"."assets" ADD COLUMN "season_number" integer;--> statement-breakpoint
ALTER TABLE "broadcast"."assets" ADD COLUMN "part_of" text;--> statement-breakpoint
ALTER TABLE "broadcast"."assets" ADD COLUMN "part_number" integer;