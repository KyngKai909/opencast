// The old translators' stream keys leave plain text (follow-up Phase 3): each translator becomes a
// manual platform connection with its key sealed by the platforms module (PLATFORM_SECRETS_KEY),
// checked, then the plain key is nulled; the station's relay setting takes its translators' break
// setting. Idempotent; without a configured key nothing moves (a warning). The old translator
// endpoints keep working, reading and writing through the sealed storage.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { secretBox } from "../src/v1/modules/platforms/secrets.js";
import { platformsSeam } from "../src/v1/modules/relays/platforms.js";
import { createHarness, market, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let kai: User;
let stationId: string;
const T = schema.translators;
const C = schema.platformConnections;

beforeAll(async () => {
  h = await createHarness({ platforms: { providers: { youtube: null, twitch: null }, secrets: secretBox({ id: "k1", key: randomBytes(32) }) } });
  const m = await market(h);
  kai = await h.signIn("Kai");
  stationId = (await stationFixture(h, { callSign: "KEYS", name: "Keys", ownerId: kai.id, marketId: m.id, tenths: 211, signedOn: true })).id;
});

afterAll(async () => {
  await h.close();
});

describe("moving translators' keys into sealed storage", () => {
  it("seals each key as a manual connection, checks it, nulls the plain one, and keeps the break setting", async () => {
    const [yt] = await h.db.insert(T).values({ stationId, service: "youtube", name: "Keys on YouTube", rtmpUrl: "rtmp://a.rtmp.youtube.com/live2", streamKey: "yt-plain-key", breakHandling: "air_spots" }).returning();
    const [fb] = await h.db.insert(T).values({ stationId, service: "rtmp", name: "Keys on Facebook", rtmpUrl: "rtmps://live-api-s.facebook.com:443/rtmp", streamKey: "fb-plain-key", breakHandling: "station_id_slate", enabled: false }).returning();

    expect(await h.services.stations.moveTranslatorKeys()).toEqual({ moved: 2, waiting: 0, failed: 0 });
    const rows = await h.db.select().from(T).where(eq(T.stationId, stationId));
    for (const row of rows) {
      expect(row.streamKey).toBeNull();
      expect(row.platformId).toBeTruthy();
    }
    const connections = await h.db.select().from(C).where(eq(C.stationId, stationId));
    expect(connections.map((c) => [c.name, c.kind, c.method]).sort()).toEqual([
      ["Keys on Facebook", "facebook", "manual"],
      ["Keys on YouTube", "youtube", "manual"]
    ]);
    for (const c of connections) {
      expect(c.streamKeyEnc).toMatch(/^v1\.k1\./);
      expect(c.streamKeyEnc).not.toMatch(/plain-key/);
    }
    // Again: nothing left to move.
    expect(await h.services.stations.moveTranslatorKeys()).toEqual({ moved: 0, waiting: 0, failed: 0 });
    // The station's one relay setting: the slate (one translator showed it), and everything, which translators relayed.
    expect(await h.services.relays.settings(stationId)).toMatchObject({ mode: "everything", breakHandling: "station_id_slate" });

    // The relay reads them from the platforms module, the key opened in memory; the one turned off is left out.
    const dests = await platformsSeam({ deps: h.deps, services: h.services }).destinationsFor(stationId);
    expect(dests).toEqual([expect.objectContaining({ platformId: rows.find((r) => r.id === yt.id)!.platformId, kind: "youtube", streamKey: "yt-plain-key", connected: false })]);
    expect(dests.some((d) => d.platformId === rows.find((r) => r.id === fb.id)!.platformId)).toBe(false);
    // And the Translators page's platforms list shows them, keys never sent.
    const list = (await kai.get(`/v1/stations/${stationId}/platforms`).expect(200)).body;
    expect(list.platforms).toHaveLength(2);
    expect(JSON.stringify(list)).not.toMatch(/plain-key/);
  });

  it("the old translator endpoints read and write through the sealed storage", async () => {
    const listed = (await kai.get(`/v1/stations/${stationId}/translators`).expect(200)).body as Array<{ name: string; hasStreamKey: boolean }>;
    expect(listed.every((t) => t.hasStreamKey)).toBe(true);

    const added = (await kai.post(`/v1/stations/${stationId}/translators`, { service: "twitch", name: "Keys on Twitch", rtmpUrl: "rtmp://live.twitch.tv/app", streamKey: "tw-new-key", breakHandling: "air_spots" }).expect(201)).body;
    expect(added).toMatchObject({ hasStreamKey: true, status: "connected" });
    const [row] = await h.db.select().from(T).where(eq(T.id, added.id));
    expect(row.streamKey).toBeNull();
    const [sealed] = await h.db.select().from(C).where(eq(C.id, row.platformId!));
    expect(sealed).toMatchObject({ kind: "twitch", name: "Keys on Twitch" });
    expect(sealed.streamKeyEnc).not.toContain("tw-new-key");

    // A new key: a new sealed connection, the old one removed (its secret erased).
    await kai.patch(`/v1/stations/${stationId}/translators/${added.id}`, { streamKey: "tw-newer-key" }).expect(200);
    const [changed] = await h.db.select().from(T).where(eq(T.id, added.id));
    expect(changed.platformId).not.toBe(row.platformId);
    const [old] = await h.db.select().from(C).where(eq(C.id, row.platformId!));
    expect(old.removedAt).not.toBeNull();
    expect(old.streamKeyEnc).toBeNull();
    const dests = await h.services.platforms.destinationsFor(stationId);
    expect(dests.find((d) => d.platformId === changed.platformId)?.streamKey).toBe("tw-newer-key");
    // Break setting and switches stay on the translator.
    await kai.patch(`/v1/stations/${stationId}/translators/${added.id}`, { breakHandling: "station_id_slate", enabled: false }).expect(200);
    const [same] = await h.db.select().from(T).where(eq(T.id, added.id));
    expect(same).toMatchObject({ platformId: changed.platformId, breakHandling: "station_id_slate", enabled: false, streamKey: null });

    // Removing one erases its sealed key.
    await kai.delete(`/v1/stations/${stationId}/translators/${added.id}`).expect(200);
    const [gone] = await h.db.select().from(C).where(eq(C.id, changed.platformId!));
    expect(gone.removedAt).not.toBeNull();
    expect(gone.streamKeyEnc).toBeNull();
  });
});

describe("without PLATFORM_SECRETS_KEY", () => {
  it("leaves the plain keys where they are, says so once, and the relay still reads them", async () => {
    const dev = await createHarness({ platforms: { providers: { youtube: null, twitch: null }, secrets: secretBox({ id: "dev", key: randomBytes(32) }, [], { configured: false, usable: true }) } });
    try {
      const m = await market(dev);
      const owner = await dev.signIn("Sam");
      const id = (await stationFixture(dev, { callSign: "PLAN", name: "Plain", ownerId: owner.id, marketId: m.id, tenths: 221, signedOn: true })).id;
      await dev.db.insert(T).values({ stationId: id, service: "rtmp", name: "Custom", rtmpUrl: "rtmp://example.test/live", streamKey: "still-plain" });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      expect(await dev.services.stations.moveTranslatorKeys()).toEqual({ moved: 0, waiting: 1, failed: 0 });
      expect(await dev.services.stations.moveTranslatorKeys()).toEqual({ moved: 0, waiting: 1, failed: 0 });
      expect(warn.mock.calls.filter((c) => String(c[0]).includes("PLATFORM_SECRETS_KEY"))).toHaveLength(1);
      warn.mockRestore();
      const [row] = await dev.db.select().from(T).where(eq(T.stationId, id));
      expect(row).toMatchObject({ streamKey: "still-plain", platformId: null });
      expect((await dev.db.select().from(C).where(eq(C.stationId, id))).length).toBe(0);
      const dests = await platformsSeam({ deps: dev.deps, services: dev.services }).destinationsFor(id);
      expect(dests).toEqual([expect.objectContaining({ platformId: row.id, kind: "custom", streamKey: "still-plain", connected: false })]);
    } finally {
      await dev.close();
    }
  });
});
