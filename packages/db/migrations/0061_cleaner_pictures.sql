-- 2026-10-09: cleaner pictures from prepare (programming prompt, Phase 1). Each prepared item
-- records the picture pipeline its renditions were made with (`pipeline`: 1 for everything made
-- before this, 2 since, which tonemaps HDR and deinterlaces) and what the probe found in the file
-- (`picture`: colour, field order, rotation, HDR, interlaced). Additive: one column with a default,
-- one nullable.
ALTER TABLE "broadcast"."prepared_items" ADD COLUMN "pipeline" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcast"."prepared_items" ADD COLUMN "picture" jsonb;