// Relay viewers in the Results mock (follow-up Phase 3): BEAT relays to YouTube and Twitch, and
// Orange Street Coffee is local. Results show each airing's relay parts ("Relay viewers, as
// reported by YouTube"; "waiting for YouTube's location data" for the last two days; Twitch never
// billed), their lines and totals; the statement has their own line. Every response goes through
// the contract (reply()). On the reference's Saturday, 8:42 pm.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getResponse, type HttpHandler } from "msw";
import { Results, Statement } from "@opencast/contracts";

const NOW = new Date("2026-09-27T03:42:00Z");
const OSC = `00000000-0000-4000-8000-${String(60001).padStart(12, "0")}`;

let handlers: HttpHandler[];
let db: typeof import("../db");
let fx: typeof import("../fixtures/results");

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  db = await import("../db");
  fx = await import("../fixtures/results");
  handlers = (await import("./results")).resultsHandlers;
});

beforeEach(() => {
  vi.setSystemTime(NOW);
  localStorage.clear();
  db.resetDb();
  fx.resetResults();
});

async function get(path: string, query: Record<string, string> = {}) {
  const url = new URL(`http://localhost/v1${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await getResponse(handlers, new Request(url, { headers: { authorization: "Bearer mock-access-token:jess@orangestreet.example" } }));
  if (!res) throw new Error(`No mock for ${path}`);
  return { status: res.status, json: await res.json() };
}

describe("relay viewers in results", () => {
  it("each BEAT airing since the 14th shows YouTube's and Twitch's relay viewers apart", async () => {
    const res = await get(`/businesses/${OSC}/results`, { month: "2026-09" });
    expect(res.status).toBe(200);
    const results = Results.parse(res.json);
    const relayed = results.airings.filter((a) => a.relayViewers);
    expect(relayed.length).toBeGreaterThan(10);
    expect(relayed.every((a) => a.station.callSign === "BEAT")).toBe(true);
    // The newest: waiting for YouTube's location data; Twitch shown, never billed to a local business.
    const newest = relayed[0]!;
    expect(newest.relayViewers).toEqual([
      expect.objectContaining({ platform: "youtube", label: "Relay viewers, waiting for YouTube's location data", status: "waiting_location", costMicros: 0 }),
      expect.objectContaining({ platform: "twitch", label: "Relay viewers, as reported by Twitch", status: "not_billed", costMicros: 0 })
    ]);
    expect(newest.relayViewers![0]!.heldMicros).toBeGreaterThan(0);
    // Older ones settled for the share YouTube placed in the area.
    const settled = relayed.flatMap((a) => a.relayViewers!).filter((p) => p.status === "settled");
    expect(settled.length).toBeGreaterThan(0);
    expect(settled[0]).toMatchObject({ platform: "youtube", label: "Relay viewers, as reported by YouTube", shareInArea: 0.6, working: expect.stringContaining("60% in your area") });
    expect(relayed.flatMap((a) => a.relayViewers!).some((p) => p.status === "not_billed" && p.platform === "youtube")).toBe(true);
    // Lines and totals: relay spend is inside the month's spend, which stays the balance's $248.90.
    expect(results.relayViewers!.map((l) => l.label)).toEqual(["Relay viewers, as reported by YouTube", "Relay viewers, as reported by Twitch"]);
    expect(results.totals.spentMicros).toBe(248_900_000);
    expect(results.totals.relaySpentMicros).toBe(results.relayViewers![0]!.spentMicros);
    expect(results.totals.relayWaitingMicros).toBeGreaterThan(0);
    expect(results.relayViewers![1]!.spentMicros).toBe(0);
  });

  it("the statement has the relay viewers' own line and what's waiting", async () => {
    const res = await get(`/businesses/${OSC}/statements`);
    expect(res.status).toBe(200);
    const [sept] = Statement.array().parse(res.json);
    expect(sept!.lines).toContainEqual(expect.objectContaining({ kind: "relay_viewers", label: "Relay viewers, as reported by YouTube", relay: { platform: "youtube" } }));
    expect(sept!.lines).toContainEqual(expect.objectContaining({ kind: "relay_waiting", includedAbove: true, relay: { platform: "youtube" } }));
  });
});
