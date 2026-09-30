// The Phase 2 STOP demo (pay-as-you-go): October 2026 for three stations, run for real on the
// services (the rules registry's starting prices, the fake payments provider), then the first half
// of November for the one that couldn't pay.
//
// - PREP 31.1 (Inland Preps) stays inside the free allowance: 6 GB kept, one 3-hour live game.
// - BEAT 12.1 (Inland Beat) is paid from its earnings: 40 GB kept, relays to YouTube and Twitch six
//   hours every evening (counted once), a 2-hour live show every Friday, $20 of pledges a day, and
//   the weekly payouts, which take the usage owed first.
// - REEL 24.1 (Saturday Reel) runs out of funding: 25 GB kept, relays around the clock, no
//   earnings, and a card that's declined. Its grace period starts on November 1; on the 12th it's
//   warned; on the 15th its relays and live shows pause while its channel stays on air; on the 16th
//   its owner adds a card that works, it's charged, and they're back.
//
// Used by test/billing-month.test.ts (which checks it) and scripts/demo-billing.ts (which prints it).

import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { StationAccount, Statement } from "@opencast/contracts";
import { createPlanner } from "../src/v1/modules/playout/engine/plan.js";
import { fakePayments } from "../src/v1/payments/index.js";
import { createHarness, market, stationFixture, type Harness, type User } from "./harness.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const $ = (d: number) => Math.round(d * 1_000_000);
export const usd = (micros: number) => `${micros < 0 ? "−" : ""}$${(Math.abs(micros) / 1_000_000).toFixed(2)}`;
const at = (iso: string) => new Date(iso);
const day = (d: Date) => d.toISOString().slice(0, 10);

/** A made-up content ID (CIDv1 shape). */
const fakeCid = () => `b${[...randomBytes(58)].map((b) => "abcdefghijklmnopqrstuvwxyz234567"[b % 32]).join("")}`;

/** A station keeps `originalGb` of originals and `preparedGb` of prepared segments. */
export async function keepStorage(h: Harness, stationId: string, originalGb: number, preparedGb: number, title = "Library") {
  const cid = fakeCid();
  await h.db.insert(schema.contents).values({ cid, bytes: Math.round(originalGb * 1e9), contentType: "video/mp4", storageClass: "infrequent", store: "local" });
  const [item] = await h.db.insert(schema.assets).values({ stationId, title, code: "PGM", source: "upload", mediaKind: "video", durationMs: 3_600_000, status: "ready" }).returning();
  const [file] = await h.db.insert(schema.assetFiles).values({ assetId: item.id, version: 1, contentId: cid }).returning();
  await h.db.insert(schema.contentRefs).values({ cid, owner: "asset_file", ownerId: file.id });
  if (preparedGb > 0) await h.db.insert(schema.preparedItems).values({ key: cid, contentId: cid, status: "ready", bytes: Math.round(preparedGb * 1e9) });
  return { itemId: item.id, cid };
}

/** A relay session (what `translator_sessions` records as a translator runs). */
export async function relayed(h: Harness, stationId: string, translatorId: string, from: Date, to: Date) {
  await h.db.insert(schema.translatorSessions).values({ translatorId, stationId, mode: "composite", startedAt: from, endedAt: to, updatedAt: to, bytesSent: 0 });
}

/** A live stretch that aired (the as-run log's `live` rows). */
export async function airedLive(h: Harness, stationId: string, from: Date, to: Date) {
  await h.db.insert(schema.asRun).values({ stationId, code: "PGM", startedAt: from, endedAt: to, reason: "live" });
}

/** Money into a station's earnings (a viewer's pledge, as the ledger records one). */
export async function earn(h: Harness, stationId: string, micros: number, memo = "Pledge") {
  await h.db.transaction(async (tx) => {
    await h.services.ledger.post(
      tx,
      "pledge",
      [
        { account: await h.services.ledger.account(tx, "external", { label: "stripe" }), micros: -micros },
        { account: await h.services.ledger.account(tx, "station_earnings", { stationId }), micros }
      ],
      { sourceType: "pledge", memo }
    );
  });
}

