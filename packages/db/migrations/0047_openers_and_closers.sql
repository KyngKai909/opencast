-- 2026-10-02: A242, a station's own openers, closers and off-air card (the user's decision).
-- Library types: `OPN` an opener (airs at sign-on, the station ID after it only if the station says
-- so, and at the start of each broadcast day for a station that chooses it), `CLS` a closer (airs
-- at sign-off, before the off-air card) and `OFF` the station's own off-air card (an image or a
-- short clip, airing as the sign-off slate). Without them, playout makes an automatic opener and
-- closer in the station's look, and the off-air card is the generated one, as before.
-- The as-run log and the channel's rows record `OPN` and `CLS`; `OFF` is a library type only (the
-- card airs as the sign-off slate, `OPEN`). None of the three is ever a log entry's code.
-- The two switches are on the break rule, beside the station ID's cadence; both off by default.
-- Additive: three enum values (nothing here uses them, so they can be added in the transaction that
-- runs the migrations) and two columns with defaults. Named by hand: 0038 is reserved (see 0040),
-- so drizzle-kit's numbering isn't relied on.
ALTER TYPE "broadcast"."log_code" ADD VALUE 'OPN';--> statement-breakpoint
ALTER TYPE "broadcast"."log_code" ADD VALUE 'CLS';--> statement-breakpoint
ALTER TYPE "broadcast"."log_code" ADD VALUE 'OFF';--> statement-breakpoint
ALTER TABLE "broadcast"."break_rules" ADD COLUMN "station_id_after_opener" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcast"."break_rules" ADD COLUMN "daily_opener" boolean DEFAULT false NOT NULL;
