// The radio band on even tenths, 88.2 to 107.8 (2026-09-29): real US FM stations are only on odd
// tenths, so no Opencast number matches one. Choosing a channel, the grid of open ones, the desk's
// board and proposals, and numbers typed into search.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anon, createHarness, market, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let kai: User;
let dee: User;
let marketId: string;

beforeAll(async () => {
  h = await createHarness();
  h.clock.set("2026-10-01T19:00:00.000Z");
  marketId = (await market(h)).id;
  kai = await h.signIn("Kai");
  dee = await h.signIn("Dee", { admin: true });
  await stationFixture(h, { callSign: "WAVE", name: "Wave", marketId, band: "radio", tenths: 992, signedOn: true });
}, 60_000);
afterAll(() => h.close());

describe("the radio band", () => {
  it("takes even tenths only when a station picks its number", async () => {
    const station = (await kai.post("/v1/stations", { name: "Night Desk", colour: "#33507A" }).expect(201)).body.station;
    for (const odd of ["88.1", "99.1", "101.9", "107.9"]) {
      const res = await kai.put(`/v1/stations/${station.id}/channel`, { marketId, band: "radio", channel: odd }).expect(400);
      expect(res.body.error).toMatchObject({ message: "Radio runs from 88.2 to 107.8, in even tenths.", fields: { channel: "Out of range" } });
    }
    await kai.put(`/v1/stations/${station.id}/channel`, { marketId, band: "radio", channel: "108.0" }).expect(400);
    const res = await kai.put(`/v1/stations/${station.id}/channel`, { marketId, band: "radio", channel: "88.4" }).expect(200);
    expect(res.body.station).toMatchObject({ channel: "88.4", band: "radio" });
  });

  it("offers the 99 even tenths, 88.2 to 107.8, with the ones in use taken", async () => {
    const grid = (await kai.get("/v1/markets/inland-empire/channels?band=radio").expect(200)).body.channels as Array<{ channel: string; state: string }>;
    expect(grid).toHaveLength(99);
    expect([grid[0].channel, grid[1].channel, grid[grid.length - 1].channel]).toEqual(["88.2", "88.4", "107.8"]);
    expect(grid.every((c) => Number(c.channel.split(".")[1]) % 2 === 0)).toBe(true);
    expect(grid.filter((c) => c.state === "taken").map((c) => c.channel)).toEqual(["88.4", "99.2"]);
    expect(grid.find((c) => c.channel === "100.0")?.state).toBe("open");
  });

  it("draws the desk's board on the same 99 frequencies", async () => {
    const board = (await dee.get("/v1/admin/markets/inland-empire/board?band=radio").expect(200)).body.slots as Array<{ major: number; state: string }>;
    expect(board.map((s) => s.major)).toEqual(Array.from({ length: 99 }, (_, i) => 882 + i * 2));
    expect(board.find((s) => s.major === 992)?.state).toBe("station");
  });

  it("refuses a desk proposal on an odd tenth", async () => {
    const creator = (
      await dee
        .post("/v1/admin/creators", { marketId, displayName: "Crate", personName: "Andre Vega", sourcePlatform: "soundcloud", sourceUrl: "https://soundcloud.com/crate", contactEmail: "andre@example.com" })
        .expect(201)
    ).body;
    await dee.patch(`/v1/admin/creators/${creator.id}`, { proposedOptions: { band: "radio", channels: ["101.9"] } }).expect(400);
    const ok = await dee.patch(`/v1/admin/creators/${creator.id}`, { proposedOptions: { band: "radio", channels: ["102.0", "95.6"] } }).expect(200);
    expect(ok.body.proposedOptions).toEqual({ band: "radio", channels: ["102.0", "95.6"] });
  });

  it("tunes search to an even tenth, and never to a real FM number", async () => {
    expect((await anon(h).get("/v1/search?q=99.2").expect(200)).body.tuneTo).toMatchObject({ callSign: "WAVE" });
    expect((await anon(h).get("/v1/search?q=99.1").expect(200)).body.tuneTo).toBeNull();
  });
});
