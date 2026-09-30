// One block per constraint in docs/prompts/1-platform.md, Phase 3.
import { afterAll, beforeAll, describe, it } from "vitest";
import type pg from "pg";
import {
  account,
  advertiser,
  asset,
  channel,
  entry,
  freshDatabase,
  inTransaction,
  market,
  station,
  user,
  type Tx
} from "./helpers.js";

let pool: pg.Pool;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ pool, drop } = await freshDatabase());
}, 60_000);

afterAll(async () => {
  await drop();
});

const test = (name: string, fn: (tx: Tx) => Promise<void>) => it(name, () => inTransaction(pool, fn));

describe("call signs", () => {
  test("are 3 to 5 capital letters", async (tx) => {
    await tx.accepts(() => station(tx, { callSign: "BEAT" }));
    for (const bad of ["BE", "BEATSS", "beat", "SK8"]) {
      await tx.rejects(/call_sign_format/, () => station(tx, { callSign: bad }));
    }
  });

  test("are unique platform-wide", async (tx) => {
    await station(tx, { callSign: "BEAT" });
    await tx.rejects(/stations_call_sign/, () => station(tx, { callSign: "BEAT" }));
  });

  test("are fixed after first sign-on, but not before", async (tx) => {
    const draft = await station(tx, { callSign: "BEAT" });
    await tx.accepts(() => tx.run(`UPDATE broadcast.stations SET call_sign = 'BEET' WHERE id = $1`, [draft.id]));
    const live = await station(tx, { callSign: "CIVC", signedOn: true });
    await tx.rejects(/fixed after first sign-on/, () =>
      tx.run(`UPDATE broadcast.stations SET call_sign = 'CIVX' WHERE id = $1`, [live.id])
    );
    await tx.accepts(() => tx.run(`UPDATE broadcast.stations SET name = 'Civic TV' WHERE id = $1`, [live.id]));
  });

  test("held for the waitlist can't be taken by another station", async (tx) => {
    await tx.run(`INSERT INTO network.call_sign_reservations (call_sign, reason) VALUES ('TACO', 'waitlist')`);
    await tx.rejects(/held for someone else/, () => station(tx, { callSign: "TACO" }));
  });

  // 0029 (2026-09-29): two people may ask for the same name; the desk decides. Until then, and
  // after, no station takes a name held for someone else.
  test("two people can hold the same name, and neither frees it for anyone else", async (tx) => {
    await tx.run(`INSERT INTO network.call_sign_reservations (call_sign, reason) VALUES ('VALE', 'waitlist'), ('VALE', 'waitlist')`);
    await tx.rejects(/held for someone else/, () => station(tx, { callSign: "VALE" }));
    await tx.run(`UPDATE network.call_sign_reservations SET released_at = now(), release_reason = 'not_kept', decision = 'not_kept', suggested = ARRAY['VALES'] WHERE ctid = (SELECT ctid FROM network.call_sign_reservations WHERE call_sign = 'VALE' LIMIT 1)`);
    await tx.rejects(/held for someone else/, () => station(tx, { callSign: "VALE" }));
  });
});

