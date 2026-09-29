CREATE TABLE "spots"."connection_events" (
	"connection_id" uuid NOT NULL,
	"event_ref" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connection_events_connection_id_event_ref_pk" PRIMARY KEY("connection_id","event_ref")
);
--> statement-breakpoint
CREATE TABLE "spots"."connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"secret" text NOT NULL,
	"hook_token" text NOT NULL,
	"connected_by" uuid,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	CONSTRAINT "connections_hook_token_unique" UNIQUE("hook_token")
);
--> statement-breakpoint
ALTER TABLE "spots"."advertisers" ADD COLUMN "redeem_on" boolean;--> statement-breakpoint
ALTER TABLE "spots"."advertisers" ADD COLUMN "receipts_key" text;--> statement-breakpoint
ALTER TABLE "spots"."codes" ADD COLUMN "picked_by" text DEFAULT 'business' NOT NULL;--> statement-breakpoint
ALTER TABLE "spots"."order_files" ADD COLUMN "duration_ms" bigint;--> statement-breakpoint
ALTER TABLE "spots"."order_files" ADD COLUMN "checks_passed" jsonb;--> statement-breakpoint
ALTER TABLE "spots"."production_orders" ADD COLUMN "quoted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "spots"."targeting" ADD COLUMN "bands" jsonb;--> statement-breakpoint
ALTER TABLE "spots"."connection_events" ADD CONSTRAINT "connection_events_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "spots"."connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."connections" ADD CONSTRAINT "connections_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "spots"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."connections" ADD CONSTRAINT "connections_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connections_advertiser" ON "spots"."connections" USING btree ("advertiser_id","kind");