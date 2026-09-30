-- 2026-09-30: Direct uploads (follow-up Phase 4). Files go from the browser straight to object
-- storage in parts, at a staging key (`uploads/<id>`); this row follows each one from `uploading`
-- through `checking` (content ID, stored once, the checks) to `preparing` or `done`, so completion
-- survives a restart (an expired lease is picked up again) and abandoned uploads are aborted after
-- 24 hours. Additive: one new table.
CREATE TABLE "broadcast"."uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"target" jsonb NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" bigint NOT NULL,
	"part_size" integer NOT NULL,
	"part_count" integer NOT NULL,
	"store" text NOT NULL,
	"key" text NOT NULL,
	"multipart_id" text,
	"state" text NOT NULL,
	"content_id" text,
	"duplicate" boolean DEFAULT false NOT NULL,
	"result" jsonb,
	"error_code" text,
	"error_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_id_format" CHECK ("broadcast"."uploads"."content_id" is null or "broadcast"."uploads"."content_id" ~ '^b[a-z2-7]{58}$')
);
--> statement-breakpoint
ALTER TABLE "broadcast"."uploads" ADD CONSTRAINT "uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "uploads_state" ON "broadcast"."uploads" USING btree ("state","lease_until");--> statement-breakpoint
CREATE INDEX "uploads_user" ON "broadcast"."uploads" USING btree ("user_id");