// A station's evening, compressed to about six and a half minutes, for the Phase 5 check
// (docs/phase-5-demo.md). Seeds the database; the running worker airs it.
//
//   npx tsx --conditions=source scripts/demo-evening.ts     (from apps/worker, with the worker running)
//
//   0:00  PGM  Late Crate, then a break: a spot (held, with its code), the credit, station ID
//   1:16  PGM  Saturday Reel, carried from REEL under barter: REEL's spot in its share
//   2:16  LIVE Crate Talk: through Livepeer when LIVEPEER_API_KEY is set (one stream is created, at
//         the ladder's renditions; push to it over RTMP); without it the stand-by slate airs
//   3:16  (nothing on the log: filled from the library when nobody acts)
//   4:16  OFF  signed off (the sign-off slate, then the playlist ends), back at 6:24 from the station ID
//   (DEMO_LIVE_S shortens or lengthens the live block; what follows moves with it.)
//
// DEMO_STATION=<station ID>: the evening again on a station an earlier run made (its Livepeer stream,
// translator and library reused; what's on its log from the evening's start comes off first).
// DEMO_LEAD_S: seconds from now to the evening's start (45 by default; longer gives preparation
// time to finish first). DEMO_LIVEPEER=off: no Livepeer stream even with a key. DEMO_TRANSLATOR_URL:
// an RTMP address to relay the channel to (a local sink; never a real destination here).

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createDeps, createV1 } from "@opencast/api/runtime";
import { STORAGE_ROOT } from "../src/config.js";

const deps = createDeps(process.env, STORAGE_ROOT);
const { services } = createV1(deps);
const db = deps.db;
const dir = path.join(STORAGE_ROOT, "demo");
await fs.mkdir(dir, { recursive: true });

async function clip(name: string, seconds: number, picture: string, tone: number) {
  const file = path.join(dir, `${name}.mp4`);
  try {
    await fs.access(file);
    return file;
  } catch {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `${picture}=duration=${seconds}:size=1280x720:rate=30`, "-f", "lavfi", "-i", `sine=frequency=${tone}:duration=${seconds}`, "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file]);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`))));
    });
    return file;
  }
}

