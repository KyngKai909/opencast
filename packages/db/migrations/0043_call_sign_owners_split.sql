-- 2026-09-30: A234, a full-station family whose owners later differ. An owner's own stations on one
-- channel's subchannels can share X.1's call sign (12.1 BEAT, 12.2 BEAT; migration 0042), checked
-- when the link is made. When owners change later (a handover, an owner who leaves) and nobody owns
-- both any more, nothing changes on air: the call sign is fixed. The Network desk is told once per
-- split; `owners_split_at` on the member says since when, and is cleared when they have an owner in
-- common again. Named by hand: 0038 is reserved (see 0040), so drizzle-kit's numbering isn't relied on.
ALTER TABLE "broadcast"."stations" ADD COLUMN "owners_split_at" timestamp with time zone;
