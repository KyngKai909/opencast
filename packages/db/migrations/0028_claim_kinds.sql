-- 2026-09-29: Network desk, Rights claims (follow-up Phase 0, item 11; desk-pages 01). A claim's kind:
-- copyright, or a privacy complaint (someone shown without consent), which comes off air the same way
-- but has no answer window, is reviewed by Opencast and never counts toward the repeat limit.
-- Additive: one type and one column with a default, so every claim from before is copyright.
CREATE TYPE "trust"."claim_kind" AS ENUM('copyright', 'privacy');--> statement-breakpoint
ALTER TABLE "trust"."claims" ADD COLUMN "kind" "trust"."claim_kind" DEFAULT 'copyright' NOT NULL;