export interface MonthRun {
  h: Harness;
  prep: { id: string };
  beat: { id: string };
  reel: { id: string };
  owners: { paz: User; kai: User; jess: User };
  mirror: ReturnType<typeof fakePayments>["mirror"];
  cards: ReturnType<typeof fakePayments>["cards"];
  /** Taken as it happened. */
  accounts: { beatMidMonth: StationAccount; prepEndOfMonth: StationAccount; reelGrace: StationAccount; reelWarned: StationAccount; reelPaused: StationAccount; reelResumed: StationAccount; beatClosed: StationAccount; prepClosed: StationAccount };
  paused: { relaysDuringGrace: number; relaysWhilePaused: number; liveWhilePaused: string[]; channelWhilePaused: string; relaysResumed: number };
  payouts: Array<{ on: string; paid: number; micros: number }>;
  /** Each notice to the owners as it was sent, at the demo's clock. */
  told: Array<{ at: string; stationId: string; title: string; body: string; key: string }>;
}

export async function createMonthHarness() {
  let mirror!: ReturnType<typeof fakePayments>["mirror"];
  let cards!: ReturnType<typeof fakePayments>["cards"];
  const h = await createHarness({
    payments: (clock) => {
      const p = fakePayments(clock);
      mirror = p.mirror;
      cards = p.cards;
      return p;
    }
  });
  return { h, mirror, cards };
}