const letters = () => Array.from({ length: 4 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join("");
const [lateCrate, reelFilm, spotA, spotB, bumper] = await Promise.all([
  clip("late-crate", 35, "testsrc", 440),
  clip("saturday-reel", 30, "smptebars", 330),
  clip("orange-street", 15, "rgbtestsrc", 660),
  clip("reel-sponsor", 15, "testsrc2", 550),
  clip("bumper", 10, "smptehdbars", 880)
]);

const [market] = await db.select().from(schema.markets).where(eq(schema.markets.slug, "inland-empire"));
if (!market) throw new Error("Run npm run db:seed first.");

interface Cast {
  beat: typeof schema.stations.$inferSelect;
  reel: typeof schema.stations.$inferSelect;
  crate: { id: string };
  film: { id: string };
  lateCrateProgram: { id: string };
  reelProgram: { id: string };
  agreement: { id: string };
}

/** Two stations, their library, a carriage agreement under barter, a business with spots and a sponsorship. */
async function cast(): Promise<Cast> {
  async function station(callSign: string, name: string, colour: string, tenths: number) {
    const [s] = await db.insert(schema.stations).values({ callSign, name, colour, homeCity: "Redlands", status: "on_air", firstSignedOnAt: new Date() }).returning();
    await db.insert(schema.channels).values({ stationId: s.id, marketId: market.id, band: "tv", tenths });
    await db.insert(schema.breakRules).values({ stationId: s.id, mode: "after_every_program", lengthMs: 120_000 });
    return s;
  }
  async function item(stationId: string, title: string, code: "PGM" | "BMP" | "SID", file: string, seconds: number, programId?: string) {
    const [a] = await db.insert(schema.assets).values({ stationId, programId: programId ?? null, title, code, source: "upload", mediaKind: "video", durationMs: seconds * 1000, status: "ready" }).returning();
    // Stored by content ID; the worker prepares it (the ladder, once) before air.
    const { cid } = await services.library.content.store(file, { storageClass: "standard" });
    const [f] = await db.insert(schema.assetFiles).values({ assetId: a.id, version: 1, contentId: cid }).returning();
    await services.library.content.addRef(db, cid, "asset_file", f.id);
    await db.insert(schema.rightsConfirmations).values({ assetId: a.id, basis: "made_it" });
    return a;
  }

  const tvTaken = new Set((await db.select({ t: schema.channels.tenths }).from(schema.channels).where(eq(schema.channels.marketId, market.id))).map((r) => Math.floor(r.t / 10)));
  const freeMajor = () => {
    for (let m = 12; m < 70; m++) if (!tvTaken.has(m)) return tvTaken.add(m), m;
    throw new Error("No free channel");
  };
  const beat = await station(letters(), "Inland Beat", "#8C3B7A", freeMajor() * 10 + 1);
  const reel = await station(letters(), "Reel", "#1F4E79", freeMajor() * 10 + 1);
  await item(beat.id, "Back to the reel", "BMP", bumper, 10);

  const [lateCrateProgram] = await db.insert(schema.programs).values({ stationId: beat.id, title: "Late Crate", description: "Records from the Inland Empire." }).returning();
  const crate = await item(beat.id, "Late Crate, ep. 14", "PGM", lateCrate, 35, lateCrateProgram.id);
  const [reelProgram] = await db.insert(schema.programs).values({ stationId: reel.id, title: "Saturday Reel", description: "Films from the archive." }).returning();
  const film = await item(reel.id, "Saturday Reel, ep. 1", "PGM", reelFilm, 30, reelProgram.id);

  // Carriage: REEL offers Saturday Reel under barter, filling a quarter of each hour's break time.
  const [offer] = await db.insert(schema.offers).values({ programId: reelProgram.id, makerStationId: reel.id, termsOffered: ["barter"], barterMakerMsPerHour: 15 * 60_000, approval: "any_station" }).returning();
  const [request] = await db.insert(schema.requests).values({ offerId: offer.id, carrierStationId: beat.id, term: "barter", slots: [], startsOn: new Date().toISOString().slice(0, 10), status: "approved" }).returning();
  const [agreement] = await db
    .insert(schema.agreements)
    .values({ requestId: request.id, offerId: offer.id, programId: reelProgram.id, makerStationId: reel.id, carrierStationId: beat.id, term: "barter", barterMakerMsPerHour: 15 * 60_000, startedAt: new Date(Date.now() - 3_600_000) })
    .returning();

  // A business with money, a spot in each station's rotation, and a sponsorship for the credit.
  const [business] = await db.insert(schema.advertisers).values({ name: "Orange Street Coffee", category: "Coffee and food", customersWhere: "online" }).returning();
  await services.ledger.addFundingSource(business.id, { kind: "card", token: "tok_visa_4417", makeDefault: true });
  const [source] = await db.select().from(schema.fundingSources).where(eq(schema.fundingSources.advertiserId, business.id));
  await services.ledger.addMoney(business.id, { amountMicros: 100_000_000, fundingSourceId: source.id });
  async function spot(title: string, file: string, stationId: string, code?: string) {
    const [s] = await db
      .insert(schema.spotsTable)
      .values({ advertiserId: business.id, title, lengthSec: 15, category: "Food", status: "listed", rateKind: "per_airing", rateMicros: 4_000_000, totalBudgetMicros: 40_000_000, dailyCapMicros: 12_000_000 })
      .returning();
    const { cid } = await services.library.content.store(file, { storageClass: "standard" });
    const [f] = await db.insert(schema.spotFiles).values({ spotId: s.id, version: 1, contentId: cid, durationMs: 15_000 }).returning();
    await services.library.content.addRef(db, cid, "spot_file", f.id);
    if (code) await db.insert(schema.codes).values({ spotId: s.id, code, offer: "10% off" });
    const [rotation] = await db.insert(schema.rotations).values({ stationId, kind: "main" }).returning();
    await db.insert(schema.rotationSpots).values({ rotationId: rotation.id, spotId: s.id, position: 0 });
    return s;
  }
  await spot("Fall menu", spotA, beat.id, "ORANGE10");
  await spot("Reel's sponsor", spotB, reel.id);
  const [sponsorship] = await db
    .insert(schema.sponsorships)
    .values({ advertiserId: business.id, stationId: beat.id, monthlyMicros: 25_000_000, creditText: "A family coffee house on Orange Street in downtown Redlands.", creditCheckedAt: new Date(), status: "requested", startsOn: new Date().toISOString().slice(0, 8) + "01" })
    .returning();
  await services.spots.decideSponsorship(sponsorship.id, (await db.insert(schema.users).values({ displayName: "Kai" }).returning())[0].id, { decision: "approve" });
  return { beat, reel, crate, film, lateCrateProgram, reelProgram, agreement };
}

/** DEMO_STATION: the evening again on a station an earlier run made (its Livepeer stream too). */
async function again(stationId: string): Promise<Cast> {
  const [beat] = await db.select().from(schema.stations).where(eq(schema.stations.id, stationId));
  if (!beat) throw new Error(`No station ${stationId}`);
  const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.carrierStationId, beat.id));
  const [reel] = await db.select().from(schema.stations).where(eq(schema.stations.id, agreement.makerStationId));
  const [crate] = await db.select().from(schema.assets).where(and(eq(schema.assets.stationId, beat.id), eq(schema.assets.code, "PGM")));
  const [film] = await db.select().from(schema.assets).where(and(eq(schema.assets.stationId, reel.id), eq(schema.assets.code, "PGM")));
  return { beat, reel, crate, film, lateCrateProgram: { id: crate.programId! }, reelProgram: { id: agreement.programId }, agreement };
}

