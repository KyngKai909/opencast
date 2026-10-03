-- 2026-10-03: G18, "Keep at this time" (A246, decision 1). A station marks a log entry as a fixed
-- point: moving the rows around it in master control stops there, and a live block ending early
-- doesn't move it up. A day template's entries hold the mark too, and copy it onto each date they
-- make. Nothing else enforces it: moves are explicit, so a move of a kept entry is refused only in
-- the batch that sends it (the service's `kept`).
-- Additive: two columns with defaults, false for every existing row (today's behaviour). Named by
-- hand after 0049 (0038 is reserved, see 0040), so drizzle-kit's numbering isn't relied on.
ALTER TABLE "broadcast"."log_entries" ADD COLUMN "keep_time" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcast"."day_template_entries" ADD COLUMN "keep_time" boolean DEFAULT false NOT NULL;
