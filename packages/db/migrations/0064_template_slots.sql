-- 2026-10-10: template slots that air the next episode (programming Phase 3). A day template's
-- entry gets a lasting slot id (its rows are written again on each save; the editor sends the id
-- back), what airs from it (this episode, the next episode, fill the slot, same as an earlier
-- slot), the programs it walks, their order and what happens at the end. A log entry names the slot
-- that made it, so a slot's walk is counted from the log and the as-run log, never stored. A
-- template's date records what its walk was made from, and its warnings. Additive: existing entries
-- air this episode, as before.
ALTER TABLE "broadcast"."day_template_dates" ADD COLUMN "walk" text;--> statement-breakpoint
ALTER TABLE "broadcast"."day_template_dates" ADD COLUMN "notes" jsonb;--> statement-breakpoint
ALTER TABLE "broadcast"."day_template_entries" ADD COLUMN "slot_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcast"."day_template_entries" ADD COLUMN "what_airs" text DEFAULT 'this_episode' NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcast"."day_template_entries" ADD COLUMN "program_ids" uuid[];--> statement-breakpoint
ALTER TABLE "broadcast"."day_template_entries" ADD COLUMN "playback_order" text;--> statement-breakpoint
ALTER TABLE "broadcast"."day_template_entries" ADD COLUMN "at_end" text;--> statement-breakpoint
ALTER TABLE "broadcast"."day_template_entries" ADD COLUMN "same_as_slot_id" uuid;--> statement-breakpoint
ALTER TABLE "broadcast"."log_entries" ADD COLUMN "template_slot_id" uuid;--> statement-breakpoint
CREATE INDEX "log_entries_template_slot" ON "broadcast"."log_entries" USING btree ("template_slot_id","starts_at");