CREATE TABLE "ledger"."payout_destinations" (
	"station_id" uuid PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'clear_account' NOT NULL,
	"clear_link_id" uuid,
	"set_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clear_wallet_has_link" CHECK ("ledger"."payout_destinations"."kind" <> 'clear_wallet' or "ledger"."payout_destinations"."clear_link_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "ledger"."deposits" ADD COLUMN "tx_hash" text;--> statement-breakpoint
ALTER TABLE "ledger"."deposits" ADD COLUMN "from_address" text;--> statement-breakpoint
ALTER TABLE "ledger"."funding_sources" ADD COLUMN "clear_link_id" uuid;--> statement-breakpoint
ALTER TABLE "ledger"."payout_destinations" ADD CONSTRAINT "payout_destinations_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."payout_destinations" ADD CONSTRAINT "payout_destinations_clear_link_id_clear_links_id_fk" FOREIGN KEY ("clear_link_id") REFERENCES "accounts"."clear_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."payout_destinations" ADD CONSTRAINT "payout_destinations_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."funding_sources" ADD CONSTRAINT "funding_sources_clear_link_id_clear_links_id_fk" FOREIGN KEY ("clear_link_id") REFERENCES "accounts"."clear_links"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deposits_tx_hash" ON "ledger"."deposits" USING btree ("tx_hash") WHERE "ledger"."deposits"."tx_hash" is not null;