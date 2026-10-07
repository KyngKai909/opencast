// A251 Phase 2 (2026-10-06): the Network desk's analytics totals and its Overview and Stations tabs.
// Totals are worked out from session minutes (every station, external ones too) and kept for good;
// devices are counted once; moving around the dial comes from a visit's minutes; admins see every
// market, a market lead only theirs (whatever they ask), and a rights reviewer nothing.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { createHarness, market, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let dee: User; // admin
let lee: User; // Inland Empire's market lead
let sam: User; // rights reviewer
let ie: string;
let beat: string;
let rdls: string; // external
let mojv: string; // High Desert
const T = (hhmmss: string) => `2026-10-01T${hhmmss}.000Z`;
// Thursday, October 1, 2026, Pacific: 7:00 am UTC to 7:00 am the next day.
const DAY = { from: "2026-10-01T07:00:00.000Z", to: "2026-10-02T07:00:00.000Z" };
const D1 = "11111111-1111-4111-8111-111111111111";
const D2 = "22222222-2222-4222-8222-222222222222";

/** A tab watching stations in turn: beats every 30 seconds, media time moving. */
async function watch(visit: string, device: string | undefined, legs: Array<{ station: string; from: string; minutes: number }>) {
  const media = new Map<string, number>();
  for (const leg of legs) {
    const start = Date.parse(T(leg.from));
    for (let i = 0; i < leg.minutes * 2; i++) {
      h.clock.set(new Date(start + i * 30_000).toISOString());
      const m = media.get(leg.station) ?? 0;
      await h.services.audience.heartbeat({ stationId: leg.station, sessionId: visit, platform: "web", mediaTimeMs: m, playing: true, ...(device ? { deviceId: device } : {}) });
      media.set(leg.station, m + 30_000);
    }
  }
}

