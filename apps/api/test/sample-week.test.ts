// The Phase 6 sample week, run for real (the services, the outbox and a local chain) and written
// out as docs/phase-6-sample-week.md. Monday 5 to Sunday 11 October 2026, Los Angeles evenings:
//
// - Orange Street Coffee funds $60 by card, lists two spots (a flat $4 one and an $8-per-thousand
//   one), and runs out of money midweek: its spots pause and the stations are told.
// - BEAT has a backup rotation (Redlands Bikes), so its breaks stay sold; REEL has none, so its
//   open time airs station ID and bumpers.
// - A per-thousand airing costs less than its hold; the difference goes back.
// - BEAT carries REEL's Saturday Reel on Monday under barter (REEL's spot in REEL's share, REEL paid);
//   REEL carries BEAT's Late Crate for $2.50 an airing (REEL pays BEAT).
// - Redlands Bikes orders a spot from BEAT: quoted, held, delivered, approved, paid.
// - A viewer pledges $10 a month to REEL.
// - LUPE, a claimable station, earns (a pledge; its programs are the creator's works, which this
//   test doesn't import); Monday's batch puts it in escrow; Lupe claims it.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { schema } from "@opencast/db";
import { escrowChain } from "../src/v1/chain/index.js";
import { createFiller } from "../src/v1/modules/playout/engine/fill.js";
import { fakePayments } from "../src/v1/payments/index.js";
import { anvilAccount, anvilKey, foundryAvailable, startChain, type TestChain } from "./chain.js";
import { anon, createHarness, itemFixture, market, stationFixture, testClip, type Harness, type User } from "./harness.js";

const $ = (d: number) => Math.round(d * 1_000_000);
const usd = (micros: number) => `${micros < 0 ? "−" : ""}$${(Math.abs(micros) / 1_000_000).toFixed(2)}`;
/** 8 pm Los Angeles (PDT, UTC−7) on day `d` of the week (0 = Monday 5 October) is 03:00 UTC the next day. */
const evening = (d: number, hour = 20, minute = 0) => new Date(Date.UTC(2026, 9, 6 + d, hour - 17, minute));
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