describe("channels", () => {
  test("TV is 2.1 to 69.9; radio is 88.2 to 107.8 in even tenths", async (tx) => {
    const m = await market(tx);
    const s = await station(tx);
    for (const [band, tenths] of [["tv", 21], ["tv", 699], ["radio", 882], ["radio", 1000], ["radio", 1078]] as const) {
      await tx.accepts(() => channel(tx, s.id, m.id, band, tenths));
    }
    // Every odd tenth is a real FM number, so none is on the band.
    for (const [band, tenths] of [["tv", 20], ["tv", 120], ["tv", 701], ["radio", 880], ["radio", 881], ["radio", 991], ["radio", 1079], ["radio", 1080]] as const) {
      await tx.rejects(/channel_number_in_band/, () => channel(tx, s.id, m.id, band, tenths));
    }
  });

  test("are unique within a market and band", async (tx) => {
    const ie = await market(tx);
    const la = await market(tx, "los-angeles");
    const a = await station(tx, { callSign: "BEAT" });
    const b = await station(tx, { callSign: "REEL" });
    await channel(tx, a.id, ie.id, "tv", 121);
    await tx.rejects(/channels_number_in_market/, () => channel(tx, b.id, ie.id, "tv", 121));
    await tx.accepts(() => channel(tx, b.id, la.id, "tv", 121));
    await tx.accepts(() => channel(tx, b.id, ie.id, "radio", 1072));
  });

  test("are fixed after first sign-on", async (tx) => {
    const m = await market(tx);
    const s = await station(tx, { callSign: "BEAT", signedOn: true });
    const c = await channel(tx, s.id, m.id, "tv", 121);
    await tx.rejects(/fixed after first sign-on/, () =>
      tx.run(`UPDATE broadcast.channels SET tenths = 122 WHERE id = $1`, [c.id])
    );
    await tx.rejects(/can't be deleted after first sign-on/, () =>
      tx.run(`DELETE FROM broadcast.channels WHERE id = $1`, [c.id])
    );
    const draft = await station(tx, { callSign: "REEL" });
    const d = await channel(tx, draft.id, m.id, "tv", 241);
    await tx.accepts(() => tx.run(`UPDATE broadcast.channels SET tenths = 242 WHERE id = $1`, [d.id]));
  });

  test("held for a waitlist reservation can't go to any other station", async (tx) => {
    const m = await market(tx);
    const holder = await station(tx, { callSign: "BEAT" });
    const other = await station(tx, { callSign: "REEL" });
    const r = await tx.one<{ id: string }>(
      `INSERT INTO network.call_sign_reservations (call_sign, reason, station_id) VALUES ('HOOP', 'waitlist', $1) RETURNING id`,
      [holder.id]
    );
    await tx.run(`INSERT INTO network.channel_holds (market_id, band, tenths, reservation_id) VALUES ($1, 'tv', 521, $2)`, [
      m.id,
      r.id
    ]);
    await tx.rejects(/held for the waitlist/, () => channel(tx, other.id, m.id, "tv", 521));
    await tx.accepts(() => channel(tx, holder.id, m.id, "tv", 521));
  });
});

describe("stations", () => {
  test("colour must hold 4.5:1 against white", async (tx) => {
    const s = await station(tx);
    await tx.accepts(() => tx.run(`UPDATE broadcast.stations SET colour = '#8C3B7A' WHERE id = $1`, [s.id]));
    await tx.rejects(/colour_contrast/, () => tx.run(`UPDATE broadcast.stations SET colour = '#00a96b' WHERE id = $1`, [s.id]));
  });

  test("a studio has no channel and never signs on", async (tx) => {
    const m = await market(tx);
    const studio = await station(tx, { kind: "studio" });
    await tx.rejects(/a studio has no channel/, () => channel(tx, studio.id, m.id, "tv", 331));
    await tx.rejects(/studio_never_signs_on/, () =>
      tx.run(`UPDATE broadcast.stations SET first_signed_on_at = now(), call_sign = 'STUD' WHERE id = $1`, [studio.id])
    );
  });
});

