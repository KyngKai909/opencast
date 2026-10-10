-- 2026-10-07: A251 Phase 4, the desk's Audience tab. `station_days` gains `minutes_total` (every
-- counted session's minutes, for the average length) and `version` (2: the reference's length bands,
-- 1–2 min, 2–5, 5–15, 15–30, 30–60, 1–2 h, 2 h+; days worked out as version 1 are worked out again
-- while their sessions are kept). `device_days` gains `visits` and `visit_sessions` (a tab's or TV
-- app run's sessions that day, for stations per visit): counts, no ids.
-- Additive: four columns with defaults.
ALTER TABLE "audience"."device_days" ADD COLUMN "visits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "audience"."device_days" ADD COLUMN "visit_sessions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "audience"."station_days" ADD COLUMN "minutes_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "audience"."station_days" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;