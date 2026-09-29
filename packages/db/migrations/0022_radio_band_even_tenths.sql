-- The radio band moves to even tenths, 88.2 to 107.8 (changed 2026-09-29). Real US FM stations
-- are only on odd tenths, so no Opencast number can match one. TV is unchanged.
--
-- Every radio number on an odd tenth moves: up one tenth (99.1 to 99.2) when that's free in its
-- market, else to the nearest free even tenth (the higher one on a tie). Nothing is deleted.
-- A channel fixed after first sign-on moves too: the guard trigger is off while it does.
ALTER TABLE "broadcast"."channels" DROP CONSTRAINT "channel_number_in_band";--> statement-breakpoint
ALTER TABLE "broadcast"."channels" DISABLE TRIGGER "channels_guard";--> statement-breakpoint
DO $$
DECLARE
  r record;
  target integer;
BEGIN
  -- The moves, so a waitlist hold can follow its own station's channel.
  CREATE TEMP TABLE radio_moves (market_id uuid, station_id uuid, old_tenths integer, new_tenths integer) ON COMMIT DROP;

  -- Channels in use, lowest first: each to a number no other channel or hold in its market has.
  FOR r IN
    SELECT c.id, c.market_id, c.station_id, c.tenths
    FROM broadcast.channels c
    WHERE c.band = 'radio' AND c.released_at IS NULL AND c.tenths % 2 = 1
    ORDER BY c.market_id, c.tenths
  LOOP
    SELECT n INTO target
    FROM generate_series(882, 1078, 2) AS n
    WHERE NOT EXISTS (
        SELECT 1 FROM broadcast.channels x
        WHERE x.market_id = r.market_id AND x.band = 'radio' AND x.tenths = n AND x.released_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM network.channel_holds h
        JOIN network.call_sign_reservations cr ON cr.id = h.reservation_id
        WHERE h.market_id = r.market_id AND h.band = 'radio' AND h.tenths = n AND h.released_at IS NULL
          AND cr.station_id IS DISTINCT FROM r.station_id
      )
    ORDER BY abs(n - r.tenths), n DESC
    LIMIT 1;
    IF target IS NULL THEN
      RAISE EXCEPTION 'no free even tenth for radio channel %.% in market %', r.tenths / 10, r.tenths % 10, r.market_id;
    END IF;
    UPDATE broadcast.channels SET tenths = target WHERE id = r.id;
    INSERT INTO radio_moves VALUES (r.market_id, r.station_id, r.tenths, target);
  END LOOP;

  -- Waitlist holds: with their station's channel when it took the held number, else the same rule.
  FOR r IN
    SELECT h.id, h.market_id, h.tenths, cr.station_id
    FROM network.channel_holds h
    JOIN network.call_sign_reservations cr ON cr.id = h.reservation_id
    WHERE h.band = 'radio' AND h.released_at IS NULL AND h.tenths % 2 = 1
    ORDER BY h.market_id, h.tenths
  LOOP
    SELECT m.new_tenths INTO target
    FROM radio_moves m
    WHERE m.market_id = r.market_id AND m.old_tenths = r.tenths AND m.station_id IS NOT DISTINCT FROM r.station_id
    LIMIT 1;
    IF target IS NULL THEN
      SELECT n INTO target
      FROM generate_series(882, 1078, 2) AS n
      WHERE NOT EXISTS (
          SELECT 1 FROM broadcast.channels x
          WHERE x.market_id = r.market_id AND x.band = 'radio' AND x.tenths = n AND x.released_at IS NULL
            AND x.station_id IS DISTINCT FROM r.station_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM network.channel_holds x
          WHERE x.market_id = r.market_id AND x.band = 'radio' AND x.tenths = n AND x.released_at IS NULL
        )
      ORDER BY abs(n - r.tenths), n DESC
      LIMIT 1;
    END IF;
    IF target IS NULL THEN
      RAISE EXCEPTION 'no free even tenth for the radio hold on %.% in market %', r.tenths / 10, r.tenths % 10, r.market_id;
    END IF;
    UPDATE network.channel_holds SET tenths = target WHERE id = r.id;
  END LOOP;
END;
$$;--> statement-breakpoint
-- Released channels and holds are history: up one tenth (107.9 to 107.8), nothing to collide with.
UPDATE "broadcast"."channels" SET "tenths" = least("tenths" + 1, 1078)
  WHERE "band" = 'radio' AND "released_at" IS NOT NULL AND "tenths" % 2 = 1;--> statement-breakpoint
UPDATE "network"."channel_holds" SET "tenths" = least("tenths" + 1, 1078)
  WHERE "band" = 'radio' AND "released_at" IS NOT NULL AND "tenths" % 2 = 1;--> statement-breakpoint
ALTER TABLE "broadcast"."channels" ENABLE TRIGGER "channels_guard";--> statement-breakpoint
ALTER TABLE "broadcast"."channels" ADD CONSTRAINT "channel_number_in_band" CHECK (("broadcast"."channels"."band" = 'tv' and "broadcast"."channels"."tenths" between 21 and 699 and "broadcast"."channels"."tenths" % 10 <> 0)
       or ("broadcast"."channels"."band" = 'radio' and "broadcast"."channels"."tenths" between 882 and 1078 and "broadcast"."channels"."tenths" % 2 = 0));--> statement-breakpoint
-- The desk's proposals for creators and permission requests: up one tenth, as above, keeping
-- their order (a proposal's first channel is its `proposed_tenths`).
UPDATE "network"."creators" SET "proposed_tenths" = least("proposed_tenths" + 1, 1078)
  WHERE "proposed_band" = 'radio' AND "proposed_tenths" % 2 = 1;--> statement-breakpoint
UPDATE "network"."creators" c SET "proposed_channels" = (
    SELECT array_agg(v ORDER BY first_at)
    FROM (
      SELECT CASE WHEN x % 2 = 1 THEN least(x + 1, 1078) ELSE x END AS v, min(i) AS first_at
      FROM unnest(c."proposed_channels") WITH ORDINALITY AS u(x, i)
      GROUP BY 1
    ) moved
  )
  WHERE c."proposed_band" = 'radio' AND EXISTS (SELECT 1 FROM unnest(c."proposed_channels") AS x WHERE x % 2 = 1);--> statement-breakpoint
UPDATE "network"."permission_requests" SET "proposed_tenths" = least("proposed_tenths" + 1, 1078)
  WHERE "proposed_band" = 'radio' AND "proposed_tenths" % 2 = 1;
