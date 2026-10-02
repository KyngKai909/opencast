// A station from setup to on air, through the HTTP API.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, createHarness, itemFixture, market, testClip, type Harness, type User } from "./harness.js";

let h: Harness;
let owner: User;
let stationId: string;
let marketId: string;

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-10-01T19:00:00.000Z"); // Noon in Los Angeles.
  const m = await market(h);
  marketId = m.id;
  owner = await h.signIn("Kai");
}, 60_000);
afterAll(() => h.close());

describe("setting up a station", () => {
  it("creates it in setup, with the creator as owner", async () => {
    const res = await owner.post("/v1/stations", { name: "Inland Beat", colour: "#8C3B7A" }).expect(201);
    stationId = res.body.station.id;
    expect(res.body).toMatchObject({ status: "setting_up", fixed: false, station: { name: "Inland Beat", colour: "#8C3B7A", callSign: null } });
    const me = await owner.get("/v1/me").expect(200);
    expect(me.body.memberships[0]).toMatchObject({ kind: "station", role: "owner" });
  });

  it("refuses a colour under 4.5:1 on white", async () => {
    const res = await owner.patch(`/v1/stations/${stationId}/setup`, { colour: "#00A96B" }).expect(400);
    expect(res.body.error.fields).toEqual({ colour: "Needs 4.5:1" });
  });

  it("takes a call sign and a channel; X.1 only", async () => {
    await owner.patch(`/v1/stations/${stationId}/setup`, { callSign: "BEAT", homeCity: "Redlands" }).expect(200);
    await owner.put(`/v1/stations/${stationId}/channel`, { marketId, band: "tv", channel: "12.2" }).expect(400);
    const res = await owner.put(`/v1/stations/${stationId}/channel`, { marketId, band: "tv", channel: "12.1" }).expect(200);
    expect(res.body.station).toMatchObject({ callSign: "BEAT", channel: "12.1", band: "tv", marketSlug: "inland-empire" });
    const grid = await owner.get("/v1/markets/inland-empire/channels?band=tv").expect(200);
    expect(grid.body.channels.find((c: { channel: string }) => c.channel === "12.1").state).toBe("taken");
    expect(grid.body.channels.find((c: { channel: string }) => c.channel === "13.1").state).toBe("open");
  });

  it("isn't public before it signs on", async () => {
    await anon(h).get("/v1/stations/BEAT").expect(404);
    const dial = await anon(h).get("/v1/markets/inland-empire/dial").expect(200);
    expect(dial.body.rows).toEqual([]);
  });
});

describe("the library", () => {
  it("uploads a file and prepares it for air in the background", async () => {
    const clip = await testClip(20);
    const res = await owner.post(`/v1/stations/${stationId}/library/uploads`).attach("file", clip).field("title", "BEAT ident").expect(201);
    expect(res.body).toMatchObject({ title: "BEAT ident", code: "BMP", status: "preparing", rights: null, offerable: true });
    await h.services.library.settle();
    const item = await owner.get(`/v1/library/${res.body.id}`).expect(200);
    expect(item.body).toMatchObject({ status: "ready", prepProgress: 100, picture: { width: 640, height: 360 } });
    expect(item.body.durationMs).toBeGreaterThan(19_000);
    expect(item.body.loudnessLufs).toBeLessThan(0);
  }, 60_000);

  it("won't log an item until its rights are confirmed", async () => {
    const item = await itemFixture(h, stationId, { rights: false });
    const add = () => owner.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt: "2026-10-02T03:00:00.000Z", itemId: item.id });
    const refused = await add().expect(422);
    expect(refused.body.error.message).toMatch(/Confirm the rights/);
    await owner.post(`/v1/library/${item.id}/rights`, { basis: "made_it" }).expect(200);
    const logged = await add().expect(201);
    // A 28:30 item takes a 29-minute slot.
    expect(logged.body.endsAt).toBe("2026-10-02T03:29:00.000Z");
    await owner.delete(`/v1/stations/${stationId}/log/${logged.body.id}`).expect(200);
  });

  it("can't delete an item while it's on the log", async () => {
    const item = await itemFixture(h, stationId);
    const entry = await owner.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt: "2026-10-03T03:00:00.000Z", itemId: item.id }).expect(201);
    const res = await owner.delete(`/v1/library/${item.id}`).expect(422);
    expect(res.body.error.message).toBe("Can't be deleted yet: It's in 1 log entry.");
    await owner.delete(`/v1/stations/${stationId}/log/${entry.body.id}`).expect(200);
    await owner.delete(`/v1/library/${item.id}`).expect(200);
  });
});

