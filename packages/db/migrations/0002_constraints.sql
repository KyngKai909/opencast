-- Constraints that span rows or tables, so they can't be column checks.
-- Each is named after the rule in docs/prompts/1-platform.md, Phase 3.

-------------------------------------------------------------------------------
-- A call sign is unique platform-wide and immutable after first sign-on.
-- (Uniqueness is the stations_call_sign index; reservations are checked here.)
-------------------------------------------------------------------------------
CREATE FUNCTION broadcast.stations_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.first_signed_on_at IS NOT NULL THEN
    IF NEW.call_sign IS DISTINCT FROM OLD.call_sign THEN
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
     ) THEN
    RAISE EXCEPTION 'call sign % is held for someone else', NEW.call_sign USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER stations_guard BEFORE INSERT OR UPDATE ON broadcast.stations
  FOR EACH ROW EXECUTE FUNCTION broadcast.stations_guard();
--> statement-breakpoint

CREATE FUNCTION network.call_sign_reservations_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.released_at IS NULL AND EXISTS (
    SELECT 1 FROM broadcast.stations s
    WHERE s.call_sign = NEW.call_sign AND s.id IS DISTINCT FROM NEW.station_id
  ) THEN
    RAISE EXCEPTION 'call sign % is already a station''s', NEW.call_sign USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER call_sign_reservations_guard BEFORE INSERT OR UPDATE ON network.call_sign_reservations
  FOR EACH ROW EXECUTE FUNCTION network.call_sign_reservations_guard();
--> statement-breakpoint

-------------------------------------------------------------------------------
-- A channel number is unique within a market and band (the index), immutable
-- after first sign-on, never given to a studio, and a number held for a
-- waitlist reservation can only go to that reservation's station.
-------------------------------------------------------------------------------
CREATE FUNCTION broadcast.channels_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  signed_on timestamptz;
  station_kind broadcast.station_kind;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT first_signed_on_at INTO signed_on FROM broadcast.stations WHERE id = OLD.station_id;
    IF signed_on IS NOT NULL THEN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'a channel can''t be deleted after first sign-on' USING ERRCODE = 'check_violation';
      END IF;
      IF (NEW.station_id, NEW.market_id, NEW.band, NEW.tenths, NEW.is_primary)
         IS DISTINCT FROM (OLD.station_id, OLD.market_id, OLD.band, OLD.tenths, OLD.is_primary)
         OR (OLD.released_at IS NOT NULL AND NEW.released_at IS DISTINCT FROM OLD.released_at) THEN
        RAISE EXCEPTION 'channel %.% is fixed after first sign-on', OLD.tenths / 10, OLD.tenths % 10
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
  END IF;

  SELECT kind INTO station_kind FROM broadcast.stations WHERE id = NEW.station_id;
  IF station_kind = 'studio' THEN
    RAISE EXCEPTION 'a studio has no channel' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.released_at IS NULL AND EXISTS (
    SELECT 1
    FROM network.channel_holds h
    JOIN network.call_sign_reservations r ON r.id = h.reservation_id
    WHERE h.market_id = NEW.market_id AND h.band = NEW.band AND h.tenths = NEW.tenths
      AND h.released_at IS NULL
      AND r.station_id IS DISTINCT FROM NEW.station_id
  ) THEN
    RAISE EXCEPTION 'channel %.% is held for the waitlist', NEW.tenths / 10, NEW.tenths % 10
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER channels_guard BEFORE INSERT OR UPDATE OR DELETE ON broadcast.channels
  FOR EACH ROW EXECUTE FUNCTION broadcast.channels_guard();
--> statement-breakpoint

CREATE FUNCTION network.channel_holds_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.released_at IS NULL AND EXISTS (
    SELECT 1
    FROM broadcast.channels c
    JOIN network.call_sign_reservations r ON r.id = NEW.reservation_id
    WHERE c.market_id = NEW.market_id AND c.band = NEW.band AND c.tenths = NEW.tenths
      AND c.released_at IS NULL
      AND c.station_id IS DISTINCT FROM r.station_id
  ) THEN
    RAISE EXCEPTION 'channel %.% is already taken', NEW.tenths / 10, NEW.tenths % 10
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER channel_holds_guard BEFORE INSERT OR UPDATE ON network.channel_holds
  FOR EACH ROW EXECUTE FUNCTION network.channel_holds_guard();
--> statement-breakpoint

-------------------------------------------------------------------------------
-- The program log never overlaps itself on a station.
-------------------------------------------------------------------------------
ALTER TABLE broadcast.log_entries ADD CONSTRAINT log_entries_no_overlap
  EXCLUDE USING gist (station_id WITH =, tstzrange(starts_at, ends_at) WITH &&);
