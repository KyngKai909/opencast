// The Phase 3 STOP demo's billing half: one week of October 2026 on BEAT, relaying to YouTube and
// Twitch (both signed in, fake platforms), with the same $8-per-thousand spot bought by an online
// business (Clicky Shop) and a local one (Orange Street Coffee, Redlands, within 10 miles), then the
// month's end: a relay share settled from YouTube's location data, one with no data (not billed),
// and one whose data never came (returned after 7 days). Run by relay-month.test.ts, and printed by
// `npm run demo:relay-viewers -w @opencast/api`.

import { randomBytes } from "node:crypto";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createHarness, market, stationFixture, type Harness, type User } from "./harness.js";
import { fakePlatforms, type FakePlatforms } from "../src/v1/modules/platforms/fake.js";
import { secretBox } from "../src/v1/modules/platforms/secrets.js";

const $ = (dollars: number) => Math.round(dollars * 1_000_000);
const fmt = (micros: number) => `${micros < 0 ? "−" : ""}$${(Math.abs(micros) / 1_000_000).toFixed(2)}`;

/** Each night at 8 pm in Los Angeles (03:00 UTC the next day): what the platforms report, and what YouTube's geography later says. */
export const NIGHTS = [
  { day: "2026-10-06", label: "Mon Oct 5", youtube: 200, twitch: 50, geography: { status: "ready" as const, inArea: 0.6 } },
  { day: "2026-10-07", label: "Tue Oct 6", youtube: 180, twitch: 40, geography: { status: "ready" as const, inArea: 0.45 } },
  { day: "2026-10-08", label: "Wed Oct 7", youtube: 240, twitch: 60, geography: { status: "none" as const } },
  { day: "2026-10-09", label: "Thu Oct 8", youtube: 210, twitch: 55, geography: { status: "ready" as const, inArea: 0.7 } },
  { day: "2026-10-10", label: "Fri Oct 9", youtube: 190, twitch: 45, geography: { status: "never" as const } }
];

export interface RelayMonth {
  h: Harness;
  fake: FakePlatforms;
  beat: string;
  orange: string;
  clicky: string;
  airings: Array<{ night: (typeof NIGHTS)[number]; business: "online" | "local"; airingId: string; holdMicros: number; opencast: { costMicros: number; working: string } }>;
  owners: { kai: User; jess: User; lee: User };
}

