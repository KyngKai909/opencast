-- 2026-09-29: how often the station ID, bumpers and the thank-you credit air in breaks. Null: every break (as before).
ALTER TABLE "broadcast"."break_rules" ADD COLUMN "cadence" jsonb;