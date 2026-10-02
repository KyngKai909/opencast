-- 2026-09-29: Storage maintenance (Network desk Settings). Each run of a one-off storage job from
-- the desk (relinkLocations, copyPinata, prepareFromOriginals), a check or an apply: who, when, its
-- progress, counts and the JSON report the scripts write. One running run per job (the partial
-- unique index). The change log gains the kind `storage`, for each apply.
CREATE TABLE "network"."storage_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "network"."storage_runs_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"job" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"progress_done" integer,
	"progress_total" integer,
	"counts" jsonb,
	"error" text,
	"report" jsonb,
	CONSTRAINT "storage_run_job" CHECK ("network"."storage_runs"."job" in ('relinkLocations', 'copyPinata', 'prepareFromOriginals')),
	CONSTRAINT "storage_run_mode" CHECK ("network"."storage_runs"."mode" in ('check', 'apply')),
	CONSTRAINT "storage_run_status" CHECK ("network"."storage_runs"."status" in ('running', 'done', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "network"."change_log" DROP CONSTRAINT "change_kind";--> statement-breakpoint
ALTER TABLE "network"."storage_runs" ADD CONSTRAINT "storage_runs_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "storage_runs_one_running" ON "network"."storage_runs" USING btree ("job") WHERE "network"."storage_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "storage_runs_job_started" ON "network"."storage_runs" USING btree ("job","started_at");--> statement-breakpoint
ALTER TABLE "network"."change_log" ADD CONSTRAINT "change_kind" CHECK ("network"."change_log"."kind" in ('rule', 'role', 'signer', 'storage'));