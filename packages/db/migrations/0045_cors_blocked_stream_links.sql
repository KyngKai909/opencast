-- 2026-10-01: A238, CORS-blocked stream links and platform feeds (the user's decision, extending A237).
-- A stream link whose server sends no `Access-Control-Allow-Origin` for Opencast's apps plays nowhere
-- in a browser (hls.js and dash.js fetch with XHR), https or not. The address a viewer's player would
-- fetch straight from the source is checked with the app's origin (its playlist, then the first
-- variant playlist and the first segment) at listing, on a change of address, and hourly with the
-- minute's checks: `cors` is `ok`, `blocked` or `unknown`, `cors_detail` what was found, and
-- `cors_checked_at` when. Blocked, it plays through Opencast's relay with every address relayed
-- (/v2/, "all" mode), or waits (`browsers_blocked`) without the relay.
-- `platform_feed`: the address uses another app's access (jmp2.uk, Pluto's stitcher with a partner's
-- token or parameters, Samsung TV Plus headends, a partner's JWT): never relayed, it waits
-- (`platform_feed`) and stays listed. Set at listing, on a change, and at the checks' next pass.
-- Named by hand: 0038 is reserved (see 0040), so drizzle-kit's numbering isn't relied on.
ALTER TABLE "network"."listed_sources" ADD COLUMN "cors" text;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "cors_detail" text;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "cors_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "platform_feed" text;
