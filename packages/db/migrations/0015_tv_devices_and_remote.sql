CREATE SCHEMA "tv";
--> statement-breakpoint
CREATE TYPE "tv"."platform" AS ENUM('android_tv', 'fire_tv', 'google_tv', 'tv_browser', 'web');--> statement-breakpoint
ALTER TYPE "audience"."platform" ADD VALUE 'mirror';--> statement-breakpoint
CREATE TABLE "tv"."cast_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tv"."code_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tv"."devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" "tv"."platform" NOT NULL,
	"name" text,
	"token_hash" text NOT NULL,
	"remote_state" jsonb,
	"remote_state_at" timestamp with time zone,
	"online_until" timestamp with time zone,
	"online_stream" uuid,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "tv"."pair_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tv"."remote_phones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"token_hash" text,
	"paired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_command_at" timestamp with time zone,
	"online_until" timestamp with time zone,
	"online_stream" uuid,
	"removed_at" timestamp with time zone,
	CONSTRAINT "remote_phones_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "tv"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"ended_by" text,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "tv"."sign_in_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"code" text NOT NULL,
	"poll_token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"session_id" uuid,
	"claimed_at" timestamp with time zone,
	CONSTRAINT "sign_in_codes_poll_token_hash_unique" UNIQUE("poll_token_hash")
);
--> statement-breakpoint
ALTER TABLE "broadcast"."playout_state" ADD COLUMN "standing_by" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "audience"."minute_samples" ADD COLUMN "mirror" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tv"."cast_targets" ADD CONSTRAINT "cast_targets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv"."pair_codes" ADD CONSTRAINT "pair_codes_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "tv"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv"."remote_phones" ADD CONSTRAINT "remote_phones_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "tv"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv"."remote_phones" ADD CONSTRAINT "remote_phones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv"."sessions" ADD CONSTRAINT "sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "tv"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv"."sign_in_codes" ADD CONSTRAINT "sign_in_codes_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "tv"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv"."sign_in_codes" ADD CONSTRAINT "sign_in_codes_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv"."sign_in_codes" ADD CONSTRAINT "sign_in_codes_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "tv"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tv_cast_targets_name" ON "tv"."cast_targets" USING btree ("user_id","kind",lower("name"));--> statement-breakpoint
CREATE INDEX "tv_code_attempts_key" ON "tv"."code_attempts" USING btree ("scope","key","at");--> statement-breakpoint
CREATE INDEX "tv_pair_codes_code" ON "tv"."pair_codes" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "tv_remote_phones_account" ON "tv"."remote_phones" USING btree ("device_id","user_id") WHERE "tv"."remote_phones"."kind" = 'account' and "tv"."remote_phones"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "tv_remote_phones_device" ON "tv"."remote_phones" USING btree ("device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tv_sessions_one_live" ON "tv"."sessions" USING btree ("device_id") WHERE "tv"."sessions"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "tv_sessions_user" ON "tv"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tv_sign_in_codes_code" ON "tv"."sign_in_codes" USING btree ("code");