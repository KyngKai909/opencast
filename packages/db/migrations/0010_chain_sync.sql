CREATE TABLE "ledger"."chain_cursor" (
	"name" text PRIMARY KEY NOT NULL,
	"block" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "network"."handovers" ADD COLUMN "payee_address" text;