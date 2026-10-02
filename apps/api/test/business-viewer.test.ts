// A business's viewer sees results, airings and statements only (biz-settings 02.1, "What each role
// can do"): not the balance, the spot lists, sponsorships or production orders. The catch-up
// report's section 7, gap 3.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@opencast/db";
import { createHarness, market, type Harness, type User } from "./harness.js";

const $ = (dollars: number) => Math.round(dollars * 1_000_000);

let h: Harness;
let jess: User; // the owner
let tomas: User; // a manager
let ana: User; // the bookkeeper, a viewer
let businessId: string;
let spotId: string;

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-09-21T19:00:00.000Z");
  const m = await market(h);
  jess = await h.signIn("Jess Lin");
  tomas = await h.signIn("Tomás");
  ana = await h.signIn("Ana K.");
  const business = await jess
    .post("/v1/businesses", { name: "Orange Street Coffee", category: "Coffee and food", customersWhere: "online", locations: [], marketIds: [m.id] })
    .expect(201);
  businessId = business.body.id;
  await h.db.insert(schema.advertiserMemberships).values([
    { advertiserId: businessId, userId: tomas.id, role: "manager" },
    { advertiserId: businessId, userId: ana.id, role: "viewer" }
  ]);
  const spot = await jess
    .post(`/v1/businesses/${businessId}/spots`, { title: "Pumpkin latte", lengthSec: 15, category: "Coffee and food", rate: { kind: "per_airing", micros: $(3) }, budget: { totalMicros: $(100), dailyCapMicros: null } })
    .expect(201);
  spotId = spot.body.id;
}, 60_000);
afterAll(() => h.close());

describe("a business's viewer", () => {
  it("sees results, airings and statements", async () => {
    await ana.get(`/v1/businesses/${businessId}/results?month=2026-09`).expect(200);
    await ana.get(`/v1/spots/${spotId}/airings`).expect(200);
    await ana.get(`/v1/businesses/${businessId}/statements`).expect(200);
    await ana.get(`/v1/businesses/${businessId}/receipts`).expect(200);
    // The profile, read-only in Settings.
    await ana.get(`/v1/businesses/${businessId}`).expect(200);
  });

  it("doesn't see the balance or what moved in and out of it", async () => {
    await ana.get(`/v1/businesses/${businessId}/balance`).expect(403);
    await ana.get(`/v1/businesses/${businessId}/movements`).expect(403);
  });

  it("doesn't see the spots, sponsorships or production orders", async () => {
    await ana.get(`/v1/businesses/${businessId}/spots`).expect(403);
    await ana.get(`/v1/spots/${spotId}`).expect(403);
    await ana.post(`/v1/spots/${spotId}/matches`, {}).expect(403);
    await ana.get(`/v1/businesses/${businessId}/sponsorships`).expect(403);
    await ana.get(`/v1/businesses/${businessId}/orders`).expect(403);
    await ana.get(`/v1/makers?businessId=${businessId}`).expect(403);
  });

  it("while the owner and managers see all of it", async () => {
    for (const who of [jess, tomas]) {
      await who.get(`/v1/businesses/${businessId}/balance`).expect(200);
      await who.get(`/v1/businesses/${businessId}/movements`).expect(200);
      await who.get(`/v1/businesses/${businessId}/spots`).expect(200);
      await who.get(`/v1/spots/${spotId}`).expect(200);
      await who.get(`/v1/businesses/${businessId}/sponsorships`).expect(200);
      await who.get(`/v1/businesses/${businessId}/orders`).expect(200);
    }
  });
});
