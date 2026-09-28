ALTER TABLE "broadcast"."break_rules" ADD COLUMN "ads_from_partners" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcast"."programs" ADD COLUMN "rating" text;--> statement-breakpoint
ALTER TABLE "broadcast"."programs" ADD COLUMN "child_directed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcast"."programs" ADD COLUMN "iab_categories" jsonb;--> statement-breakpoint
ALTER TABLE "broadcast"."stations" ADD COLUMN "iab_categories" jsonb;--> statement-breakpoint
ALTER TABLE "broadcast"."programs" ADD CONSTRAINT "program_rating" CHECK ("broadcast"."programs"."rating" is null or "broadcast"."programs"."rating" in ('TV-Y', 'TV-Y7', 'TV-G', 'TV-PG', 'TV-14', 'TV-MA'));