describe("program log", () => {
  test("can't reference an asset without a rights confirmation", async (tx) => {
    const s = await station(tx);
    const a = await asset(tx, s.id);
    const logIt = () =>
      tx.run(
        `INSERT INTO broadcast.log_entries (station_id, starts_at, ends_at, kind, code, asset_id)
         VALUES ($1, '2026-10-01 20:00Z', '2026-10-01 20:30Z', 'program', 'PGM', $2)`,
        [s.id, a.id]
      );
    await tx.rejects(/log_entries_asset_id/, logIt);
    await tx.run(`INSERT INTO broadcast.rights_confirmations (asset_id, basis) VALUES ($1, 'made_it')`, [a.id]);
    await tx.accepts(logIt);
  });

  test("never overlaps on a station", async (tx) => {
    const s = await station(tx);
    const a = await asset(tx, s.id);
    await tx.run(`INSERT INTO broadcast.rights_confirmations (asset_id, basis) VALUES ($1, 'made_it')`, [a.id]);
    const at = (start: string, end: string) =>
      tx.run(
        `INSERT INTO broadcast.log_entries (station_id, starts_at, ends_at, kind, code, asset_id) VALUES ($1, $2, $3, 'program', 'PGM', $4)`,
        [s.id, start, end, a.id]
      );
    await at("2026-10-01 20:00Z", "2026-10-01 20:30Z");
    await tx.rejects(/log_entries_no_overlap/, () => at("2026-10-01 20:29Z", "2026-10-01 21:00Z"));
    await tx.accepts(() => at("2026-10-01 20:30Z", "2026-10-01 21:00Z"));
  });

  test("airs another station's program only under a carriage agreement", async (tx) => {
    const maker = await station(tx, { callSign: "REEL" });
    const carrier = await station(tx, { callSign: "BEAT" });
    const a = await asset(tx, maker.id);
    await tx.run(`INSERT INTO broadcast.rights_confirmations (asset_id, basis) VALUES ($1, 'made_it')`, [a.id]);
    await tx.rejects(/needs a carriage agreement/, () =>
      tx.run(
        `INSERT INTO broadcast.log_entries (station_id, starts_at, ends_at, kind, code, asset_id)
         VALUES ($1, '2026-10-01 20:00Z', '2026-10-01 20:30Z', 'program', 'PGM', $2)`,
        [carrier.id, a.id]
      )
    );
  });
});

describe("link imports", () => {
  async function program(tx: Tx, stationId: string) {
    return tx.one<{ id: string }>(`INSERT INTO broadcast.programs (station_id, title) VALUES ($1, 'Saturday Reel') RETURNING id`, [
      stationId
    ]);
  }
  const offer = (tx: Tx, programId: string, stationId: string) =>
    tx.run(`INSERT INTO catalog.offers (program_id, maker_station_id, terms_offered) VALUES ($1, $2, '["barter"]')`, [
      programId,
      stationId
    ]);

  test("can never have a carriage offer", async (tx) => {
    const s = await station(tx);
    const p = await program(tx, s.id);
    await asset(tx, s.id, { source: "link", programId: p.id });
    await tx.rejects(/link imports stay local/, () => offer(tx, p.id, s.id));
  });

  test("can't join a program that's offered", async (tx) => {
    const s = await station(tx);
    const p = await program(tx, s.id);
    await asset(tx, s.id, { programId: p.id });
    await offer(tx, p.id, s.id);
    await tx.rejects(/link imports stay local/, () => asset(tx, s.id, { source: "link", programId: p.id }));
  });
});

