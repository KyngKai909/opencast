-- 2026-09-29: Pay-as-you-go for stations (follow-up Phase 2). Being on air is free; a station pays
-- for storage, relays of everything it airs and live hours through Livepeer, measured each day
-- (ledger.usage_days), accrued as `usage` entries against the month's bill (ledger.usage_bills) and
-- paid at month end from earnings first, then the owner's Clear wallet or a card
-- (ledger.station_billing). Additive: three account kinds, two entry kinds, three tables.
-- `account_owner_fits_kind` now compares the kind as text: the new kinds can't be cast to the enum
-- in the transaction that adds them. The starting prices (docs/pricing.md, every number for
-- review) are the rules' first set versions, from October 1, 2026.
ALTER TYPE "ledger"."account_kind" ADD VALUE 'usage_owed';--> statement-breakpoint
ALTER TYPE "ledger"."account_kind" ADD VALUE 'usage_billed';--> statement-breakpoint
ALTER TYPE "ledger"."account_kind" ADD VALUE 'opencast_usage';--> statement-breakpoint
ALTER TYPE "ledger"."entry_kind" ADD VALUE 'usage';--> statement-breakpoint
ALTER TYPE "ledger"."entry_kind" ADD VALUE 'usage_payment';--> statement-breakpoint
CREATE TABLE "ledger"."station_billing" (
	"station_id" uuid PRIMARY KEY NOT NULL,
	"funding" text,
	"clear_link_id" uuid,
	"card_ref" text,
	"card_label" text,
	"card_expires_on" date,
	"caps" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"caps_reached" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"standing" text DEFAULT 'ok' NOT NULL,
	"grace_started_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "station_billing_clear_has_link" CHECK ("ledger"."station_billing"."funding" is distinct from 'clear' or "ledger"."station_billing"."clear_link_id" is not null),
	CONSTRAINT "station_billing_grace_started" CHECK ("ledger"."station_billing"."standing" = 'ok' or "ledger"."station_billing"."grace_started_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "ledger"."usage_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"month" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"lines" jsonb,
	"closed_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_method" text,
	"last_failure" text,
	"last_provider_ref" text,
	"clear_tx_hash" text,
	"clear_amount_micros" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_bill_month_start" CHECK (extract(day from "ledger"."usage_bills"."month") = 1)
);
--> statement-breakpoint
CREATE TABLE "ledger"."usage_days" (
	"station_id" uuid NOT NULL,
	"usage_type" text NOT NULL,
	"day" date NOT NULL,
	"quantity" double precision DEFAULT 0 NOT NULL,
	"detail" jsonb,
	"charge_micros" bigint,
	"closed_at" timestamp with time zone,
	"entry_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_days_station_id_usage_type_day_pk" PRIMARY KEY("station_id","usage_type","day"),
	CONSTRAINT "usage_type_known" CHECK ("ledger"."usage_days"."usage_type" in ('storage', 'relay_everything', 'live_hours', 'radio_live', 'relay_live_only')),
	CONSTRAINT "usage_quantity_nonnegative" CHECK ("ledger"."usage_days"."quantity" >= 0),
	CONSTRAINT "usage_charge_nonnegative" CHECK ("ledger"."usage_days"."charge_micros" is null or "ledger"."usage_days"."charge_micros" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ledger"."accounts" DROP CONSTRAINT "account_owner_fits_kind";--> statement-breakpoint
ALTER TABLE "ledger"."station_billing" ADD CONSTRAINT "station_billing_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."station_billing" ADD CONSTRAINT "station_billing_clear_link_id_clear_links_id_fk" FOREIGN KEY ("clear_link_id") REFERENCES "accounts"."clear_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."station_billing" ADD CONSTRAINT "station_billing_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."usage_bills" ADD CONSTRAINT "usage_bills_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."usage_days" ADD CONSTRAINT "usage_days_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."usage_days" ADD CONSTRAINT "usage_days_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "ledger"."entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_bills_station_month" ON "ledger"."usage_bills" USING btree ("station_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_bills_clear_tx" ON "ledger"."usage_bills" USING btree ("clear_tx_hash") WHERE "ledger"."usage_bills"."clear_tx_hash" is not null;--> statement-breakpoint
CREATE INDEX "usage_days_day" ON "ledger"."usage_days" USING btree ("day");--> statement-breakpoint
ALTER TABLE "ledger"."accounts" ADD CONSTRAINT "account_owner_fits_kind" CHECK (case "ledger"."accounts"."kind"::text
        when 'advertiser_available' then "ledger"."accounts"."advertiser_id" is not null and "ledger"."accounts"."station_id" is null
        when 'station_earnings' then "ledger"."accounts"."station_id" is not null and "ledger"."accounts"."advertiser_id" is null
        when 'escrow_owed' then "ledger"."accounts"."station_id" is not null and "ledger"."accounts"."advertiser_id" is null
        when 'escrow' then "ledger"."accounts"."station_id" is not null and "ledger"."accounts"."advertiser_id" is null
        when 'creator' then "ledger"."accounts"."station_id" is not null and "ledger"."accounts"."user_id" is not null
        when 'usage_owed' then "ledger"."accounts"."station_id" is not null and "ledger"."accounts"."advertiser_id" is null
        else "ledger"."accounts"."advertiser_id" is null and "ledger"."accounts"."station_id" is null
      end);
--> statement-breakpoint
-- The starting price sheet (docs/pricing.md): cost plus a margin, from the Phase 5 measurements. For review.
INSERT INTO "network"."rules" ("key", "value", "effective_from", "note") VALUES
  ('prices.storage', '{"perGbMonthMicros":40000}', '2026-10-01T00:00:00Z', 'Starting price sheet (docs/pricing.md): cost about $0.018 a GB-month. For review'),
  ('prices.relay_everything', '{"perHourMicros":200000}', '2026-10-01T00:00:00Z', 'Starting price sheet (docs/pricing.md): cost about $0.085 an hour to one platform, $0.15 to two. For review'),
  ('prices.live_hours', '{"perHourMicros":750000}', '2026-10-01T00:00:00Z', 'Starting price sheet (docs/pricing.md): Livepeer $0.33 an hour plus delivery. For review'),
  ('prices.radio_live', '{"perHourMicros":0}', '1970-01-01T00:00:00Z', 'Open: free. Radio live runs through the worker''s own ingest, not Livepeer (docs/pricing.md)'),
  ('billing.grace', '{"days":14,"warnDaysBefore":3}', '1970-01-01T00:00:00Z', 'Open: the follow-up prompt''s default');
--> statement-breakpoint
INSERT INTO "network"."change_log" ("at", "kind", "subject", "summary", "after", "effective_from", "note")
SELECT r.created_at, 'rule', r.key, 'The starting price sheet', r.value, r.effective_from, r.note
FROM "network"."rules" r
WHERE r.key IN ('prices.storage', 'prices.relay_everything', 'prices.live_hours', 'prices.radio_live', 'billing.grace') AND r.set_by IS NULL AND r.note NOT LIKE 'Open: not set yet%';