describe("the program log", () => {
  let showId: string;

  it("never overlaps, and generates breaks from the rule", async () => {
    const show = await owner.post(`/v1/stations/${stationId}/programs`, { title: "Late Crate", description: "Records from the Inland Empire." }).expect(201);
    showId = show.body.id;
    const ep = await itemFixture(h, stationId, { programId: showId, episodeNumber: 14 });
    await owner
      .put(`/v1/stations/${stationId}/break-rule`, {
        mode: "after_every_program",
        everyMinutes: null,
        lengthMs: 120_000,
        spotMsPerHour: 180_000,
        sameSpotPerHour: 2,
        fillOrder: ["SPT", "UND", "BMP", "SID"],
        openTimeTo: "spot_market",
        blockedCategories: ["Alcohol", "Gambling"]
      })
      .expect(200);
    await owner.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt: "2026-10-01T20:00:00.000Z", endsAt: "2026-10-01T20:30:00.000Z", itemId: ep.id }).expect(201);
    const clash = await owner.post(`/v1/stations/${stationId}/log`, { kind: "program", startsAt: "2026-10-01T20:15:00.000Z", endsAt: "2026-10-01T20:45:00.000Z", itemId: ep.id }).expect(422);
    expect(clash.body.error.code).toBe("log_entries_no_overlap");
    const log = await owner.get(`/v1/stations/${stationId}/log?from=2026-10-01T20:00:00.000Z&to=2026-10-01T21:00:00.000Z`).expect(200);
    expect(log.body.entries[0]).toMatchObject({ title: "Late Crate", code: "PGM" });
    expect(log.body.breaks).toEqual([
      expect.objectContaining({ startsAt: "2026-10-01T20:28:30.000Z", lengthMs: 90_000, context: "After Late Crate, ep. 14", openMs: 90_000 })
    ]);
    expect(log.body.gaps).toEqual([{ startsAt: "2026-10-01T20:30:00.000Z", endsAt: "2026-10-01T21:00:00.000Z" }]);
  });

  it("warns of dead air at 30 and 12 minutes", async () => {
    const events: Array<{ minutesBefore: number }> = [];
    h.deps.bus.on("station.dead_air_warning", (e) => void events.push(e));
    h.clock.set("2026-10-01T20:05:00.000Z"); // The gap starts at 20:30.
    await h.services.log.checkDeadAir([stationId]);
    h.clock.set("2026-10-01T20:19:00.000Z");
    await h.services.log.checkDeadAir([stationId]);
    await h.services.log.checkDeadAir([stationId]);
    await h.deps.bus.settle();
    expect(events.map((e) => e.minutesBefore)).toEqual([30, 12]);
    const status = await owner.get(`/v1/stations/${stationId}/dead-air`).expect(200);
    expect(status.body.nextGapAt).toBe("2026-10-01T20:30:00.000Z");
    h.clock.set("2026-10-01T19:00:00.000Z");
  });

  it("fills a gap by repeating from the library", async () => {
    const ep = await itemFixture(h, stationId, { programId: showId, episodeNumber: 15, durationMs: 29.5 * 60_000 });
    const filled = await owner
      .post(`/v1/stations/${stationId}/log/fill`, { with: "repeat", startsAt: "2026-10-01T19:00:00.000Z", endsAt: "2026-10-01T20:00:00.000Z", itemIds: [ep.id] })
      .expect(200);
    expect(filled.body.map((e: { startsAt: string }) => e.startsAt)).toEqual(["2026-10-01T19:00:00.000Z", "2026-10-01T19:30:00.000Z"]);
  });
});

