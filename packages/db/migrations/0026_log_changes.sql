-- 2026-09-29: the log's edit history. Each batch of changes published from master control's edit mode, who and when.
CREATE TABLE "broadcast"."log_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"user_id" uuid,
	"summary" text NOT NULL,
	"lines" jsonb NOT NULL,
	"changes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broadcast"."log_changes" ADD CONSTRAINT "log_changes_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."log_changes" ADD CONSTRAINT "log_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "log_changes_station_time" ON "broadcast"."log_changes" USING btree ("station_id","created_at");