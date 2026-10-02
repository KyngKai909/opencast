CREATE TABLE "broadcast"."prepared_captions" (
	"key" text NOT NULL,
	"content_id" text NOT NULL,
	"rendition" text NOT NULL,
	"source" text NOT NULL,
	"language" text,
	"segments" integer NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"prepared_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prepared_captions_key_content_id_pk" PRIMARY KEY("key","content_id")
);
--> statement-breakpoint
ALTER TABLE "broadcast"."caption_tracks" ADD COLUMN "content_id" text;--> statement-breakpoint
ALTER TABLE "broadcast"."translators" ADD COLUMN "burn_captions" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcast"."prepared_captions" ADD CONSTRAINT "prepared_captions_key_prepared_items_key_fk" FOREIGN KEY ("key") REFERENCES "broadcast"."prepared_items"("key") ON DELETE no action ON UPDATE no action;