-- 2026-09-30: shared call signs (A229, A230). One brand's streams on one channel's subchannels can
-- share a call sign, as real TV does (KCET, KCET-DT2): 15.1 SBCO, 15.2 SBCO, 15.3 SBCO. A station on
-- X.n (n ≥ 2) may share the call sign of the station on X.1 in the same market and major
-- (`shares_call_sign_with`), when both are external stations, or both are full stations the same
-- owner runs (never mixed). Everywhere else a call sign stays unique, as before: the unique index
-- now leaves out a family's members, which a foreign key ties to X.1's call sign (a change on X.1
-- follows to them), and the rest is checked at commit. A waitlist hold still keeps a name from
-- everyone else; a hold for X.1 counts for its family. Only the call sign is shared: evidence,
-- health, outages, earnings, spots, billing and watch data stay per station.
-- `listed_sources.removed_with`: taken off the dial with X.1 (A231), so "Put back" brings it back too.
-- Named by hand: 0038 is reserved (see 0040), so drizzle-kit's numbering isn't relied on.
ALTER TABLE "broadcast"."stations" ADD COLUMN "shares_call_sign_with" uuid;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD COLUMN "removed_with" uuid;--> statement-breakpoint
DROP INDEX "broadcast"."stations_call_sign";--> statement-breakpoint
CREATE UNIQUE INDEX "stations_call_sign" ON "broadcast"."stations" USING btree ("call_sign") WHERE "broadcast"."stations"."shares_call_sign_with" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "stations_id_call_sign" ON "broadcast"."stations" USING btree ("id","call_sign");--> statement-breakpoint
CREATE INDEX "stations_call_sign_family" ON "broadcast"."stations" USING btree ("shares_call_sign_with") WHERE "broadcast"."stations"."shares_call_sign_with" is not null;--> statement-breakpoint
ALTER TABLE "broadcast"."stations" ADD CONSTRAINT "stations_call_sign_family_fk" FOREIGN KEY ("shares_call_sign_with","call_sign") REFERENCES "broadcast"."stations"("id","call_sign") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "network"."listed_sources" ADD CONSTRAINT "listed_sources_removed_with_listed_sources_id_fk" FOREIGN KEY ("removed_with") REFERENCES "network"."listed_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast"."stations" ADD CONSTRAINT "shares_call_sign_with_x1" CHECK ("broadcast"."stations"."shares_call_sign_with" is null or ("broadcast"."stations"."call_sign" is not null and "broadcast"."stations"."shares_call_sign_with" <> "broadcast"."stations"."id"));--> statement-breakpoint

-- A call sign is fixed after first sign-on, except an external station's (A222). A name held on the
-- waitlist is refused to everyone but the station it's held for and, from now, that station's family
-- (a hold for X.1, after a family's call sign changed or it was taken off, is the family's).
CREATE OR REPLACE FUNCTION broadcast.stations_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.first_signed_on_at IS NOT NULL THEN
    IF NEW.call_sign IS DISTINCT FROM OLD.call_sign AND NOT (OLD.kind = 'listed' AND NEW.kind = 'listed' AND NEW.call_sign IS NOT NULL) THEN
      RAISE EXCEPTION 'call sign % is fixed after first sign-on', OLD.call_sign USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.first_signed_on_at IS DISTINCT FROM OLD.first_signed_on_at THEN
      RAISE EXCEPTION 'first sign-on time can''t change' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.call_sign IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.call_sign IS DISTINCT FROM OLD.call_sign)
     AND EXISTS (
       SELECT 1 FROM network.call_sign_reservations r
       WHERE r.call_sign = NEW.call_sign AND r.released_at IS NULL
         AND r.station_id IS DISTINCT FROM NEW.id
         AND (NEW.shares_call_sign_with IS NULL OR r.station_id IS DISTINCT FROM NEW.shares_call_sign_with)
     ) THEN
    RAISE EXCEPTION 'call sign % is held for someone else', NEW.call_sign USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- A hold can't take a name a station has, unless the station is the one it's held for or in its family.
