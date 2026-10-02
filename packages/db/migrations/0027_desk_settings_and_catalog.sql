-- 2026-09-29: Network desk Settings and the catalog's shelf (follow-up Phase 0, items 10 and 11).
-- Settings: desk roles besides admin (rights reviewers, market leads), the rules registry with
-- effective dates, escrow signer proposals that need the other admins' approval, and one change log.
-- The shelf: series, items with their rights records and evidence, episodes composed from items.
-- Additive: new tables only. The rules registry starts with the values in effect before it
-- (ledger.revenue_config's rows, trust.policy's row, and the defaults the code used), so nothing
-- reads differently; revenue_config and trust.policy stay, and a write to either still reaches it.
CREATE TABLE "network"."change_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "network"."change_log_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"by" uuid,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"summary" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"effective_from" timestamp with time zone,
	"note" text,
	CONSTRAINT "change_kind" CHECK ("network"."change_log"."kind" in ('rule', 'role', 'signer'))
);
--> statement-breakpoint
CREATE TABLE "network"."desk_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"market_id" uuid,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_by" uuid,
	"removed_at" timestamp with time zone,
	CONSTRAINT "desk_role_kind" CHECK ("network"."desk_roles"."role" in ('rights_reviewer', 'market_lead')),
	CONSTRAINT "market_lead_has_market" CHECK (("network"."desk_roles"."role" = 'market_lead') = ("network"."desk_roles"."market_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "network"."rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"value" jsonb NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"set_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_key_format" CHECK ("network"."rules"."key" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$')
);
--> statement-breakpoint
CREATE TABLE "network"."signer_approvals" (
	"proposal_id" uuid NOT NULL,
	"admin_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signer_approvals_proposal_id_admin_id_pk" PRIMARY KEY("proposal_id","admin_id"),
	CONSTRAINT "signer_decision" CHECK ("network"."signer_approvals"."decision" in ('approve', 'refuse'))
);
--> statement-breakpoint
CREATE TABLE "network"."signer_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"old_address" text,
	"new_address" text,
	"threshold" integer,
	"signers_after" jsonb NOT NULL,
	"threshold_after" integer NOT NULL,
	"note" text,
	"proposed_by" uuid NOT NULL,
	"proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approvers" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "signer_kind" CHECK ("network"."signer_proposals"."kind" in ('add', 'remove', 'replace', 'threshold')),
	CONSTRAINT "signer_status" CHECK ("network"."signer_proposals"."status" in ('open', 'approved', 'refused', 'withdrawn')),
	CONSTRAINT "signer_addresses" CHECK (("network"."signer_proposals"."kind" in ('remove', 'replace')) = ("network"."signer_proposals"."old_address" is not null) and ("network"."signer_proposals"."kind" in ('add', 'replace')) = ("network"."signer_proposals"."new_address" is not null)),
	CONSTRAINT "signer_threshold_after" CHECK ("network"."signer_proposals"."threshold_after" >= 1 and "network"."signer_proposals"."threshold_after" <= jsonb_array_length("network"."signer_proposals"."signers_after"))
);
--> statement-breakpoint
CREATE TABLE "catalog"."shelf_episode_items" (
	"episode_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"position" integer,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_reason" text,
	CONSTRAINT "shelf_episode_items_episode_id_item_id_pk" PRIMARY KEY("episode_id","item_id"),
	CONSTRAINT "removed_has_no_position" CHECK (("catalog"."shelf_episode_items"."removed_at" is null) = ("catalog"."shelf_episode_items"."position" is not null))
);
--> statement-breakpoint
CREATE TABLE "catalog"."shelf_episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text,
	"library_item_id" uuid,
	"composition" text,
	"version" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"error" text,
	"composed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "episode_status" CHECK ("catalog"."shelf_episodes"."status" in ('draft', 'composing', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "catalog"."shelf_item_checks" (
	"item_id" uuid NOT NULL,
	"line" text NOT NULL,
	"state" text DEFAULT 'todo' NOT NULL,
	"detail" text,
	"record" text,
	"set_by" uuid,
	"set_at" timestamp with time zone,
	CONSTRAINT "shelf_item_checks_item_id_line_pk" PRIMARY KEY("item_id","line"),
	CONSTRAINT "item_check_state" CHECK ("catalog"."shelf_item_checks"."state" in ('todo', 'ok', 'warn', 'fail', 'not_needed'))
);
--> statement-breakpoint
CREATE TABLE "catalog"."shelf_item_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"line" text NOT NULL,
	"content_id" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."shelf_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid NOT NULL,
	"title" text NOT NULL,
	"source" text NOT NULL,
	"work_kind" text DEFAULT 'film' NOT NULL,
	"published_year" integer,
	"country" text DEFAULT 'US' NOT NULL,
	"basis" text,
	"library_item_id" uuid,
	"content_id" text NOT NULL,
	"duration_ms" bigint,
	"state" text DEFAULT 'checking' NOT NULL,
	"first_checked_by" uuid,
	"first_checked_at" timestamp with time zone,
	"second_checked_by" uuid,
	"second_checked_at" timestamp with time zone,
	"failed_by" uuid,
	"failed_at" timestamp with time zone,
	"failed_reason" text,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_state" CHECK ("catalog"."shelf_items"."state" in ('checking', 'second_check', 'passed', 'failed')),
	CONSTRAINT "item_kind" CHECK ("catalog"."shelf_items"."work_kind" in ('film', 'sound_recording')),
	CONSTRAINT "second_check_is_someone_else" CHECK ("catalog"."shelf_items"."second_checked_by" is null or "catalog"."shelf_items"."second_checked_by" <> "catalog"."shelf_items"."first_checked_by"),
	CONSTRAINT "passed_has_both_checks" CHECK ("catalog"."shelf_items"."state" <> 'passed' or ("catalog"."shelf_items"."first_checked_by" is not null and "catalog"."shelf_items"."second_checked_by" is not null)),
	CONSTRAINT "sent_has_first_check" CHECK ("catalog"."shelf_items"."state" <> 'second_check' or "catalog"."shelf_items"."first_checked_by" is not null)
);
--> statement-breakpoint
CREATE TABLE "catalog"."shelf_rebuilds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "catalog"."shelf_rebuilds_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"series_id" uuid NOT NULL,
	"item_id" uuid,
	"reason" text NOT NULL,
	"by" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"episodes" jsonb NOT NULL,
	"unchanged" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."shelf_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"station_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"media_kind" text DEFAULT 'video' NOT NULL,
	"rights_basis" text NOT NULL,
	"basis_note" text,
	"notes" text,
	"episode_length_ms" bigint,
	"colour" text,
	"state" text DEFAULT 'building' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shelf_series_program_id_unique" UNIQUE("program_id"),
	CONSTRAINT "series_basis" CHECK ("catalog"."shelf_series"."rights_basis" in ('us_government', 'published_before_cutoff', 'not_renewed', 'mixed', 'sound_recording', 'licence')),
	CONSTRAINT "series_state" CHECK ("catalog"."shelf_series"."state" in ('building', 'coming'))
);
--> statement-breakpoint
ALTER TABLE "network"."change_log" ADD CONSTRAINT "change_log_by_users_id_fk" FOREIGN KEY ("by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."desk_roles" ADD CONSTRAINT "desk_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."desk_roles" ADD CONSTRAINT "desk_roles_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "network"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."desk_roles" ADD CONSTRAINT "desk_roles_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."desk_roles" ADD CONSTRAINT "desk_roles_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."rules" ADD CONSTRAINT "rules_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."signer_approvals" ADD CONSTRAINT "signer_approvals_proposal_id_signer_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "network"."signer_proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."signer_approvals" ADD CONSTRAINT "signer_approvals_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."signer_proposals" ADD CONSTRAINT "signer_proposals_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."shelf_episode_items" ADD CONSTRAINT "shelf_episode_items_episode_id_shelf_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "catalog"."shelf_episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."shelf_episode_items" ADD CONSTRAINT "shelf_episode_items_item_id_shelf_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "catalog"."shelf_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."shelf_episodes" ADD CONSTRAINT "shelf_episodes_series_id_shelf_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "catalog"."shelf_series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."shelf_episodes" ADD CONSTRAINT "shelf_episodes_library_item_id_assets_id_fk" FOREIGN KEY ("library_item_id") REFERENCES "broadcast"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."shelf_item_checks" ADD CONSTRAINT "shelf_item_checks_item_id_shelf_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "catalog"."shelf_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."shelf_item_checks" ADD CONSTRAINT "shelf_item_checks_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."shelf_item_evidence" ADD CONSTRAINT "shelf_item_evidence_item_id_shelf_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "catalog"."shelf_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."shelf_item_evidence" ADD CONSTRAINT "shelf_item_evidence_content_id_contents_cid_fk" FOREIGN KEY ("content_id") REFERENCES "broadcast"."contents"("cid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."shelf_item_evidence" ADD CONSTRAINT "shelf_item_evidence_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."shelf_items" ADD CONSTRAINT "shelf_items_series_id_shelf_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "catalog"."shelf_series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."shelf_items" ADD CONSTRAINT "shelf_items_library_item_id_assets_id_fk" FOREIGN KEY ("library_item_id") REFERENCES "broadcast"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."shelf_items" ADD CONSTRAINT "shelf_items_content_id_contents_cid_fk" FOREIGN KEY ("content_id") REFERENCES "broadcast"."contents"("cid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."shelf_items" ADD CONSTRAINT "shelf_items_first_checked_by_users_id_fk" FOREIGN KEY ("first_checked_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."shelf_items" ADD CONSTRAINT "shelf_items_second_checked_by_users_id_fk" FOREIGN KEY ("second_checked_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."shelf_items" ADD CONSTRAINT "shelf_items_failed_by_users_id_fk" FOREIGN KEY ("failed_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."shelf_items" ADD CONSTRAINT "shelf_items_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."shelf_rebuilds" ADD CONSTRAINT "shelf_rebuilds_series_id_shelf_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "catalog"."shelf_series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."shelf_rebuilds" ADD CONSTRAINT "shelf_rebuilds_item_id_shelf_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "catalog"."shelf_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."shelf_rebuilds" ADD CONSTRAINT "shelf_rebuilds_by_users_id_fk" FOREIGN KEY ("by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."shelf_series" ADD CONSTRAINT "shelf_series_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."shelf_series" ADD CONSTRAINT "shelf_series_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "broadcast"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."shelf_series" ADD CONSTRAINT "shelf_series_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_log_at" ON "network"."change_log" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "desk_roles_one_active" ON "network"."desk_roles" USING btree ("user_id","role",coalesce("market_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "network"."desk_roles"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "rules_key_scope_from" ON "network"."rules" USING btree ("key","scope","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "shelf_episodes_number" ON "catalog"."shelf_episodes" USING btree ("series_id","number");--> statement-breakpoint
CREATE INDEX "shelf_item_evidence_item" ON "catalog"."shelf_item_evidence" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "shelf_items_series" ON "catalog"."shelf_items" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "shelf_items_content" ON "catalog"."shelf_items" USING btree ("content_id");
--> statement-breakpoint
-- The values in effect before the registry, as its first versions. A rule nobody had set starts
-- at the beginning of time with the default the code used.
INSERT INTO "network"."rules" ("key", "value", "effective_from", "note")
SELECT 'shares.opencast', jsonb_build_object('spotBps', opencast_spot_share_bps, 'pledgeBps', opencast_pledge_share_bps, 'productionBps', opencast_production_share_bps), (effective_from::timestamp AT TIME ZONE 'UTC'), 'From ledger.revenue_config'
FROM "ledger"."revenue_config"
UNION ALL
SELECT 'shares.pool', jsonb_build_object('shareBps', pool_share_bps, 'baseBps', pool_base_bps, 'watchTimeBps', pool_watch_time_bps, 'fundBps', pool_fund_bps), (effective_from::timestamp AT TIME ZONE 'UTC'), 'From ledger.revenue_config'
FROM "ledger"."revenue_config"
UNION ALL
SELECT 'money.payout_schedule', to_jsonb(payout_schedule), (effective_from::timestamp AT TIME ZONE 'UTC'), 'From ledger.revenue_config'
FROM "ledger"."revenue_config"
UNION ALL
SELECT 'escrow.unclaimed_period', jsonb_build_object('days', unclaimed_period_days), (effective_from::timestamp AT TIME ZONE 'UTC'), 'From ledger.revenue_config'
FROM "ledger"."revenue_config";
--> statement-breakpoint
INSERT INTO "network"."rules" ("key", "value", "effective_from", "note")
SELECT d.key, d.value::jsonb, '1970-01-01T00:00:00Z'::timestamptz, 'The value in effect before the registry'
FROM (VALUES
  ('shares.opencast', '{"spotBps":0,"pledgeBps":0,"productionBps":0}'),
  ('shares.pool', '{"shareBps":0,"baseBps":0,"watchTimeBps":0,"fundBps":0}'),
  ('money.payout_schedule', '"weekly"'),
  ('escrow.unclaimed_period', '{"days":1095}')
) AS d(key, value)
WHERE NOT EXISTS (SELECT 1 FROM "network"."rules" r WHERE r.key = d.key);
--> statement-breakpoint
INSERT INTO "network"."rules" ("key", "value", "effective_from", "note")
SELECT 'rights.claim_dates', jsonb_build_object('answerDays', coalesce(p.answer_days, 14), 'counterNoticeBusinessDays', coalesce(p.claimant_reply_business_days, 10)), '1970-01-01T00:00:00Z'::timestamptz, 'From trust.policy. Placeholders until reviewed by a lawyer'
FROM (SELECT 1) one LEFT JOIN "trust"."policy" p ON p.id = 1
UNION ALL
SELECT 'rights.repeat_limit', jsonb_build_object('upheldIn12Months', coalesce(p.upheld_per_year_to_pause_offers, 3)), '1970-01-01T00:00:00Z'::timestamptz, 'From trust.policy'
FROM (SELECT 1) one LEFT JOIN "trust"."policy" p ON p.id = 1;
--> statement-breakpoint
INSERT INTO "network"."rules" ("key", "value", "effective_from", "note") VALUES
  ('prices.storage', '{"perGbMonthMicros":null}', '1970-01-01T00:00:00Z', 'Open: not set yet'),
  ('prices.relay_everything', '{"perHourMicros":null}', '1970-01-01T00:00:00Z', 'Open: not set yet'),
  ('prices.live_hours', '{"perHourMicros":null}', '1970-01-01T00:00:00Z', 'Open: not set yet'),
  ('prices.free_allowance', '{"storageGb":10,"liveHours":5}', '1970-01-01T00:00:00Z', 'Open: the follow-up prompt''s default'),
  ('rights.public_domain_us', '{"jurisdiction":"US","termYears":95,"renewalRequiredThrough":1963,"noticeRequiredThrough":1977}', '1970-01-01T00:00:00Z', 'Open: US works only. Published 95 years ago or more; the cut-off year moves every January 1'),
  ('rights.sound_recordings_us', '{"jurisdiction":"US","allBefore":1923,"tiers":[{"from":1923,"through":1946,"years":100},{"from":1947,"through":1956,"years":110},{"from":1957,"through":1972,"endsOn":"2067-02-15"}]}', '1970-01-01T00:00:00Z', 'Open: the Music Modernization Act''s terms for recordings fixed before February 15, 1972'),
  ('relays.platform_limits', '{"platforms":[{"platform":"twitch","maxHours":48,"savesUnderHours":null},{"platform":"youtube","maxHours":null,"savesUnderHours":12},{"platform":"facebook","maxHours":8,"savesUnderHours":null}]}', '1970-01-01T00:00:00Z', 'For Phase 3. Platforms change these; add limits as they''re found'),
  ('numbering.channels', '{"tv":{"firstMajor":2,"lastMajor":69},"radio":{"firstTenths":882,"lastTenths":1078}}', '1970-01-01T00:00:00Z', 'The whole band, in every market. Radio is even tenths, 88.2 to 107.8'),
  ('escrow.signers', '{"signers":null,"threshold":null}', '1970-01-01T00:00:00Z', 'As deployed: read from the contract or configuration');
--> statement-breakpoint
INSERT INTO "network"."change_log" ("at", "kind", "subject", "summary", "after", "effective_from", "note")
SELECT r.created_at, 'rule', r.key, 'Started the registry with the value in effect', r.value, r.effective_from, r.note
FROM "network"."rules" r;
--> statement-breakpoint
-- Anything that still writes ledger.revenue_config or trust.policy reaches the registry too, as a new version.
CREATE FUNCTION "ledger"."revenue_config_to_rules"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  starts timestamptz := (NEW.effective_from::timestamp AT TIME ZONE 'UTC');
BEGIN
  INSERT INTO network.rules (key, value, effective_from, note) VALUES
    ('shares.opencast', jsonb_build_object('spotBps', NEW.opencast_spot_share_bps, 'pledgeBps', NEW.opencast_pledge_share_bps, 'productionBps', NEW.opencast_production_share_bps), starts, 'From ledger.revenue_config'),
    ('shares.pool', jsonb_build_object('shareBps', NEW.pool_share_bps, 'baseBps', NEW.pool_base_bps, 'watchTimeBps', NEW.pool_watch_time_bps, 'fundBps', NEW.pool_fund_bps), starts, 'From ledger.revenue_config'),
    ('money.payout_schedule', to_jsonb(NEW.payout_schedule), starts, 'From ledger.revenue_config'),
    ('escrow.unclaimed_period', jsonb_build_object('days', NEW.unclaimed_period_days), starts, 'From ledger.revenue_config');
  INSERT INTO network.change_log (kind, subject, summary, after, effective_from, note)
  VALUES ('rule', 'shares.opencast', 'Written to ledger.revenue_config', to_jsonb(NEW), starts, 'Bridged from ledger.revenue_config');
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "revenue_config_to_rules" AFTER INSERT OR UPDATE ON "ledger"."revenue_config" FOR EACH ROW EXECUTE FUNCTION "ledger"."revenue_config_to_rules"();
--> statement-breakpoint
CREATE FUNCTION "trust"."policy_to_rules"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO network.rules (key, value, effective_from, note) VALUES
    ('rights.claim_dates', jsonb_build_object('answerDays', NEW.answer_days, 'counterNoticeBusinessDays', NEW.claimant_reply_business_days), now(), 'From trust.policy'),
    ('rights.repeat_limit', jsonb_build_object('upheldIn12Months', NEW.upheld_per_year_to_pause_offers), now(), 'From trust.policy');
  INSERT INTO network.change_log (kind, subject, summary, after, effective_from, note)
  VALUES ('rule', 'rights.claim_dates', 'Written to trust.policy', to_jsonb(NEW), now(), 'Bridged from trust.policy');
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "policy_to_rules" AFTER INSERT OR UPDATE ON "trust"."policy" FOR EACH ROW EXECUTE FUNCTION "trust"."policy_to_rules"();
--> statement-breakpoint
-- Only double-checked items go into episodes (an item already in one may fail later: it's then taken out).
CREATE FUNCTION "catalog"."shelf_episode_item_passed"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.removed_at IS NULL AND NOT EXISTS (SELECT 1 FROM catalog.shelf_items i WHERE i.id = NEW.item_id AND i.state = 'passed') THEN
    RAISE EXCEPTION 'shelf_item_not_passed: only items checked by two people go into episodes' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "shelf_episode_item_passed" BEFORE INSERT OR UPDATE ON "catalog"."shelf_episode_items" FOR EACH ROW EXECUTE FUNCTION "catalog"."shelf_episode_item_passed"();
--> statement-breakpoint
-- The person who proposed a signer change never approves it, and only the admins it names do.
CREATE FUNCTION "network"."signer_approval_by_another"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p network.signer_proposals%ROWTYPE;
BEGIN
  SELECT * INTO p FROM network.signer_proposals WHERE id = NEW.proposal_id;
  IF p.proposed_by = NEW.admin_id THEN
    RAISE EXCEPTION 'signer_self_approval: the proposer can''t approve their own change' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (p.approvers ? NEW.admin_id::text) THEN
    RAISE EXCEPTION 'signer_not_approver: only the admins named on the proposal decide it' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "signer_approval_by_another" BEFORE INSERT OR UPDATE ON "network"."signer_approvals" FOR EACH ROW EXECUTE FUNCTION "network"."signer_approval_by_another"();