const reuse = process.env.DEMO_STATION;
const { beat, reel, crate, film, lateCrateProgram, reelProgram, agreement } = reuse ? await again(reuse) : await cast();

// The evening.
const t0 = Math.ceil((Date.now() + Number(process.env.DEMO_LEAD_S ?? 45) * 1000) / 60_000) * 60_000;
const at = (s: number) => new Date(t0 + s * 1000);
// DEMO_LIVE_S: the live block's length (60 s by default; whole segments). A minute of dead air follows it.
const liveEnd = 136 + Math.max(4, Math.round(Number(process.env.DEMO_LIVE_S ?? 60) / 4) * 4);
// The live source. With a Livepeer key, the product's own path: one Livepeer stream at the ladder's renditions.
if (reuse) {
  // Earlier evenings (and the dead air they filled) spent the spots' daily caps: the business tops
  // up and raises them, so tonight's breaks have spots again.
  const [funding] = await db.select().from(schema.fundingSources).limit(1);
  if (funding) await services.ledger.addMoney(funding.advertiserId, { amountMicros: 100_000_000, fundingSourceId: funding.id });
  // (A day of budget, $20, has to be there for a spot to stay listed.)
  const spots = await db.select().from(schema.spotsTable);
  for (const s of spots) {
    await db
      .update(schema.spotsTable)
      .set({ dailyCapMicros: 20_000_000, totalBudgetMicros: s.totalBudgetMicros + 100_000_000, status: "listed", pauseReason: null, pausedAt: null })
      .where(eq(schema.spotsTable.id, s.id));
  }
  // What's on the log from the evening's start on (dead air filled since) comes off, as master control would take it off.
  const ahead = (await services.log.entries(beat.id, new Date(t0), new Date(t0 + 86_400_000))).filter((e) => e.startsAt.getTime() > Date.now() && e.endsAt.getTime() > t0);
  for (const e of ahead) await services.log.remove(beat.id, e.id);
}
const [existing] = reuse ? await db.select().from(schema.liveSources).where(eq(schema.liveSources.stationId, beat.id)) : [];
const live = existing
  ? existing
  : process.env.LIVEPEER_API_KEY && process.env.DEMO_LIVEPEER !== "off"
    ? (await services.stations.addLiveSource(beat.id, { kind: "encoder", name: "Studio A" })).source
    : (await db.insert(schema.liveSources).values({ stationId: beat.id, kind: "encoder", name: "Studio A", streamKey: `demo-${randomUUID().slice(0, 8)}` }).returning())[0];
const [liveRow] = await db.select({ streamId: schema.liveSources.livepeerStreamId }).from(schema.liveSources).where(eq(schema.liveSources.id, live.id));
if (process.env.DEMO_TRANSLATOR_URL && !reuse) {
  await db.insert(schema.translators).values({ stationId: beat.id, service: "rtmp", name: "Local sink", rtmpUrl: process.env.DEMO_TRANSLATOR_URL, streamKey: "beat" });
}
const [crateTalk] = (reuse ? await db.select().from(schema.programs).where(and(eq(schema.programs.stationId, beat.id), eq(schema.programs.title, "Crate Talk"))) : []).concat(
  reuse ? [] : await db.insert(schema.programs).values({ stationId: beat.id, title: "Crate Talk", description: "Live from Studio A.", isLive: true }).returning()
);
await db.insert(schema.logEntries).values([
  { stationId: beat.id, startsAt: at(0), endsAt: at(76), kind: "program", code: "PGM", assetId: crate.id, programId: lateCrateProgram.id },
  { stationId: beat.id, startsAt: at(76), endsAt: at(136), kind: "program", code: "PGM", assetId: film.id, programId: reelProgram.id, carriageAgreementId: agreement.id },
  { stationId: beat.id, startsAt: at(136), endsAt: at(liveEnd), kind: "live", code: "PGM", liveSourceId: live.id, programId: crateTalk.id },
  { stationId: beat.id, startsAt: at(liveEnd + 60), endsAt: at(liveEnd + 188), kind: "off_air", code: "OPEN" }
]);
await db.insert(schema.playoutState).values({ stationId: beat.id, onAir: true }).onConflictDoUpdate({ target: schema.playoutState.stationId, set: { onAir: true } });
// Written straight to the log: a station already on air is told to read it again.
await services.playout.replan(beat.id);

const hlsPort = process.env.WORKER_HEALTH_PORT ?? "8788";
console.log(
  JSON.stringify(
    {
      station: beat.callSign,
      stationId: beat.id,
      producer: reel.callSign,
      t0: new Date(t0).toISOString(),
      liveSource: live.id,
      livepeerStream: liveRow?.streamId ? { id: liveRow.streamId, name: `${beat.callSign} live: Studio A` } : null,
      translator: process.env.DEMO_TRANSLATOR_URL ?? null,
      hls: `http://localhost:${hlsPort}/hls/${beat.id}/master.m3u8`
    },
    null,
    2
  )
);
process.exit(0);