describe("claimable stations", () => {
  async function setup(tx: Tx) {
    const s = await station(tx, { kind: "claimable", callSign: "LUPE" });
    const creator = await tx.one<{ id: string }>(
      `INSERT INTO network.creators (display_name, person_name, source_platform, source_url, station_id)
       VALUES ('Tía Lupe''s Kitchen', 'Lupe Ortiz', 'youtube', 'https://youtube.com/@lupe', $1) RETURNING id`,
      [s.id]
    );
    const work = (title: string) =>
      tx.one<{ id: string }>(
        `INSERT INTO network.creator_works (creator_id, title, duration_ms, source_url) VALUES ($1, $2, 600000, 'https://youtube.com/v') RETURNING id`,
        [creator.id, title]
      );
    return { s, creator, work };
  }

  test("only import works covered by a yes, and nothing before it", async (tx) => {
    const { s, creator, work } = await setup(tx);
    const covered = await work("Mole, part 1");
    const notAsked = await work("Someone else's song");
    await tx.rejects(/no permission or licence record/, () => asset(tx, s.id, { source: "creator_work", creatorWorkId: covered.id }));

    const req = await tx.one<{ id: string }>(
      `INSERT INTO network.permission_requests (creator_id, link_token, sent_via) VALUES ($1, 'tok', '["email"]') RETURNING id`,
      [creator.id]
    );
    const yes = await tx.one<{ id: string }>(
      `INSERT INTO network.permission_records (request_id, answer) VALUES ($1, 'yes') RETURNING id`,
      [req.id]
    );
    await tx.run(`INSERT INTO network.permission_record_works (permission_record_id, creator_work_id) VALUES ($1, $2)`, [
      yes.id,
      covered.id
    ]);

    const a = await asset(tx, s.id, { source: "creator_work", creatorWorkId: covered.id });
    await tx.rejects(/no permission or licence record/, () => asset(tx, s.id, { source: "creator_work", creatorWorkId: notAsked.id }));
    await tx.rejects(/only airs the creator's covered works/, () => asset(tx, s.id));
    await tx.rejects(/must be the permission or licence record/, () =>
      tx.run(`INSERT INTO broadcast.rights_confirmations (asset_id, basis) VALUES ($1, 'made_it')`, [a.id])
    );
    await tx.accepts(() =>
      tx.run(
        `INSERT INTO broadcast.rights_confirmations (asset_id, basis, permission_record_id) VALUES ($1, 'permission_record', $2)`,
        [a.id, yes.id]
      )
    );
  });

  test("a licence only counts if it allows commercial use", async (tx) => {
    const { s, work } = await setup(tx);
    const nc = await work("NC short");
    const by = await work("CC BY short");
    await tx.run(
      `INSERT INTO network.licence_records (creator_work_id, licence, licence_url, attribution) VALUES ($1, 'cc_by_nc', 'https://creativecommons.org/licenses/by-nc/4.0/', 'Lupe')`,
      [nc.id]
    );
    await tx.run(
      `INSERT INTO network.licence_records (creator_work_id, licence, licence_url, attribution) VALUES ($1, 'cc_by', 'https://creativecommons.org/licenses/by/4.0/', 'Lupe')`,
      [by.id]
    );
    await tx.rejects(/no permission or licence record/, () => asset(tx, s.id, { source: "creator_work", creatorWorkId: nc.id }));
    await tx.accepts(() => asset(tx, s.id, { source: "creator_work", creatorWorkId: by.id }));
  });
});

describe("ledger", () => {
  test("entries must balance", async (tx) => {
    const adv = await advertiser(tx);
    const available = await account(tx, "advertiser_available", { advertiserId: adv.id });
    const bank = await account(tx, "external", { label: "bank" });
    await tx.rejects(/doesn't balance/, async () => {
      await entry(tx, "deposit", [
        [available.id, 500_000_000],
        [bank.id, -499_000_000]
      ]);
      await tx.check();
    });
    await tx.accepts(() =>
      entry(tx, "deposit", [
        [available.id, 500_000_000],
        [bank.id, -500_000_000]
      ])
    );
  });

  test("rows are never updated or deleted", async (tx) => {
    const adv = await advertiser(tx);
    const available = await account(tx, "advertiser_available", { advertiserId: adv.id });
    const bank = await account(tx, "external", { label: "bank" });
    const id = await entry(tx, "deposit", [
      [available.id, 1_000_000],
      [bank.id, -1_000_000]
    ]);
    await tx.check();
    await tx.rejects(/append-only/, () => tx.run(`UPDATE ledger.entries SET memo = 'x' WHERE id = $1`, [id]));
    await tx.rejects(/append-only/, () => tx.run(`DELETE FROM ledger.postings WHERE entry_id = $1`, [id]));
  });

  test("an advertiser can't spend more than is available", async (tx) => {
    const adv = await advertiser(tx);
    const available = await account(tx, "advertiser_available", { advertiserId: adv.id });
    const bank = await account(tx, "external", { label: "bank" });
    await tx.rejects(/below zero/, async () => {
      await entry(tx, "withdrawal", [
        [available.id, -1],
        [bank.id, 1]
      ]);
      await tx.check();
    });
  });
});

