-- 2026-10-10: Other apps viewers on per-thousand spots (programming Phase 5, P5.1, the user's
-- decision). An airing's Other apps part: the sessions from the channel list whose playlist polls
-- ran through the spot, billed apart from Opencast's own viewers once the polls after it are in.
-- Additive: a new table.
CREATE TABLE "spots"."other_app_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"airing_id" uuid NOT NULL,
	"audience" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"fraction" real NOT NULL,
	"cap_micros" bigint,
	"status" text DEFAULT 'counting' NOT NULL,
	"reason" text,
	"sessions" integer,
	"billed_sessions" integer,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"held_micros" bigint DEFAULT 0 NOT NULL,
	"working" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "other_app_charges_airing_id_unique" UNIQUE("airing_id"),
	CONSTRAINT "other_app_charges_fraction" CHECK ("spots"."other_app_charges"."fraction" >= 0 and "spots"."other_app_charges"."fraction" <= 1),
	CONSTRAINT "other_app_charges_cost" CHECK ("spots"."other_app_charges"."cost_micros" >= 0 and "spots"."other_app_charges"."held_micros" >= 0)
);
--> statement-breakpoint
ALTER TABLE "spots"."other_app_charges" ADD CONSTRAINT "other_app_charges_airing_id_airings_id_fk" FOREIGN KEY ("airing_id") REFERENCES "spots"."airings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "other_app_charges_open" ON "spots"."other_app_charges" USING btree ("status","ended_at");