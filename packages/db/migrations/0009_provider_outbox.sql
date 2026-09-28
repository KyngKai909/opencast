CREATE TABLE "ledger"."provider_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" uuid,
	"owner_label" text,
	"provider" text NOT NULL,
	"ref" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"onboarding_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_accounts_owner" UNIQUE NULLS NOT DISTINCT("owner_type","owner_id","owner_label","provider")
);
--> statement-breakpoint
CREATE TABLE "ledger"."provider_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"kind" text NOT NULL,
	"from_wallet" text NOT NULL,
	"to_wallet" text,
	"hold_id" uuid,
	"amount_micros" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"provider_ref" text,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "move_amount_positive" CHECK ("ledger"."provider_moves"."amount_micros" > 0),
	CONSTRAINT "transfer_has_destination" CHECK (("ledger"."provider_moves"."kind" = 'transfer') = ("ledger"."provider_moves"."to_wallet" is not null))
);
--> statement-breakpoint
ALTER TABLE "ledger"."provider_moves" ADD CONSTRAINT "provider_moves_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "ledger"."entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."provider_moves" ADD CONSTRAINT "provider_moves_hold_id_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "ledger"."holds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_moves_entry_seq" ON "ledger"."provider_moves" USING btree ("entry_id","seq");--> statement-breakpoint
CREATE INDEX "provider_moves_pending" ON "ledger"."provider_moves" USING btree ("status","created_at");