CREATE SCHEMA "accounts";
--> statement-breakpoint
CREATE SCHEMA "audience";
--> statement-breakpoint
CREATE SCHEMA "broadcast";
--> statement-breakpoint
CREATE SCHEMA "catalog";
--> statement-breakpoint
CREATE SCHEMA "ledger";
--> statement-breakpoint
CREATE SCHEMA "network";
--> statement-breakpoint
CREATE SCHEMA "spots";
--> statement-breakpoint
CREATE SCHEMA "trust";
--> statement-breakpoint
CREATE TYPE "broadcast"."band" AS ENUM('tv', 'radio');--> statement-breakpoint
CREATE TYPE "broadcast"."log_code" AS ENUM('PGM', 'SPT', 'UND', 'BMP', 'SID', 'OPEN');--> statement-breakpoint
CREATE TYPE "broadcast"."rights_basis" AS ENUM('made_it', 'owner_permission', 'public_domain', 'permission_record', 'licence_record');--> statement-breakpoint
CREATE TYPE "accounts"."advertiser_role" AS ENUM('owner', 'manager', 'viewer');--> statement-breakpoint
CREATE TYPE "accounts"."station_role" AS ENUM('owner', 'operator', 'host');--> statement-breakpoint
CREATE TYPE "broadcast"."asset_source" AS ENUM('upload', 'link', 'creator_work', 'library');--> statement-breakpoint
CREATE TYPE "broadcast"."station_kind" AS ENUM('station', 'studio', 'claimable', 'listed', 'catalog');--> statement-breakpoint
CREATE TYPE "broadcast"."station_status" AS ENUM('setting_up', 'on_air', 'off_air', 'signed_off');--> statement-breakpoint
CREATE TYPE "catalog"."carriage_term" AS ENUM('barter', 'cash', 'cash_plus_barter', 'free');--> statement-breakpoint
CREATE TYPE "spots"."order_status" AS ENUM('asked', 'quoted', 'passed', 'accepted', 'delivered', 'changes_requested', 'approved', 'disputed', 'cancelled');--> statement-breakpoint
CREATE TYPE "spots"."spot_status" AS ENUM('draft', 'in_review', 'listed', 'paused', 'ended');--> statement-breakpoint
CREATE TYPE "ledger"."account_kind" AS ENUM('advertiser_available', 'holds', 'station_earnings', 'escrow_owed', 'escrow', 'creator', 'creator_fund', 'opencast_share', 'pool', 'opencast_absorbed', 'card_fees', 'external');--> statement-breakpoint
CREATE TYPE "ledger"."entry_kind" AS ENUM('deposit', 'card_fee', 'withdrawal', 'hold', 'settle', 'release', 'absorb_gap', 'carriage_fee', 'barter_split', 'opencast_share', 'pool', 'pledge', 'payout', 'escrow_deposit', 'escrow_claim', 'escrow_stop', 'escrow_unclaimed', 'reversal');--> statement-breakpoint
CREATE TYPE "trust"."claim_status" AS ENUM('open', 'answered', 'upheld', 'removed', 'expired', 'withdrawn', 'restored');--> statement-breakpoint
CREATE TYPE "network"."creator_stage" AS ENUM('found', 'already_licensed', 'asked', 'said_yes', 'setting_up', 'on_air', 'claimed', 'declined', 'no_answer');--> statement-breakpoint
CREATE TYPE "network"."licence" AS ENUM('cc0', 'cc_by', 'cc_by_sa', 'cc_by_nd', 'cc_by_nc', 'cc_by_nc_sa', 'cc_by_nc_nd', 'other');--> statement-breakpoint
CREATE TYPE "network"."waitlist_role" AS ENUM('viewer', 'station', 'producer', 'business');--> statement-breakpoint
CREATE TYPE "audience"."platform" AS ENUM('phone', 'cast', 'web', 'tv_app');--> statement-breakpoint
CREATE TABLE "accounts"."advertiser_memberships" (
	"advertiser_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "accounts"."advertiser_role" NOT NULL,
	"note" text,
	"last_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advertiser_memberships_advertiser_id_user_id_pk" PRIMARY KEY("advertiser_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "accounts"."devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"paired_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"signed_out_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts"."identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts"."invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid,
	"advertiser_id" uuid,
	"email" text,
	"phone" text,
	"role" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_one_target" CHECK (("accounts"."invites"."station_id" is null) <> ("accounts"."invites"."advertiser_id" is null)),
	CONSTRAINT "invite_has_contact" CHECK ("accounts"."invites"."email" is not null or "accounts"."invites"."phone" is not null),
	CONSTRAINT "invite_role_fits" CHECK (("accounts"."invites"."station_id" is not null and "accounts"."invites"."role" in ('operator', 'host'))
       or ("accounts"."invites"."advertiser_id" is not null and "accounts"."invites"."role" in ('manager', 'viewer')))
);
--> statement-breakpoint
CREATE TABLE "accounts"."notification_prefs" (
	"user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"scope_id" uuid,
	"prefs" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts"."preset_key_use" (
	"user_id" uuid NOT NULL,
	"key" smallint NOT NULL,
	"day" date NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "preset_key_use_user_id_key_day_pk" PRIMARY KEY("user_id","key","day")
);
--> statement-breakpoint
CREATE TABLE "accounts"."presets" (
	"user_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"key" smallint,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "presets_user_id_station_id_pk" PRIMARY KEY("user_id","station_id"),
	CONSTRAINT "preset_key_range" CHECK ("accounts"."presets"."key" is null or "accounts"."presets"."key" between 1 and 6)
);
--> statement-breakpoint
CREATE TABLE "accounts"."reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"log_entry_id" uuid,
	"listed_airing_id" uuid,
	"switch_me_over" boolean DEFAULT false NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_one_target" CHECK (("accounts"."reminders"."log_entry_id" is null) <> ("accounts"."reminders"."listed_airing_id" is null))
);
--> statement-breakpoint
CREATE TABLE "accounts"."station_memberships" (
	"station_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "accounts"."station_role" NOT NULL,
	"note" text,
	"last_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "station_memberships_station_id_user_id_pk" PRIMARY KEY("station_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "accounts"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"privy_did" text,
	"display_name" text,
	"email" text,
	"market_id" uuid,
	"is_admin" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "users_privy_did_unique" UNIQUE("privy_did")
);
--> statement-breakpoint
CREATE TABLE "broadcast"."as_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"code" "broadcast"."log_code" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"log_entry_id" uuid,
	"break_id" uuid,
	"asset_id" uuid,
	"program_id" uuid,
	"airing_id" uuid,
	"carriage_agreement_id" uuid,
	"live_source_id" uuid,
	"reason" text NOT NULL,
	"proof_frame_url" text,
	"proof_frame_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "as_run_ends_after_start" CHECK ("broadcast"."as_run"."ended_at" >= "broadcast"."as_run"."started_at")
);
--> statement-breakpoint
CREATE TABLE "broadcast"."asset_break_points" (
	"asset_id" uuid NOT NULL,
	"offset_ms" bigint NOT NULL,
	CONSTRAINT "asset_break_points_asset_id_offset_ms_pk" PRIMARY KEY("asset_id","offset_ms")
);
--> statement-breakpoint
CREATE TABLE "broadcast"."asset_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"storage" text NOT NULL,
	"location" text NOT NULL,
	"r2_key" text,
	"ipfs_cid" text,
	"compression" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast"."asset_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_folder_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast"."assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"program_id" uuid,
	"folder_id" uuid,
	"title" text NOT NULL,
	"episode_number" integer,
	"episode_description" text,
	"code" "broadcast"."log_code" NOT NULL,
	"source" "broadcast"."asset_source" NOT NULL,
	"source_url" text,
	"creator_work_id" uuid,
	"media_kind" text NOT NULL,
	"duration_ms" bigint,
	"status" text DEFAULT 'preparing' NOT NULL,
	"prep_progress" smallint,
	"width_px" integer,
	"height_px" integer,
	"loudness_lufs" real,
	"captions" text DEFAULT 'none' NOT NULL,
	"original_filename" text,
	"legacy_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_legacy_id_unique" UNIQUE("legacy_id"),
	CONSTRAINT "link_has_url" CHECK ("broadcast"."assets"."source" <> 'link' or "broadcast"."assets"."source_url" is not null),
	CONSTRAINT "creator_work_has_work" CHECK ("broadcast"."assets"."source" <> 'creator_work' or "broadcast"."assets"."creator_work_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "broadcast"."blocked_categories" (
	"station_id" uuid NOT NULL,
	"category" text NOT NULL,
	CONSTRAINT "blocked_categories_station_id_category_pk" PRIMARY KEY("station_id","category")
);
--> statement-breakpoint
CREATE TABLE "broadcast"."break_rules" (
	"station_id" uuid PRIMARY KEY NOT NULL,
	"mode" text DEFAULT 'after_every_program' NOT NULL,
	"every_minutes" integer,
	"length_ms" bigint DEFAULT 120000 NOT NULL,
	"spot_ms_per_hour" bigint DEFAULT 180000 NOT NULL,
	"same_spot_per_hour" smallint DEFAULT 2 NOT NULL,
	"fill_order" jsonb DEFAULT '["SPT","UND","BMP","SID"]'::jsonb NOT NULL,
	"open_time_to" text DEFAULT 'spot_market' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "every_minutes_set" CHECK ("broadcast"."break_rules"."mode" <> 'every_n_minutes' or "broadcast"."break_rules"."every_minutes" > 0),
	CONSTRAINT "sid_last" CHECK ("broadcast"."break_rules"."fill_order"->>(jsonb_array_length("broadcast"."break_rules"."fill_order") - 1) = 'SID')
);
--> statement-breakpoint
CREATE TABLE "broadcast"."breaks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"length_ms" bigint NOT NULL,
	"log_entry_id" uuid,
	"origin" text NOT NULL,
	"producer_share_ms" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast"."channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"band" "broadcast"."band" NOT NULL,
	"tenths" integer NOT NULL,
	"is_primary" boolean DEFAULT true NOT NULL,
	"carries_station_id" uuid,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_number_in_band" CHECK (("broadcast"."channels"."band" = 'tv' and "broadcast"."channels"."tenths" between 21 and 699 and "broadcast"."channels"."tenths" % 10 <> 0)
       or ("broadcast"."channels"."band" = 'radio' and "broadcast"."channels"."tenths" between 881 and 1079 and "broadcast"."channels"."tenths" % 2 = 1))
);
--> statement-breakpoint
CREATE TABLE "broadcast"."commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"action" text NOT NULL,
	"issued_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "broadcast"."dead_air_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"gap_starts_at" timestamp with time zone NOT NULL,
	"gap_ends_at" timestamp with time zone NOT NULL,
	"warned_30_at" timestamp with time zone,
	"warned_12_at" timestamp with time zone,
	"auto_filled_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast"."host_assignments" (
	"station_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	CONSTRAINT "host_assignments_user_id_program_id_pk" PRIMARY KEY("user_id","program_id")
);
--> statement-breakpoint
CREATE TABLE "broadcast"."import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"requested_urls" jsonb NOT NULL,
	"expand_playlists" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "broadcast"."live_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"livepeer_stream_id" text,
	"stream_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast"."livepeer_config" (
	"station_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"stream_id" text,
	"stream_key" text,
	"playback_id" text,
	"playback_url" text,
	"ingest_url" text,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast"."log_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"code" "broadcast"."log_code" NOT NULL,
	"asset_id" uuid,
	"program_id" uuid,
	"carriage_agreement_id" uuid,
	"live_source_id" uuid,
	"repeat_group_id" uuid,
	"local_note" text,
	"episode_title" text,
	"episode_description" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ends_after_start" CHECK ("broadcast"."log_entries"."ends_at" > "broadcast"."log_entries"."starts_at"),
	CONSTRAINT "program_has_asset" CHECK ("broadcast"."log_entries"."kind" <> 'program' or "broadcast"."log_entries"."asset_id" is not null),
	CONSTRAINT "live_has_source" CHECK ("broadcast"."log_entries"."kind" <> 'live' or "broadcast"."log_entries"."live_source_id" is not null),
	CONSTRAINT "episode_description_length" CHECK (char_length("broadcast"."log_entries"."episode_description") <= 160)
);
--> statement-breakpoint
CREATE TABLE "broadcast"."playout_state" (
	"station_id" uuid PRIMARY KEY NOT NULL,
	"on_air" boolean DEFAULT false NOT NULL,
	"current_log_entry_id" uuid,
	"current_asset_id" uuid,
	"current_started_at" timestamp with time zone,
	"current_offset_ms" bigint DEFAULT 0 NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast"."programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text,
	"advisory" text DEFAULT 'none' NOT NULL,
	"is_live" boolean DEFAULT false NOT NULL,
	"rights_note" text,
	"attribution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "description_length" CHECK (char_length("broadcast"."programs"."description") <= 160)
);
--> statement-breakpoint
CREATE TABLE "broadcast"."repeat_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"pattern" text NOT NULL,
	"weekday" smallint,
	"start_time" time NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast"."rights_confirmations" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"basis" "broadcast"."rights_basis" NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"permission_record_id" uuid,
	"licence_record_id" uuid,
	CONSTRAINT "permission_record_basis" CHECK ("broadcast"."rights_confirmations"."basis" <> 'permission_record' or "broadcast"."rights_confirmations"."permission_record_id" is not null),
	CONSTRAINT "licence_record_basis" CHECK ("broadcast"."rights_confirmations"."basis" <> 'licence_record' or "broadcast"."rights_confirmations"."licence_record_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "broadcast"."schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"enabled" boolean DEFAULT true NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast"."speakers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast"."stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "broadcast"."station_kind" DEFAULT 'station' NOT NULL,
	"call_sign" text,
	"handle" text,
	"name" text NOT NULL,
	"description" text,
	"colour" text,
	"home_city" text,
	"studio_latitude" real,
	"studio_longitude" real,
	"category" text,
	"status" "broadcast"."station_status" DEFAULT 'setting_up' NOT NULL,
	"first_signed_on_at" timestamp with time zone,
	"signed_off_at" timestamp with time zone,
	"escrow_id" serial NOT NULL,
	"bug_mode" text DEFAULT 'call_sign_and_channel' NOT NULL,
	"bug_position" text DEFAULT 'bottom_right' NOT NULL,
	"bug_opacity" smallint DEFAULT 78 NOT NULL,
	"logo_url" text,
	"legal_name" text,
	"legal_contact" text,
	"pledges_tax_deductible" boolean,
	"member_credit_style" text DEFAULT 'text' NOT NULL,
	"legacy_owner_wallet" text,
	"legacy_slug" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stations_escrow_id_unique" UNIQUE("escrow_id"),
	CONSTRAINT "call_sign_format" CHECK ("broadcast"."stations"."call_sign" is null or "broadcast"."stations"."call_sign" ~ '^[A-Z]{3,5}$'),
	CONSTRAINT "colour_contrast" CHECK ("broadcast"."stations"."colour" is null or public.contrast_on_white("broadcast"."stations"."colour") >= 4.5),
	CONSTRAINT "studio_never_signs_on" CHECK ("broadcast"."stations"."kind" <> 'studio' or "broadcast"."stations"."first_signed_on_at" is null),
	CONSTRAINT "signed_on_has_call_sign" CHECK ("broadcast"."stations"."first_signed_on_at" is null or "broadcast"."stations"."call_sign" is not null),
	CONSTRAINT "bug_opacity_range" CHECK ("broadcast"."stations"."bug_opacity" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "broadcast"."translators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"service" text NOT NULL,
	"name" text NOT NULL,
	"rtmp_url" text NOT NULL,
	"stream_key" text NOT NULL,
	"break_handling" text DEFAULT 'air_spots' NOT NULL,
	"prerecorded_label" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog"."agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"maker_station_id" uuid NOT NULL,
	"carrier_station_id" uuid NOT NULL,
	"term" "catalog"."carriage_term" NOT NULL,
	"cash_price_micros" bigint,
	"cash_price_unit" text,
	"barter_maker_ms_per_hour" bigint,
	"airings_per_episode" smallint,
	"window_days" smallint DEFAULT 7 NOT NULL,
	"live_only" boolean DEFAULT false NOT NULL,
	"notice_days" smallint DEFAULT 7 NOT NULL,
	"audio_only" boolean DEFAULT false NOT NULL,
	"subchannel_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"end_notice_given_at" timestamp with time zone,
	"end_notice_given_by" text,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agreements_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "maker_is_not_carrier" CHECK ("catalog"."agreements"."maker_station_id" <> "catalog"."agreements"."carrier_station_id")
);
--> statement-breakpoint
CREATE TABLE "catalog"."offer_previews" (
	"offer_id" uuid NOT NULL,
	"day" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "offer_previews_offer_id_day_pk" PRIMARY KEY("offer_id","day")
);
--> statement-breakpoint
CREATE TABLE "catalog"."offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"maker_station_id" uuid NOT NULL,
	"terms_offered" jsonb NOT NULL,
	"cash_price_micros" bigint,
	"cash_price_unit" text,
	"barter_maker_ms_per_hour" bigint,
	"airings_per_episode" smallint,
	"window_days" smallint DEFAULT 7 NOT NULL,
	"live_only" boolean DEFAULT false NOT NULL,
	"notice_days" smallint DEFAULT 7 NOT NULL,
	"approval" text DEFAULT 'i_approve' NOT NULL,
	"radio_band_allowed" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'offered' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "airings_per_episode_range" CHECK ("catalog"."offers"."airings_per_episode" is null or "catalog"."offers"."airings_per_episode" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "catalog"."requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"carrier_station_id" uuid NOT NULL,
	"term" "catalog"."carriage_term" NOT NULL,
	"slots" jsonb NOT NULL,
	"starts_on" date NOT NULL,
	"audio_only" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'asked' NOT NULL,
	"decline_reason" text,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spots"."advertiser_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text,
	"street_address" text,
	"city" text NOT NULL,
	"latitude" real NOT NULL,
	"longitude" real NOT NULL,
	"radius_miles" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_area_radius" CHECK ("spots"."advertiser_locations"."kind" <> 'service_area' or "spots"."advertiser_locations"."radius_miles" > 0)
);
--> statement-breakpoint
CREATE TABLE "spots"."advertiser_markets" (
	"advertiser_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	CONSTRAINT "advertiser_markets_advertiser_id_market_id_pk" PRIMARY KEY("advertiser_id","market_id")
);
--> statement-breakpoint
CREATE TABLE "spots"."advertisers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"about" text,
	"website" text,
	"logo_url" text,
	"customers_where" text NOT NULL,
	"warn_days" jsonb DEFAULT '[3,1]'::jsonb NOT NULL,
	"auto_top_up" boolean DEFAULT false NOT NULL,
	"auto_top_up_micros" bigint,
	"auto_top_up_below_days" smallint DEFAULT 3 NOT NULL,
	"legal_name" text,
	"ein_last4" text,
	"receipts_email" text,
	"is_house" boolean DEFAULT false NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spots"."airings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spot_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"break_id" uuid NOT NULL,
	"hold_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"rate_kind" text NOT NULL,
	"rate_micros" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "airings_hold_id_unique" UNIQUE("hold_id")
);
--> statement-breakpoint
CREATE TABLE "spots"."code_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"airing_id" uuid,
	"station_id" uuid,
	"customer_ref" text,
	"counts_as_customer" boolean DEFAULT false NOT NULL,
	"marked_by" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spots"."codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spot_id" uuid NOT NULL,
	"code" text NOT NULL,
	"offer" text NOT NULL,
	"window_days" smallint DEFAULT 7 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "codes_spot_id_unique" UNIQUE("spot_id")
);
--> statement-breakpoint
CREATE TABLE "spots"."order_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"role" text NOT NULL,
	"version" integer,
	"location" text NOT NULL,
	"filename" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spots"."order_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"delivery_file_id" uuid,
	"timecode_ms" bigint,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"makers_mistake" boolean DEFAULT false NOT NULL,
	"round" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spots"."production_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"maker_station_id" uuid NOT NULL,
	"title" text NOT NULL,
	"length_sec" smallint NOT NULL,
	"about" text NOT NULL,
	"must_say" text,
	"needed_by" date NOT NULL,
	"status" "spots"."order_status" DEFAULT 'asked' NOT NULL,
	"quote_micros" bigint,
	"deliver_by" date,
	"rounds_included" smallint,
	"voiced_by" text,
	"hold_id" uuid,
	"delivered_at" timestamp with time zone,
	"auto_approve_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"spot_id" uuid,
	"tell_maker_when_listed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_orders_hold_id_unique" UNIQUE("hold_id")
);
--> statement-breakpoint
CREATE TABLE "spots"."rotation_spots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rotation_id" uuid NOT NULL,
	"spot_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "spots"."rotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"kind" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spots"."sponsorship_months" (
	"sponsorship_id" uuid NOT NULL,
	"month" date NOT NULL,
	"hold_id" uuid NOT NULL,
	CONSTRAINT "sponsorship_months_sponsorship_id_month_pk" PRIMARY KEY("sponsorship_id","month"),
	CONSTRAINT "sponsorship_months_hold_id_unique" UNIQUE("hold_id")
);
--> statement-breakpoint
CREATE TABLE "spots"."sponsorship_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"program_id" uuid,
	"min_monthly_micros" bigint NOT NULL,
	"max_sponsors" smallint NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "sponsorship_settings_scope" UNIQUE NULLS NOT DISTINCT("station_id","program_id")
);
--> statement-breakpoint
CREATE TABLE "spots"."sponsorships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"program_id" uuid,
	"monthly_micros" bigint NOT NULL,
	"credit_text" text NOT NULL,
	"credit_checked_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"decline_reason" text,
	"starts_on" date NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sponsorship_amount_positive" CHECK ("spots"."sponsorships"."monthly_micros" > 0)
);
--> statement-breakpoint
CREATE TABLE "spots"."spot_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spot_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"original_filename" text,
	"location" text NOT NULL,
	"duration_ms" bigint NOT NULL,
	"width_px" integer,
	"height_px" integer,
	"loudness_lufs" real,
	"captions" jsonb,
	"scaled_to_fit" boolean DEFAULT false NOT NULL,
	"current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spots"."spots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"title" text NOT NULL,
	"length_sec" smallint NOT NULL,
	"category" text NOT NULL,
	"status" "spots"."spot_status" DEFAULT 'draft' NOT NULL,
	"pause_reason" text,
	"paused_at" timestamp with time zone,
	"rate_kind" text NOT NULL,
	"rate_micros" bigint NOT NULL,
	"per_airing_max_micros" bigint,
	"total_budget_micros" bigint NOT NULL,
	"daily_cap_micros" bigint,
	"starts_on" date,
	"ends_on" date,
	"listed_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"production_order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spot_length" CHECK ("spots"."spots"."length_sec" in (15, 30, 60)),
	CONSTRAINT "rate_positive" CHECK ("spots"."spots"."rate_micros" > 0),
	CONSTRAINT "budget_positive" CHECK ("spots"."spots"."total_budget_micros" > 0),
	CONSTRAINT "daily_cap_positive" CHECK ("spots"."spots"."daily_cap_micros" is null or "spots"."spots"."daily_cap_micros" > 0),
	CONSTRAINT "paused_has_reason" CHECK (("spots"."spots"."status" = 'paused') = ("spots"."spots"."pause_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "spots"."targeting" (
	"spot_id" uuid PRIMARY KEY NOT NULL,
	"within_miles" real,
	"location_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"station_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dayparts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"excluded_station_ids" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spots"."upload_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spot_file_id" uuid NOT NULL,
	"check" text NOT NULL,
	"result" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger"."accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "ledger"."account_kind" NOT NULL,
	"advertiser_id" uuid,
	"station_id" uuid,
	"user_id" uuid,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_owner" UNIQUE NULLS NOT DISTINCT("kind","advertiser_id","station_id","user_id","label"),
	CONSTRAINT "account_owner_fits_kind" CHECK (case "ledger"."accounts"."kind"
        when 'advertiser_available' then "ledger"."accounts"."advertiser_id" is not null and "ledger"."accounts"."station_id" is null
        when 'station_earnings' then "ledger"."accounts"."station_id" is not null and "ledger"."accounts"."advertiser_id" is null
        when 'escrow_owed' then "ledger"."accounts"."station_id" is not null and "ledger"."accounts"."advertiser_id" is null
        when 'escrow' then "ledger"."accounts"."station_id" is not null and "ledger"."accounts"."advertiser_id" is null
        when 'creator' then "ledger"."accounts"."station_id" is not null and "ledger"."accounts"."user_id" is not null
        else "ledger"."accounts"."advertiser_id" is null and "ledger"."accounts"."station_id" is null
      end)
);
--> statement-breakpoint
CREATE TABLE "ledger"."deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"funding_source_id" uuid,
	"amount_micros" bigint NOT NULL,
	"fee_micros" bigint DEFAULT 0 NOT NULL,
	"provider_ref" text,
	"expected_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger"."entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "ledger"."entry_kind" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reverses_entry_id" uuid,
	"source_type" text,
	"source_id" uuid,
	"idempotency_key" text,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entries_reverses_entry_id_unique" UNIQUE("reverses_entry_id"),
	CONSTRAINT "entries_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "reversal_references_entry" CHECK (("ledger"."entries"."kind" = 'reversal') = ("ledger"."entries"."reverses_entry_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "ledger"."escrow_deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_address" text NOT NULL,
	"tx_hash" text,
	"confirmed_at" timestamp with time zone,
	"entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger"."funding_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"provider_ref" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger"."holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"spot_id" uuid,
	"station_id" uuid,
	"sponsorship_id" uuid,
	"production_order_id" uuid,
	"amount_micros" bigint NOT NULL,
	"is_estimate" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hold_amount_positive" CHECK ("ledger"."holds"."amount_micros" > 0),
	CONSTRAINT "hold_purpose_fits" CHECK (case "ledger"."holds"."purpose"
        when 'airing' then "ledger"."holds"."spot_id" is not null and "ledger"."holds"."station_id" is not null
        when 'sponsorship_month' then "ledger"."holds"."sponsorship_id" is not null
        when 'production_order' then "ledger"."holds"."production_order_id" is not null
      end)
);
--> statement-breakpoint
CREATE TABLE "ledger"."payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_micros" bigint NOT NULL,
	"destination" text NOT NULL,
	"scheduled_for" date NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"provider_ref" text,
	"entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger"."pledges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"cadence" text NOT NULL,
	"amount_micros" bigint NOT NULL,
	"credit_on_air" boolean DEFAULT false NOT NULL,
	"stripe_ref" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_after" date
);
--> statement-breakpoint
CREATE TABLE "ledger"."postings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_micros" bigint NOT NULL,
	"hold_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posting_nonzero" CHECK ("ledger"."postings"."amount_micros" <> 0)
);
--> statement-breakpoint
CREATE TABLE "ledger"."revenue_config" (
	"effective_from" date PRIMARY KEY NOT NULL,
	"opencast_spot_share_bps" integer DEFAULT 0 NOT NULL,
	"opencast_pledge_share_bps" integer DEFAULT 0 NOT NULL,
	"opencast_production_share_bps" integer DEFAULT 0 NOT NULL,
	"pool_share_bps" integer DEFAULT 0 NOT NULL,
	"pool_base_bps" integer DEFAULT 0 NOT NULL,
	"pool_watch_time_bps" integer DEFAULT 0 NOT NULL,
	"pool_fund_bps" integer DEFAULT 0 NOT NULL,
	"payout_schedule" text DEFAULT 'weekly' NOT NULL,
	"unclaimed_period_days" integer DEFAULT 1095 NOT NULL,
	"offer_window_days" smallint DEFAULT 7 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger"."statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"period" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"lines" jsonb NOT NULL,
	"opening_micros" bigint NOT NULL,
	"closing_micros" bigint NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trust"."answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"basis" "broadcast"."rights_basis" NOT NULL,
	"note" text,
	"attachment_url" text,
	"attested_by" uuid NOT NULL,
	"legal_name" text NOT NULL,
	"legal_contact" text NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimant_reply_due_at" timestamp with time zone NOT NULL,
	CONSTRAINT "answers_claim_id_unique" UNIQUE("claim_id")
);
--> statement-breakpoint
CREATE TABLE "trust"."claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"claimant_name" text NOT NULL,
	"claimant_role" text,
	"claimant_contact" text NOT NULL,
	"work_kind" text,
	"claim_text" text NOT NULL,
	"range_start_ms" bigint,
	"range_end_ms" bigint,
	"sworn_statement" boolean NOT NULL,
	"status" "trust"."claim_status" DEFAULT 'open' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answer_due_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "trust"."policy" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"upheld_per_year_to_pause_offers" integer DEFAULT 3 NOT NULL,
	"answer_days" integer DEFAULT 14 NOT NULL,
	"claimant_reply_business_days" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trust"."takedowns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"pulled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"airings_replaced" integer DEFAULT 0 NOT NULL,
	"replaced_with_asset_id" uuid,
	"restored_at" timestamp with time zone,
	"carrier_notified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "network"."call_sign_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_sign" text NOT NULL,
	"signup_id" uuid,
	"market_id" uuid,
	"station_id" uuid,
	"reason" text NOT NULL,
	"held_until" timestamp with time zone,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_sign_format" CHECK ("network"."call_sign_reservations"."call_sign" ~ '^[A-Z]{3,5}$')
);
--> statement-breakpoint
CREATE TABLE "network"."channel_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"band" "broadcast"."band" NOT NULL,
	"tenths" integer NOT NULL,
	"reservation_id" uuid NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network"."creator_works" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"title" text NOT NULL,
	"duration_ms" bigint,
	"source_url" text NOT NULL,
	"group_label" text,
	"left_out_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network"."creators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid,
	"display_name" text NOT NULL,
	"person_name" text,
	"description" text,
	"source_platform" text NOT NULL,
	"source_url" text NOT NULL,
	"contact_email" text,
	"stage" "network"."creator_stage" DEFAULT 'found' NOT NULL,
	"proposed_band" "broadcast"."band",
	"proposed_tenths" integer,
	"next_action" text,
	"next_action_due" date,
	"reminded_at" timestamp with time zone,
	"do_not_ask" boolean DEFAULT false NOT NULL,
	"station_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network"."handovers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"claimant_user_id" uuid,
	"source_account_verified_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"payable_after" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network"."licence_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_work_id" uuid NOT NULL,
	"licence" "network"."licence" NOT NULL,
	"licence_url" text NOT NULL,
	"attribution" text NOT NULL,
	"allows_carriage" boolean GENERATED ALWAYS AS (licence in ('cc0', 'cc_by', 'cc_by_sa')) STORED NOT NULL,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network"."listed_airings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listed_source_id" uuid NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network"."listed_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"stream_url" text NOT NULL,
	"embed_terms" text NOT NULL,
	"calendar_url" text,
	"calendar_sync" text DEFAULT 'not_set' NOT NULL,
	"listing_state" text DEFAULT 'not_listed' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listed_sources_station_id_unique" UNIQUE("station_id")
);
--> statement-breakpoint
CREATE TABLE "network"."markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'America/Los_Angeles' NOT NULL,
	"latitude" text,
	"longitude" text,
	"opened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "markets_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "network"."permission_record_works" (
	"permission_record_id" uuid NOT NULL,
	"creator_work_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network"."permission_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"answer" text NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_from_ip" text,
	"copy_sent_at" timestamp with time zone,
	"copy_sent_to" text,
	CONSTRAINT "permission_records_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "network"."permission_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"link_token" text NOT NULL,
	"sent_via" jsonb NOT NULL,
	"note" text,
	"proposed_band" "broadcast"."band",
	"proposed_tenths" integer,
	"sent_by" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permission_requests_link_token_unique" UNIQUE("link_token")
);
--> statement-breakpoint
CREATE TABLE "network"."recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"band" "broadcast"."band" NOT NULL,
	"blocks" jsonb NOT NULL,
	"max_airings_per_work_per_week" integer DEFAULT 3 NOT NULL,
	"break_rule" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network"."waitlist_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" "network"."waitlist_role" NOT NULL,
	"email" text NOT NULL,
	"zip" text NOT NULL,
	"market_id" uuid,
	"requested_call_sign" text,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network"."zip_markets" (
	"zip" text PRIMARY KEY NOT NULL,
	"market_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audience"."minute_samples" (
	"station_id" uuid NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"tuned_in" integer NOT NULL,
	"phone" integer DEFAULT 0 NOT NULL,
	"cast" integer DEFAULT 0 NOT NULL,
	"web" integer DEFAULT 0 NOT NULL,
	"tv_app" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "minute_samples_station_id_minute_pk" PRIMARY KEY("station_id","minute")
);
--> statement-breakpoint
CREATE TABLE "audience"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"platform" "audience"."platform" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_beat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"beats" integer DEFAULT 0 NOT NULL,
	"last_media_time_ms" integer,
	"flagged_bot" boolean DEFAULT false NOT NULL,
	"flag_reason" text
);
--> statement-breakpoint
CREATE TABLE "audience"."translator_samples" (
	"translator_id" uuid NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"viewers" integer NOT NULL,
	CONSTRAINT "translator_samples_translator_id_minute_pk" PRIMARY KEY("translator_id","minute")
);
--> statement-breakpoint
ALTER TABLE "accounts"."advertiser_memberships" ADD CONSTRAINT "advertiser_memberships_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "spots"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts"."advertiser_memberships" ADD CONSTRAINT "advertiser_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts"."devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts"."identities" ADD CONSTRAINT "identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts"."invites" ADD CONSTRAINT "invites_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts"."invites" ADD CONSTRAINT "invites_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "spots"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts"."invites" ADD CONSTRAINT "invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts"."invites" ADD CONSTRAINT "invites_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts"."notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts"."preset_key_use" ADD CONSTRAINT "preset_key_use_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts"."presets" ADD CONSTRAINT "presets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts"."presets" ADD CONSTRAINT "presets_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts"."reminders" ADD CONSTRAINT "reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts"."reminders" ADD CONSTRAINT "reminders_log_entry_id_log_entries_id_fk" FOREIGN KEY ("log_entry_id") REFERENCES "broadcast"."log_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts"."reminders" ADD CONSTRAINT "reminders_listed_airing_id_listed_airings_id_fk" FOREIGN KEY ("listed_airing_id") REFERENCES "network"."listed_airings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts"."station_memberships" ADD CONSTRAINT "station_memberships_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts"."station_memberships" ADD CONSTRAINT "station_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts"."users" ADD CONSTRAINT "users_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "network"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."as_run" ADD CONSTRAINT "as_run_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."as_run" ADD CONSTRAINT "as_run_log_entry_id_log_entries_id_fk" FOREIGN KEY ("log_entry_id") REFERENCES "broadcast"."log_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."as_run" ADD CONSTRAINT "as_run_break_id_breaks_id_fk" FOREIGN KEY ("break_id") REFERENCES "broadcast"."breaks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."as_run" ADD CONSTRAINT "as_run_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "broadcast"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."as_run" ADD CONSTRAINT "as_run_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "broadcast"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."as_run" ADD CONSTRAINT "as_run_airing_id_airings_id_fk" FOREIGN KEY ("airing_id") REFERENCES "spots"."airings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."as_run" ADD CONSTRAINT "as_run_carriage_agreement_id_agreements_id_fk" FOREIGN KEY ("carriage_agreement_id") REFERENCES "catalog"."agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."as_run" ADD CONSTRAINT "as_run_live_source_id_live_sources_id_fk" FOREIGN KEY ("live_source_id") REFERENCES "broadcast"."live_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."asset_break_points" ADD CONSTRAINT "asset_break_points_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "broadcast"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."asset_files" ADD CONSTRAINT "asset_files_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "broadcast"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."asset_folders" ADD CONSTRAINT "asset_folders_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."asset_folders" ADD CONSTRAINT "asset_folders_parent_folder_id_asset_folders_id_fk" FOREIGN KEY ("parent_folder_id") REFERENCES "broadcast"."asset_folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."assets" ADD CONSTRAINT "assets_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."assets" ADD CONSTRAINT "assets_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "broadcast"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."assets" ADD CONSTRAINT "assets_folder_id_asset_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "broadcast"."asset_folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."assets" ADD CONSTRAINT "assets_creator_work_id_creator_works_id_fk" FOREIGN KEY ("creator_work_id") REFERENCES "network"."creator_works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."blocked_categories" ADD CONSTRAINT "blocked_categories_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."break_rules" ADD CONSTRAINT "break_rules_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."breaks" ADD CONSTRAINT "breaks_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."breaks" ADD CONSTRAINT "breaks_log_entry_id_log_entries_id_fk" FOREIGN KEY ("log_entry_id") REFERENCES "broadcast"."log_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."channels" ADD CONSTRAINT "channels_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."channels" ADD CONSTRAINT "channels_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "network"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."channels" ADD CONSTRAINT "channels_carries_station_id_stations_id_fk" FOREIGN KEY ("carries_station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."commands" ADD CONSTRAINT "commands_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."commands" ADD CONSTRAINT "commands_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."dead_air_events" ADD CONSTRAINT "dead_air_events_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."host_assignments" ADD CONSTRAINT "host_assignments_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."host_assignments" ADD CONSTRAINT "host_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."host_assignments" ADD CONSTRAINT "host_assignments_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "broadcast"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."import_jobs" ADD CONSTRAINT "import_jobs_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."live_sources" ADD CONSTRAINT "live_sources_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."livepeer_config" ADD CONSTRAINT "livepeer_config_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."log_entries" ADD CONSTRAINT "log_entries_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."log_entries" ADD CONSTRAINT "log_entries_asset_id_rights_confirmations_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "broadcast"."rights_confirmations"("asset_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."log_entries" ADD CONSTRAINT "log_entries_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "broadcast"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."log_entries" ADD CONSTRAINT "log_entries_carriage_agreement_id_agreements_id_fk" FOREIGN KEY ("carriage_agreement_id") REFERENCES "catalog"."agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."log_entries" ADD CONSTRAINT "log_entries_live_source_id_live_sources_id_fk" FOREIGN KEY ("live_source_id") REFERENCES "broadcast"."live_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."log_entries" ADD CONSTRAINT "log_entries_repeat_group_id_repeat_groups_id_fk" FOREIGN KEY ("repeat_group_id") REFERENCES "broadcast"."repeat_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."log_entries" ADD CONSTRAINT "log_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."playout_state" ADD CONSTRAINT "playout_state_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."playout_state" ADD CONSTRAINT "playout_state_current_log_entry_id_log_entries_id_fk" FOREIGN KEY ("current_log_entry_id") REFERENCES "broadcast"."log_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."playout_state" ADD CONSTRAINT "playout_state_current_asset_id_assets_id_fk" FOREIGN KEY ("current_asset_id") REFERENCES "broadcast"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."programs" ADD CONSTRAINT "programs_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."repeat_groups" ADD CONSTRAINT "repeat_groups_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."rights_confirmations" ADD CONSTRAINT "rights_confirmations_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "broadcast"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."rights_confirmations" ADD CONSTRAINT "rights_confirmations_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."rights_confirmations" ADD CONSTRAINT "rights_confirmations_permission_record_id_permission_records_id_fk" FOREIGN KEY ("permission_record_id") REFERENCES "network"."permission_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."rights_confirmations" ADD CONSTRAINT "rights_confirmations_licence_record_id_licence_records_id_fk" FOREIGN KEY ("licence_record_id") REFERENCES "network"."licence_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."schedules" ADD CONSTRAINT "schedules_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."speakers" ADD CONSTRAINT "speakers_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "broadcast"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."translators" ADD CONSTRAINT "translators_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."agreements" ADD CONSTRAINT "agreements_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "catalog"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."agreements" ADD CONSTRAINT "agreements_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "catalog"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."agreements" ADD CONSTRAINT "agreements_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "broadcast"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."agreements" ADD CONSTRAINT "agreements_maker_station_id_stations_id_fk" FOREIGN KEY ("maker_station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."agreements" ADD CONSTRAINT "agreements_carrier_station_id_stations_id_fk" FOREIGN KEY ("carrier_station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."agreements" ADD CONSTRAINT "agreements_subchannel_id_channels_id_fk" FOREIGN KEY ("subchannel_id") REFERENCES "broadcast"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."offer_previews" ADD CONSTRAINT "offer_previews_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "catalog"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."offers" ADD CONSTRAINT "offers_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "broadcast"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."offers" ADD CONSTRAINT "offers_maker_station_id_stations_id_fk" FOREIGN KEY ("maker_station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."requests" ADD CONSTRAINT "requests_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "catalog"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."requests" ADD CONSTRAINT "requests_carrier_station_id_stations_id_fk" FOREIGN KEY ("carrier_station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog"."requests" ADD CONSTRAINT "requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."advertiser_locations" ADD CONSTRAINT "advertiser_locations_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "spots"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."advertiser_markets" ADD CONSTRAINT "advertiser_markets_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "spots"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."advertiser_markets" ADD CONSTRAINT "advertiser_markets_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "network"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."airings" ADD CONSTRAINT "airings_spot_id_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "spots"."spots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."airings" ADD CONSTRAINT "airings_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."airings" ADD CONSTRAINT "airings_break_id_breaks_id_fk" FOREIGN KEY ("break_id") REFERENCES "broadcast"."breaks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."airings" ADD CONSTRAINT "airings_hold_id_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "ledger"."holds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."code_events" ADD CONSTRAINT "code_events_code_id_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "spots"."codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."code_events" ADD CONSTRAINT "code_events_airing_id_airings_id_fk" FOREIGN KEY ("airing_id") REFERENCES "spots"."airings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."code_events" ADD CONSTRAINT "code_events_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."code_events" ADD CONSTRAINT "code_events_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."codes" ADD CONSTRAINT "codes_spot_id_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "spots"."spots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."order_files" ADD CONSTRAINT "order_files_order_id_production_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "spots"."production_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."order_notes" ADD CONSTRAINT "order_notes_order_id_production_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "spots"."production_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."order_notes" ADD CONSTRAINT "order_notes_delivery_file_id_order_files_id_fk" FOREIGN KEY ("delivery_file_id") REFERENCES "spots"."order_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."order_notes" ADD CONSTRAINT "order_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."production_orders" ADD CONSTRAINT "production_orders_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "spots"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."production_orders" ADD CONSTRAINT "production_orders_maker_station_id_stations_id_fk" FOREIGN KEY ("maker_station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."production_orders" ADD CONSTRAINT "production_orders_hold_id_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "ledger"."holds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."production_orders" ADD CONSTRAINT "production_orders_spot_id_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "spots"."spots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."rotation_spots" ADD CONSTRAINT "rotation_spots_rotation_id_rotations_id_fk" FOREIGN KEY ("rotation_id") REFERENCES "spots"."rotations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."rotation_spots" ADD CONSTRAINT "rotation_spots_spot_id_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "spots"."spots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."rotations" ADD CONSTRAINT "rotations_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."sponsorship_months" ADD CONSTRAINT "sponsorship_months_sponsorship_id_sponsorships_id_fk" FOREIGN KEY ("sponsorship_id") REFERENCES "spots"."sponsorships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."sponsorship_months" ADD CONSTRAINT "sponsorship_months_hold_id_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "ledger"."holds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."sponsorship_settings" ADD CONSTRAINT "sponsorship_settings_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."sponsorship_settings" ADD CONSTRAINT "sponsorship_settings_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "broadcast"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."sponsorships" ADD CONSTRAINT "sponsorships_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "spots"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."sponsorships" ADD CONSTRAINT "sponsorships_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."sponsorships" ADD CONSTRAINT "sponsorships_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "broadcast"."programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."sponsorships" ADD CONSTRAINT "sponsorships_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."spot_files" ADD CONSTRAINT "spot_files_spot_id_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "spots"."spots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."spots" ADD CONSTRAINT "spots_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "spots"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."spots" ADD CONSTRAINT "spots_production_order_id_production_orders_id_fk" FOREIGN KEY ("production_order_id") REFERENCES "spots"."production_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."targeting" ADD CONSTRAINT "targeting_spot_id_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "spots"."spots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spots"."upload_checks" ADD CONSTRAINT "upload_checks_spot_file_id_spot_files_id_fk" FOREIGN KEY ("spot_file_id") REFERENCES "spots"."spot_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."accounts" ADD CONSTRAINT "accounts_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "spots"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."accounts" ADD CONSTRAINT "accounts_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."deposits" ADD CONSTRAINT "deposits_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "spots"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."deposits" ADD CONSTRAINT "deposits_funding_source_id_funding_sources_id_fk" FOREIGN KEY ("funding_source_id") REFERENCES "ledger"."funding_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."deposits" ADD CONSTRAINT "deposits_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "ledger"."entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."escrow_deposits" ADD CONSTRAINT "escrow_deposits_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "ledger"."entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."funding_sources" ADD CONSTRAINT "funding_sources_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "spots"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."holds" ADD CONSTRAINT "holds_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "spots"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."holds" ADD CONSTRAINT "holds_spot_id_spots_id_fk" FOREIGN KEY ("spot_id") REFERENCES "spots"."spots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."holds" ADD CONSTRAINT "holds_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."holds" ADD CONSTRAINT "holds_sponsorship_id_sponsorships_id_fk" FOREIGN KEY ("sponsorship_id") REFERENCES "spots"."sponsorships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."holds" ADD CONSTRAINT "holds_production_order_id_production_orders_id_fk" FOREIGN KEY ("production_order_id") REFERENCES "spots"."production_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."payouts" ADD CONSTRAINT "payouts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "ledger"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."payouts" ADD CONSTRAINT "payouts_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "ledger"."entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."pledges" ADD CONSTRAINT "pledges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."pledges" ADD CONSTRAINT "pledges_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."postings" ADD CONSTRAINT "postings_entry_id_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "ledger"."entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."postings" ADD CONSTRAINT "postings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "ledger"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."postings" ADD CONSTRAINT "postings_hold_id_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "ledger"."holds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger"."statements" ADD CONSTRAINT "statements_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "ledger"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust"."answers" ADD CONSTRAINT "answers_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "trust"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust"."answers" ADD CONSTRAINT "answers_attested_by_users_id_fk" FOREIGN KEY ("attested_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust"."claims" ADD CONSTRAINT "claims_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "broadcast"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust"."claims" ADD CONSTRAINT "claims_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust"."takedowns" ADD CONSTRAINT "takedowns_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "trust"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust"."takedowns" ADD CONSTRAINT "takedowns_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust"."takedowns" ADD CONSTRAINT "takedowns_replaced_with_asset_id_assets_id_fk" FOREIGN KEY ("replaced_with_asset_id") REFERENCES "broadcast"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."call_sign_reservations" ADD CONSTRAINT "call_sign_reservations_signup_id_waitlist_signups_id_fk" FOREIGN KEY ("signup_id") REFERENCES "network"."waitlist_signups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."call_sign_reservations" ADD CONSTRAINT "call_sign_reservations_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "network"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."call_sign_reservations" ADD CONSTRAINT "call_sign_reservations_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."channel_holds" ADD CONSTRAINT "channel_holds_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "network"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."channel_holds" ADD CONSTRAINT "channel_holds_reservation_id_call_sign_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "network"."call_sign_reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."creator_works" ADD CONSTRAINT "creator_works_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "network"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."creators" ADD CONSTRAINT "creators_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "network"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."creators" ADD CONSTRAINT "creators_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."handovers" ADD CONSTRAINT "handovers_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."handovers" ADD CONSTRAINT "handovers_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "network"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."handovers" ADD CONSTRAINT "handovers_claimant_user_id_users_id_fk" FOREIGN KEY ("claimant_user_id") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."licence_records" ADD CONSTRAINT "licence_records_creator_work_id_creator_works_id_fk" FOREIGN KEY ("creator_work_id") REFERENCES "network"."creator_works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."listed_airings" ADD CONSTRAINT "listed_airings_listed_source_id_listed_sources_id_fk" FOREIGN KEY ("listed_source_id") REFERENCES "network"."listed_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD CONSTRAINT "listed_sources_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."permission_record_works" ADD CONSTRAINT "permission_record_works_permission_record_id_permission_records_id_fk" FOREIGN KEY ("permission_record_id") REFERENCES "network"."permission_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."permission_record_works" ADD CONSTRAINT "permission_record_works_creator_work_id_creator_works_id_fk" FOREIGN KEY ("creator_work_id") REFERENCES "network"."creator_works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."permission_records" ADD CONSTRAINT "permission_records_request_id_permission_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "network"."permission_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."permission_requests" ADD CONSTRAINT "permission_requests_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "network"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."permission_requests" ADD CONSTRAINT "permission_requests_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."waitlist_signups" ADD CONSTRAINT "waitlist_signups_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "network"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."zip_markets" ADD CONSTRAINT "zip_markets_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "network"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience"."minute_samples" ADD CONSTRAINT "minute_samples_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience"."sessions" ADD CONSTRAINT "sessions_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "broadcast"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience"."translator_samples" ADD CONSTRAINT "translator_samples_translator_id_translators_id_fk" FOREIGN KEY ("translator_id") REFERENCES "broadcast"."translators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "advertiser_one_owner" ON "accounts"."advertiser_memberships" USING btree ("advertiser_id") WHERE "accounts"."advertiser_memberships"."role" = 'owner';--> statement-breakpoint
CREATE UNIQUE INDEX "identities_kind_value" ON "accounts"."identities" USING btree ("kind","value");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_prefs_scope" ON "accounts"."notification_prefs" USING btree ("user_id","scope","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "presets_key" ON "accounts"."presets" USING btree ("user_id","key") WHERE "accounts"."presets"."key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "station_one_owner" ON "accounts"."station_memberships" USING btree ("station_id") WHERE "accounts"."station_memberships"."role" = 'owner';--> statement-breakpoint
CREATE INDEX "as_run_station_time" ON "broadcast"."as_run" USING btree ("station_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_files_version" ON "broadcast"."asset_files" USING btree ("asset_id","version");--> statement-breakpoint
CREATE INDEX "assets_station" ON "broadcast"."assets" USING btree ("station_id");--> statement-breakpoint
CREATE INDEX "breaks_station_time" ON "broadcast"."breaks" USING btree ("station_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_number_in_market" ON "broadcast"."channels" USING btree ("market_id","band","tenths") WHERE "broadcast"."channels"."released_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "channels_one_primary" ON "broadcast"."channels" USING btree ("station_id") WHERE "broadcast"."channels"."is_primary" and "broadcast"."channels"."released_at" is null;--> statement-breakpoint
CREATE INDEX "log_entries_station_time" ON "broadcast"."log_entries" USING btree ("station_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stations_call_sign" ON "broadcast"."stations" USING btree ("call_sign");--> statement-breakpoint
CREATE UNIQUE INDEX "stations_handle" ON "broadcast"."stations" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX "offers_one_per_program" ON "catalog"."offers" USING btree ("program_id") WHERE "catalog"."offers"."status" = 'offered';--> statement-breakpoint
CREATE INDEX "airings_station_time" ON "spots"."airings" USING btree ("station_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "code_events_code" ON "spots"."code_events" USING btree ("code_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rotations_station_kind" ON "spots"."rotations" USING btree ("station_id","kind");--> statement-breakpoint
CREATE INDEX "spots_advertiser" ON "spots"."spots" USING btree ("advertiser_id");--> statement-breakpoint
CREATE INDEX "postings_account" ON "ledger"."postings" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "postings_hold" ON "ledger"."postings" USING btree ("hold_id");--> statement-breakpoint
CREATE UNIQUE INDEX "statements_period" ON "ledger"."statements" USING btree ("account_id","period","period_start");--> statement-breakpoint
CREATE INDEX "claims_station" ON "trust"."claims" USING btree ("station_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "call_sign_reservations_active" ON "network"."call_sign_reservations" USING btree ("call_sign") WHERE "network"."call_sign_reservations"."released_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_holds_active" ON "network"."channel_holds" USING btree ("market_id","band","tenths") WHERE "network"."channel_holds"."released_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "permission_record_works_pk" ON "network"."permission_record_works" USING btree ("permission_record_id","creator_work_id");--> statement-breakpoint
CREATE INDEX "sessions_station_beat" ON "audience"."sessions" USING btree ("station_id","last_beat_at");