describe.runIf(foundryAvailable())("a sample week of money", () => {
  let h: Harness;
  let chain: TestChain;
  let mirror: ReturnType<typeof fakePayments>["mirror"];
  let filler: ReturnType<typeof createFiller>;
  let kai: User, jess: User, maya: User, omar: User, sam: User, lupe: User, dee: User;
  let beat: { id: string }, reel: { id: string }, lupeStation: { id: string };
  let orange: string, bikes: string;
  let fallMenu: string, nightOwl: string, rideSeason: string;
  const names = new Map<string, string>();
  const notes: string[] = [];

  beforeAll(async () => {
    chain = await startChain();
    h = await createHarness({
      payments: (clock) => {
        const p = fakePayments(clock);
        mirror = p.mirror;
        return p;
      },
      chain: escrowChain({ rpcUrl: chain.rpcUrl, escrow: chain.escrow, fund: chain.fund, usdc: chain.usdc, settlementKey: anvilKey(0), chainId: 31337, pollingIntervalMs: 100 })
    });
    filler = createFiller({ deps: h.deps, services: h.services });
    h.clock.set("2026-10-05T16:00:00.000Z"); // Monday 9 am in Los Angeles.
    const m = await market(h);
    [kai, jess, maya, omar, sam, dee] = await Promise.all(["Kai", "Jess", "Maya", "Omar", "Sam", "Dee"].map((n, i) => h.signIn(n, i === 5 ? { admin: true } : {})));
    lupe = await h.signIn("Lupe Ortiz", { linked: [{ kind: "wallet", value: anvilAccount(7).address }] });

    beat = await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId: m.id, tenths: 121, signedOn: true });
    reel = await stationFixture(h, { callSign: "REEL", name: "Reel", ownerId: jess.id, marketId: m.id, tenths: 241, signedOn: true });
    lupeStation = await stationFixture(h, { callSign: "LUPE", name: "Tía Lupe's Kitchen", kind: "claimable", marketId: m.id, tenths: 331, signedOn: true });
    await h.db.insert(schema.creators).values({ marketId: m.id, displayName: "Tía Lupe's Kitchen", personName: "Lupe Ortiz", sourcePlatform: "youtube", sourceUrl: "https://youtube.com/@tialupe", stage: "on_air", stationId: lupeStation.id });
    for (const [s, owner] of [[beat, kai], [reel, jess]] as const) {
      await owner.put(`/v1/stations/${s.id}/break-rule`, { mode: "every_n_minutes", everyMinutes: 30, lengthMs: 90_000, spotMsPerHour: 120_000, sameSpotPerHour: 2, fillOrder: ["SPT", "UND", "BMP", "SID"], openTimeTo: "spot_market", blockedCategories: [] }).expect(200);
      await itemFixture(h, s.id, { title: "Station ID", code: "SID", durationMs: 5_000 });
      await itemFixture(h, s.id, { title: "Bumper", code: "BMP", durationMs: 10_000 });
    }
    for (const s of [beat, reel, lupeStation]) await h.db.update(schema.stations).set({ studioLatitude: 34.05, studioLongitude: -117.18, homeCity: "Redlands" }).where(eq(schema.stations.id, s.id));
    await h.db.update(schema.stations).set({ takesOrders: true }).where(eq(schema.stations.id, beat.id));

    // The businesses.
    const o = await maya.post("/v1/businesses", { name: "Orange Street Coffee", category: "Coffee and food", customersWhere: "online", marketIds: [m.id] }).expect(201);
    orange = o.body.id;
    const b = await omar.post("/v1/businesses", { name: "Redlands Bikes", category: "Retail", customersWhere: "online", marketIds: [m.id] }).expect(201);
    bikes = b.body.id;

    // Programs, carriage and the evenings' logs (a program at 8, carried ones after).
    const show = async (s: { id: string }, owner: User, title: string) => {
      const p = await owner.post(`/v1/stations/${s.id}/programs`, { title, description: `${title}, every evening.` }).expect(201);
      const eps = [];
      for (let d = 0; d < 7; d++) eps.push(await itemFixture(h, s.id, { programId: p.body.id, title: `${title}, ep. ${d + 1}`, durationMs: 55 * 60_000 }));
      return { programId: p.body.id as string, eps };
    };
    const crate = await show(beat, kai, "Late Crate");
    const reelShow = await show(reel, jess, "Saturday Reel");
    const terms = { cashPriceMicros: $(2.5), cashPriceUnit: "per_airing", barterMakerMsPerHour: 60_000, airingsPerEpisode: 2, windowDays: 7, liveOnly: false, noticeDays: 7, approval: "any_station", radioBandAllowed: true };
    const reelOffer = await jess.post(`/v1/programs/${reelShow.programId}/offer`, { ...terms, termsOffered: ["barter"] }).expect(201);
    await kai.post(`/v1/catalog/offers/${reelOffer.body.id}/requests`, { carrierStationId: beat.id, term: "barter", slots: [{ weekday: 6, time: "21:00" }], startsOn: "2026-10-05" }).expect(201);
    const crateOffer = await kai.post(`/v1/programs/${crate.programId}/offer`, { ...terms, termsOffered: ["cash"] }).expect(201);
    await jess.post(`/v1/catalog/offers/${crateOffer.body.id}/requests`, { carrierStationId: reel.id, term: "cash", slots: [{ weekday: 3, time: "21:00" }], startsOn: "2026-10-05" }).expect(201);
    const barter = (await kai.get(`/v1/stations/${beat.id}/carriage/agreements`).expect(200)).body.carrying[0];
    const cash = (await jess.get(`/v1/stations/${reel.id}/carriage/agreements`).expect(200)).body.carrying[0];
    const log = async (s: { id: string }, start: Date, minutes: number, itemId: string, carriageAgreementId?: string) =>
      h.db.insert(schema.logEntries).values({ stationId: s.id, startsAt: start, endsAt: new Date(start.getTime() + minutes * 60_000), kind: "program", code: "PGM", assetId: itemId, carriageAgreementId: carriageAgreementId ?? null });
    for (let d = 0; d < 7; d++) {
      await log(beat, evening(d), 60, crate.eps[d].id);
      await log(reel, evening(d), 60, reelShow.eps[d].id);
    }
    await log(beat, evening(0, 19), 60, reelShow.eps[5].id, barter.id); // Monday 7 pm: REEL's show on BEAT, barter
    await log(reel, evening(2, 21), 60, crate.eps[2].id, cash.id); // Wednesday: BEAT's show on REEL, $2.50

    // Last week's tuned in, 7 to 11 pm, which prices the per-thousand hold; this week fewer watch.
    for (let d = -7; d < 7; d++) {
      const rows = Array.from({ length: 240 }, (_, i) => ({ stationId: beat.id, minute: new Date(evening(d, 19).getTime() + i * 60_000), tunedIn: d < 0 ? 262 : 175, web: d < 0 ? 262 : 175 }));
      await h.db.insert(schema.minuteSamples).values(rows).onConflictDoNothing();
    }
    for (const [id, n] of [
      [beat.id, "BEAT"],
      [reel.id, "REEL"],
      [lupeStation.id, "LUPE"],
      [orange, "Orange Street Coffee"],
      [bikes, "Redlands Bikes"],
      [lupe.id, "Lupe"]
    ] as const)
      names.set(id, n);
  }, 180_000);

  afterAll(async () => {
    await h?.close();
    chain?.stop();
  });

  async function listed(owner: User, business: string, title: string, lengthSec: 15 | 30, rate: { kind: "per_airing" | "per_thousand"; micros: number; perAiringMaxMicros?: number | null }, dailyCap = $(40)) {
    const s = await owner.post(`/v1/businesses/${business}/spots`, { title, lengthSec, category: "Food", rate: { perAiringMaxMicros: null, ...rate }, budget: { totalMicros: $(200), dailyCapMicros: dailyCap } }).expect(201);
    await h.db.insert(schema.spotFiles).values({ spotId: s.body.id, version: 1, location: `/fixtures/${title}.mp4`, durationMs: lengthSec * 1000 });
    await h.db.update(schema.spotsTable).set({ status: "listed", listedAt: h.clock.now() }).where(eq(schema.spotsTable.id, s.body.id));
    names.set(s.body.id, title);
    return s.body.id as string;
  }

  /** One evening: fill the breaks (money held), then air them (settled from the as-run). */
  async function airEvening(d: number) {
    h.clock.set(evening(d, 18).toISOString());
    for (const s of [beat, reel]) {
      const results = await filler.fillAhead(s.id, h.clock.now(), 5 * 3_600_000);
      void results;
    }
    const airings = await h.db
      .select()
      .from(schema.airings)
      .where(and(inArray(schema.airings.stationId, [beat.id, reel.id, lupeStation.id]), gte(schema.airings.scheduledAt, evening(d, 19)), lt(schema.airings.scheduledAt, evening(d, 23))))
      .orderBy(asc(schema.airings.scheduledAt));
    h.clock.set(evening(d, 23).toISOString());
    for (const a of airings) {
      const [spot] = await h.db.select().from(schema.spotsTable).where(eq(schema.spotsTable.id, a.spotId));
      const [row] = await h.db
        .insert(schema.asRun)
        .values({ stationId: a.stationId, code: "SPT", startedAt: a.scheduledAt, endedAt: new Date(a.scheduledAt.getTime() + spot.lengthSec * 1000), airingId: a.id, reason: "rotation" })
        .returning();
      await h.services.spots.settleAiring({ airingId: a.id, asRunId: row.id, startedAt: row.startedAt, endedAt: row.endedAt });
    }
    // Carried episodes that aired tonight: the cash deal's fee.
    const carried = await h.db
      .select()
      .from(schema.logEntries)
      .where(and(gte(schema.logEntries.startsAt, evening(d, 19)), lt(schema.logEntries.startsAt, evening(d, 23))));
    for (const e of carried.filter((x) => x.carriageAgreementId)) {
      await h.services.catalog.chargeCarriedAiring({ agreementId: e.carriageAgreementId!, carrierStationId: e.stationId, logEntryId: e.id });
    }
    await h.services.spots.releaseUnaired();
    await h.services.ledger.sendMoves();
    return airings.length;
  }

  it("runs the week", async () => {
    // Monday morning: the money arrives, the spots are listed and put in rotation.
    const card = await maya.post(`/v1/businesses/${orange}/funding-sources`, { kind: "card", token: "tok_4242" }).expect(201);
    await maya.post(`/v1/businesses/${orange}/deposits`, { amountMicros: $(60), fundingSourceId: card.body[0].id }).expect(201);
    const bank = await omar.post(`/v1/businesses/${bikes}/funding-sources`, { kind: "clear_bank", token: "bank_8810" }).expect(201);
    const pending = await omar.post(`/v1/businesses/${bikes}/deposits`, { amountMicros: $(400), fundingSourceId: bank.body[0].id }).expect(201);
    expect(pending.body.status).toBe("pending");
    // Tuesday the bank transfer arrives: the provider's webhook says so.
    await anon(h).post("/v1/webhooks/clear").set("content-type", "application/json").send(JSON.stringify({ kind: "deposit_arrived", depositId: pending.body.depositId })).expect(200);
    fallMenu = await listed(maya, orange, "Fall menu", 30, { kind: "per_airing", micros: $(4) }, $(12));
    nightOwl = await listed(maya, orange, "Night owl", 15, { kind: "per_thousand", micros: $(8), perAiringMaxMicros: $(3) }, $(6));
    rideSeason = await listed(omar, bikes, "Ride season", 30, { kind: "per_airing", micros: $(3) });
    await kai.put(`/v1/stations/${beat.id}/rotations/main`, { spotIds: [fallMenu, nightOwl] }).expect(200);
    await kai.put(`/v1/stations/${beat.id}/rotations/backup`, { spotIds: [rideSeason] }).expect(200);
    await jess.put(`/v1/stations/${reel.id}/rotations/main`, { spotIds: [fallMenu] }).expect(200);

    // A production order: Redlands Bikes asks BEAT for a :30.
    const order = await h.services.spots.orderSpot(bikes, { makerStationId: beat.id, title: "Ride season, made by BEAT", lengthSec: 30, about: "Spring bikes", neededBy: "2026-10-09" });
    await h.services.spots.quote(order.id, { action: "quote", priceMicros: $(150), deliverBy: "2026-10-08", roundsIncluded: 2, voicedBy: "Kai" });
    await h.services.spots.acceptQuote(order.id);

    // A pledge to REEL, and one to LUPE (a claimable station earns into what it's owed).
    await sam.post(`/v1/stations/${reel.id}/pledges`, { cadence: "monthly", amountMicros: $(10), creditOnAir: true }).expect(201);
    await sam.post(`/v1/stations/${lupeStation.id}/pledges`, { cadence: "once", amountMicros: $(25), creditOnAir: false }).expect(201);

    const aired: number[] = [];
    for (let d = 0; d < 7; d++) {
      if (d > 0) {
        // Midnight in Los Angeles: the jobs bring back spots that stopped at yesterday's daily cap.
        h.clock.set(evening(d, 0).toISOString());
        await h.services.spots.resumeDailyCaps();
      }
      if (d === 3) {
        // Thursday: the order is delivered and approved; BEAT is paid.
        h.clock.set(evening(3, 12).toISOString());
        const clip = await testClip(30);
        await h.services.spots.deliver(order.id, { path: clip, originalName: "ride-season.mp4", size: 1, mimeType: "video/mp4" });
        await h.services.spots.reviewDelivery(order.id, "approve");
      }
      aired.push(await airEvening(d));
    }
    notes.push(`Airings settled each evening: ${aired.map((n, d) => `${DAYS[d].slice(0, 3)} ${n}`).join(", ")}.`);

    // What filled each station's breaks, day by day.
    const all = await h.db.select().from(schema.airings).orderBy(asc(schema.airings.scheduledAt));
    for (const s of [beat, reel]) {
      const lines = DAYS.map((name, d) => {
        const today = all.filter((a) => a.stationId === s.id && a.scheduledAt >= evening(d, 19) && a.scheduledAt < evening(d, 23));
        const count = (spot: string) => today.filter((a) => a.spotId === spot).length;
        const parts = [fallMenu, nightOwl, rideSeason].filter((spot) => count(spot)).map((spot) => `${names.get(spot)} ×${count(spot)}`);
        return `${name.slice(0, 3)} ${parts.join(", ") || "no spots (station ID and bumpers)"}`;
      });
      notes.push(`${names.get(s.id)}'s breaks: ${lines.join("; ")}.`);
    }
    // The per-thousand example: held at last week's tuned in, settled at tonight's.
    const [owl] = all.filter((a) => a.spotId === nightOwl);
    const [held] = await h.db.select().from(schema.holds).where(eq(schema.holds.id, owl.holdId));
    const [owlRun] = await h.db.select().from(schema.asRun).where(eq(schema.asRun.airingId, owl.id));
    const owlCost = (await h.services.ledger.costsOfAsRun([owlRun.id])).get(owlRun.id) ?? 0;
    expect(owlCost).toBeLessThan(held.amountMicros);
    notes.push(`Night owl (per thousand, $8): held ${usd(held.amountMicros)} at the estimate from recent tuned in, settled at the real 175 tuned in for ${usd(owlCost)}; the ${usd(held.amountMicros - owlCost)} difference went back to Orange's balance.`);
    const barterSplit = await h.db.select().from(schema.entries).where(eq(schema.entries.kind, "barter_split"));
    expect(barterSplit.length).toBeGreaterThan(0);
    notes.push(`Barter: ${barterSplit.length} airing(s) in REEL's share of BEAT's breaks during Saturday Reel (carried Monday at 7 pm), paid on to REEL.`);

    // Orange ran out midweek: both spots paused for balance, and the stations were told.
    const spots = await h.db.select().from(schema.spotsTable).where(eq(schema.spotsTable.advertiserId, orange));
    notes.push(`Orange's spots at the end of the week: ${spots.map((s) => `${names.get(s.id)} ${s.status}${s.pauseReason ? ` (${s.pauseReason})` : ""}`).join(", ")}.`);
    // Both paused for balance, and stay paused: money coming back from a hold isn't a top-up.
    expect(spots.every((s) => s.status === "paused" && s.pauseReason === "balance")).toBe(true);
    const paused = await h.db.select().from(schema.notices).where(eq(schema.notices.kind, "spot_paused"));
    const toStations = paused.filter((n) => n.scopeKind === "station");
    expect(toStations.length).toBeGreaterThan(0);
    notes.push(...[...new Map(toStations.map((n) => [n.scopeId, n.body])).entries()].map(([id, body]) => `Notice to ${names.get(id!) ?? id}: "${body}"`));

    // Monday 12 October: the weekly batch into escrow, payouts, statements.
    h.clock.set("2026-10-12T16:00:00.000Z");
    const batch = await h.services.ledger.escrowWeekly();
    notes.push(`Weekly escrow batch: ${batch!.stations} station(s), ${usd(batch!.micros)}, transaction ${batch!.txHash.slice(0, 12)}….`);
    const payouts = await h.services.ledger.runPayouts();
    notes.push(`Weekly payouts: ${payouts.paid} stations, ${usd(payouts.micros)}.`);
    const statements = await h.services.ledger.issueStatements("week", new Date("2026-10-05T00:00:00.000Z"));
    notes.push(`Weekly statements issued: ${statements}.`);

    // Lupe claims LUPE: the desk checks her, two verifiers approve on-chain, 72 hours, paid.
    const claim = await lupe.post(`/v1/stations/${lupeStation.id}/claim`, { kind: "claim", sourceAccountProof: "youtube:@tialupe" }).expect(201);
    const approved = await dee.post(`/v1/admin/handovers/${claim.body.handoverId}/approve`).expect(200);
    const { escrowStationId, payee } = approved.body.onChain;
    await chain.asAccount(1, "approve", [BigInt(escrowStationId), payee, 1]);
    await chain.asAccount(2, "approve", [BigInt(escrowStationId), payee, 1]);
    await chain.warp(72 * 3600);
    await chain.asAccount(8, "execute", [BigInt(escrowStationId)]);
    h.clock.set("2026-10-15T17:00:00.000Z");
    await h.services.ledger.syncChain();
    notes.push(`Lupe's wallet received ${usd(await chain.usdcBalance(anvilAccount(7).address))} from the escrow contract; LUPE is now ${await h.services.stations.kindOf(lupeStation.id) === "station" ? "her own station" : "still claimable"}.`);
    await h.services.ledger.sendMoves();
  }, 240_000);

  it("balances: every entry sums to zero, the provider matches the ledger, the chain matches the escrow", async () => {
    const postings = await h.db.select().from(schema.postings);
    const byEntry = new Map<string, number>();
    for (const p of postings) byEntry.set(p.entryId, (byEntry.get(p.entryId) ?? 0) + p.amountMicros);
    expect([...byEntry.values()].every((sum) => sum === 0)).toBe(true);
    const ledgerSays = await h.services.ledger.custodyBalances();
    for (const [wallet, micros] of ledgerSays) expect(mirror.wallets.get(wallet) ?? 0, wallet).toBe(micros);
    const lupeEscrow = (await h.services.ledger.escrowBalances([lupeStation.id])).get(lupeStation.id)!;
    expect(lupeEscrow).toEqual({ owed: 0, held: 0 });
    expect(await h.services.ledger.everMovedToOpencast()).toBe(0);
    // Orange was never charged more than it put in.
    const orangeBalance = await h.services.ledger.balance(orange);
    expect(orangeBalance.availableMicros).toBeGreaterThanOrEqual(0);
  });

  it("writes the week's ledger", async () => {
    const report = await ledgerReport(h, names);
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/phase-6-sample-week.md");
    writeFileSync(file, `${report.header}\n\n## What happened\n\n${notes.map((n) => `- ${n}`).join("\n")}\n\n${report.body}`);
  });
});

