// Local development data: the three markets the designs use, with a few ZIPs each.
// Safe to run again.
import pg from "pg";

const url = process.env.DATABASE_URL ?? "postgres://opencast:opencast@localhost:54329/opencast";
const markets = [
  { slug: "inland-empire", name: "Inland Empire", lat: "34.0556", lng: "-117.1825", zips: ["92373", "92374", "92324", "92335", "92501", "92507"] },
  { slug: "los-angeles", name: "Los Angeles", lat: "34.0522", lng: "-118.2437", zips: ["90012", "90026", "90028", "90291"] },
  { slug: "high-desert", name: "High Desert", lat: "34.5362", lng: "-117.2928", zips: ["92392", "92395", "92308"] }
];

const client = new pg.Client({ connectionString: url });
await client.connect();
for (const m of markets) {
  const { rows } = await client.query(
    `insert into network.markets (slug, name, timezone, latitude, longitude, opened_at)
     values ($1, $2, 'America/Los_Angeles', $3, $4, now())
     on conflict (slug) do update set name = excluded.name
     returning id`,
    [m.slug, m.name, m.lat, m.lng]
  );
  for (const zip of m.zips) {
    await client.query(`insert into network.zip_markets (zip, market_id) values ($1, $2) on conflict do nothing`, [zip, rows[0].id]);
  }
}
await client.end();
console.log(`Seeded ${markets.length} markets.`);
