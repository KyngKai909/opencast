-- 2026-10-10: where it can air (programming Phase 6). Outlets (contracts' `Outlet`: opencast,
-- other_apps, relays, fast, recording) on a station's rights confirmation and on carriage terms
-- (offers, and agreements, which keep a copy so narrowing applies to new carriers only); network
-- licences, what Opencast licenses from distributors (licensor, outlets, territories, dates, the
-- deal) and the programs or items each covers. Additive: existing rights rows, offers and
-- agreements take `opencast` and `relays` from the column default (relays already carried them);
-- no data is written by hand.
CREATE TABLE "network"."network_licence_covers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"licence_id" uuid NOT NULL,
	"program_id" uuid,
	"asset_id" uuid,
	CONSTRAINT "network_licence_covers_one" CHECK (("network"."network_licence_covers"."program_id" is null) <> ("network"."network_licence_covers"."asset_id" is null))
);
--> statement-breakpoint
CREATE TABLE "network"."network_licences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"licensor" text NOT NULL,
	"name" text,
	"outlets" text[] DEFAULT '{opencast}'::text[] NOT NULL,
	"worldwide" boolean DEFAULT false NOT NULL,
	"countries" text[] DEFAULT '{}'::text[] NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"deal_kind" text DEFAULT 'none' NOT NULL,
	"rev_share_basis_points" integer,
	"flat_fee_micros" bigint,
	"flat_fee_per" text,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "network_licence_dates" CHECK ("network"."network_licences"."ends_on" >= "network"."network_licences"."starts_on"),
	CONSTRAINT "network_licence_territory" CHECK ("network"."network_licences"."worldwide" or cardinality("network"."network_licences"."countries") > 0),
	CONSTRAINT "network_licence_rev_share" CHECK ("network"."network_licences"."deal_kind" <> 'rev_share' or "network"."network_licences"."rev_share_basis_points" between 0 and 10000),
	CONSTRAINT "network_licence_flat_fee" CHECK ("network"."network_licences"."deal_kind" <> 'flat_fee' or ("network"."network_licences"."flat_fee_micros" >= 0 and "network"."network_licences"."flat_fee_per" is not null))
);
--> statement-breakpoint
ALTER TABLE "broadcast"."rights_confirmations" ADD COLUMN "outlets" text[] DEFAULT '{opencast,relays}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog"."agreements" ADD COLUMN "outlets" text[] DEFAULT '{opencast,relays}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog"."offers" ADD COLUMN "outlets" text[] DEFAULT '{opencast,relays}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "network"."network_licence_covers" ADD CONSTRAINT "network_licence_covers_licence_id_network_licences_id_fk" FOREIGN KEY ("licence_id") REFERENCES "network"."network_licences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."network_licence_covers" ADD CONSTRAINT "network_licence_covers_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "broadcast"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."network_licence_covers" ADD CONSTRAINT "network_licence_covers_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "broadcast"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."network_licences" ADD CONSTRAINT "network_licences_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "network_licence_covers_licence" ON "network"."network_licence_covers" USING btree ("licence_id");--> statement-breakpoint
CREATE INDEX "network_licence_covers_program" ON "network"."network_licence_covers" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "network_licence_covers_asset" ON "network"."network_licence_covers" USING btree ("asset_id");