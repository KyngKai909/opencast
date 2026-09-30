-- 2026-09-30: The old translators' stream keys move out of plain text (follow-up Phase 3, the relay
-- half). Each translator becomes a manual platform connection, its key sealed with
-- PLATFORM_SECRETS_KEY by the platforms module (in code: SQL can't seal; `stations.moveTranslatorKeys`,
-- run by the jobs tick), linked here by `platform_id`, and its plain `stream_key` nulled once the
-- sealed copy is checked. The column stays. Additive: one column, one NOT NULL dropped.
ALTER TABLE "broadcast"."translators" ALTER COLUMN "stream_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcast"."translators" ADD COLUMN "platform_id" uuid;