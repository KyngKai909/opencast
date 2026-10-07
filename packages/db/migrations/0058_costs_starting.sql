-- 2026-10-07: the Costs rules' first set versions (A251 Phase 6 added them as "Not set yet"), from
-- docs/pricing.md and docs/phase-5-demo.md (supplier prices checked 29 September 2026), so the desk's
-- "Cost to run, estimated" has numbers. What Opencast pays its own suppliers, every number for review:
-- storage is R2's GB-month alone (pricing.md's $0.018 spreads preparing over storage; here preparing
-- is its own line); preparing is a minute of the worker's wall clock (2.0 vCPU-hours per media hour
-- in about 1,046 s, plus memory and R2's segment writes); relays assume Livepeer doesn't charge the
-- split; the platform is an estimate of the fixed bill (Railway's Pro plan with its included usage,
-- and the Cloudflare Worker's paid plan), to be replaced with the real bill.
INSERT INTO "network"."rules" ("key", "value", "effective_from", "note") VALUES
  ('costs.storage', '{"costPerGbMonthMicros":15000}', '2026-10-01T00:00:00Z', 'Starting costs (docs/pricing.md): R2 $0.015 a GB-month. For review'),
  ('costs.preparing', '{"costPerMinuteMicros":4800}', '2026-10-01T00:00:00Z', 'Starting costs (docs/pricing.md): CPU $0.0032, R2 writes $0.0012 and memory $0.0005 a minute of preparing. For review'),
  ('costs.relays', '{"costPerHourMicros":85000}', '2026-10-01T00:00:00Z', 'Starting costs (docs/pricing.md): $0.085 an hour on Railway if Livepeer doesn''t charge the split ($0.415 if it does). For review'),
  ('costs.live', '{"costPerHourMicros":480000}', '2026-10-01T00:00:00Z', 'Starting costs (docs/pricing.md): Livepeer $0.33 plus R2 copies $0.15 an hour, whatever the audience. For review'),
  ('costs.platform', '{"costPerWeekMicros":5770000}', '2026-10-01T00:00:00Z', 'Starting costs, estimated: about $25 a month (Railway Pro $20 with its included usage, Cloudflare Worker $5). Replace with the real bill');
--> statement-breakpoint
INSERT INTO "network"."change_log" ("at", "kind", "subject", "summary", "after", "effective_from", "note")
SELECT r.created_at, 'rule', r.key, 'The starting costs', r.value, r.effective_from, r.note
FROM "network"."rules" r
WHERE r.key IN ('costs.storage', 'costs.preparing', 'costs.relays', 'costs.live', 'costs.platform') AND r.set_by IS NULL AND r.note LIKE 'Starting costs%';
