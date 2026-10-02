CREATE TABLE "broadcast"."day_template_dates" (
	"station_id" uuid NOT NULL,
	"date" date NOT NULL,
	"template_id" uuid NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"edited_at" timestamp with time zone,
	"entries" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "day_template_dates_station_id_date_pk" PRIMARY KEY("station_id","date")
);
--> statement-breakpoint
CREATE TABLE "broadcast"."day_template_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"start_minute" integer NOT NULL,
	"length_ms" bigint NOT NULL,
	"kind" text NOT NULL,
	"code" "broadcast"."log_code" NOT NULL,
	"asset_id" uuid,
	"program_id" uuid,
	"carriage_agreement_id" uuid,
	"live_source_id" uuid,
	"local_note" text,
	"episode_title" text,
	"episode_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_entry_start_minute" CHECK ("broadcast"."day_template_entries"."start_minute" >= 0 and "broadcast"."day_template_entries"."start_minute" < 1440),
	CONSTRAINT "template_entry_length" CHECK ("broadcast"."day_template_entries"."length_ms" > 0)
);
--> statement-breakpoint
CREATE TABLE "broadcast"."off_air_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"days" smallint[] NOT NULL,
	"sign_off_at" time NOT NULL,
	"back_at" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broadcast"."log_entries" ADD COLUMN "template_date" date;--> statement-breakpoint
ALTER TABLE "broadcast"."repeat_groups" ADD COLUMN "template" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcast"."repeat_groups" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "broadcast"."repeat_groups" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "broadcast"."repeat_groups" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "broadcast"."day_template_dates" ADD CONSTRAINT "day_template_dates_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."day_template_dates" ADD CONSTRAINT "day_template_dates_template_id_repeat_groups_id_fk" FOREIGN KEY ("template_id") REFERENCES "broadcast"."repeat_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."day_template_entries" ADD CONSTRAINT "day_template_entries_template_id_repeat_groups_id_fk" FOREIGN KEY ("template_id") REFERENCES "broadcast"."repeat_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."day_template_entries" ADD CONSTRAINT "day_template_entries_asset_id_rights_confirmations_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "broadcast"."rights_confirmations"("asset_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."day_template_entries" ADD CONSTRAINT "day_template_entries_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "broadcast"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."day_template_entries" ADD CONSTRAINT "day_template_entries_carriage_agreement_id_agreements_id_fk" FOREIGN KEY ("carriage_agreement_id") REFERENCES "catalog"."agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."day_template_entries" ADD CONSTRAINT "day_template_entries_live_source_id_live_sources_id_fk" FOREIGN KEY ("live_source_id") REFERENCES "broadcast"."live_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."off_air_hours" ADD CONSTRAINT "off_air_hours_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "day_template_dates_template" ON "broadcast"."day_template_dates" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "day_template_entries_template" ON "broadcast"."day_template_entries" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "off_air_hours_station" ON "broadcast"."off_air_hours" USING btree ("station_id");