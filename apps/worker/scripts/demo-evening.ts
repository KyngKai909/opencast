// A station's evening, compressed to about four and a half minutes, for the
// Phase 5 check. Seeds the dev database; the running worker airs it.
//
//   npx tsx scripts/demo-evening.ts            (from apps/worker, with the dev stack running)
//
//   0:00  PGM  Late Crate, then a break: a spot, the credit, station ID
//   1:15  PGM  Saturday Reel, carried from REEL under barter: REEL's spot in its share
//   2:15  LIVE Crate Talk from an encoder (push to the printed RTMP URL)
//   3:15  (nothing on the log: filled from the library when nobody acts)
//   4:15  OFF  signed off

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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

async function station(callSign: string, name: string, colour: string, tenths: number) {
  const [s] = await db.insert(schema.stations).values({ callSign, name, colour, homeCity: "Redlands", status: "on_air", firstSignedOnAt: new Date() }).returning();
  await db.insert(schema.channels).values({ stationId: s.id, marketId: market.id, band: "tv", tenths });
  await db.insert(schema.breakRules).values({ stationId: s.id, mode: "after_every_program", lengthMs: 120_000 });
  return s;
}
async function item(stationId: string, title: string, code: "PGM" | "BMP" | "SID", file: string, seconds: number, programId?: string) {
  const [a] = await db.insert(schema.assets).values({ stationId, programId: programId ?? null, title, code, source: "upload", mediaKind: "video", durationMs: seconds * 1000, status: "ready" }).returning();
  // Stored by content ID; the worker copies it into its cache before air.
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

// The evening.
const t0 = Math.ceil((Date.now() + 45_000) / 60_000) * 60_000;
const at = (s: number) => new Date(t0 + s * 1000);
const key = `demo-${randomUUID().slice(0, 8)}`;
const [live] = await db.insert(schema.liveSources).values({ stationId: beat.id, kind: "encoder", name: "Studio A", streamKey: key }).returning();
const [crateTalk] = await db.insert(schema.programs).values({ stationId: beat.id, title: "Crate Talk", description: "Live from Studio A.", isLive: true }).returning();
await db.insert(schema.logEntries).values([
  { stationId: beat.id, startsAt: at(0), endsAt: at(75), kind: "program", code: "PGM", assetId: crate.id, programId: lateCrateProgram.id },
  { stationId: beat.id, startsAt: at(75), endsAt: at(135), kind: "program", code: "PGM", assetId: film.id, programId: reelProgram.id, carriageAgreementId: agreement.id },
  { stationId: beat.id, startsAt: at(135), endsAt: at(195), kind: "live", code: "PGM", liveSourceId: live.id, programId: crateTalk.id },
  { stationId: beat.id, startsAt: at(255), endsAt: at(285), kind: "off_air", code: "OPEN" }
]);
await db.insert(schema.playoutState).values({ stationId: beat.id, onAir: true }).onConflictDoUpdate({ target: schema.playoutState.stationId, set: { onAir: true } });

console.log(JSON.stringify({ station: beat.callSign, stationId: beat.id, producer: reel.callSign, t0: new Date(t0).toISOString(), live: `rtmp://127.0.0.1:${process.env.LIVE_LISTEN_PORT ?? 1935}/live/${key}`, hls: `http://localhost:8787/hls/${beat.id}/index.m3u8` }, null, 2));
process.exit(0);