CREATE OR REPLACE FUNCTION network.call_sign_reservations_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.released_at IS NULL AND EXISTS (
    SELECT 1 FROM broadcast.stations s
    WHERE s.call_sign = NEW.call_sign AND s.id IS DISTINCT FROM NEW.station_id
      AND (NEW.station_id IS NULL OR coalesce(s.shares_call_sign_with, s.id) IS DISTINCT FROM (
        SELECT coalesce(x.shares_call_sign_with, x.id) FROM broadcast.stations x WHERE x.id = NEW.station_id
      ))
  ) THEN
    RAISE EXCEPTION 'call sign % is already a station''s', NEW.call_sign USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- The family rules, for the families `sid` is in (as X.1 or as a member). `linked`: a member whose link
-- was just made, so its owner is checked too (only then: an owner leaving later doesn't undo a call
-- sign that's fixed on air).
CREATE FUNCTION broadcast.call_sign_family_check(sid uuid, linked uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  m broadcast.stations%ROWTYPE;
  h broadcast.stations%ROWTYPE;
  mc broadcast.channels%ROWTYPE;
  hc broadcast.channels%ROWTYPE;
BEGIN
  FOR m IN
    SELECT * FROM broadcast.stations WHERE shares_call_sign_with IS NOT NULL AND (id = sid OR shares_call_sign_with = sid)
  LOOP
    SELECT * INTO h FROM broadcast.stations WHERE id = m.shares_call_sign_with;
    IF h.shares_call_sign_with IS NOT NULL THEN
      RAISE EXCEPTION 'call sign %: a family shares the call sign of the station on X.1 itself', m.call_sign USING ERRCODE = 'check_violation';
    END IF;
    IF m.kind <> h.kind OR m.kind NOT IN ('listed', 'station') THEN
      RAISE EXCEPTION 'call sign %: only external stations, or one owner''s own stations, share a call sign, never mixed', m.call_sign USING ERRCODE = 'check_violation';
    END IF;
    IF m.kind = 'station' AND m.id = linked AND NOT EXISTS (
      SELECT 1 FROM accounts.station_memberships a
      JOIN accounts.station_memberships b ON b.user_id = a.user_id AND b.station_id = h.id AND b.role = 'owner'
      WHERE a.station_id = m.id AND a.role = 'owner'
    ) THEN
      RAISE EXCEPTION 'call sign %: a station shares X.1''s call sign only when the same owner runs both', m.call_sign USING ERRCODE = 'check_violation';
    END IF;
    -- Taken off the dial or signed off for good: archived, its channel may have been freed since.
    CONTINUE WHEN m.status = 'signed_off';
    SELECT * INTO mc FROM broadcast.channels WHERE station_id = m.id AND is_primary AND released_at IS NULL;
    SELECT * INTO hc FROM broadcast.channels WHERE station_id = h.id AND is_primary AND released_at IS NULL;
    IF mc.id IS NULL OR hc.id IS NULL OR mc.band <> 'tv' OR hc.band <> 'tv' OR mc.market_id <> hc.market_id
       OR hc.tenths % 10 <> 1 OR mc.tenths % 10 = 1 OR mc.tenths / 10 <> hc.tenths / 10 THEN
      RAISE EXCEPTION 'call sign %: shared only on X.n beside X.1, in the same market and major', m.call_sign USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION broadcast.stations_call_sign_family() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM broadcast.call_sign_family_check(NEW.id,
    CASE WHEN TG_OP = 'INSERT' OR NEW.shares_call_sign_with IS DISTINCT FROM OLD.shares_call_sign_with THEN NEW.id END);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER stations_call_sign_family AFTER INSERT OR UPDATE ON broadcast.stations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION broadcast.stations_call_sign_family();
--> statement-breakpoint
CREATE FUNCTION broadcast.channels_call_sign_family() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM broadcast.call_sign_family_check(NEW.station_id, NULL);
  IF TG_OP = 'UPDATE' AND OLD.station_id IS DISTINCT FROM NEW.station_id THEN
    PERFORM broadcast.call_sign_family_check(OLD.station_id, NULL);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER channels_call_sign_family AFTER INSERT OR UPDATE ON broadcast.channels
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION broadcast.channels_call_sign_family();