describe("spots", () => {
  async function fundedAdvertiser(tx: Tx, micros: number) {
    const adv = await advertiser(tx);
    const available = await account(tx, "advertiser_available", { advertiserId: adv.id });
    const bank = await account(tx, "external", { label: "bank" });
    if (micros > 0) {
      await entry(tx, "deposit", [
        [available.id, micros],
        [bank.id, -micros]
      ]);
    }
    return { adv, available };
  }
  const spot = (tx: Tx, advertiserId: string, status: string, dailyCap: number | null) =>
    tx.one<{ id: string }>(
      `INSERT INTO spots.spots (advertiser_id, title, length_sec, category, status, rate_kind, rate_micros, total_budget_micros, daily_cap_micros)
       VALUES ($1, 'Fall menu', 30, 'Food', $2, 'per_thousand', 8000000, 300000000, $3) RETURNING id`,
      [advertiserId, status, dailyCap]
    );

  test("can't be listed until the balance covers a day of budget", async (tx) => {
    const { adv } = await fundedAdvertiser(tx, 11_000_000);
    const s = await spot(tx, adv.id, "draft", 12_000_000);
    await tx.rejects(/doesn't cover a day/, () => tx.run(`UPDATE spots.spots SET status = 'listed' WHERE id = $1`, [s.id]));
    await tx.accepts(() => tx.run(`UPDATE spots.spots SET daily_cap_micros = 10000000, status = 'listed' WHERE id = $1`, [s.id]));
  });

  test("can't be placed in a break unless money for that airing is held", async (tx) => {
    const { adv, available } = await fundedAdvertiser(tx, 50_000_000);
    const holdsAccount = await account(tx, "holds");
    const st = await station(tx, { callSign: "BEAT" });
    const s = await spot(tx, adv.id, "draft", null);
    const brk = await tx.one<{ id: string }>(
      `INSERT INTO broadcast.breaks (station_id, starts_at, length_ms, origin) VALUES ($1, '2026-10-01 20:28:30Z', 120000, 'rule') RETURNING id`,
      [st.id]
    );
    const hold = (amount: number) =>
      tx.one<{ id: string }>(
        `INSERT INTO ledger.holds (advertiser_id, purpose, spot_id, station_id, amount_micros, is_estimate) VALUES ($1, 'airing', $2, $3, $4, true) RETURNING id`,
        [adv.id, s.id, st.id, amount]
      );
    const place = (holdId: string) =>
      tx.run(
        `INSERT INTO spots.airings (spot_id, station_id, break_id, hold_id, scheduled_at, rate_kind, rate_micros) VALUES ($1, $2, $3, $4, '2026-10-01 20:28:30Z', 'per_thousand', 8000000)`,
        [s.id, st.id, brk.id, holdId]
      );

    // Without a hold at all: the placement is refused.
    await tx.rejects(/needs a hold|not-null/, () => place(null as unknown as string));
    await tx.rejects(/isn't funded/, async () => {
      const h = await hold(2_100_000);
      await place(h.id);
      await tx.check();
    });
    await tx.accepts(async () => {
      const h = await hold(2_100_000);
      await entry(tx, "hold", [
        [available.id, -2_100_000],
        [holdsAccount.id, 2_100_000, h.id]
      ]);
      await place(h.id);
    });
  });
});

