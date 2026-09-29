// S10: the market from the connection (a stub lookup; addresses aren't stored) and from a
// location. S13: a live block on the stand-by slate shows on the dial.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@opencast/db";
import type { GeoLookup } from "../src/v1/geo.js";
import { clientIp, isPrivateAddress, parseGeo } from "../src/v1/geo.js";
import { anon, createHarness, stationFixture, type Harness } from "./harness.js";

const looked: string[] = [];
const stub: GeoLookup = {
  configured: true,
  async lookup(ip) {
    looked.push(ip);
    if (ip === "203.0.113.5") return { zip: "92501", point: null };
    // Downtown Los Angeles, no ZIP.
    if (ip === "203.0.113.6") return { zip: null, point: { lat: 34.05, lng: -118.25 } };
    // Somewhere far from every market.
    if (ip === "203.0.113.7") return { zip: null, point: { lat: 47.6, lng: -122.3 } };
    return null;
  }
};

let h: Harness;
let bare: Harness;
const ids: Record<string, string> = {};

beforeAll(async () => {
  [h, bare] = await Promise.all([createHarness({ geo: stub }), createHarness()]);
  for (const target of [h, bare]) {
    const rows = await target.db
      .insert(schema.markets)
      .values([
        { slug: "inland-empire", name: "Inland Empire", latitude: "34.0633", longitude: "-117.6509", openedAt: target.clock.now() },
        { slug: "los-angeles", name: "Los Angeles", latitude: "34.0522", longitude: "-118.2437", openedAt: target.clock.now() },
        { slug: "san-diego", name: "San Diego", latitude: "32.7157", longitude: "-117.1611", openedAt: null }
      ])
      .returning();
    if (target === h) for (const row of rows) ids[row.slug] = row.id;
    await target.db.insert(schema.zipMarkets).values({ zip: "92501", marketId: rows[0].id });
  }
}, 60_000);
afterAll(async () => {
  await h.close();
  await bare.close();
});

const names = (nearby: Array<{ market: { slug: string }; miles: number | null }>) => nearby.map((n) => [n.market.slug, n.miles]);

describe("the market from the connection (S10)", () => {
  it("looks the address up and forgets it: a ZIP, a point, or nothing", async () => {
    const byZip = await anon(h).get("/v1/markets/by-connection").set("x-forwarded-for", "203.0.113.5").expect(200);
    expect(byZip.body.market.slug).toBe("inland-empire");
    expect(names(byZip.body.nearby)).toEqual([["los-angeles", 34]]);

    const byPoint = await anon(h).get("/v1/markets/by-connection").set("x-forwarded-for", "203.0.113.6").expect(200);
    expect(byPoint.body.market.slug).toBe("los-angeles");
    expect(names(byPoint.body.nearby)).toEqual([["inland-empire", 34]]);

    const far = await anon(h).get("/v1/markets/by-connection").set("x-forwarded-for", "203.0.113.7").expect(200);
    expect(far.body.market).toBeNull();
    // Open markets only, by distance.
    expect(far.body.nearby.map((n: { market: { slug: string } }) => n.market.slug)).toEqual(["los-angeles", "inland-empire"]);
    expect(far.body.nearby.every((n: { miles: number }) => n.miles > 900)).toBe(true);

    const unknown = await anon(h).get("/v1/markets/by-connection").set("x-forwarded-for", "203.0.113.99").expect(200);
    expect(unknown.body).toEqual({ market: null, nearby: [expect.objectContaining({ miles: null }), expect.objectContaining({ miles: null })] });
    expect(unknown.body.nearby.map((n: { market: { slug: string } }) => n.market.slug)).toEqual(["inland-empire", "los-angeles"]);
    expect(looked).toEqual(["203.0.113.5", "203.0.113.6", "203.0.113.7", "203.0.113.99"]);
  });

  it("never looks up a private address, and with nothing configured there's no lookup", async () => {
    looked.length = 0;
    for (const ip of ["10.1.2.3", "192.168.1.20", "127.0.0.1", "fd00::1", "100.64.0.9"]) {
      const res = await anon(h).get("/v1/markets/by-connection").set("x-forwarded-for", ip).expect(200);
      expect(res.body.market).toBeNull();
      expect(names(res.body.nearby)).toEqual([
        ["inland-empire", null],
        ["los-angeles", null]
      ]);
    }
    // supertest connects from loopback, so no header is private too.
    await anon(h).get("/v1/markets/by-connection").expect(200);
    expect(looked).toEqual([]);

    const none = await anon(bare).get("/v1/markets/by-connection").set("x-forwarded-for", "203.0.113.5").expect(200);
    expect(none.body.market).toBeNull();
    expect(none.body.nearby).toHaveLength(2);
  });

  it("reads the lookup's answer and the client's address", () => {
    expect(parseGeo("92501")).toEqual({ zip: "92501", point: null });
    expect(parseGeo('{"postal":"92501-1234","latitude":33.98,"longitude":-117.37}')).toEqual({ zip: "92501", point: { lat: 33.98, lng: -117.37 } });
    expect(parseGeo('{"zip_code":"","lat":0,"lon":0}')).toBeNull();
    expect(parseGeo("not a zip")).toBeNull();
    const req = (xff?: string, remote = "::ffff:127.0.0.1") => ({ headers: xff ? { "x-forwarded-for": xff } : {}, socket: { remoteAddress: remote } }) as never;
    expect(clientIp(req("1.2.3.4, 203.0.113.5"))).toBe("203.0.113.5");
    expect(clientIp(req("1.2.3.4, 203.0.113.5, 10.0.0.2"), 2)).toBe("203.0.113.5");
    expect(clientIp(req())).toBe("127.0.0.1");
    expect(clientIp(req("garbage"))).toBeNull();
    expect(isPrivateAddress("203.0.113.5")).toBe(false);
    expect(isPrivateAddress("172.20.0.1")).toBe(true);
    expect(isPrivateAddress("2606:4700::1111")).toBe(false);
  });
});