beforeAll(async () => {
  h = await createHarness();
  h.clock.set(T("18:00:00"));
  ie = (await market(h)).id;
  const hd = (await market(h, "high-desert", "High Desert")).id;
  dee = await h.signIn("Dee A.", { admin: true });
  lee = await h.signIn("Lee R.");
  sam = await h.signIn("Sam K.");
  for (const [u, address] of [[lee, "lee@opencast.test"], [sam, "sam@opencast.test"]] as const) await h.db.update(schema.users).set({ email: address }).where(eq(schema.users.id, u.id));
  await dee.post("/v1/admin/desk/team", { email: "lee@opencast.test", roles: [{ role: "market_lead", marketId: ie }] }).expect(200);
  await dee.post("/v1/admin/desk/team", { email: "sam@opencast.test", roles: [{ role: "rights_reviewer" }] }).expect(200);
  const owner = await h.signIn("Kai");
  beat = (await stationFixture(h, { callSign: "BEAT", name: "Beat Tape TV", ownerId: owner.id, marketId: ie, tenths: 121, signedOn: true, colour: "#8C3B7A" })).id;
  rdls = (await stationFixture(h, { callSign: "RDLS", name: "Redlands Community TV", kind: "listed", marketId: ie, tenths: 91, signedOn: true })).id;
  mojv = (await stationFixture(h, { callSign: "MOJV", name: "Mojave", ownerId: owner.id, marketId: hd, tenths: 141, signedOn: true })).id;

  // A tab on BEAT for 10 minutes, then RDLS for 10; later a second tab on the same device, BEAT
  // again; another device on MOJV for 15; and a script beating every 5 seconds (a bot).
  await watch("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", D1, [{ station: beat, from: "19:00:00", minutes: 10 }, { station: rdls, from: "19:10:00", minutes: 10 }]);
  await watch("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", D1, [{ station: beat, from: "19:30:00", minutes: 10 }]);
  await watch("cccccccc-cccc-4ccc-8ccc-cccccccccccc", D2, [{ station: mojv, from: "19:00:00", minutes: 15 }]);
  for (let i = 0; i < 6; i++) {
    h.clock.set(new Date(Date.parse(T("19:40:00")) + i * 5_000).toISOString());
    await h.services.audience.heartbeat({ stationId: beat, sessionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", platform: "web", mediaTimeMs: i * 5_000, playing: true });
  }
  h.clock.set(T("20:05:00"));
  await h.services.audience.totals.tick();
}, 120_000);
afterAll(() => h.close());

const overview = (u: User, extra = "") => u.get(`/v1/desk/analytics/overview?from=${DAY.from}&to=${DAY.to}${extra}`);
const stations = (u: User, extra = "") => u.get(`/v1/desk/analytics/stations?from=${DAY.from}&to=${DAY.to}${extra}`);

describe("the totals", () => {
  it("adds up every station's minutes by hour, external ones too, and the network's busiest minute", async () => {
    const hours = await h.db.select().from(schema.stationHours);
    const minutes = Object.fromEntries([beat, rdls, mojv].map((id) => [id, hours.filter((r) => r.stationId === id).reduce((s, r) => s + r.tunedMinutes, 0)]));
    expect(minutes).toEqual({ [beat]: 20, [rdls]: 10, [mojv]: 15 });
    const net = await h.db.select().from(schema.networkHours).where(eq(schema.networkHours.scope, "all|all"));
    expect(net.reduce((s, r) => s + r.tunedMinutes, 0)).toBe(45);
    // 7:00 to 7:10 pm: BEAT and MOJV at once.
    expect(Math.max(...net.map((r) => r.peak))).toBe(2);
  });

  it("counts sessions, bots by reason, and devices once; and moving around the dial from a visit's minutes", async () => {
    const days = await h.db.select().from(schema.stationDays).where(eq(schema.stationDays.day, "2026-10-01"));
    const beatDay = days.find((d) => d.stationId === beat)!;
    expect(beatDay).toMatchObject({ sessions: 2, bots: 1, botReasons: { "beats too close together": 1 } });
    const devices = await h.db.select().from(schema.deviceDays).where(eq(schema.deviceDays.day, "2026-10-01"));
    expect(devices.find((d) => d.scope === "all|all")).toMatchObject({ devices: 2 });
    expect(devices.find((d) => d.scope === `station:${beat}`)).toMatchObject({ devices: 1 });
    const flows = await h.db.select().from(schema.stationFlows).where(eq(schema.stationFlows.day, "2026-10-01"));
    const flow = (from: string, to: string) => flows.find((f) => f.fromStation === from && f.toStation === to)?.changes ?? 0;
    expect(flow("", beat)).toBe(2);
    expect(flow(beat, rdls)).toBe(1);
    expect(flow(rdls, "")).toBe(1);
    expect(flow(beat, "")).toBe(1);
    expect(flow("", mojv)).toBe(1);
  });

  it("names no session, device or person", async () => {
    for (const table of [schema.stationHours, schema.stationHourPlaces, schema.networkHours, schema.stationDays, schema.deviceDays, schema.stationFlows]) {
      const values = JSON.stringify(await h.db.select().from(table));
      for (const secret of [D1, D2, "aaaaaaaa-aaaa", "bbbbbbbb-bbbb", lee.id, dee.id]) expect(values).not.toContain(secret);
    }
  });
});

describe("the Overview", () => {
  it("shows an admin the whole network: hours, tuned in, peak, sessions and bots, devices, surfaces, places and stations", async () => {
    const { body } = await overview(dee).expect(200);
    expect(body.scope).toMatchObject({ fixedMarket: null, market: null, band: "all", previousFrom: "2026-09-30T07:00:00.000Z" });
    expect(body.scope.markets.map((m: { slug: string }) => m.slug).sort()).toEqual(["high-desert", "inland-empire"]);
    expect(body.hoursWatched).toMatchObject({ value: 0.8, previous: null, byDay: [0.8] });
    expect(body.peakTunedIn).toMatchObject({ value: 2, at: "2026-10-01T19:00:00.000Z" });
    expect(body.sessions).toMatchObject({ value: 4, botsFiltered: 1 });
    expect(body.devices.value).toBe(2);
    expect(body.platforms[0]).toEqual({ platform: "web", hours: 0.8 });
    expect(body.places).toEqual([{ market: null, hours: 0.8 }]);
    expect(body.stations.map((s: { station: { callSign: string; kind: string }; hours: number }) => [s.station.callSign, s.station.kind, s.hours])).toEqual([
      ["BEAT", "independent", 0.3],
      ["MOJV", "independent", 0.3],
      ["RDLS", "external", 0.2]
    ]);
    expect(body.tunedIn.find((p: { at: string }) => p.at === "2026-10-01T19:00:00.000Z").value).toBe(0.8);
  });

  it("keeps a market lead to their market, whatever they ask; a rights reviewer sees nothing", async () => {
    const hd = (await h.services.network.allMarkets()).find((m) => m.slug === "high-desert")!.id;
    const { body } = await overview(lee, `&market=${hd}`).expect(200);
    expect(body.scope).toMatchObject({ fixedMarket: ie, market: ie });
    expect(body.scope.markets.map((m: { id: string }) => m.id)).toEqual([ie]);
    expect(body.stations.map((s: { station: { callSign: string } }) => s.station.callSign).sort()).toEqual(["BEAT", "RDLS"]);
    expect(body.hoursWatched.value).toBe(0.5);
    await overview(sam).expect(403);
  });

  it("narrows to a band, and refuses a span that ends before it starts or runs past a year", async () => {
    const { body } = await overview(dee, "&band=radio").expect(200);
    expect(body.hoursWatched.value).toBe(0);
    expect(body.stations).toEqual([]);
    await dee.get(`/v1/desk/analytics/overview?from=${DAY.to}&to=${DAY.from}`).expect(400);
    await dee.get(`/v1/desk/analytics/overview?from=2024-01-01T00:00:00.000Z&to=${DAY.to}`).expect(400);
  });
});

describe("the Stations table", () => {
  it("has each station's row and the network's; an external station shows what Opencast can count", async () => {
    const { body } = await stations(dee).expect(200);
    const row = (cs: string) => body.rows.find((r: { station: { callSign: string } }) => r.station.callSign === cs);
    expect(row("BEAT")).toMatchObject({ hours: 0.3, peakTunedIn: 1, sessions: 2, deadAirMinutes: 0, timeDownMinutes: null, earnedMicros: 0, held: false, underMinimum: true, stayedToTheEnd: null });
    expect(row("RDLS")).toMatchObject({ hours: 0.2, deadAirMinutes: null, timeDownMinutes: 0, earnedMicros: null, station: { kind: "external" } });
    expect(body.total).toMatchObject({ hours: 0.8, sessions: 4, peakTunedIn: 2 });
  });
});

describe("one station (Ref. 12d 03)", () => {
  it("has its numbers against the network's, its busiest night by the minute, and where its sessions came from and went", async () => {
    // Two tabs on BEAT at 8:00 pm Pacific (its busiest hour now), then the totals again.
    for (const tab of ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2"]) {
      const start = Date.parse("2026-10-02T03:00:00.000Z");
      for (let i = 0; i < 10; i++) {
        h.clock.set(new Date(start + i * 30_000).toISOString());
        await h.services.audience.heartbeat({ stationId: beat, sessionId: tab, platform: "tv_app", mediaTimeMs: i * 30_000, playing: true });
      }
    }
    h.clock.set("2026-10-02T05:00:00.000Z");
    await h.services.audience.totals.tick();

    const { body } = await dee.get(`/v1/desk/analytics/stations/${beat}?from=${DAY.from}&to=${DAY.to}`).expect(200);
    expect(body.station).toMatchObject({ callSign: "BEAT", kind: "independent", market: { slug: "inland-empire" } });
    expect(body.station.onDialSince).toBeTruthy();
    expect(body.hoursWatched.value).toBe(0.5);
    expect(body.hoursWatched.shareOfNetwork).toBeGreaterThan(0);
    expect(body.peakTunedIn).toMatchObject({ value: 2, at: "2026-10-02T03:00:00.000Z" });
    expect(body.underMinimum).toBe(true);
    // Its night: 6 pm to 2 am Pacific, October 1, the two tabs at 8 pm.
    expect(body.night).toMatchObject({ from: "2026-10-02T01:00:00.000Z", to: "2026-10-02T09:00:00.000Z" });
    expect(body.night.minutes.find((m: { at: string }) => m.at === "2026-10-02T03:02:00.000Z").value).toBe(2);
    expect(body.platforms[0]).toMatchObject({ platform: "web" });
    expect(body.places).toEqual([{ market: null, own: false, hours: 0.5 }]);
    // Sessions starting on it (three visits), and the one that went on to RDLS.
    expect(body.cameFrom[0]).toMatchObject({ station: null, changes: 4 });
    expect(body.wentTo.find((f: { station: { callSign: string } | null }) => f.station?.callSign === "RDLS")).toMatchObject({ changes: 1 });
    expect(body.airtime).toEqual({ programs: 0, breaks: 0, live: 0, deadAir: 0 });
    expect(body.earned).toMatchObject({ totalMicros: 0, held: false });
    expect(body.timeDownMinutes).toBeNull();
  });

  it("an external station's: no airtime or earnings of ours, its time down instead", async () => {
    const { body } = await dee.get(`/v1/desk/analytics/stations/${rdls}?from=${DAY.from}&to=${DAY.to}`).expect(200);
    expect(body).toMatchObject({ station: { kind: "external" }, airtime: null, earned: null, timeDownMinutes: 0, adMicrosPer1000Hours: null });
    expect(body.cameFrom.find((f: { station: { callSign: string } | null }) => f.station?.callSign === "BEAT")).toMatchObject({ changes: 1 });
  });

  it("a market lead sees their market's stations only; a rights reviewer none", async () => {
    await lee.get(`/v1/desk/analytics/stations/${beat}?from=${DAY.from}&to=${DAY.to}`).expect(200);
    await lee.get(`/v1/desk/analytics/stations/${mojv}?from=${DAY.from}&to=${DAY.to}`).expect(403);
    await sam.get(`/v1/desk/analytics/stations/${beat}?from=${DAY.from}&to=${DAY.to}`).expect(403);
    await dee.get(`/v1/desk/analytics/stations/00000000-0000-4000-8000-000000000999?from=${DAY.from}&to=${DAY.to}`).expect(404);
  });
});
