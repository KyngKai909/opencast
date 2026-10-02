-- A201 (2026-09-30): DASH stream links play in Opencast's player (dash.js, loaded only when one is
-- tuned; a device that can't play DASH skips them). The rule's code fallback stays "not played", so
-- a database without this row keeps the safe default. No schema change.
INSERT INTO "network"."rules" ("key", "value", "effective_from", "note") VALUES
  ('external.dash_stream_links', '{"played":true}', '2026-09-30T00:00:00Z', 'A201: DASH stream links played in Opencast''s player (dash.js, loaded only when one is tuned)');
--> statement-breakpoint
INSERT INTO "network"."change_log" ("at", "kind", "subject", "summary", "before", "after", "effective_from", "note")
SELECT r.created_at, 'rule', r.key, 'DASH stream links: Not played yet to Played', '{"played":false}', r.value, r.effective_from, 'A201'
FROM "network"."rules" r
WHERE r.key = 'external.dash_stream_links' AND r.set_by IS NULL AND r.note LIKE 'A201:%';
