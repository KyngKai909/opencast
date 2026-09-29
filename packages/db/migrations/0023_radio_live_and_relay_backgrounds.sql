CREATE TABLE "broadcast"."relay_backgrounds" (
	"station_id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"content_id" text NOT NULL,
	"file_name" text,
	"status" text DEFAULT 'preparing' NOT NULL,
	"error" text,
	"loop_key" text,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"frames" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broadcast"."relay_backgrounds" ADD CONSTRAINT "relay_backgrounds_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;