describe("the market from a location (S10)", () => {
  it("finds the nearest market within 50 miles, and the others within 60", async () => {
    const riverside = await anon(h).get("/v1/markets/by-location?lat=33.98&lng=-117.37").expect(200);
    expect(riverside.body.market.slug).toBe("inland-empire");
    expect(names(riverside.body.nearby)).toEqual([["los-angeles", 50]]);

    const seattle = await anon(h).get("/v1/markets/by-location?lat=47.6&lng=-122.3").expect(200);
    expect(seattle.body.market).toBeNull();
    expect(seattle.body.nearby.map((n: { market: { slug: string } }) => n.market.slug)).toEqual(["los-angeles", "inland-empire"]);

    // A market that isn't open yet is still the market you're in.
    const sd = await anon(h).get("/v1/markets/by-location?lat=32.72&lng=-117.16").expect(200);
    expect(sd.body.market).toMatchObject({ slug: "san-diego", open: false });

    await anon(h).get("/v1/markets/by-location?lat=91&lng=0").expect(400);
    await anon(h).get("/v1/markets/by-location?lat=34").expect(400);
  });
});

describe("stand by on the dial (S13)", () => {
  it("says standby while a live block waits for its signal, ok otherwise, nothing off air", async () => {
    const owner = await h.signIn();
    const live = await stationFixture(h, { callSign: "LIVS", ownerId: owner.id, marketId: ids["inland-empire"], tenths: 131, signedOn: true });
    const quiet = await stationFixture(h, { callSign: "QUIT", ownerId: owner.id, marketId: ids["inland-empire"], tenths: 141, signedOn: true });
    const [source] = await h.db.insert(schema.liveSources).values({ stationId: live.id, kind: "encoder", name: "Studio A", streamKey: "k" }).returning();
    const now = h.clock.now().getTime();
    await h.db.insert(schema.logEntries).values({ stationId: live.id, startsAt: new Date(now - 60_000), endsAt: new Date(now + 3_600_000), kind: "live", code: "PGM", liveSourceId: source.id });
    await h.db.insert(schema.playoutState).values({ stationId: live.id, onAir: true, standingBy: true });

    const row = async (callSign: string) => {
      const dial = await anon(h).get("/v1/markets/inland-empire/dial").expect(200);
      return dial.body.rows.find((r: { station: { callSign: string } }) => r.station.callSign === callSign);
    };
    expect(await row("LIVS")).toMatchObject({ onAir: true, signal: "standby", now: { kind: "live" } });
    expect((await row("QUIT")).signal).toBeUndefined();

    await h.db.update(schema.playoutState).set({ standingBy: false });
    expect((await row("LIVS")).signal).toBe("ok");
  });
});
