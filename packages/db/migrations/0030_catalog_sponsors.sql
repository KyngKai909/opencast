-- 2026-09-29: Catalog sponsors (Network desk, desk-pages 03). The catalog's credit sold by series and
-- market: a catalog sponsorship is a sponsorship of the catalog station's series program (or of every
-- catalog series, program null) credited in one market, so it's held, renewed and settled monthly
-- like any sponsorship. One live sponsorship or offer per slot. Clear-filled slots are recorded each
-- month with the credits that aired; nothing is billed for them (Open).
ALTER TABLE "spots"."sponsorships" ADD COLUMN "market_id" uuid;--> statement-breakpoint
ALTER TABLE "spots"."sponsorships" ADD COLUMN "offered_by" uuid;--> statement-breakpoint
ALTER TABLE "spots"."sponsorships" ADD CONSTRAINT "sponsorships_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "network"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."sponsorships" ADD CONSTRAINT "sponsorships_offered_by_users_id_fk" FOREIGN KEY ("offered_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sponsorships_catalog_slot" ON "spots"."sponsorships" USING btree ("market_id",coalesce("program_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "market_id" is not null and "status" in ('requested', 'approved');--> statement-breakpoint
CREATE TABLE "spots"."catalog_house_credits" (
	"program_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"month" date NOT NULL,
	"credits" integer NOT NULL,
	"billed_micros" bigint DEFAULT 0 NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_house_credits_program_id_market_id_month_pk" PRIMARY KEY("program_id","market_id","month"),
	CONSTRAINT "catalog_house_credits_counted" CHECK ("spots"."catalog_house_credits"."credits" > 0)
);
--> statement-breakpoint
ALTER TABLE "spots"."catalog_house_credits" ADD CONSTRAINT "catalog_house_credits_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "broadcast"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."catalog_house_credits" ADD CONSTRAINT "catalog_house_credits_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "network"."markets"("id") ON DELETE no action ON UPDATE no action;
