// The relay service's own parts: configuration from the environment only, the lease that keeps a
// second instance waiting (a redeploy, or a move to another host), and the health endpoint.
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { RelayHealth } from "@opencast/contracts";
import { relayConfig } from "../src/config.js";
import { createLease, type LeaseStore } from "../src/lease.js";
import { healthServer } from "../src/server.js";

function memoryStore(): LeaseStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async set(key, value, options) {
      if (options.NX && data.has(key)) return null;
      if (options.XX && !data.has(key)) return null;
      data.set(key, value);
      return "OK";
    },
    async get(key) {
      return data.get(key) ?? null;
    },
    async del(key) {
      return data.delete(key) ? 1 : 0;
    }
  };
}

describe("configuration", () => {
  it("comes from the environment only, with defaults that work on any Linux host", () => {
    const c = relayConfig({ DATABASE_URL: "postgres://x" }, "a");
    expect(c).toMatchObject({ port: 8789, redisUrl: null, tickMs: 5_000, alertAfterMs: 45_000, fanOut: null, livepeerConfigured: false, segmentBase: null });
    const moved = relayConfig({ DATABASE_URL: "postgres://x", PORT: "8080", REDIS_URL: "redis://r:6379", LIVEPEER_API_KEY: "k", RELAY_FAN_OUT: "direct", HLS_PUBLIC_URL: "https://worker.example/", RELAY_SCRATCH_DIR: "/data/scratch" }, "b");
    expect(moved).toMatchObject({ port: 8080, redisUrl: "redis://r:6379", fanOut: "direct", livepeerConfigured: true, segmentBase: "https://worker.example", scratchDir: "/data/scratch", storageRoot: "/data/scratch/storage" });
  });

  it("refuses what it can't run with", () => {
    expect(() => relayConfig({}, "a")).toThrow(/DATABASE_URL/);
    expect(() => relayConfig({ DATABASE_URL: "postgres://x", RELAY_FAN_OUT: "tee" }, "a")).toThrow(/RELAY_FAN_OUT/);
  });
});

describe("the lease", () => {
  it("lets one instance send; the other waits until it lets go", async () => {
    const store = memoryStore();
    const a = createLease(store, "relay", "a", 20);
    const b = createLease(store, "relay", "b", 20);
    expect(await a.refresh()).toBe(true);
    expect(await b.refresh()).toBe(false);
    expect(await a.refresh()).toBe(true);
    await a.release();
    expect(await b.refresh()).toBe(true);
    expect(await a.refresh()).toBe(false);
  });

  it("without Redis (or with Redis failing) the instance keeps relaying", async () => {
    expect(await createLease(null, "relay", "a", 20).refresh()).toBe(true);
    const broken: LeaseStore = { set: () => Promise.reject(new Error("down")), get: () => Promise.reject(new Error("down")), del: () => Promise.reject(new Error("down")) };
    expect(await createLease(broken, "relay", "a", 20, () => undefined).refresh()).toBe(true);
  });
});

describe("the health endpoint", () => {
  let server: ReturnType<typeof healthServer> | null = null;
  afterEach(() => void server?.close());

  it("answers relay hours, bandwidth and errors per station", async () => {
    const body: RelayHealth = {
      ok: false,
      service: "opencast-relay",
      instance: "a",
      leader: true,
      fanOut: "livepeer",
      stations: [
        { stationId: "8f3c2f1e-7a0b-4a8e-9a55-7d7a5f3c0b11", callSign: "BEAT", mode: "everything", status: "relaying", picture: "composite", platforms: 2, relayHours: 3.5, bytesSent: 4_620_000_000, kbps: 2_930, errors: 0, lastError: null, since: "2026-10-03T00:00:00.000Z" },
        { stationId: "0b6f0c55-2d7e-4a8c-8f7a-3c1d2e4f5a66", callSign: "HALL", mode: "everything", status: "stopped", picture: "copy", platforms: 1, relayHours: 1, bytesSent: 10, kbps: 0, errors: 3, lastError: "Connection refused", since: "2026-10-03T00:00:00.000Z" }
      ],
      at: "2026-10-03T03:30:00.000Z"
    };
    server = healthServer(() => body);
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", () => r()));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const parsed = RelayHealth.parse(await res.json());
    expect(parsed.stations.map((s) => [s.callSign, s.status, s.relayHours, s.kbps, s.errors])).toEqual([
      ["BEAT", "relaying", 3.5, 2_930, 0],
      ["HALL", "stopped", 1, 0, 3]
    ]);
    expect((await fetch(`http://127.0.0.1:${port}/other`)).status).toBe(404);
  });
});