describe("signing on", () => {
  it("is refused until the log covers 24 hours", async () => {
    const checks = await owner.get(`/v1/stations/${stationId}/sign-on/checks`).expect(200);
    expect(checks.body.ready).toBe(false);
    expect(checks.body.checks.find((c: { key: string }) => c.key === "log_covers_24h").passed).toBe(false);
    const res = await owner.post(`/v1/stations/${stationId}/sign-on`).expect(422);
    expect(res.body.error.message).toMatch(/the log covers the next 24 hours/);
  });

  it("signs on once the log is full; call sign and channel are then fixed", async () => {
    // 57:30 in a 58-minute slot leaves a 30-second break (with its station ID) every hour.
    const long = await itemFixture(h, stationId, { title: "Overnight", durationMs: 57.5 * 60_000 });
    await owner
      .post(`/v1/stations/${stationId}/log/fill`, { with: "repeat", startsAt: "2026-10-01T20:30:00.000Z", endsAt: "2026-10-02T21:30:00.000Z", itemIds: [long.id] })
      .expect(200);
    const checks = await owner.get(`/v1/stations/${stationId}/sign-on/checks`).expect(200);
    expect(checks.body.checks.filter((c: { blocking: boolean; passed: boolean }) => c.blocking && !c.passed).map((c: { key: string }) => c.key)).toEqual([]);
    const status = await owner.post(`/v1/stations/${stationId}/sign-on`).expect(202);
    expect(status.body.onAir).toBe(true);
    const setup = await owner.get(`/v1/stations/${stationId}/setup`).expect(200);
    expect(setup.body).toMatchObject({ status: "on_air", fixed: true });
    const change = await owner.patch(`/v1/stations/${stationId}/setup`, { callSign: "BEET" }).expect(422);
    expect(change.body.error.message).toMatch(/fixed after first sign-on/);
    await owner.put(`/v1/stations/${stationId}/channel`, { marketId, band: "tv", channel: "13.1" }).expect(422);
  });
});

describe("the viewer's dial", () => {
  it("lists the station in channel order with now and next, lit when on air", async () => {
    const dial = await anon(h).get("/v1/markets/inland-empire/dial?band=tv").expect(200);
    expect(dial.body.rows).toHaveLength(1);
    const row = dial.body.rows[0];
    expect(row.station).toMatchObject({ callSign: "BEAT", channel: "12.1" });
    expect(row.onAir).toBe(true);
    expect(row.now).toMatchObject({ title: "Late Crate", startsAt: "2026-10-01T19:00:00.000Z" });
    expect(row.next).toMatchObject({ startsAt: "2026-10-01T19:30:00.000Z" });
    expect(row.playback.kind).toBe("hls");
  });

  it("the guide shows a window", async () => {
    const guide = await anon(h).get("/v1/markets/inland-empire/guide?from=2026-10-01T19:00:00.000Z&to=2026-10-01T21:00:00.000Z").expect(200);
    expect(guide.body.rows[0].airings.map((a: { startsAt: string }) => a.startsAt).slice(0, 3)).toEqual([
      "2026-10-01T19:00:00.000Z",
      "2026-10-01T19:30:00.000Z",
      "2026-10-01T20:00:00.000Z"
    ]);
  });

  it("the station page is public now", async () => {
    const page = await anon(h).get("/v1/stations/BEAT").expect(200);
    expect(page.body).toMatchObject({ onAir: true, programs: [expect.objectContaining({ title: "Late Crate" })] });
  });

  it("typing a channel number tunes to it", async () => {
    const res = await anon(h).get("/v1/search?q=12.1").expect(200);
    expect(res.body.tuneTo).toMatchObject({ callSign: "BEAT" });
    const byName = await anon(h).get("/v1/search?q=late%20crate").expect(200);
    expect(byName.body.airings.length).toBeGreaterThan(0);
  });

  it("viewers never see audience numbers", async () => {
    const dial = await anon(h).get("/v1/markets/inland-empire/dial").expect(200);
    expect(JSON.stringify(dial.body)).not.toMatch(/tunedIn|viewers|audience/i);
  });
});

describe("roles", () => {
  it("an operator can edit the log but not the station's identity; a host can't edit the log", async () => {
    const op = await h.signIn("Op");
    const host = await h.signIn("Host");
    const { schema } = await import("@opencast/db");
    await h.db.insert(schema.stationMemberships).values([
      { stationId, userId: op.id, role: "operator" },
      { stationId, userId: host.id, role: "host" }
    ]);
    await op.get(`/v1/stations/${stationId}/break-rule`).expect(200);
    await op.patch(`/v1/stations/${stationId}/setup`, { name: "Beat" }).expect(403);
    const res = await host.post(`/v1/stations/${stationId}/log`, { kind: "off_air", startsAt: "2026-10-05T03:00:00.000Z", endsAt: "2026-10-05T04:00:00.000Z" }).expect(403);
    expect(res.body.error.message).toMatch(/Hosts/);
  });
});
