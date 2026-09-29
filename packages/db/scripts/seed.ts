// Seed data: the markets, with their ZIP codes, and Opencast's own network stations.
// Safe to run again: markets and ZIPs are upserted, stations are matched by call sign, and a
// network station on another number moves to its own (LOFI from 99.1 to 99.2) when that's free.
//   npm run db:seed                         (DATABASE_URL, or the local Docker database)
//   tsx scripts/seed.ts --markets-only      (the markets alone: the real-API e2e runs, whose
//                                            fixtures have their own BEAT)
import { pathToFileURL } from "node:url";
import pg from "pg";

/**
 * The Inland Empire: western Riverside County and the San Bernardino valley and mountains.
 * The High Desert (Victor Valley) is its own market, and the Coachella Valley isn't in either.
 */
const INLAND_EMPIRE_ZIPS = [
  // San Bernardino County: the west valley (Chino, Chino Hills, Montclair, Ontario, Rancho Cucamonga, Upland)
  "91701", "91708", "91709", "91710", "91729", "91730", "91737", "91739", "91743", "91758", "91759",
  "91761", "91762", "91763", "91764", "91784", "91785", "91786",
  // the east valley (Bloomington, Colton, Fontana, Grand Terrace, Highland, Loma Linda, Mentone,
  // Redlands, Rialto, San Bernardino, Yucaipa) and Calimesa
  "92313", "92316", "92318", "92320", "92324", "92331", "92334", "92335", "92336", "92337", "92346",
  "92350", "92354", "92357", "92358", "92359", "92369", "92373", "92374", "92375", "92376", "92377",
  "92399", "92401", "92402", "92403", "92404", "92405", "92406", "92407", "92408", "92410", "92411",
  "92413", "92415", "92418", "92423", "92427",
  // the San Bernardino Mountains (Big Bear, Lake Arrowhead, Crestline, Running Springs, Forest Falls)
  "92305", "92314", "92315", "92317", "92321", "92322", "92325", "92326", "92333", "92339", "92352",
  "92378", "92382", "92385", "92386", "92391",
  // Riverside County: Riverside, Eastvale, Norco, Corona, Moreno Valley and the Pass (Banning, Beaumont, Cabazon)
  "91752", "92501", "92502", "92503", "92504", "92505", "92506", "92507", "92508", "92509", "92513",
  "92514", "92516", "92517", "92518", "92519", "92521", "92522", "92551", "92552", "92553", "92554",
  "92555", "92556", "92557", "92860", "92877", "92878", "92879", "92880", "92881", "92882", "92883",
  "92220", "92223", "92230",
  // Perris, Menifee, Hemet, San Jacinto, Lake Elsinore, Wildomar, Murrieta, Temecula and the hills
  "92530", "92531", "92532", "92536", "92539", "92543", "92544", "92545", "92546", "92548", "92549",
  "92561", "92562", "92563", "92564", "92567", "92570", "92571", "92572", "92581", "92582", "92583",
  "92584", "92585", "92586", "92587", "92589", "92590", "92591", "92592", "92593", "92595", "92596",
  "92599"
];

const markets = [
  { slug: "inland-empire", name: "Inland Empire", lat: "34.0556", lng: "-117.1825", zips: INLAND_EMPIRE_ZIPS },
  { slug: "los-angeles", name: "Los Angeles", lat: "34.0522", lng: "-118.2437", zips: ["90012", "90026", "90028", "90291"] },
  { slug: "high-desert", name: "High Desert", lat: "34.5362", lng: "-117.2928", zips: ["92392", "92395", "92308"] }
];

/**
 * Opencast's own network stations (kind "catalog": run by Opencast from the Network desk, and
 * shown there as the Opencast catalog). No programs yet: they sign on from master control once
 * they have a library and a log.
 */
const networkStations = [
  {
    callSign: "RETRO",
    handle: "retro",
    name: "Retro Rerun",
    description: "Classic cartoons, around the clock.",
    colour: "#B23A2A", // 5.95:1 against white
    category: "Classic",
    iab: ["640", "645"], // Entertainment > Television, Genres > Family/Children
    market: "inland-empire",
    band: "tv",
    tenths: 41 // 4.1
  },
  {
    callSign: "LOFI",
    handle: "lofi",
    name: "LOFI",
    description: "Lo-fi beats, day and night.",
    colour: "#5A3E8C", // 8.39:1 against white
    category: "Music",
    iab: ["338"], // Entertainment > Music
    market: "inland-empire",
    band: "radio",
    tenths: 992 // 99.2 (was 99.1: the radio band is on even tenths, so it matches no real FM station)
  },
  {
    callSign: "BEAT",
    handle: "beat",
    name: "BEAT",
    description: "Instrumentals and beat tapes, all day.",
    colour: "#2A6A2E", // 6.56:1 against white
    category: "Music",
    iab: ["338"], // Entertainment > Music
    market: "inland-empire",
    band: "radio",
    tenths: 942 // 94.2
  }
] as const;

