-- 2026-10-06: A249, large and compressed XMLTV guides for external stations (the user's choice).
-- `guide_read` is what the last read of a listing's XMLTV guide found (the channel kept, the
-- guide's channels and size, gzipped or not), with the guide's `ETag` and `Last-Modified` from the
-- last read that worked, sent back on the next so an unchanged guide isn't downloaded again. New
-- `calendar_sync` values (`pick_channel`, `not_in_guide`, `too_big`) are text, as the column's
-- others are: no type changes.
-- Additive: one nullable column, null for every existing row. Named by hand after 0052 (0038 is
-- reserved, see 0040); drizzle-kit agrees with it.
ALTER TABLE "network"."listed_sources" ADD COLUMN "guide_read" jsonb;
