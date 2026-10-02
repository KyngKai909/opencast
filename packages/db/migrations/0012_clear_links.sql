CREATE TABLE "accounts"."clear_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"address" text NOT NULL,
	"subject" text NOT NULL,
	"provider_app_id" text NOT NULL,
	"access" text NOT NULL,
	"linked_at" timestamp with time zone NOT NULL,
	"unlinked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts"."clear_links" ADD CONSTRAINT "clear_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clear_links_one_per_user" ON "accounts"."clear_links" USING btree ("user_id") WHERE "accounts"."clear_links"."unlinked_at" is null;