export async function runMonth(h: Harness, mirror: MonthRun["mirror"], cards: MonthRun["cards"]): Promise<MonthRun> {
  h.clock.set("2026-10-01T00:00:00.000Z");
  const m = await market(h);
  const [paz, kai, jess] = await Promise.all([h.signIn("Paz"), h.signIn("Kai"), h.signIn("Jess")]);
  const prep = await stationFixture(h, { callSign: "PREP", name: "Inland Preps", ownerId: paz.id, marketId: m.id, tenths: 311, signedOn: true });
  const beat = await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId: m.id, tenths: 121, signedOn: true });
  const reel = await stationFixture(h, { callSign: "REEL", name: "Saturday Reel", ownerId: jess.id, marketId: m.id, tenths: 241, signedOn: true });
  for (const s of [prep, beat, reel]) await h.db.insert(schema.playoutState).values({ stationId: s.id, onAir: true }).onConflictDoNothing();

  // What each keeps in storage, originals and prepared segments together.
  await keepStorage(h, prep.id, 1.5, 4.5, "Game film");
  await keepStorage(h, beat.id, 10, 30, "Late Crate");
  await keepStorage(h, reel.id, 5, 20, "Saturday Reel");

  // Translators: BEAT to YouTube and Twitch (evenings), REEL to YouTube (around the clock).
  const translator = async (stationId: string, service: "youtube" | "twitch") =>
    (await h.db.insert(schema.translators).values({ stationId, service, name: service === "youtube" ? "YouTube" : "Twitch", rtmpUrl: `rtmp://${service}.test/live`, streamKey: `key-${randomUUID()}` }).returning())[0].id;
  const beatYouTube = await translator(beat.id, "youtube");
  const beatTwitch = await translator(beat.id, "twitch");
  const reelYouTube = await translator(reel.id, "youtube");
  const start = at("2026-10-01T00:00:00.000Z");
  for (let d = 0; d < 31; d++) {
    const dayStart = new Date(start.getTime() + d * DAY);
    // 11 am to 5 pm in Los Angeles is 18:00 to 24:00 UTC: both platforms at once, counted once.
    await relayed(h, beat.id, beatYouTube, new Date(dayStart.getTime() + 18 * HOUR), new Date(dayStart.getTime() + 24 * HOUR));
    await relayed(h, beat.id, beatTwitch, new Date(dayStart.getTime() + 18 * HOUR + 5 * 60_000), new Date(dayStart.getTime() + 24 * HOUR));
  }
  // REEL relays until it's paused (November 15).
  for (let d = 0; d < 45; d++) {
    const dayStart = new Date(start.getTime() + d * DAY);
    await relayed(h, reel.id, reelYouTube, dayStart, new Date(dayStart.getTime() + DAY));
  }
  // Live: PREP's game on October 10 (3 hours); BEAT every Friday evening (2 hours, Saturday 03:00 UTC).
  await airedLive(h, prep.id, at("2026-10-10T01:00:00.000Z"), at("2026-10-10T04:00:00.000Z"));
  for (const saturday of ["03", "10", "17", "24", "31"]) await airedLive(h, beat.id, at(`2026-10-${saturday}T03:00:00.000Z`), at(`2026-10-${saturday}T05:00:00.000Z`));

  // Cards: BEAT's works (it's never needed); REEL's is declined.
  const setup = (await kai.post(`/v1/stations/${beat.id}/account/card-setup`).expect(201)).body;
  await kai.post(`/v1/stations/${beat.id}/account/card`, { setupIntentId: setup.setupIntentId }).expect(200);
  await jess.post(`/v1/stations/${reel.id}/account/card`, { setupIntentId: "seti_fake_declined_reel" }).expect(200);

  const runs: MonthRun = {
    h,
    prep,
    beat,
    reel,
    owners: { paz, kai, jess },
    mirror,
    cards,
    accounts: {} as MonthRun["accounts"],
    paused: { relaysDuringGrace: 0, relaysWhilePaused: 0, liveWhilePaused: [], channelWhilePaused: "", relaysResumed: 0 },
    payouts: [],
    told: []
  };
  // One notice per key (a warning repeated the next day is the same notice).
  h.deps.bus.on("station.account", (e) => void (runs.told.some((t) => t.key === e.dedupeKey) || runs.told.push({ at: h.clock.now().toISOString(), stationId: e.stationId, title: e.title, body: e.body, key: e.dedupeKey })));

  // REEL has a live show booked for November 15, 8 pm in Los Angeles (to see it paused).
  const source = await jess.post(`/v1/stations/${reel.id}/live-sources`, { kind: "encoder", name: "Studio B" }).expect(201);
  h.clock.set("2026-11-10T00:00:00.000Z");
  await jess.post(`/v1/stations/${reel.id}/log`, { kind: "live", startsAt: "2026-11-16T03:00:00.000Z", endsAt: "2026-11-16T04:00:00.000Z", liveSourceId: source.body.source.id }).expect(201);
  h.clock.set("2026-10-01T00:00:00.000Z");

  const planner = createPlanner({ deps: h.deps, services: h.services });
  const end = at("2026-11-16T18:00:00.000Z");
  for (let t = start.getTime(); t <= end.getTime(); t += 6 * HOUR) {
    const now = new Date(t);
    h.clock.set(now.toISOString());
    const hourUtc = now.getUTCHours();
    // BEAT's pledges: $20 a day, in the evening.
    if (hourUtc === 0 && now < at("2026-11-01T00:00:00.000Z") && t > start.getTime()) await earn(h, beat.id, $(20), "Pledges");
    await h.services.billing.tick();
    // Mondays (5 am in Los Angeles here): last week's statements, then payouts, as the jobs do.
    const la = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short" }).format(now);
    if (la === "Mon" && hourUtc === 12) {
      const lastMonday = new Date(Date.parse(`${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now)}T00:00:00Z`) - 7 * DAY);
      await h.services.ledger.issueStatements("week", lastMonday);
      const paid = await h.services.ledger.runPayouts();
      runs.payouts.push({ on: day(now), paid: paid.paid, micros: paid.micros });
    }
    // The 1st, after the month's close: last month's statements.
    if (day(now) === "2026-11-01" && hourUtc === 12) await h.services.ledger.issueStatements("month", at("2026-10-01T00:00:00.000Z"));
    await h.services.ledger.sendMoves();

    const view = async (s: { id: string }, u: User) => (await u.get(`/v1/stations/${s.id}/account`).expect(200)).body as StationAccount;
    const iso = now.toISOString();
    if (iso === "2026-10-15T12:00:00.000Z") runs.accounts.beatMidMonth = await view(beat, kai);
    if (iso === "2026-10-31T18:00:00.000Z") runs.accounts.prepEndOfMonth = await view(prep, paz);
    if (iso === "2026-11-01T12:00:00.000Z") {
      runs.accounts.reelGrace = await view(reel, jess);
      runs.accounts.beatClosed = await view(beat, kai);
      runs.accounts.prepClosed = await view(prep, paz);
      runs.paused.relaysDuringGrace = (await h.services.stations.relays(reel.id)).length;
    }
    if (iso === "2026-11-12T12:00:00.000Z") runs.accounts.reelWarned = await view(reel, jess);
    if (iso === "2026-11-15T06:00:00.000Z") {
      runs.accounts.reelPaused = await view(reel, jess);
      runs.paused.relaysWhilePaused = (await h.services.stations.relays(reel.id)).length;
      const planned = await planner.plan(reel.id, at("2026-11-16T03:00:00.000Z"), at("2026-11-16T04:00:00.000Z"));
      runs.paused.liveWhilePaused = [...new Set(planned.map((s) => s.reason))];
      const [state] = await h.db.select().from(schema.playoutState).where(eq(schema.playoutState.stationId, reel.id));
      runs.paused.channelWhilePaused = state.onAir ? "on air" : "off air";
    }
    if (iso === "2026-11-16T12:00:00.000Z") {
      // Jess adds a card that works: what's due is charged at once, and they're back.
      await jess.post(`/v1/stations/${reel.id}/account/card`, { setupIntentId: "seti_fake_reel_new" }).expect(200);
      runs.accounts.reelResumed = await view(reel, jess);
      runs.paused.relaysResumed = (await h.services.stations.relays(reel.id)).length;
    }
  }
  await h.deps.bus.settle();
  return runs;
}