export interface SeedOptions {
  /** Opencast's own network stations too (the default), or the markets alone. */
  networkStations?: boolean;
  log?: (line: string) => void;
}

/** Seeds the markets (and, unless told not to, the network stations) in one transaction. */
export async function seed(client: pg.Client | pg.PoolClient, options: SeedOptions = {}) {
  const log = options.log ?? ((line: string) => console.warn(line));
  const stations = options.networkStations === false ? [] : networkStations;
  await client.query("begin");
  try {
    const marketIds = new Map<string, string>();
    for (const m of markets) {
      const { rows } = await client.query(
        `insert into network.markets (slug, name, timezone, latitude, longitude, opened_at)
         values ($1, $2, 'America/Los_Angeles', $3, $4, now())
         on conflict (slug) do update set name = excluded.name
         returning id`,
        [m.slug, m.name, m.lat, m.lng]
      );
      marketIds.set(m.slug, rows[0].id);
      for (const zip of m.zips) {
        await client.query(`insert into network.zip_markets (zip, market_id) values ($1, $2) on conflict do nothing`, [zip, rows[0].id]);
      }
    }

    for (const s of stations) {
      const marketId = marketIds.get(s.market)!;
      const existing = await client.query(`select id, kind from broadcast.stations where call_sign = $1`, [s.callSign]);
      let stationId: string;
      if (existing.rows[0]) {
        stationId = existing.rows[0].id;
        if (existing.rows[0].kind !== "catalog") {
          log(`${s.callSign}: the call sign belongs to another station (${existing.rows[0].kind}); not seeded.`);
          continue;
        }
        await client.query(
          `update broadcast.stations set name = $2, description = $3, colour = $4, category = $5, iab_categories = $6::jsonb where id = $1`,
          [stationId, s.name, s.description, s.colour, s.category, JSON.stringify(s.iab)]
        );
      } else {
        const { rows } = await client.query(
          `insert into broadcast.stations (kind, call_sign, handle, name, description, colour, category, iab_categories, home_city)
           values ('catalog', $1, $2, $3, $4, $5, $6, $7::jsonb, 'Inland Empire') returning id`,
          [s.callSign, s.handle, s.name, s.description, s.colour, s.category, JSON.stringify(s.iab)]
        );
        stationId = rows[0].id;
      }
      // Its channel: skipped (and reported) if another station already holds that number.
      const held = await client.query(
        `select station_id from broadcast.channels where market_id = $1 and band = $2 and tenths = $3 and released_at is null`,
        [marketId, s.band, s.tenths]
      );
      if (held.rows[0]) {
        if (held.rows[0].station_id !== stationId) log(`${s.callSign}: ${s.band} ${s.tenths / 10} in ${s.market} is already taken; no channel given.`);
        continue;
      }
      // On another number already (LOFI on 99.1 before the band moved to even tenths; migration
      // 0022 moves it, and this catches a move that couldn't land on its own number): moved to its
      // own, unless it has signed on, when the number is fixed.
      const own = await client.query(
        `select c.id, c.tenths, s.first_signed_on_at from broadcast.channels c join broadcast.stations s on s.id = c.station_id
         where c.station_id = $1 and c.is_primary and c.released_at is null`,
        [stationId]
      );
      if (own.rows[0]?.first_signed_on_at) {
        log(`${s.callSign}: signed on at ${own.rows[0].tenths / 10}, so its number is fixed; not moved to ${s.tenths / 10}.`);
      } else if (own.rows[0]) {
        await client.query(`update broadcast.channels set market_id = $2, band = $3, tenths = $4 where id = $1`, [own.rows[0].id, marketId, s.band, s.tenths]);
      } else {
        await client.query(
          `insert into broadcast.channels (station_id, market_id, band, tenths, is_primary) values ($1, $2, $3, $4, true)`,
          [stationId, marketId, s.band, s.tenths]
        );
      }
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  }
  return { markets: markets.length, zips: INLAND_EMPIRE_ZIPS.length, networkStations: stations.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL ?? "postgres://opencast:opencast@localhost:54329/opencast";
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const done = await seed(client, { networkStations: !process.argv.includes("--markets-only") });
    console.log(`Seeded ${done.markets} markets (${done.zips} Inland Empire ZIPs) and ${done.networkStations} network stations.`);
  } finally {
    await client.end();
  }
}
