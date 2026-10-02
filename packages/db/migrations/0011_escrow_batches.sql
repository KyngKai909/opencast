ALTER TABLE "ledger"."escrow_deposits" ADD COLUMN "items" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger"."escrow_deposits" ADD COLUMN "status" text DEFAULT 'sending' NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger"."escrow_deposits" ADD COLUMN "error" text;