export async function statementsOf(run: MonthRun, stationId: string, owner: User): Promise<Statement[]> {
  return (await owner.get(`/v1/stations/${stationId}/statements`).expect(200)).body as Statement[];
}

export async function noticesOf(run: MonthRun, user: User) {
  const rows = await run.h.db
    .select()
    .from(schema.notices)
    .where(and(eq(schema.notices.userId, user.id), eq(schema.notices.kind, "station_account")))
    .orderBy(asc(schema.notices.createdAt));
  return rows.map((r) => ({ at: r.createdAt.toISOString(), title: r.title, body: r.body }));
}

const quantity = (u: { unit: string; quantity: number }) => (u.unit === "gb_month" ? `${u.quantity.toFixed(2)} GB-months` : `${Math.round(u.quantity * 100) / 100} h`);

function accountText(title: string, a: StationAccount): string[] {
  const out = [`${title} (as of ${a.asOf.slice(0, 16).replace("T", " ")} UTC, ${a.month})`];
  for (const u of a.usage) {
    if (u.quantity === 0 && u.soFarMicros === 0) continue;
    const allowance = u.allowance ? `, ${Math.round(u.allowance.left * 100) / 100} of ${u.allowance.quantity} free left` : "";
    const price = u.free ? "free" : u.priceMicros === null ? "not set" : `${usd(u.priceMicros)}/${u.unit === "gb_month" ? "GB-month" : "hour"}`;
    out.push(`    ${u.label}: ${quantity(u)}${allowance}, ${price}; so far ${usd(u.soFarMicros)}, estimate ${usd(u.estimate.micros)}${u.paused ? ` (paused: ${u.paused})` : ""}`);
  }
  out.push(`    Total so far ${usd(a.totals.soFarMicros)}, estimate for the month ${usd(a.totals.estimateMicros)}. Standing: ${a.standing}${a.grace ? `, pauses on ${a.grace.pausesOn} (${a.grace.daysLeft} days), ${usd(a.grace.dueMicros)} due` : ""}.`);
  out.push(`    Funding: earnings first (${usd(a.funding.earningsAvailableMicros)} available), then ${a.funding.source === "card" ? (a.funding.card?.label ?? "a card") : a.funding.source === "clear" ? "Clear" : "nothing chosen"}.`);
  for (const b of a.bills) {
    out.push(`    Bill ${b.month}: ${b.status}, ${usd(b.amountMicros)} (earnings ${usd(b.fromEarningsMicros)}, card ${usd(b.fromCardMicros)}, Clear ${usd(b.fromClearMicros)}), due ${usd(b.dueMicros)}${b.lastAttempt?.reason ? `; last try: ${b.lastAttempt.reason}` : ""}`);
  }
  return out;
}