export async function runRelayMonth(): Promise<RelayMonth> {
  const fake = fakePlatforms();
  const h = await createHarness({ platforms: { providers: fake, secrets: secretBox({ id: "demo", key: randomBytes(32) }) }, publicBase: "https://api.opencast.test" });
  h.clock.set("2026-10-05T19:00:00.000Z");
  const ie = (await market(h)).id;
  const la = (await market(h, "los-angeles", "Los Angeles")).id;
  const kai = await h.signIn("Kai");
  const jess = await h.signIn("Jess Lin");
  const lee = await h.signIn("Lee");
  const beat = await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId: ie, tenths: 121, signedOn: true });
  await h.db.update(schema.stations).set({ studioLatitude: 34.0556, studioLongitude: -117.1825, homeCity: "Redlands" }).where(eq(schema.stations.id, beat.id));

  const orange = (
    await jess
      .post("/v1/businesses", { name: "Orange Street Coffee", category: "Coffee and food", customersWhere: "location", locations: [{ kind: "location", streetAddress: "101 Orange St", city: "Redlands", latitude: 34.0558, longitude: -117.1817 }] })
      .expect(201)
  ).body.id as string;
  const clicky = (await lee.post("/v1/businesses", { name: "Clicky Shop", category: "Retail", customersWhere: "online", marketIds: [ie] }).expect(201)).body.id as string;
  for (const [user, id] of [
    [jess, orange],
    [lee, clicky]
  ] as const) {
    const sources = await user.post(`/v1/businesses/${id}/funding-sources`, { kind: "card", token: "tok_visa_4417" }).expect(201);
    await user.post(`/v1/businesses/${id}/deposits`, { amountMicros: $(100), fundingSourceId: sources.body[0].id }).expect(201);
  }
  const spot = async (advertiserId: string, title: string, withinMiles: number | null) => {
    const [row] = await h.db
      .insert(schema.spotsTable)
      .values({ advertiserId, title, lengthSec: 30, category: "Food", status: "listed", rateKind: "per_thousand", rateMicros: $(8), totalBudgetMicros: $(50), listedAt: h.clock.now() })
      .returning();
    await h.db.insert(schema.targeting).values({ spotId: row.id, withinMiles });
    return row.id;
  };
  const orangeSpot = await spot(orange, "Fall menu", 10);
  const clickySpot = await spot(clicky, "Free shipping", null);

  // BEAT signs in to YouTube and Twitch on the Translators page.
  for (const [provider, account, accountId] of [
    ["youtube", "Inland Beat channel", "UC-beat"],
    ["twitch", "InlandBeat", "tw-42"]
  ] as const) {
    const start = await kai.post(`/v1/stations/${beat.id}/platforms/oauth/${provider}/start`, {}).expect(200);
    const code = `code-${provider}`;
    fake.codes.set(code, { account, accountId });
    await request(h.app).get(`/v1/platforms/oauth/${provider}/callback?state=${new URL(start.body.url).searchParams.get("state")}&code=${code}`).expect(302);
  }
  const destinations = await h.services.platforms.destinationsFor(beat.id);
  const youtube = destinations.find((d) => d.kind === "youtube")!.platformId;
  const twitch = destinations.find((d) => d.kind === "twitch")!.platformId;
  // The week before, at 8 pm: 100 on Opencast, 200 on YouTube, 50 on Twitch (what the holds are priced from).
  for (let i = 0; i < 60; i++) {
    const minute = new Date(Date.parse("2026-10-05T03:00:00Z") + i * 60_000);
    await h.db.insert(schema.minuteSamples).values({ stationId: beat.id, minute, tunedIn: 100, web: 100 });
    await h.db.insert(schema.platformViewerSamples).values([
      { platformId: youtube, stationId: beat.id, kind: "youtube", minute, viewers: 200, broadcastRef: "yt-last-week" },
      { platformId: twitch, stationId: beat.id, kind: "twitch", minute, viewers: 50, broadcastRef: "tw-last-week" }
    ]);
  }

  const airings: RelayMonth["airings"] = [];
  for (const night of NIGHTS) {
    // What the platforms report during the break, polled each minute.
    h.clock.set(`${night.day}T03:00:10.000Z`);
    fake.youtubeViewers.set("yt-video-1", night.youtube);
    fake.twitchViewers.set("tw-42", night.twitch);
    await h.services.platforms.pollViewers();
    // Opencast: 100 tuned in, 70 placed in the Inland Empire, 10 in Los Angeles, 20 not placed.
    const minute = new Date(`${night.day}T03:00:00Z`);
    await h.db.insert(schema.minuteSamples).values({ stationId: beat.id, minute, tunedIn: 100, web: 100 });
    await h.db.insert(schema.minuteMarkets).values([
      { stationId: beat.id, minute, marketId: ie, tunedIn: 70 },
      { stationId: beat.id, minute, marketId: la, tunedIn: 10 }
    ]);
    h.clock.set(`${night.day}T02:00:00.000Z`);
    const [brk] = await h.db.insert(schema.breaks).values({ stationId: beat.id, startsAt: minute, lengthMs: 60_000, origin: "rule" }).returning();
    for (const [business, spotId, offset] of [
      ["online", clickySpot, 0],
      ["local", orangeSpot, 30]
    ] as const) {
      const startedAt = new Date(minute.getTime() + offset * 1000);
      h.clock.set(`${night.day}T02:00:00.000Z`);
      const placed = await h.services.spots.place({ spotId, stationId: beat.id, breakId: brk.id, scheduledAt: startedAt });
      h.clock.set(`${night.day}T03:01:05.000Z`);
      const [run] = await h.db
        .insert(schema.asRun)
        .values({ stationId: beat.id, code: "SPT", startedAt, endedAt: new Date(startedAt.getTime() + 30_000), airingId: placed.airingId, breakId: brk.id, reason: "rotation" })
        .returning();
      const opencast = await h.services.spots.settleAiring({ airingId: placed.airingId, asRunId: run.id, startedAt: run.startedAt, endedAt: run.endedAt });
      airings.push({ night, business, airingId: placed.airingId, holdMicros: placed.holdMicros, opencast });
    }
    // A few minutes later the counts are in: online businesses' relay parts settle, local ones wait.
    h.clock.set(`${night.day}T03:05:00.000Z`);
    await h.services.spots.settleRelayViewers();
  }

  // YouTube Analytics, a day or two late: each night's views by city (1,000 views; the rest in Los Angeles).
  for (const night of NIGHTS) {
    const g = night.geography;
    if (g.status === "never") continue;
    fake.geography.set(
      `yt-video-1:${night.day}`,
      g.status === "none"
        ? { status: "none", totalViews: 40 }
        : {
            status: "ready",
            totalViews: 1000,
            places: [
              { label: "Redlands", latitude: 34.0556, longitude: -117.1825, views: Math.round(g.inArea * 1000) },
              { label: "Los Angeles", latitude: 34.0522, longitude: -118.2437, views: 1000 - Math.round(g.inArea * 1000) }
            ]
          }
    );
  }
  for (const at of ["2026-10-08T12:00:00.000Z", "2026-10-10T12:00:00.000Z", "2026-10-12T12:00:00.000Z"]) {
    h.clock.set(at);
    await h.services.platforms.fetchGeography();
    await h.services.spots.settleRelayViewers();
  }
  // Friday's never came: returned a week after it aired.
  h.clock.set("2026-10-17T03:05:00.000Z");
  await h.services.spots.settleRelayViewers();
  h.clock.set("2026-10-31T20:00:00.000Z");
  return { h, fake, beat: beat.id, orange, clicky, airings, owners: { kai, jess, lee } };
}

