CREATE TABLE "broadcast"."content_preview_needs" (
	"cid" text NOT NULL,
	"reason" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_preview_needs_cid_reason_subject_id_pk" PRIMARY KEY("cid","reason","subject_id")
);
--> statement-breakpoint
CREATE TABLE "broadcast"."content_previews" (
	"cid" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast"."content_refs" (
	"cid" text NOT NULL,
	"owner" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_refs_cid_owner_owner_id_pk" PRIMARY KEY("cid","owner","owner_id")
);
--> statement-breakpoint
CREATE TABLE "broadcast"."contents" (
	"cid" text PRIMARY KEY NOT NULL,
	"bytes" bigint NOT NULL,
	"content_type" text NOT NULL,
	"storage_class" text NOT NULL,
	"store" text NOT NULL,
	"locked_at" timestamp with time zone,
	"lock_reason" text,
	"deleted_at" timestamp with time zone,
	"deleted_reason" text,
	"ipfs_cid" text,
	"ipfs_pin_id" text,
	"ipfs_reason" text,
	"ipfs_published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cid_format" CHECK ("broadcast"."contents"."cid" ~ '^b[a-z2-7]{58}$'),
	CONSTRAINT "deleted_has_reason" CHECK (("broadcast"."contents"."deleted_at" is null) = ("broadcast"."contents"."deleted_reason" is null)),
	CONSTRAINT "ipfs_has_reason" CHECK (("broadcast"."contents"."ipfs_cid" is null) = ("broadcast"."contents"."ipfs_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "broadcast"."asset_files" ALTER COLUMN "storage" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcast"."asset_files" ALTER COLUMN "location" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "spots"."order_files" ALTER COLUMN "location" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "spots"."spot_files" ALTER COLUMN "location" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcast"."asset_files" ADD COLUMN "content_id" text;--> statement-breakpoint
ALTER TABLE "broadcast"."asset_files" ADD COLUMN "original_content_id" text;--> statement-breakpoint
ALTER TABLE "spots"."order_files" ADD COLUMN "content_id" text;--> statement-breakpoint
ALTER TABLE "spots"."spot_files" ADD COLUMN "content_id" text;--> statement-breakpoint
ALTER TABLE "broadcast"."content_preview_needs" ADD CONSTRAINT "content_preview_needs_cid_contents_cid_fk" FOREIGN KEY ("cid") REFERENCES "broadcast"."contents"("cid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."content_previews" ADD CONSTRAINT "content_previews_cid_contents_cid_fk" FOREIGN KEY ("cid") REFERENCES "broadcast"."contents"("cid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."content_refs" ADD CONSTRAINT "content_refs_cid_contents_cid_fk" FOREIGN KEY ("cid") REFERENCES "broadcast"."contents"("cid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_refs_owner" ON "broadcast"."content_refs" USING btree ("owner","owner_id");--> statement-breakpoint
ALTER TABLE "broadcast"."asset_files" ADD CONSTRAINT "asset_files_content_id_contents_cid_fk" FOREIGN KEY ("content_id") REFERENCES "broadcast"."contents"("cid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."asset_files" ADD CONSTRAINT "asset_files_original_content_id_contents_cid_fk" FOREIGN KEY ("original_content_id") REFERENCES "broadcast"."contents"("cid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."order_files" ADD CONSTRAINT "order_files_content_id_contents_cid_fk" FOREIGN KEY ("content_id") REFERENCES "broadcast"."contents"("cid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."spot_files" ADD CONSTRAINT "spot_files_content_id_contents_cid_fk" FOREIGN KEY ("content_id") REFERENCES "broadcast"."contents"("cid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."asset_files" ADD CONSTRAINT "asset_file_has_content" CHECK ("broadcast"."asset_files"."content_id" is not null or "broadcast"."asset_files"."location" is not null);--> statement-breakpoint
ALTER TABLE "spots"."order_files" ADD CONSTRAINT "order_file_has_content" CHECK ("spots"."order_files"."content_id" is not null or "spots"."order_files"."location" is not null);--> statement-breakpoint
ALTER TABLE "spots"."spot_files" ADD CONSTRAINT "spot_file_has_content" CHECK ("spots"."spot_files"."content_id" is not null or "spots"."spot_files"."location" is not null);--> statement-breakpoint
-- Content leaves storage only when nothing points at it and no claim holds it; a takedown is the one exception.
CREATE FUNCTION broadcast.content_delete_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND NEW.deleted_reason = 'unreferenced' THEN
    IF NEW.locked_at IS NOT NULL THEN
      RAISE EXCEPTION 'content % is locked by a rights claim', NEW.cid USING ERRCODE = 'check_violation', CONSTRAINT = 'content_locked';
    END IF;
    IF EXISTS (SELECT 1 FROM broadcast.content_refs r WHERE r.cid = NEW.cid) THEN
      RAISE EXCEPTION 'content % is still referenced', NEW.cid USING ERRCODE = 'check_violation', CONSTRAINT = 'content_referenced';
    END IF;
  END IF;
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL AND OLD.deleted_reason = 'takedown' THEN
    RAISE EXCEPTION 'content % was taken down', NEW.cid USING ERRCODE = 'check_violation', CONSTRAINT = 'content_taken_down';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER content_delete_guard BEFORE UPDATE ON broadcast.contents FOR EACH ROW EXECUTE FUNCTION broadcast.content_delete_guard();