function statementText(name: string, s: Statement): string[] {
  const out = [`${name}, ${s.period === "week" ? "week" : "month"} of ${s.periodStart} to ${s.periodEnd}: opening ${usd(s.openingMicros)}, closing ${usd(s.closingMicros)}`];
  for (const l of s.lines) {
    if (l.amountMicros === 0 && !l.usage && l.group !== "usage") continue;
    out.push(`    ${l.group === "usage" ? "[usage] " : ""}${l.label}${l.detail ? ` (${l.detail})` : ""}: ${usd(l.amountMicros)}${l.includedAbove ? ", shown" : ""}`);
  }
  return out;
}

/** The month, as the STOP asks for it: the accounts, the statements, the notices. */
export async function monthReport(run: MonthRun): Promise<string> {
  const { owners } = run;
  const lines: string[] = ["# Pay-as-you-go: October 2026 for three stations", ""];
  lines.push("Prices (the registry's starting versions, from October 1): storage $0.04 a GB-month, relays of everything aired $0.20 an hour, live hours $0.75 an hour; free each month 10 GB and 5 live hours; grace 14 days.", "");

  lines.push("## PREP 31.1: inside the free allowance", "");
  lines.push(...accountText("Station account on October 31", run.accounts.prepEndOfMonth), ...accountText("After the month closed", run.accounts.prepClosed), "");
  lines.push("## BEAT 12.1: paid from its earnings", "");
  lines.push(...accountText("Station account on October 15", run.accounts.beatMidMonth), ...accountText("After the month closed", run.accounts.beatClosed), "");
  lines.push(`Weekly payouts (usage taken from earnings first): ${run.payouts.map((p) => `${p.on} ${usd(p.micros)}`).join("; ")}.`, "");
  lines.push("## REEL 24.1: runs out of funding, grace, paused, paid", "");
  lines.push(...accountText("November 1, grace started", run.accounts.reelGrace), ...accountText("November 12, the warning", run.accounts.reelWarned), ...accountText("November 15, paused", run.accounts.reelPaused));
  lines.push(`    While paused: ${run.paused.relaysWhilePaused} relays running (${run.paused.relaysDuringGrace} during grace); the booked live show plans as ${run.paused.liveWhilePaused.join(", ")}; the channel is ${run.paused.channelWhilePaused}.`);
  lines.push(...accountText("November 16, a card that works", run.accounts.reelResumed));
  lines.push(`    Relays running again: ${run.paused.relaysResumed}.`, "");

  lines.push("## Statements", "");
  for (const [name, s, u] of [
    ["PREP", run.prep, owners.paz],
    ["BEAT", run.beat, owners.kai],
    ["REEL", run.reel, owners.jess]
  ] as const) {
    const list = await statementsOf(run, s.id, u);
    const month = list.find((x) => x.period === "month" && x.periodStart === "2026-10-01");
    const week = name === "BEAT" ? list.find((x) => x.period === "week" && x.periodStart === "2026-10-19") : undefined;
    if (week) lines.push(...statementText(name, week));
    if (month) lines.push(...statementText(name, month));
    lines.push("");
  }

  lines.push("## Notices to the owners", "");
  for (const [name, s, u] of [
    ["PREP (Paz)", run.prep, owners.paz],
    ["BEAT (Kai)", run.beat, owners.kai],
    ["REEL (Jess)", run.reel, owners.jess]
  ] as const) {
    lines.push(`${name}, ${(await noticesOf(run, u)).length} in master control, each also pushed and emailed:`);
    for (const n of run.told.filter((t) => t.stationId === s.id)) lines.push(`    ${n.at.slice(0, 16).replace("T", " ")} UTC  ${n.title}. ${n.body}`);
    lines.push("");
  }
  const charged = run.cards.charges.map((c) => `${c.paymentMethodId.includes("declined") ? "declined" : "charged"} ${usd(c.amountMicros)}`).join(", ");
  lines.push(`Card charges tried: ${charged}.`);
  const custody = await run.h.services.ledger.custodyBalances();
  const matches = [...custody].every(([wallet, micros]) => (run.mirror.wallets.get(wallet) ?? 0) === micros);
  lines.push(`Every wallet at the provider matches the ledger: ${matches ? "yes" : "no"}.`);
  return lines.join("\n");
}