/** The ledger as a reader would want it: every entry by day, then every account's closing balance. */
async function ledgerReport(h: Harness, names: Map<string, string>) {
  const accounts = await h.db.select().from(schema.accountsTable);
  const label = (a: (typeof accounts)[number]) => {
    const who = names.get(a.advertiserId ?? a.stationId ?? "") ?? a.advertiserId ?? a.stationId ?? "";
    const kinds: Record<string, string> = {
      advertiser_available: `${who}: available`,
      holds: "Held (all businesses)",
      station_earnings: `${who}: earnings`,
      escrow_owed: `${who}: owed to escrow`,
      escrow: `${who}: in escrow`,
      creator: `${who}: paid to creator ${names.get(a.userId ?? "") ?? ""}`.trim(),
      creator_fund: "Creator fund",
      opencast_share: "Opencast's share",
      pool: "The pool",
      opencast_absorbed: "Absorbed by Opencast",
      card_fees: "Card fees (Stripe, at cost)",
      external: `Outside (${a.label ?? "bank"})`
    };
    return kinds[a.kind] ?? a.kind;
  };
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const entries = await h.db.select().from(schema.entries).orderBy(asc(schema.entries.occurredAt), asc(schema.entries.createdAt));
  const postings = await h.db.select().from(schema.postings);
  const postingsBy = new Map<string, typeof postings>();
  for (const p of postings) postingsBy.set(p.entryId, [...(postingsBy.get(p.entryId) ?? []), p]);
  const day = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "long", month: "long", day: "numeric" }).format(d);
  const time = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" }).format(d);
  let body = "## Every entry\n\nEach entry balances: money into an account is positive, out is negative.\n";
  let current = "";
  for (const e of entries) {
    const d = day(e.occurredAt);
    if (d !== current) {
      body += `\n### ${d}\n\n| Time | Entry | What | Postings |\n|---|---|---|---|\n`;
      current = d;
    }
    const lines = (postingsBy.get(e.id) ?? []).map((p) => `${label(byId.get(p.accountId)!)} ${usd(p.amountMicros)}`).join("<br>");
    body += `| ${time(e.occurredAt)} | ${e.kind} | ${(e.memo ?? "").replace(/\|/g, "/")} | ${lines} |\n`;
  }
  const balances = new Map<string, number>();
  for (const p of postings) balances.set(p.accountId, (balances.get(p.accountId) ?? 0) + p.amountMicros);
  body += "\n## Closing balances\n\n| Account | Balance |\n|---|---|\n";
  for (const [id, micros] of [...balances].sort((a, b) => label(byId.get(a[0])!).localeCompare(label(byId.get(b[0])!)))) {
    if (micros !== 0) body += `| ${label(byId.get(id)!)} | ${usd(micros)} |\n`;
  }
  const moves = await h.db.select().from(schema.providerMoves);
  body += `\n## At the provider\n\n${moves.length} provider moves were written by the ledger and sent (${moves.filter((m) => m.status === "sent").length} sent, ${moves.filter((m) => m.status !== "sent").length} not): ${["encumber", "release", "transfer"].map((k) => `${moves.filter((m) => m.kind === k).length} ${k}`).join(", ")}. Every wallet's balance at the provider equals the ledger's.\n`;
  const header = `# Phase 6: a sample week of money\n\nGenerated by \`apps/api/test/sample-week.test.ts\` (${entries.length} ledger entries). The services, the outbox (fake provider) and the escrow contract on a local chain, Monday 5 to Sunday 11 October 2026, Los Angeles time; then the Monday batch, payouts and a claim.`;
  return { header, body };
}