--> statement-breakpoint

-- A log entry can't reference an asset without a rights confirmation: that's the
-- foreign key to rights_confirmations. This adds that another station's asset
-- can only be logged under a carriage agreement for its program.
CREATE FUNCTION broadcast.log_entries_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  asset_station uuid;
  asset_program uuid;
BEGIN
  IF NEW.asset_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT station_id, program_id INTO asset_station, asset_program FROM broadcast.assets WHERE id = NEW.asset_id;
  IF asset_station <> NEW.station_id AND NOT EXISTS (
    SELECT 1 FROM catalog.agreements a
    WHERE a.id = NEW.carriage_agreement_id
      AND a.carrier_station_id = NEW.station_id
      AND a.program_id = asset_program
  ) THEN
    RAISE EXCEPTION 'another station''s program needs a carriage agreement' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER log_entries_guard BEFORE INSERT OR UPDATE ON broadcast.log_entries
  FOR EACH ROW EXECUTE FUNCTION broadcast.log_entries_guard();
--> statement-breakpoint

-------------------------------------------------------------------------------
-- An asset imported from a link can never have a carriage offer.
-------------------------------------------------------------------------------
CREATE FUNCTION catalog.offers_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'offered' AND EXISTS (
    SELECT 1 FROM broadcast.assets WHERE program_id = NEW.program_id AND source = 'link'
  ) THEN
    RAISE EXCEPTION 'link imports stay local: this program can''t be offered' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER offers_guard BEFORE INSERT OR UPDATE ON catalog.offers
  FOR EACH ROW EXECUTE FUNCTION catalog.offers_guard();
--> statement-breakpoint

-------------------------------------------------------------------------------
-- Assets: link imports can't join an offered program, and a claimable
-- station's works must each be covered by a yes or a licence that counts.
-- Nothing is copied from a creator's source before one of those exists.
-------------------------------------------------------------------------------
CREATE FUNCTION broadcast.work_is_covered(work_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM network.permission_record_works w
    JOIN network.permission_records p ON p.id = w.permission_record_id
    WHERE w.creator_work_id = work_id AND p.answer = 'yes'
  ) OR EXISTS (
    SELECT 1 FROM network.licence_records l WHERE l.creator_work_id = work_id AND l.allows_carriage
  );
$$;
--> statement-breakpoint
CREATE FUNCTION broadcast.assets_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  station_kind broadcast.station_kind;
BEGIN
  IF NEW.source = 'link' AND NEW.program_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM catalog.offers WHERE program_id = NEW.program_id AND status = 'offered'
  ) THEN
    RAISE EXCEPTION 'link imports stay local: this program is offered for carriage' USING ERRCODE = 'check_violation';
  END IF;

  SELECT kind INTO station_kind FROM broadcast.stations WHERE id = NEW.station_id;
  IF station_kind = 'claimable' THEN
    IF NEW.source <> 'creator_work' THEN
      RAISE EXCEPTION 'a claimable station only airs the creator''s covered works' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT broadcast.work_is_covered(NEW.creator_work_id) THEN
      RAISE EXCEPTION 'this work has no permission or licence record' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER assets_guard BEFORE INSERT OR UPDATE ON broadcast.assets
  FOR EACH ROW EXECUTE FUNCTION broadcast.assets_guard();
--> statement-breakpoint

-- A claimable station's rights confirmation must be the record that covers that exact work.
CREATE FUNCTION broadcast.rights_confirmations_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  station_kind broadcast.station_kind;
  work_id uuid;