// Pay-as-you-go (migration 0033, follow-up Phase 2): a station's usage is owed on its own account,
// accrued and paid in balanced entries like anything else; its days and bills keep their shape.
describe("pay-as-you-go", () => {
  test("usage is owed by a station, and Opencast's side of it belongs to nobody else", async (tx) => {
    const s = await station(tx, { callSign: "BEAT" });
    await tx.rejects(/account_owner_fits_kind/, () => account(tx, "usage_owed"));
    await tx.rejects(/account_owner_fits_kind/, () => account(tx, "usage_billed", { stationId: s.id }));
    await tx.rejects(/account_owner_fits_kind/, () => account(tx, "opencast_usage", { stationId: s.id }));
    const owed = await account(tx, "usage_owed", { stationId: s.id });
    const billed = await account(tx, "usage_billed");
    const paid = await account(tx, "opencast_usage");
    const earnings = await account(tx, "station_earnings", { stationId: s.id });
    const outside = await account(tx, "external", { label: "bank" });
    await tx.accepts(async () => {
      await entry(tx, "deposit", [
        [earnings.id, 5_000_000],
        [outside.id, -5_000_000]
      ]);
      // Accrued: the station owes $1.20.
      await entry(tx, "usage", [
        [owed.id, -1_200_000],
        [billed.id, 1_200_000]
      ]);
      // Paid from its earnings.
      await entry(tx, "usage_payment", [
        [earnings.id, -1_200_000],
        [owed.id, 1_200_000],
        [billed.id, -1_200_000],
        [paid.id, 1_200_000]
      ]);
      await tx.check();
    });
    await tx.rejects(/doesn't balance/, async () => {
      await entry(tx, "usage", [
        [owed.id, -1_000_000],
        [billed.id, 999_999]
      ]);
      await tx.check();
    });
  });

  test("a day's usage is one of the known types, never negative; a bill is for a whole month", async (tx) => {
    const s = await station(tx, { callSign: "BEAT" });
    await tx.accepts(() => tx.run(`INSERT INTO ledger.usage_days (station_id, usage_type, day, quantity) VALUES ($1, 'storage', '2026-10-03', 12.5)`, [s.id]));
    await tx.rejects(/usage_type_known/, () => tx.run(`INSERT INTO ledger.usage_days (station_id, usage_type, day, quantity) VALUES ($1, 'bandwidth', '2026-10-03', 1)`, [s.id]));
    await tx.rejects(/usage_quantity_nonnegative/, () => tx.run(`INSERT INTO ledger.usage_days (station_id, usage_type, day, quantity) VALUES ($1, 'live_hours', '2026-10-03', -1)`, [s.id]));
    await tx.run(`INSERT INTO ledger.usage_bills (station_id, month) VALUES ($1, '2026-10-01')`, [s.id]);
    await tx.rejects(/usage_bills_station_month/, () => tx.run(`INSERT INTO ledger.usage_bills (station_id, month) VALUES ($1, '2026-10-01')`, [s.id]));
    await tx.rejects(/usage_bill_month_start/, () => tx.run(`INSERT INTO ledger.usage_bills (station_id, month) VALUES ($1, '2026-11-15')`, [s.id]));
  });

  test("a station paying from Clear names the link; grace has a start", async (tx) => {
    const s = await station(tx, { callSign: "BEAT" });
    await tx.rejects(/station_billing_clear_has_link/, () => tx.run(`INSERT INTO ledger.station_billing (station_id, funding) VALUES ($1, 'clear')`, [s.id]));
    await tx.rejects(/station_billing_grace_started/, () => tx.run(`INSERT INTO ledger.station_billing (station_id, standing) VALUES ($1, 'grace')`, [s.id]));
    await tx.accepts(() => tx.run(`INSERT INTO ledger.station_billing (station_id, funding, standing, grace_started_at) VALUES ($1, 'card', 'grace', now())`, [s.id]));
  });
});

