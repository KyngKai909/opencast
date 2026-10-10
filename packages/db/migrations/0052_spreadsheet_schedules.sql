-- 2026-10-06: A248, an external station's schedule from a spreadsheet (the user's request). A
-- schedule link can be a spreadsheet (`schedule_format` `sheet`: a Google Sheet, or a .csv, .tsv,
-- .xlsx or .ods file), and a spreadsheet can be uploaded (`schedule_source` `file`), kept as what
-- was read from it (`sheet_file`; the file itself isn't kept). `sheet_read` is what the last read
-- found (layout, tab, days, the zone used, cells skipped); `schedule_time_zone` is the listing's own
-- time zone for times given without one. A Google Sheet that isn't public is `calendar_sync`
-- `not_public`. The new values are text, as the columns' others are: no type changes.
-- Additive: three nullable columns, null for every existing row. Named by hand after 0051 (0038 is
-- reserved, see 0040); drizzle-kit agrees with it.
ALTER TABLE "network"."listed_sources" ADD COLUMN "schedule_time_zone" text;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "sheet_read" jsonb;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "sheet_file" jsonb;