BEGIN
  SELECT s.kind, a.creator_work_id INTO station_kind, work_id
  FROM broadcast.assets a JOIN broadcast.stations s ON s.id = a.station_id
  WHERE a.id = NEW.asset_id;

  IF station_kind = 'claimable' THEN
    IF NEW.basis = 'permission_record' AND EXISTS (
      SELECT 1 FROM network.permission_record_works w
      JOIN network.permission_records p ON p.id = w.permission_record_id
      WHERE w.permission_record_id = NEW.permission_record_id AND w.creator_work_id = work_id AND p.answer = 'yes'
    ) THEN
      RETURN NEW;
    END IF;
    IF NEW.basis = 'licence_record' AND EXISTS (
      SELECT 1 FROM network.licence_records l
      WHERE l.id = NEW.licence_record_id AND l.creator_work_id = work_id AND l.allows_carriage
    ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'a claimable station''s rights must be the permission or licence record for that work'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER rights_confirmations_guard BEFORE INSERT OR UPDATE ON broadcast.rights_confirmations
  FOR EACH ROW EXECUTE FUNCTION broadcast.rights_confirmations_guard();
--> statement-breakpoint

-------------------------------------------------------------------------------
-- Ledger rows are never updated or deleted, only reversed.
-------------------------------------------------------------------------------
CREATE FUNCTION ledger.append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger.% is append-only: reverse it with a new entry', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER entries_append_only BEFORE UPDATE OR DELETE ON ledger.entries
  FOR EACH ROW EXECUTE FUNCTION ledger.append_only();
--> statement-breakpoint
CREATE TRIGGER postings_append_only BEFORE UPDATE OR DELETE ON ledger.postings
  FOR EACH ROW EXECUTE FUNCTION ledger.append_only();
--> statement-breakpoint
CREATE TRIGGER holds_append_only BEFORE UPDATE OR DELETE ON ledger.holds
  FOR EACH ROW EXECUTE FUNCTION ledger.append_only();
--> statement-breakpoint
CREATE TRIGGER statements_append_only BEFORE UPDATE OR DELETE ON ledger.statements
  FOR EACH ROW EXECUTE FUNCTION ledger.append_only();
--> statement-breakpoint
CREATE TRIGGER as_run_append_only BEFORE UPDATE OR DELETE ON broadcast.as_run
  FOR EACH ROW EXECUTE FUNCTION ledger.append_only();
--> statement-breakpoint

-- Postings on the holds account always name their hold, and only there.
CREATE FUNCTION ledger.postings_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  account_kind ledger.account_kind;
BEGIN
  SELECT kind INTO account_kind FROM ledger.accounts WHERE id = NEW.account_id;
  IF (account_kind = 'holds') <> (NEW.hold_id IS NOT NULL) THEN
    RAISE EXCEPTION 'a posting names a hold exactly when it is on the holds account' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER postings_guard BEFORE INSERT ON ledger.postings
  FOR EACH ROW EXECUTE FUNCTION ledger.postings_guard();
--> statement-breakpoint

-- An escrow account only exists for a claimable station.
CREATE FUNCTION ledger.accounts_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind IN ('escrow', 'escrow_owed', 'creator') AND NOT EXISTS (
    SELECT 1 FROM broadcast.stations WHERE id = NEW.station_id AND kind = 'claimable'
  ) THEN
    RAISE EXCEPTION '% accounts are only for claimable stations', NEW.kind USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER accounts_guard BEFORE INSERT ON ledger.accounts
  FOR EACH ROW EXECUTE FUNCTION ledger.accounts_guard();
--> statement-breakpoint
CREATE TRIGGER accounts_append_only BEFORE UPDATE OR DELETE ON ledger.accounts
  FOR EACH ROW EXECUTE FUNCTION ledger.append_only();
--> statement-breakpoint

-- Checked at commit, once every posting of an entry is in:
--  * every entry balances to zero and has at least two postings;
--  * an advertiser's available balance and every hold stay at or above zero;
--  * escrow only ever pays the verified creator of that station, or the creator fund,
--    and is only ever paid into from that station's own earnings.
CREATE FUNCTION ledger.entry_checks() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  total bigint;
  lines int;
  bad record;
BEGIN
  SELECT coalesce(sum(amount_micros), 0), count(*) INTO total, lines
  FROM ledger.postings WHERE entry_id = NEW.id;
  IF lines < 2 OR total <> 0 THEN
    RAISE EXCEPTION 'ledger entry % doesn''t balance (% postings, sum %)', NEW.id, lines, total
      USING ERRCODE = 'check_violation';
  END IF;

  FOR bad IN
    SELECT a.id, a.kind, sum(p2.amount_micros) AS balance
    FROM ledger.postings p
    JOIN ledger.accounts a ON a.id = p.account_id AND a.kind = 'advertiser_available'
    JOIN ledger.postings p2 ON p2.account_id = a.id
    WHERE p.entry_id = NEW.id
    GROUP BY a.id, a.kind
    HAVING sum(p2.amount_micros) < 0
  LOOP
    RAISE EXCEPTION 'advertiser balance would go below zero (%)', bad.balance USING ERRCODE = 'check_violation';
  END LOOP;

  FOR bad IN
    SELECT p.hold_id, sum(p2.amount_micros) AS open_amount
    FROM ledger.postings p
    JOIN ledger.postings p2 ON p2.hold_id = p.hold_id
    WHERE p.entry_id = NEW.id AND p.hold_id IS NOT NULL
    GROUP BY p.hold_id
    HAVING sum(p2.amount_micros) < 0
  LOOP
    RAISE EXCEPTION 'hold % would go below zero', bad.hold_id USING ERRCODE = 'check_violation';
  END LOOP;

  -- Money out of escrow: every account credited must be that station's creator or the fund.
  IF EXISTS (
    SELECT 1 FROM ledger.postings p JOIN ledger.accounts a ON a.id = p.account_id
    WHERE p.entry_id = NEW.id AND a.kind = 'escrow' AND p.amount_micros < 0
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM ledger.postings p
      JOIN ledger.accounts a ON a.id = p.account_id
      WHERE p.entry_id = NEW.id AND p.amount_micros > 0
        AND NOT (
          a.kind = 'creator_fund'
          OR (a.kind = 'creator' AND a.station_id IN (
                SELECT e.station_id FROM ledger.postings pe
                JOIN ledger.accounts e ON e.id = pe.account_id
                WHERE pe.entry_id = NEW.id AND e.kind = 'escrow'))
        )
    ) THEN
      RAISE EXCEPTION 'escrow can only pay the station''s verified creator or the creator fund'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Money into escrow: only from the same station's owed earnings.
  IF EXISTS (
    SELECT 1
    FROM ledger.postings p JOIN ledger.accounts a ON a.id = p.account_id
    WHERE p.entry_id = NEW.id AND a.kind = 'escrow' AND p.amount_micros > 0
      AND NOT EXISTS (
        SELECT 1 FROM ledger.postings q JOIN ledger.accounts b ON b.id = q.account_id
        WHERE q.entry_id = NEW.id AND b.kind = 'escrow_owed' AND b.station_id = a.station_id AND q.amount_micros < 0
      )
  ) THEN
    RAISE EXCEPTION 'escrow is only paid from that station''s own earnings' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER entry_checks AFTER INSERT ON ledger.entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger.entry_checks();
--> statement-breakpoint

-- A hold is only a hold once its amount has moved onto the holds account, in the same transaction.
CREATE FUNCTION ledger.hold_is_funded() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  held bigint;
BEGIN
  SELECT coalesce(sum(p.amount_micros), 0) INTO held
  FROM ledger.postings p WHERE p.hold_id = NEW.id AND p.amount_micros > 0;
  IF held < NEW.amount_micros THEN
    RAISE EXCEPTION 'hold % isn''t funded (% of %)', NEW.id, held, NEW.amount_micros USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER hold_is_funded AFTER INSERT ON ledger.holds
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger.hold_is_funded();
--> statement-breakpoint

-------------------------------------------------------------------------------
-- A spot can't be placed in a break unless money for that airing is held.
-- (hold_id is required and unique; the hold must be funded, above; and it must
-- be a hold for this spot on this station.)
-------------------------------------------------------------------------------
CREATE FUNCTION spots.airings_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ledger.holds h
    WHERE h.id = NEW.hold_id AND h.purpose = 'airing'
      AND h.spot_id = NEW.spot_id AND h.station_id = NEW.station_id
  ) THEN
    RAISE EXCEPTION 'an airing needs a hold for this spot on this station' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER airings_guard BEFORE INSERT OR UPDATE ON spots.airings
  FOR EACH ROW EXECUTE FUNCTION spots.airings_guard();