describe("escrow", () => {
  async function setup(tx: Tx) {
    const claimable = await station(tx, { kind: "claimable", callSign: "CRAT" });
    const otherClaimable = await station(tx, { kind: "claimable", callSign: "FLDR" });
    const regular = await station(tx, { callSign: "BEAT" });
    const creatorUser = await user(tx);
    const owed = await account(tx, "escrow_owed", { stationId: claimable.id });
    const escrow = await account(tx, "escrow", { stationId: claimable.id });
    const creator = await account(tx, "creator", { stationId: claimable.id, userId: creatorUser.id });
    const otherCreator = await account(tx, "creator", { stationId: otherClaimable.id, userId: creatorUser.id });
    const fund = await account(tx, "creator_fund");
    const pool = await account(tx, "pool");
    const opencast = await account(tx, "opencast_share");
    const absorbed = await account(tx, "opencast_absorbed");
    const fees = await account(tx, "card_fees");
    const external = await account(tx, "external", { label: "chain" });
    const stationEarnings = await account(tx, "station_earnings", { stationId: regular.id });
    const holds = await account(tx, "holds");
    const adv = await advertiser(tx);
    const advertiserAvailable = await account(tx, "advertiser_available", { advertiserId: adv.id });
    // A real, funded hold, so the holds path is refused by the escrow rule and not by the hold guard.
    const spot = await tx.one<{ id: string }>(
      `INSERT INTO spots.spots (advertiser_id, title, length_sec, category, rate_kind, rate_micros, total_budget_micros)
       VALUES ($1, 'Fall menu', 30, 'Food', 'per_airing', 4000000, 100000000) RETURNING id`,
      [adv.id]
    );
    const hold = await tx.one<{ id: string }>(
      `INSERT INTO ledger.holds (advertiser_id, purpose, spot_id, station_id, amount_micros) VALUES ($1, 'airing', $2, $3, 4000000) RETURNING id`,
      [adv.id, spot.id, regular.id]
    );
    const bank = await account(tx, "external", { label: "bank" });
    await entry(tx, "deposit", [
      [advertiserAvailable.id, 4_000_000],
      [bank.id, -4_000_000]
    ]);
    await entry(tx, "hold", [
      [advertiserAvailable.id, -4_000_000],
      [holds.id, 4_000_000, hold.id]
    ]);
    // Settled earnings, then the weekly deposit into escrow.
    const world = await account(tx, "external", { label: "settle" });
    await entry(tx, "settle", [
      [owed.id, 214_600_000],
      [world.id, -214_600_000]
    ]);
    await entry(tx, "escrow_deposit", [
      [escrow.id, 214_600_000],
      [owed.id, -214_600_000]
    ]);
    await tx.check();
    return {
      holdId: hold.id,
      escrow,
      creator,
      fund,
      nonCreator: { otherCreator, pool, opencast, absorbed, fees, external, stationEarnings, holds, advertiserAvailable }
    };
  }

  test("pays the station's verified creator", async (tx) => {
    const { escrow, creator } = await setup(tx);
    await tx.accepts(() =>
      entry(tx, "escrow_claim", [
        [escrow.id, -214_600_000],
        [creator.id, 214_600_000]
      ])
    );
  });

  test("pays the creator fund after the unclaimed period", async (tx) => {
    const { escrow, fund } = await setup(tx);
    await tx.accepts(() =>
      entry(tx, "escrow_unclaimed", [
        [escrow.id, -214_600_000],
        [fund.id, 214_600_000]
      ])
    );
  });

  test("every path to anyone else fails", async (tx) => {
    const { escrow, nonCreator, holdId } = await setup(tx);
    for (const [name, target] of Object.entries(nonCreator)) {
      await tx.rejects(/escrow can only pay/, async () => {
        await entry(tx, "escrow_claim", [
          [escrow.id, -1_000_000],
          [target.id, 1_000_000, name === "holds" ? holdId : undefined]
        ]);
        await tx.check();
      });
    }
  });

  test("a split that sends even a cent elsewhere fails", async (tx) => {
    const { escrow, creator, nonCreator } = await setup(tx);
    await tx.rejects(/escrow can only pay/, async () => {
      await entry(tx, "escrow_claim", [
        [escrow.id, -214_600_000],
        [creator.id, 214_590_000],
        [nonCreator.opencast.id, 10_000]
      ]);
      await tx.check();
    });
  });

  test("is only paid into from that station's own earnings", async (tx) => {
    const { escrow, nonCreator } = await setup(tx);
    await tx.rejects(/only paid from that station's own earnings/, async () => {
      await entry(tx, "escrow_deposit", [
        [escrow.id, 1_000_000],
        [nonCreator.stationEarnings.id, -1_000_000]
      ]);
      await tx.check();
    });
  });

  test("accounts only exist for claimable stations", async (tx) => {
    const regular = await station(tx, { callSign: "REEL" });
    await tx.rejects(/only for claimable stations/, () => account(tx, "escrow", { stationId: regular.id }));
  });
});
