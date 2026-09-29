CREATE TABLE "accounts"."sign_in_sessions" (
	"user_id" uuid NOT NULL,
	"sid" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "sign_in_sessions_user_id_sid_pk" PRIMARY KEY("user_id","sid")
);
--> statement-breakpoint
CREATE TABLE "accounts"."watch_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "network"."handovers" ALTER COLUMN "station_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts"."users" ADD COLUMN "signed_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts"."users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ledger"."pledges" ADD COLUMN "card_label" text;--> statement-breakpoint
ALTER TABLE "ledger"."pledges" ADD COLUMN "card_expires_on" date;--> statement-breakpoint
ALTER TABLE "network"."creator_works" ADD COLUMN "noun" text;--> statement-breakpoint
ALTER TABLE "network"."creators" ADD COLUMN "pronoun" text;--> statement-breakpoint
ALTER TABLE "network"."creators" ADD COLUMN "proposed_channels" integer[];--> statement-breakpoint
ALTER TABLE "network"."creators" ADD COLUMN "recipe_id" uuid;--> statement-breakpoint
ALTER TABLE "network"."creators" ADD COLUMN "operator_user_id" uuid;--> statement-breakpoint
ALTER TABLE "network"."creators" ADD COLUMN "claim_invite_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "network"."creators" ADD COLUMN "claim_link_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "network"."handovers" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "network"."permission_records" ADD COLUMN "wording_version" text;--> statement-breakpoint
ALTER TABLE "network"."permission_requests" ADD COLUMN "work_ids" jsonb;--> statement-breakpoint
ALTER TABLE "network"."permission_requests" ADD COLUMN "stopped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "network"."permission_requests" ADD COLUMN "stopped_from_ip" text;--> statement-breakpoint
ALTER TABLE "network"."recipes" ADD COLUMN "when_text" text;--> statement-breakpoint
ALTER TABLE "network"."recipes" ADD COLUMN "catalog_about" text;--> statement-breakpoint
ALTER TABLE "accounts"."sign_in_sessions" ADD CONSTRAINT "sign_in_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts"."watch_history" ADD CONSTRAINT "watch_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts"."watch_history" ADD CONSTRAINT "watch_history_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "watch_history_user" ON "accounts"."watch_history" USING btree ("user_id","last_at");--> statement-breakpoint
ALTER TABLE "network"."creators" ADD CONSTRAINT "creators_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "network"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."creators" ADD CONSTRAINT "creators_operator_user_id_users_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."handovers" ADD CONSTRAINT "handovers_request_id_permission_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "network"."permission_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."handovers" ADD CONSTRAINT "handover_has_station_or_link" CHECK ("network"."handovers"."station_id" is not null or "network"."handovers"."request_id" is not null);--> statement-breakpoint
-- Creators proposed one channel until now: it's the first of their proposed channels.
UPDATE "network"."creators" SET "proposed_channels" = ARRAY["proposed_tenths"] WHERE "proposed_tenths" IS NOT NULL AND "proposed_channels" IS NULL;