--> statement-breakpoint

-------------------------------------------------------------------------------
-- A spot can't be listed until its advertiser's available balance covers at
-- least one day of its budget: the daily cap if it has one, otherwise the total
-- spread over its dates, otherwise the whole total. Mirrors packages/domain.
-------------------------------------------------------------------------------
CREATE FUNCTION spots.one_day_of_budget(spot spots.spots) RETURNS bigint LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN spot.daily_cap_micros IS NOT NULL THEN spot.daily_cap_micros
    WHEN spot.starts_on IS NOT NULL AND spot.ends_on IS NOT NULL
      THEN ceil(spot.total_budget_micros::numeric / greatest(spot.ends_on - spot.starts_on + 1, 1))::bigint
    ELSE spot.total_budget_micros
  END;
$$;
--> statement-breakpoint
CREATE FUNCTION spots.spots_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  available bigint;
BEGIN
  IF NEW.status = 'listed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'listed') THEN
    SELECT coalesce(sum(p.amount_micros), 0) INTO available
    FROM ledger.accounts a JOIN ledger.postings p ON p.account_id = a.id
    WHERE a.kind = 'advertiser_available' AND a.advertiser_id = NEW.advertiser_id;
    IF available < spots.one_day_of_budget(NEW) THEN
      RAISE EXCEPTION 'available balance doesn''t cover a day of this spot''s budget (% < %)',
        available, spots.one_day_of_budget(NEW) USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER spots_guard BEFORE INSERT OR UPDATE ON spots.spots
  FOR EACH ROW EXECUTE FUNCTION spots.spots_guard();
--> statement-breakpoint

-- The revenue config starts with everything at zero.
INSERT INTO ledger.revenue_config (effective_from) VALUES ('2026-01-01');
--> statement-breakpoint
INSERT INTO trust.policy (id) VALUES (1);
