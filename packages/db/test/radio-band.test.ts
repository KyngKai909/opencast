// The radio band on even tenths (migration 0022): radio numbers on odd tenths move up one tenth,
// or to the nearest free even tenth, with nothing deleted; and the seed (LOFI on 99.2, BEAT added,
// safe to run again).
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../scripts/seed.js";
import { freshDatabase } from "./helpers.js";

const migrations = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const adminUrl = process.env.DATABASE_URL ?? "postgres://opencast:opencast@localhost:54329/opencast";
const BAND_MIGRATION = "0022_radio_band_even_tenths";

/** A database migrated up to (not including) `before`, then the rest on `finish()`. */
async function databaseBefore(before: string) {
  const name = `opencast_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 4 });
  pool.on("error", () => undefined);
  // The same migrations, with the journal cut off before `before`.
  const partial = mkdtempSync(path.join(tmpdir(), "opencast-migrations-"));
  cpSync(migrations, partial, { recursive: true });
  const journalPath = path.join(partial, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ tag: string }> };
  const cut = journal.entries.findIndex((e) => e.tag === before);
  expect(cut).toBeGreaterThan(0);
  writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut) }));
  await migrate(drizzle(pool), { migrationsFolder: partial, migrationsSchema: "drizzle" });
  rmSync(partial, { recursive: true, force: true });
  return {
    pool,
    finish: () => migrate(drizzle(pool), { migrationsFolder: migrations, migrationsSchema: "drizzle" }),
    async drop() {
      await pool.end();
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    }
  };
}

describe("migration 0022: the radio band on even tenths", () => {
  let db: Awaited<ReturnType<typeof databaseBefore>>;
  const ids: Record<string, string> = {};
  const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.pool.query(sql, params)).rows[0] as T;

  beforeAll(async () => {
    db = await databaseBefore(BAND_MIGRATION);
    const market = async (slug: string) => (await one<{ id: string }>(`INSERT INTO network.markets (slug, name) VALUES ($1, $1) RETURNING id`, [slug])).id;
    ids.ie = await market("inland-empire");
    ids.la = await market("los-angeles");
    const station = async (callSign: string, kind = "station", signedOn = true) =>
      (
        await one<{ id: string }>(
          `INSERT INTO broadcast.stations (kind, call_sign, name, first_signed_on_at, status) VALUES ($1, $2, $2, $3, $4) RETURNING id`,
          [kind, callSign, signedOn ? new Date() : null, signedOn ? "on_air" : "setting_up"]
        )
      ).id;
    const channel = async (stationId: string, marketId: string, band: "tv" | "radio", tenths: number, releasedAt: Date | null = null) =>
      (
        await one<{ id: string }>(
          `INSERT INTO broadcast.channels (station_id, market_id, band, tenths, released_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [stationId, marketId, band, tenths, releasedAt]
        )
      ).id;
    // LOFI on the real 99.1, signed on: its number was fixed, and moves anyway.
    ids.lofi = await station("LOFI", "catalog");
    ids.lofiChannel = await channel(ids.lofi, ids.ie, "radio", 991);
    // The same number in another market moves on its own.
    ids.laStation = await station("LAFM");
    ids.laChannel = await channel(ids.laStation, ids.la, "radio", 991);
    // The top of the band: 107.7 takes 107.8, so 107.9 goes to the nearest free even tenth, 107.6.
    ids.top1 = await station("TOPA", "station", false);
    ids.top1Channel = await channel(ids.top1, ids.ie, "radio", 1077);
    ids.top2 = await station("TOPB");
    ids.top2Channel = await channel(ids.top2, ids.ie, "radio", 1079);
    // A waitlist hold on 107.5 with no station yet: 107.6 is taken now, so 107.4.
    const reservation = async (callSign: string, stationId: string | null) =>
      (await one<{ id: string }>(`INSERT INTO network.call_sign_reservations (call_sign, reason, station_id) VALUES ($1, 'waitlist', $2) RETURNING id`, [callSign, stationId])).id;
    const hold = async (tenths: number, reservationId: string, releasedAt: Date | null = null) =>
      (await one<{ id: string }>(`INSERT INTO network.channel_holds (market_id, band, tenths, reservation_id, released_at) VALUES ($1, 'radio', $2, $3, $4) RETURNING id`, [ids.ie, tenths, reservationId, releasedAt])).id;
    ids.freeHold = await hold(1075, await reservation("GOSP", null));
    // A hold whose station took the held number: the two stay together.
    ids.taker = await station("TACO", "station", false);
    ids.takerChannel = await channel(ids.taker, ids.ie, "radio", 953);
    ids.takerHold = await hold(953, await reservation("TACO", ids.taker));
    // History: a released channel and hold move up one tenth too.
    ids.oldChannel = await channel(ids.top1, ids.ie, "radio", 1079, new Date("2026-01-01"));
    ids.oldHold = await hold(881, await reservation("OLDY", null), new Date("2026-01-01"));
    // TV stays put.
    ids.retro = await station("RETRO", "catalog");
    ids.tv = await channel(ids.retro, ids.ie, "tv", 41);
    // The desk's proposals.
    ids.creator = (
      await one<{ id: string }>(
        `INSERT INTO network.creators (display_name, source_platform, source_url, proposed_band, proposed_tenths, proposed_channels)
         VALUES ('Crate', 'soundcloud', 'https://soundcloud.com/crate', 'radio', 1019, ARRAY[1019, 1077, 1079, 954]) RETURNING id`
      )
    ).id;
    ids.tvCreator = (
      await one<{ id: string }>(
        `INSERT INTO network.creators (display_name, source_platform, source_url, proposed_band, proposed_tenths, proposed_channels)
         VALUES ('Skate', 'vimeo', 'https://vimeo.com/skate', 'tv', 383, ARRAY[383, 451]) RETURNING id`
      )
    ).id;
    ids.request = (
      await one<{ id: string }>(
        `INSERT INTO network.permission_requests (creator_id, link_token, sent_via, proposed_band, proposed_tenths) VALUES ($1, 'tok', '["email"]', 'radio', 1019) RETURNING id`,
        [ids.creator]
      )
    ).id;
    await db.finish();
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  const tenthsOf = async (table: string, id: string) => (await one<{ tenths: number }>(`SELECT tenths FROM ${table} WHERE id = $1`, [id])).tenths;

  it("moves a radio channel up one tenth when that's free: LOFI 99.1 to 99.2, in each market", async () => {
    expect(await tenthsOf("broadcast.channels", ids.lofiChannel)).toBe(992);
    expect(await tenthsOf("broadcast.channels", ids.laChannel)).toBe(992);
  });

  it("else to the nearest free even tenth", async () => {
    expect(await tenthsOf("broadcast.channels", ids.top1Channel)).toBe(1078);
    expect(await tenthsOf("broadcast.channels", ids.top2Channel)).toBe(1076);
    expect(await tenthsOf("network.channel_holds", ids.freeHold)).toBe(1074);
  });

  it("keeps a hold with its own station's channel", async () => {
    expect(await tenthsOf("broadcast.channels", ids.takerChannel)).toBe(954);
    expect(await tenthsOf("network.channel_holds", ids.takerHold)).toBe(954);
  });

  it("moves released channels and holds, deletes nothing, and leaves TV alone", async () => {
    expect(await tenthsOf("broadcast.channels", ids.oldChannel)).toBe(1078);
    expect(await tenthsOf("network.channel_holds", ids.oldHold)).toBe(882);
    expect(await tenthsOf("broadcast.channels", ids.tv)).toBe(41);
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM broadcast.channels`)).n).toBe(7);
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM network.channel_holds`)).n).toBe(3);
    expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM broadcast.channels WHERE band = 'radio' AND tenths % 2 = 1`)).n).toBe(0);
  });

  it("moves the desk's radio proposals, in order, and not TV's", async () => {
    const creator = await one<{ proposed_tenths: number; proposed_channels: number[] }>(`SELECT proposed_tenths, proposed_channels FROM network.creators WHERE id = $1`, [ids.creator]);
    expect(creator).toEqual({ proposed_tenths: 1020, proposed_channels: [1020, 1078, 954] });
    const tv = await one<{ proposed_tenths: number; proposed_channels: number[] }>(`SELECT proposed_tenths, proposed_channels FROM network.creators WHERE id = $1`, [ids.tvCreator]);
    expect(tv).toEqual({ proposed_tenths: 383, proposed_channels: [383, 451] });
    expect((await one<{ proposed_tenths: number }>(`SELECT proposed_tenths FROM network.permission_requests WHERE id = $1`, [ids.request])).proposed_tenths).toBe(1020);
  });

  it("guards channels again afterwards: a signed-on number is fixed, and odd tenths are refused", async () => {
    await expect(db.pool.query(`UPDATE broadcast.channels SET tenths = 994 WHERE id = $1`, [ids.lofiChannel])).rejects.toThrow(/fixed after first sign-on/);
    await expect(
      db.pool.query(`INSERT INTO broadcast.channels (station_id, market_id, band, tenths) VALUES ($1, $2, 'radio', 993)`, [ids.top1, ids.la])
    ).rejects.toThrow(/channel_number_in_band/);
  });
});

describe("the seed", () => {
  let fresh: Awaited<ReturnType<typeof freshDatabase>>;
  beforeAll(async () => {
    fresh = await freshDatabase(adminUrl);
  }, 60_000);
  afterAll(async () => {
    await fresh?.drop();
  });

  const run = async (options: Parameters<typeof seed>[1] = {}) => {
    const client = await fresh.pool.connect();
    const lines: string[] = [];
    try {
      return { done: await seed(client, { ...options, log: (l) => lines.push(l) }), lines };
    } finally {
      client.release();
    }
  };
  const networkDial = async () =>
    (
      await fresh.pool.query(
        `SELECT s.call_sign, s.kind, s.handle, s.name, s.description, s.colour, s.category, s.iab_categories, c.band, c.tenths
         FROM broadcast.stations s JOIN broadcast.channels c ON c.station_id = s.id AND c.released_at IS NULL
         JOIN network.markets m ON m.id = c.market_id AND m.slug = 'inland-empire'
         WHERE s.kind = 'catalog' ORDER BY s.call_sign`
      )
    ).rows;

  it("puts the markets alone in when asked (the real-API e2e runs)", async () => {
    const { done } = await run({ networkStations: false });
    expect(done.networkStations).toBe(0);
    expect((await fresh.pool.query(`SELECT slug FROM network.markets ORDER BY slug`)).rows.map((r) => r.slug)).toEqual(["high-desert", "inland-empire", "los-angeles"]);
    expect(await networkDial()).toEqual([]);
  });

  it("seeds RETRO on 4.1, LOFI on 99.2 and BEAT on 94.2", async () => {
    const { done, lines } = await run();
    expect(done.networkStations).toBe(3);
    expect(lines).toEqual([]);
    const dial = await networkDial();
    expect(dial.map((r) => [r.call_sign, r.band, r.tenths])).toEqual([
      ["BEAT", "radio", 942],
      ["LOFI", "radio", 992],
      ["RETRO", "tv", 41]
    ]);
    expect(dial[0]).toMatchObject({
      kind: "catalog",
      handle: "beat",
      name: "BEAT",
      description: "Instrumentals and beat tapes, all day.",
      colour: "#2A6A2E",
      category: "Music",
      iab_categories: ["338"]
    });
  });

  it("is safe to run again", async () => {
    const before = await networkDial();
    const { lines } = await run();
    expect(lines).toEqual([]);
    expect(await networkDial()).toEqual(before);
    expect((await fresh.pool.query(`SELECT count(*)::int AS n FROM broadcast.stations`)).rows[0].n).toBe(3);
    expect((await fresh.pool.query(`SELECT count(*)::int AS n FROM broadcast.channels`)).rows[0].n).toBe(3);
  });

  it("moves a network station on another number to its own", async () => {
    await fresh.pool.query(`UPDATE broadcast.channels SET tenths = 990 WHERE tenths = 992 AND band = 'radio'`);
    await run();
    expect((await networkDial()).find((r) => r.call_sign === "LOFI")?.tenths).toBe(992);
  });

  it("leaves a call sign another station has alone", async () => {
    await fresh.pool.query(`UPDATE broadcast.stations SET kind = 'station', name = 'Inland Beat' WHERE call_sign = 'BEAT'`);
    const { lines } = await run();
    expect(lines).toEqual(["BEAT: the call sign belongs to another station (station); not seeded."]);
    expect((await fresh.pool.query(`SELECT name FROM broadcast.stations WHERE call_sign = 'BEAT'`)).rows[0].name).toBe("Inland Beat");
  });
});
