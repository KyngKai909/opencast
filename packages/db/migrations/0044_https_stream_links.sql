-- 2026-10-01: A237, plain-http stream links (the user's decision, over Phase 6's "never proxied"). A
-- stream link listed as `http://` is tried over https first (same host and path; 443, or its own
-- port when it names one other than 80): when a real playlist answers there, the dial plays the
-- https address straight from the source, and only otherwise through Opencast's HTTPS relay (or it
-- waits, `needs_https`, when the relay isn't configured). `https_url` is the https address that
-- answered (null: not upgraded); `https_checked_at` when it was last tried (at listing, on a change of
-- address, and again hourly with the minute's checks), so a source that adds or drops https is followed.
-- Named by hand: 0038 is reserved (see 0040), so drizzle-kit's numbering isn't relied on.
ALTER TABLE "network"."listed_sources" ADD COLUMN "https_url" text;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "https_checked_at" timestamp with time zone;
