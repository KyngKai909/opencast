-- 2026-10-07: invite-only sign-ups (the user's request, like Clubhouse while it grew). Invite codes
-- (a person's own, one use each, or the desk's, any number), and on each account when and how it
-- was let in. Everyone with an account now was let in when they signed up ("existing"). Sign-ups
-- start invite-only, with 10 codes each; the desk changes both in Settings, Rules, Sign-ups.
CREATE TABLE "accounts"."invite_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"created_by" uuid,
	"note" text,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_codes_code_unique" UNIQUE("code"),
	CONSTRAINT "invite_code_format" CHECK ("accounts"."invite_codes"."code" ~ '^[A-HJKMNP-Z2-9]{8}$'),
	CONSTRAINT "invite_code_personal_once" CHECK ("accounts"."invite_codes"."kind" <> 'personal' or ("accounts"."invite_codes"."max_uses" = 1 and "accounts"."invite_codes"."created_by" is not null)),
	CONSTRAINT "invite_code_uses_fit" CHECK ("accounts"."invite_codes"."max_uses" is null or "accounts"."invite_codes"."uses" <= "accounts"."invite_codes"."max_uses")
);
--> statement-breakpoint
ALTER TABLE "accounts"."users" ADD COLUMN "admitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts"."users" ADD COLUMN "admitted_how" text;--> statement-breakpoint
ALTER TABLE "accounts"."users" ADD COLUMN "admitted_by_code" uuid;--> statement-breakpoint
ALTER TABLE "accounts"."invite_codes" ADD CONSTRAINT "invite_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invite_codes_created_by" ON "accounts"."invite_codes" USING btree ("created_by");--> statement-breakpoint
UPDATE "accounts"."users" SET "admitted_at" = "created_at", "admitted_how" = 'existing' WHERE "admitted_at" IS NULL;--> statement-breakpoint
INSERT INTO "network"."rules" ("key", "value", "effective_from", "note") VALUES
  ('signups.invite_only', '{"on":true}', '1970-01-01T00:00:00Z', 'Invite-only sign-ups to start (the user''s request, 2026-10-07)'),
  ('signups.codes_per_person', '{"codes":10}', '1970-01-01T00:00:00Z', 'Ten invite codes each to start (the user''s request, 2026-10-07)');