export async function relayReport(run: RelayMonth): Promise<string> {
  const { h } = run;
  const out: string[] = [];
  const charges = await h.db.select().from(schema.relayCharges);
  const describe = (c: (typeof charges)[number]) => {
    const name = c.platform === "youtube" ? "YouTube" : "Twitch";
    if (c.status === "settled") return `${name} ${c.working}${c.resolvedAt ? ` (settled ${c.resolvedAt.toISOString().slice(5, 10)})` : ""}`;
    if (c.status === "returned") return `${name} ${Math.round(c.viewers ?? 0)}: returned ${fmt(c.returnedMicros)} on ${c.resolvedAt!.toISOString().slice(5, 10)}, no location data within 7 days`;
    if (c.status === "not_billed") return `${name} ${Math.round(c.viewers ?? 0)}: not billed (${c.reason === "twitch_no_location" ? "Twitch doesn't report where viewers are" : c.reason === "no_location_data" ? "YouTube had no location data" : c.reason})`;
    return `${name}: ${c.status}`;
  };
  for (const [business, id, title] of [
    ["online", run.clicky, "Clicky Shop (online): Free shipping, $8.00 per 1,000"],
    ["local", run.orange, "Orange Street Coffee (local, within 10 miles of Redlands): Fall menu, $8.00 per 1,000"]
  ] as const) {
    out.push(`## ${title}`, "");
    for (const a of run.airings.filter((x) => x.business === business)) {
      const parts = charges.filter((c) => c.airingId === a.airingId).sort((x, y) => (x.platform === "youtube" ? -1 : 1) - (y.platform === "youtube" ? -1 : 1));
      out.push(`- ${a.night.label}, held ${fmt(a.holdMicros)}. Opencast ${a.opencast.working}. ${parts.map(describe).join(". ")}.`);
    }
    const owner = business === "online" ? run.owners.lee : run.owners.jess;
    const results = (await owner.get(`/v1/businesses/${id}/results?month=2026-10`).expect(200)).body;
    out.push("", `Results for October: spent ${fmt(results.totals.spentMicros)} (relay viewers ${fmt(results.totals.relaySpentMicros ?? 0)}; still waiting ${fmt(results.totals.relayWaitingMicros ?? 0)}).`);
    for (const l of results.relayViewers ?? []) out.push(`- ${l.label}: ${l.airings} airings, ${l.viewersAddedUp} viewers reported, ${l.billedViewersAddedUp} billed, ${fmt(l.spentMicros)}${l.returnedMicros ? `, ${fmt(l.returnedMicros)} returned` : ""}`);
    const statement = (await owner.get(`/v1/businesses/${id}/statements`).expect(200)).body[0];
    out.push("", `October statement (so far): opening ${fmt(statement.openingMicros)}, closing ${fmt(statement.closingMicros)}.`);
    for (const l of statement.lines.filter((x: { group: string }) => x.group === "balance")) out.push(`- ${l.label}${l.detail ? ` (${l.detail})` : ""}: ${fmt(l.amountMicros)}${l.includedAbove ? ", included above" : ""}`);
    out.push("");
  }
  const earnings = (await run.owners.kai.get(`/v1/stations/${run.beat}/earnings?period=month`).expect(200)).body;
  out.push("## BEAT's earnings, October", "", `- Spots (Opencast viewers): ${fmt(earnings.lines.spots.micros)}, ${earnings.lines.spots.airings} airings`);
  for (const l of earnings.lines.relayViewers ?? []) out.push(`- ${l.label}: ${fmt(l.micros)}, ${l.airings} airings`);
  const unbalanced = await h.db.execute<{ n: string }>(sql`select count(*) as n from (select entry_id from ledger.postings group by entry_id having sum(amount_micros) <> 0) x`);
  const held = await h.db.execute<{ sum: string }>(sql`select coalesce(sum(p.amount_micros), 0) as sum from ledger.postings p join ledger.accounts a on a.id = p.account_id where a.kind = 'holds'`);
  out.push("", `Ledger: ${unbalanced.rows[0].n === "0" ? "every entry balances" : `${unbalanced.rows[0].n} entries don't balance`}; still held ${fmt(Number(held.rows[0].sum))}.`);
  return out.join("\n");
}
