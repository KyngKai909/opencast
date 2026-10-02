-- Reserved call signs (2026-09-29, Network desk desk-pages 02): end dates, the same name asked for
-- twice, names Opencast won't allow. Additive: every row is kept, columns are added.

-- Two people may ask for the same call sign: the desk decides (decision, release_reason not_kept).
-- The index stays, not unique. broadcast.stations_guard still refuses a station a name held for
-- anyone else, so neither can take it before the desk decides.
DROP INDEX "network"."call_sign_reservations_active";--> statement-breakpoint
CREATE INDEX "call_sign_reservations_active" ON "network"."call_sign_reservations" USING btree ("call_sign") WHERE "network"."call_sign_reservations"."released_at" is null;--> statement-breakpoint

ALTER TABLE "network"."call_sign_reservations" ADD COLUMN "invited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "network"."call_sign_reservations" ADD COLUMN "reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "network"."call_sign_reservations" ADD COLUMN "extended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "network"."call_sign_reservations" ADD COLUMN "extended_by" uuid;--> statement-breakpoint
ALTER TABLE "network"."call_sign_reservations" ADD COLUMN "decision" text;--> statement-breakpoint
ALTER TABLE "network"."call_sign_reservations" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "network"."call_sign_reservations" ADD COLUMN "decided_by" uuid;--> statement-breakpoint
ALTER TABLE "network"."call_sign_reservations" ADD COLUMN "suggested" text[];--> statement-breakpoint
ALTER TABLE "network"."call_sign_reservations" ADD COLUMN "replaces" uuid;--> statement-breakpoint
ALTER TABLE "network"."call_sign_reservations" ADD COLUMN "release_reason" text;--> statement-breakpoint
ALTER TABLE "network"."call_sign_reservations" ADD COLUMN "released_by" uuid;--> statement-breakpoint
ALTER TABLE "network"."call_sign_reservations" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "network"."call_sign_reservations" ADD CONSTRAINT "call_sign_reservations_extended_by_users_id_fk" FOREIGN KEY ("extended_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."call_sign_reservations" ADD CONSTRAINT "call_sign_reservations_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network"."call_sign_reservations" ADD CONSTRAINT "call_sign_reservations_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "accounts"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "network"."waitlist_signups" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "network"."waitlist_signups" ADD COLUMN "about" text;--> statement-breakpoint

-- Every reservation gets an end: 120 days from the day it was made (the registry's first
-- `call_signs.hold`), but never sooner than 15 days from now, so each one still gets its reminder
-- (14 days before) instead of ending the day this runs. Holds after a sign-off already have theirs.
UPDATE "network"."call_sign_reservations"
SET "held_until" = GREATEST("created_at" + interval '120 days', now() + interval '15 days')
WHERE "held_until" IS NULL AND "released_at" IS NULL;--> statement-breakpoint
UPDATE "network"."call_sign_reservations"
SET "held_until" = "created_at" + interval '120 days'
WHERE "held_until" IS NULL;--> statement-breakpoint

-- The rules registry's first versions: the hold's length, and the names Opencast won't allow.
INSERT INTO "network"."rules" ("key", "value", "effective_from", "note") VALUES
  ('call_signs.hold', '{"days":120,"reminderDays":14}', '1970-01-01T00:00:00Z', 'Open: the desk frame''s 120 days, a reminder two weeks before'),
  ('call_signs.refused', '{"refuseKwFourLetters":true,"impersonation":["ABC","AMC","BBC","BET","CBC","CBS","CNN","CSPAN","ESPN","FCC","FEMA","FOX","HBO","HULU","MSNBC","MTV","NBC","NOAA","NPR","NWS","PBS","ROKU","TBS","TNT","TUBI"],"denylist":["ALERT","EAS","SOS"]}', '1970-01-01T00:00:00Z', 'Open: K or W and three letters look like FCC stations; a first list of brands and agencies; the denylist is a start');--> statement-breakpoint
INSERT INTO "network"."change_log" ("at", "kind", "subject", "summary", "after", "effective_from", "note")
SELECT r.created_at, 'rule', r.key, 'Started the registry with the value in effect', r.value, r.effective_from, r.note
FROM "network"."rules" r
WHERE r.key IN ('call_signs.hold', 'call_signs.refused');
