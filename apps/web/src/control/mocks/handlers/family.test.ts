// @vitest-environment node
// Shared call signs on the mocks (A229): Kai owns 12.1 BEAT Inland Beat and 12.2 BEAT Beat Tapes.
// The channels answer his own subchannels, choosing one can share X.1's call sign, and the
// family's rules hold (X.1 stays put; a call sign is fixed once on air).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { dbStation, getDb, resetDb } from "../db";
import { resetSettings, saveSettings, settingsDb } from "../../../desk/mocks/settingsDb";
import { MOCK_TOKEN_PREFIX } from "../../../auth/mockToken";
import { BEAT, MARKET, TAPE, stationByRef } from "../fixtures/stations";
import { handlers } from "./index";

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
  resetSettings();
});

async function api(path: string, init: { method?: string; body?: unknown; as?: string } = {}) {
  const res = await fetch(`http://localhost/v1${path}`, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${MOCK_TOKEN_PREFIX}${init.as ?? "kai@example.com"}`, "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
  });
  return { status: res.status, body: await res.json() };
}

const newStation = async (as = "kai@example.com") => (await api("/stations", { method: "POST", body: { name: "Beat Live", colour: "#1F5E8C" }, as })).body.station.id as string;
const choose = (id: string, channel: string, shareCallSign?: boolean, as?: string) => api(`/stations/${id}/channel`, { method: "PUT", body: { marketId: MARKET.id, band: "tv", channel, ...(shareCallSign === undefined ? {} : { shareCallSign }) }, as });

describe("the mock's family", () => {
  it("seeds 12.2 BEAT Beat Tapes, sharing 12.1 BEAT's call sign, both Kai's", async () => {
    const tape = await api(`/stations/${TAPE.id}/setup`);
    expect(tape.body.station).toMatchObject({ callSign: "BEAT", channel: "12.2", name: "Beat Tapes", slug: "beat-12-2", sharesCallSign: true });
    expect(tape.body.sharesCallSignWith).toMatchObject({ id: BEAT.id, slug: "beat" });
    const beat = await api(`/stations/${BEAT.id}/setup`);
    expect(beat.body.callSignFamily.map((s: { name: string }) => s.name)).toEqual(["Beat Tapes"]);
    expect(beat.body.sharesCallSignWith).toBeNull();
    const me = await api("/me");
    expect(me.body.memberships.filter((m: { role: string }) => m.role === "owner").map((m: { station: { slug: string } }) => m.station.slug)).toEqual(["beat", "beat-12-2"]);
  });

  it("finds a station by slug, and a bare call sign is X.1", async () => {
    expect(stationByRef("BEAT")?.name).toBe("Inland Beat");
    expect(stationByRef("beat-12-2")?.name).toBe("Beat Tapes");
    expect(stationByRef(TAPE.id)?.name).toBe("Beat Tapes");
    expect((await api("/stations/beat-12-2")).body.station.name).toBe("Beat Tapes");
    expect((await api("/stations/beat")).body.station.name).toBe("Inland Beat");
    // Beat Tapes plays the mock server's "tape" stream (BEAT 12.2's bug).
    expect((await api("/stations/beat-12-2")).body.playback?.url).toBe("/mock-hls/tape/master.m3u8");
  });
});

describe("availableChannels' own subchannels", () => {
  it("offers the next free one beside each station Kai owns on X.1", async () => {
    const r = await api("/markets/inland-empire/channels?band=tv");
    expect(r.body.ownSubchannels).toEqual([{ channel: "12.3", beside: expect.objectContaining({ id: BEAT.id }) }]);
    expect((await api("/markets/inland-empire/channels?band=radio")).body.ownSubchannels).toEqual([]);
  });

  it("offers none to someone who owns no X.1, or when the rule is off", async () => {
    expect((await api("/markets/inland-empire/channels?band=tv", { as: "marcus@example.com" })).body.ownSubchannels).toEqual([]);
    settingsDb().rules.push({ id: "00000000-0000-4000-8000-000000009997", key: "numbering.own_subchannels", scope: "", value: { allowed: false }, effectiveFrom: "2026-09-01T00:00:00.000Z", setBy: null, note: null, createdAt: "2026-09-01T00:00:00.000Z" });
    saveSettings();
    expect((await api("/markets/inland-empire/channels?band=tv")).body.ownSubchannels).toEqual([]);
    const id = await newStation();
    expect((await choose(id, "12.3", true)).status).toBe(400);
  });
});

describe("chooseChannel with shareCallSign", () => {
  it("shares X.1's call sign, then lets it go when unticked", async () => {
    const id = await newStation();
    const shared = await choose(id, "12.3", true);
    expect(shared.status).toBe(200);
    expect(shared.body.station).toMatchObject({ callSign: "BEAT", channel: "12.3", slug: "beat-12-3", sharesCallSign: true });
    expect(shared.body.sharesCallSignWith.id).toBe(BEAT.id);
    expect((await api(`/stations/${BEAT.id}/setup`)).body.callSignFamily.map((s: { channel: string }) => s.channel)).toEqual(["12.2", "12.3"]);

    const own = await choose(id, "12.3", false);
    expect(own.body.station.callSign).toBeNull();
    expect(own.body.sharesCallSignWith).toBeNull();
    expect(own.body.station.sharesCallSign).toBeUndefined();
  });

  it("on a subchannel without sharing, the station picks its own", async () => {
    const id = await newStation();
    const r = await choose(id, "12.3", false);
    expect(r.status).toBe(200);
    expect(r.body.station).toMatchObject({ callSign: null, channel: "12.3" });
    expect(r.body.sharesCallSignWith).toBeNull();
  });

  it("stops sharing when the station moves to a main channel", async () => {
    const id = await newStation();
    await choose(id, "12.3", true);
    const moved = await choose(id, "13.1");
    expect(moved.status).toBe(200);
    expect(moved.body.station).toMatchObject({ callSign: null, channel: "13.1" });
    expect(moved.body.sharesCallSignWith).toBeNull();
  });

  it("refuses a subchannel beside someone else's station, or one that's taken", async () => {
    const id = await newStation();
    const civic = await choose(id, "7.2", true);
    expect([civic.status, civic.body.error.code]).toEqual([409, "not_your_subchannel"]);
    const taken = await choose(id, "12.2", true);
    expect([taken.status, taken.body.error.code]).toEqual([409, "channel_taken"]);
    const marcus = await newStation("marcus@example.com");
    expect((await choose(marcus, "12.3", true, "marcus@example.com")).status).toBe(409);
  });

  it("keeps X.1 on its channel while stations share its call sign", async () => {
    const beat = dbStation(BEAT.id)!;
    beat.setup = { ...beat.setup, fixed: false };
    const r = await choose(BEAT.id, "14.1");
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("family_channel");
  });
});

describe("a family's call sign once on air", () => {
  it("a member that has signed on can't take its own", async () => {
    const r = await api(`/stations/${TAPE.id}/setup`, { method: "PATCH", body: { callSign: "TAPE" } });
    expect([r.status, r.body.error.code]).toEqual([422, "fixed_after_sign_on"]);
  });

  it("before its first sign-on a member can take its own, and stops sharing", async () => {
    const id = await newStation();
    await choose(id, "12.3", true);
    const r = await api(`/stations/${id}/setup`, { method: "PATCH", body: { callSign: "LIVE" } });
    expect(r.status).toBe(200);
    expect(r.body.station).toMatchObject({ callSign: "LIVE", slug: "live" });
    expect(r.body.sharesCallSignWith).toBeNull();
  });

  it("X.1's change before sign-on changes the family's, refused once a member is on air", async () => {
    const beat = dbStation(BEAT.id)!;
    beat.setup = { ...beat.setup, fixed: false };
    // Beat Tapes has signed on: refused.
    expect((await api(`/stations/${BEAT.id}/setup`, { method: "PATCH", body: { callSign: "BEET" } })).status).toBe(422);
    // Before it had: the family's changes too.
    const tape = dbStation(TAPE.id)!;
    tape.setup = { ...tape.setup, fixed: false };
    expect((await api(`/stations/${BEAT.id}/setup`, { method: "PATCH", body: { callSign: "BEET" } })).status).toBe(200);
    expect(getDb().stations.find((s) => s.ident.id === TAPE.id)!.ident).toMatchObject({ callSign: "BEET", slug: "beet-12-2" });
  });
});
