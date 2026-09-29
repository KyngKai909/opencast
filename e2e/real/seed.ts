// What the real-API runs start with: enough to open every product on real data. Through the API
// itself wherever an endpoint does it (businesses, money, spots, sponsorships, carriage offers,
// presets, pledges, the desk's creators and recipes), and straight into the database, with the
// API's own test fixtures (apps/api/test/harness.ts), for what only playout or setup would make
// (stations on the dial, library items, the schedule). Modelled on the API's sample week
// (apps/api/test/sample-week.test.ts): the same stations, businesses and people.
//
// The schedule runs on the real clock: hour-long programs from 12 hours ago to 36 hours ahead, so
// "on now" and "up next" have something whenever the run starts.

import { and, eq, gt, lte } from "drizzle-orm";
import { importJWK, SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import { schema } from "@opencast/db";
import { itemFixture, stationFixture, type Harness } from "../../apps/api/test/harness.js";
import type { Deps, Services } from "../../apps/api/src/v1/context.js";
import { PEOPLE, type Person, type Seed } from "./shared.js";

interface SeedContext {
  db: Deps["db"];
  services: Services;
  deps: Deps;
  apiBase: string;
  signingJwk: Record<string, unknown>;
  appId: string;
}

const $ = (dollars: number) => Math.round(dollars * 1_000_000);
const HOUR = 3_600_000;

export async function seed(ctx: SeedContext): Promise<Seed> {
  const { db, services } = ctx;
  const key = await importJWK(ctx.signingJwk as Parameters<typeof importJWK>[0], "ES256");
  const tokenFor = (person: string) =>
    new SignJWT({ sid: randomUUID() }).setProtectedHeader({ alg: "ES256" }).setIssuer("privy.io").setAudience(ctx.appId).setSubject(`did:privy:${person}`).setIssuedAt().setExpirationTime("2h").sign(key);

  /** A request as someone, through the API. Throws with the API's answer when the status isn't `expect`. */
  async function as<T = any>(person: Person | null, method: string, path: string, body?: unknown, expect = method === "POST" ? 201 : 200): Promise<T> {
    const headers: Record<string, string> = {};
    if (person) headers.authorization = `Bearer ${await tokenFor(person)}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${ctx.apiBase}/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    if (res.status !== expect) throw new Error(`seed: ${method} ${path} as ${person ?? "nobody"} answered ${res.status} (wanted ${expect}): ${text}`);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  // The fixtures take a harness; they only need the database, the clock and the services.
  const h = { db, clock: ctx.deps.clock, services } as unknown as Harness;
  const now = ctx.deps.clock.now();

  // --- Markets (packages/db/scripts/seed.ts put them in).
  const markets = await db.select().from(schema.markets);
  const marketId = (slug: string) => {
    const m = markets.find((x) => x.slug === slug);
    if (!m) throw new Error(`seed: no market ${slug}; did packages/db/scripts/seed.ts run?`);
    return m.id;
  };
  const ie = marketId("inland-empire");

  // --- People: signed in once (the API makes their accounts from the token), then named.
  const users = {} as Record<Person, string>;
  for (const person of Object.keys(PEOPLE) as Person[]) {
    const user = await services.accounts.userForToken(await tokenFor(person));
    await db.update(schema.users).set({ displayName: PEOPLE[person].name, isAdmin: person === "dee" }).where(eq(schema.users.id, user.id));
    users[person] = user.id;
  }

  // --- Stations on the Inland Empire dial (and one in the High Desert), as the mocks have them.
  const station = async (
    callSign: string,
    name: string,
    tenths: number,
    colour: string,
    o: { band?: "tv" | "radio"; kind?: "station" | "claimable"; owner?: Person; market?: string; category: string; description: string; homeCity?: string }
  ) => {
    const s = await stationFixture(h, { callSign, name, colour, tenths, band: o.band ?? "tv", kind: o.kind ?? "station", marketId: o.market ?? ie, ownerId: o.owner ? users[o.owner] : undefined, signedOn: true });
    await db.update(schema.stations).set({ category: o.category, description: o.description, homeCity: o.homeCity ?? "Redlands", studioLatitude: 34.05, studioLongitude: -117.18 }).where(eq(schema.stations.id, s.id));
    const channel = `${Math.floor(tenths / 10)}.${tenths % 10}`;
    return { id: s.id, callSign, channel, name };
  };
  const stations = {
    civc: await station("CIVC", "Inland Civic", 71, "#2E6B5A", { category: "Public affairs", description: "Town halls and council meetings, unedited." }),
    beat: await station("BEAT", "Inland Beat", 121, "#8C3B7A", { owner: "kai", category: "Music", description: "Beat makers, crate diggers and the Inland Empire's producers." }),
    sazn: await station("SAZN", "Sazón", 181, "#A3402A", { category: "Food", description: "Home cooking from Inland Empire kitchens.", homeCity: "Fontana" }),
    reel: await station("REEL", "Saturday Reel", 241, "#9A5412", { owner: "jess", category: "Classic", description: "Restored public-domain films, cartoons and newsreels.", homeCity: "Riverside" }),
    nite: await station("NITE", "Night Desk", 883, "#33507A", { band: "radio", category: "Classic", description: "Old-time radio overnight.", homeCity: "Riverside" }),
    mojv: await station("MOJV", "Mojave Community", 51, "#4F5B2A", { market: marketId("high-desert"), category: "Public affairs", description: "Victorville and the High Desert.", homeCity: "Victorville" })
  };
  // A claimable station airs only its creator's covered works, so CRAT is set up the way the desk
  // does it: Crate's works, their yes, a recipe, and the station from it (Dee operates it).
  const crate = await as<{ id: string }>("dee", "POST", "/admin/creators", { marketId: ie, displayName: "Crate", personName: "Andre Vega", description: "Producers and their tapes", sourcePlatform: "soundcloud", sourceUrl: "https://soundcloud.com/crate", contactEmail: "andre@example.com" });
  await as("dee", "POST", `/admin/creators/${crate.id}/works`, [
    { title: "Tape swap, side A", durationMs: 28 * 60_000, sourceUrl: "https://soundcloud.com/crate/a" },
    { title: "Tape swap, side B", durationMs: 29 * 60_000, sourceUrl: "https://soundcloud.com/crate/b" },
    { title: "Basement session", durationMs: 55 * 60_000, sourceUrl: "https://soundcloud.com/crate/c" }
  ], 200);
  const permission = async (creatorId: string, note: string) => {
    const asked = await as<{ link: string }>("dee", "POST", `/admin/creators/${creatorId}/permission-requests`, { sentVia: ["email"], note });
    await as(null, "POST", `/permission/${asked.link.split("/permission/")[1]}/answer`, { answer: "yes" }, 200);
  };
  await permission(crate.id, "We'd love to put you on 101.9.");
  const radioRecipe = await as<{ id: string }>("dee", "POST", "/admin/recipes", { name: "Music, radio band", category: "Music", band: "radio", blocks: [{ start: "00:00", end: "24:00", source: "creator" }], maxAiringsPerWorkPerWeek: 21, breakRule: { mode: "every_n_minutes", everyMinutes: 30 } });
  const cratSetUp = await as<{ station: { id: string } }>("dee", "POST", `/admin/creators/${crate.id}/station`, { recipeId: radioRecipe.id, marketId: ie, band: "radio", channel: "101.9", callSign: "CRAT", name: "Crate", operatorUserId: users.dee, signOnAt: new Date(now.getTime() - 24 * HOUR).toISOString() });
  const crat = { id: cratSetUp.station.id, callSign: "CRAT", channel: "101.9", name: "Crate" };
  await db.update(schema.stations).set({ colour: "#7E2F35", category: "Music", description: "Producers and their tapes.", homeCity: "Redlands", status: "on_air", firstSignedOnAt: new Date(now.getTime() - 24 * HOUR) }).where(eq(schema.stations.id, crat.id));

  await db.insert(schema.stationMemberships).values({ stationId: stations.beat.id, userId: users.marcus, role: "operator" });
  await db.update(schema.stations).set({ takesOrders: true, orderTurnaround: "About a week", orderFromMicros: $(100) }).where(eq(schema.stations.id, stations.beat.id));

  // --- Programs: through the API for the stations people own, straight in for the others.
  const programVia = async (owner: Person, stationId: string, title: string, category: string) =>
    (await as<{ id: string }>(owner, "POST", `/stations/${stationId}/programs`, { title, description: `${title}, on the air every day.`, category })).id;
  const programDirect = async (stationId: string, title: string, category: string) =>
    (await db.insert(schema.programs).values({ stationId, title, description: `${title}, on the air every day.`, category }).returning())[0].id;
  const programs = {
    lateCrate: await programVia("kai", stations.beat.id, "Late Crate", "Music"),
    beatTapeLive: await programVia("kai", stations.beat.id, "Beat Tape Live", "Music"),
    saturdayReel: await programVia("jess", stations.reel.id, "Saturday Reel", "Classic"),
    councilMeeting: await programDirect(stations.civc.id, "Redlands City Council", "Public affairs"),
    homeCooking: await programDirect(stations.sazn.id, "Home Cooking", "Food"),
    nightDesk: await programDirect(stations.nite.id, "The Night Desk", "Classic")
  };
  const extra = {
    mojv: await programDirect(stations.mojv.id, "High Desert Report", "Public affairs")
  };

  // --- Library and the schedule: an hour-long program every hour, 12 hours back to 36 ahead.
  const schedule: Array<[{ id: string }, string[]]> = [
    [stations.civc, [programs.councilMeeting]],
    [stations.beat, [programs.lateCrate, programs.beatTapeLive]],
    [stations.sazn, [programs.homeCooking]],
    [stations.reel, [programs.saturdayReel]],
    [stations.nite, [programs.nightDesk]],
    [stations.mojv, [extra.mojv]]
  ];
  /** A library item with its rights confirmed: the API's itemFixture, or the same for radio (audio). */
  const item = async (stationId: string, radio: boolean, fields: { title: string; programId?: string; episodeNumber?: number; durationMs: number; code?: "PGM" | "SID" | "BMP" }) => {
    if (!radio) return itemFixture(h, stationId, fields);
    const [row] = await db.insert(schema.assets).values({ stationId, programId: fields.programId ?? null, title: fields.title, episodeNumber: fields.episodeNumber ?? null, code: fields.code ?? "PGM", source: "upload", mediaKind: "audio", durationMs: fields.durationMs, status: "ready" }).returning();
    await db.insert(schema.rightsConfirmations).values({ assetId: row!.id, basis: "made_it" });
    await db.insert(schema.assetFiles).values({ assetId: row!.id, version: 1, storage: "local", location: `/fixtures/${row!.id}.m4a` });
    return row!;
  };
  const radio = new Set([stations.nite.id]);
  const titles = new Map((await db.select({ id: schema.programs.id, title: schema.programs.title }).from(schema.programs)).map((p) => [p.id, p.title]));
  const first = Math.floor(now.getTime() / HOUR) * HOUR - 12 * HOUR;
  for (const [s, programIds] of schedule) {
    const episodes = new Map<string, string[]>();
    for (const programId of programIds) {
      const eps: string[] = [];
      for (let n = 1; n <= 4; n++) eps.push((await item(s.id, radio.has(s.id), { programId, title: `${titles.get(programId)}, episode ${n}`, episodeNumber: n, durationMs: 58 * 60_000 })).id);
      episodes.set(programId, eps);
    }
    await item(s.id, radio.has(s.id), { title: "Station ID", code: "SID", durationMs: 5_000 });
    await item(s.id, radio.has(s.id), { title: "Bumper", code: "BMP", durationMs: 10_000 });
    const rows = Array.from({ length: 48 }, (_, i) => {
      const programId = programIds[i % programIds.length]!;
      const eps = episodes.get(programId)!;
      const startsAt = new Date(first + i * HOUR);
      return { stationId: s.id, startsAt, endsAt: new Date(startsAt.getTime() + HOUR), kind: "program" as const, code: "PGM" as const, assetId: eps[Math.floor(i / programIds.length) % eps.length]!, programId };
    });
    await db.insert(schema.logEntries).values(rows);
  }
  // CRAT: its imported works, back to back, over the same hours (whatever setting it up scheduled stays).
  const cratWorks = await db.select().from(schema.assets).where(eq(schema.assets.stationId, crat.id));
  const covered = cratWorks.filter((a) => a.code === "PGM");
  if (!covered.length) throw new Error("seed: setting up CRAT imported no works");
  const cratRows = [];
  for (let t = first, i = 0; t < first + 48 * HOUR; i++) {
    const a = covered[i % covered.length]!;
    const length = Math.max(a.durationMs ?? 30 * 60_000, 60_000);
    cratRows.push({ stationId: crat.id, startsAt: new Date(t), endsAt: new Date(t + length), kind: "program" as const, code: "PGM" as const, assetId: a.id });
    t += length;
  }
  await db.delete(schema.logEntries).where(eq(schema.logEntries.stationId, crat.id));
  await db.insert(schema.logEntries).values(cratRows);

  // On the air: what the playout worker records while it plays (it isn't running here, so nothing
  // streams: players find no segments). MOJV stays off the air.
  for (const s of [stations.civc, stations.beat, stations.sazn, stations.reel, stations.nite, crat]) {
    const [entry] = await db
      .select()
      .from(schema.logEntries)
      .where(and(eq(schema.logEntries.stationId, s.id), lte(schema.logEntries.startsAt, now), gt(schema.logEntries.endsAt, now)));
    await db.insert(schema.playoutState).values({ stationId: s.id, onAir: true, currentLogEntryId: entry?.id ?? null, currentAssetId: entry?.assetId ?? null, currentStartedAt: entry?.startsAt ?? null, updatedAt: now });
  }

  // --- Breaks: BEAT and REEL sell their open time on the spot market.
  for (const [s, owner] of [[stations.beat, "kai"], [stations.reel, "jess"]] as const) {
    await as(owner, "PUT", `/stations/${s.id}/break-rule`, { mode: "every_n_minutes", everyMinutes: 30, lengthMs: 90_000, spotMsPerHour: 120_000, sameSpotPerHour: 2, fillOrder: ["SPT", "UND", "BMP", "SID"], openTimeTo: "spot_market", blockedCategories: [] });
  }

  // --- Carriage: Saturday Reel is offered to any station (barter or $2.50 an airing).
  const offer = await as<{ id: string }>("jess", "POST", `/programs/${programs.saturdayReel}/offer`, {
    cashPriceMicros: $(2.5),
    cashPriceUnit: "per_airing",
    barterMakerMsPerHour: 60_000,
    airingsPerEpisode: 2,
    windowDays: 7,
    liveOnly: false,
    noticeDays: 7,
    approval: "any_station",
    radioBandAllowed: true,
    termsOffered: ["barter", "cash"]
  });

  // --- Businesses, their money (the fake card provider) and their spots.
  const orange = (await as<{ id: string }>("maya", "POST", "/businesses", { name: "Orange Street Coffee", category: "Coffee and food", customersWhere: "online", marketIds: [ie] })).id;
  const bikes = (await as<{ id: string }>("omar", "POST", "/businesses", { name: "Redlands Bikes", category: "Retail", customersWhere: "online", marketIds: [ie] })).id;
  const fund = async (person: Person, business: string, dollars: number, token: string) => {
    const card = await as<Array<{ id: string }>>(person, "POST", `/businesses/${business}/funding-sources`, { kind: "card", token });
    await as(person, "POST", `/businesses/${business}/deposits`, { amountMicros: $(dollars), fundingSourceId: card[0]!.id });
  };
  await fund("maya", orange, 60, "tok_4242");
  await fund("omar", bikes, 150, "tok_4242");

  /** A spot with its file, sent for review; approved by Dee (the review queue) unless `review` is false. */
  const spot = async (person: Person, business: string, title: string, lengthSec: 15 | 30, rate: { kind: "per_airing" | "per_thousand"; micros: number; perAiringMaxMicros?: number | null }, approve = true) => {
    const s = await as<{ id: string }>(person, "POST", `/businesses/${business}/spots`, { title, lengthSec, category: "Food", rate: { perAiringMaxMicros: null, ...rate }, budget: { totalMicros: $(200), dailyCapMicros: $(12) } });
    await db.insert(schema.spotFiles).values({ spotId: s.id, version: 1, location: `/fixtures/${title}.mp4`, durationMs: lengthSec * 1000 });
    await as(person, "POST", `/spots/${s.id}/submit`, undefined, 200);
    if (approve) await as("dee", "POST", `/review/spots/${s.id}`, { decision: "approve" }, 200);
    return s.id;
  };
  const fallMenu = await spot("maya", orange, "Fall menu", 30, { kind: "per_airing", micros: $(4) });
  const nightOwl = await spot("maya", orange, "Night owl", 15, { kind: "per_thousand", micros: $(8), perAiringMaxMicros: $(3) });
  const rideSeason = await spot("omar", bikes, "Ride season", 30, { kind: "per_airing", micros: $(3) }, false);
  // REEL runs Fall menu; BEAT's rotation is empty, so its breaks can be filled from the market.
  await as("jess", "PUT", `/stations/${stations.reel.id}/rotations/main`, { spotIds: [fallMenu] });

  // A sponsorship waiting for BEAT's answer: Orange Street Coffee underwrites Late Crate.
  await as("maya", "POST", `/businesses/${orange}/sponsorships`, {
    stationId: stations.beat.id,
    programId: programs.lateCrate,
    monthlyMicros: $(50),
    creditText: "Orange Street Coffee, roasting on Orange Street in Redlands.",
    startsOn: now.toISOString().slice(0, 10)
  });

  // --- A viewer: Sam lives in the Inland Empire, keeps two presets and pledges to REEL.
  await as("sam", "PATCH", "/me", { marketId: ie });
  await as("sam", "POST", "/me/presets", { stationId: stations.beat.id, key: 1 }, 200);
  await as("sam", "POST", "/me/presets", { stationId: stations.reel.id, key: 2 }, 200);
  await as("sam", "POST", `/stations/${stations.reel.id}/pledges`, { cadence: "monthly", amountMicros: $(10), creditOnAir: true });

  // --- Network desk: Lupe said yes to two works (her station is the desk's flow to set up).
  const lupe = await as<{ id: string }>("dee", "POST", "/admin/creators", {
    marketId: ie,
    displayName: "Tía Lupe's Kitchen",
    personName: "Lupe Ortiz",
    description: "Cooking in Spanish, Fontana",
    sourcePlatform: "youtube",
    sourceUrl: "https://youtube.com/@tialupe",
    contactEmail: "lupe@example.com"
  });
  await as("dee", "POST", `/admin/creators/${lupe.id}/works`, [
    { title: "Mole, part 1", durationMs: 12 * 60_000, sourceUrl: "https://youtube.com/v/1" },
    { title: "Pozole", durationMs: 15 * 60_000, sourceUrl: "https://youtube.com/v/2" },
    { title: "A song someone else owns", durationMs: 3 * 60_000, sourceUrl: "https://youtube.com/v/3", leftOutReason: "Likely someone else's rights" }
  ], 200);
  await permission(lupe.id, "We'd love to put you on 33.1.");
  const recipe = await as<{ id: string }>("dee", "POST", "/admin/recipes", {
    name: "Cooking and food, TV band",
    category: "Food",
    band: "tv",
    blocks: [{ start: "06:00", end: "24:00", source: "creator" }],
    maxAiringsPerWorkPerWeek: 3,
    breakRule: { mode: "every_n_minutes", everyMinutes: 30 }
  });

  return {
    markets: { inlandEmpire: ie, losAngeles: marketId("los-angeles"), highDesert: marketId("high-desert") },
    users,
    stations: { ...stations, crat },
    programs,
    offers: { saturdayReel: offer.id },
    businesses: { orange, bikes },
    spots: { fallMenu, nightOwl, rideSeason },
    creators: { lupe: lupe.id, crate: crate.id },
    recipes: { food: recipe.id }
  };
}
