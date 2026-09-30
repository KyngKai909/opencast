// A215 (follow-up Phase 6): changing an external station's listing and taking it off for good. An
// edit never puts anything on the dial without evidence that covers what now plays (a written
// permission names one exact stream address; embed terms were checked for one player's host; a
// public basis is about the source; a new way to play needs its own evidence). A new address is
// checked afresh, a new schedule read again, and every change is kept. Taken off the dial, a
// listing is archived like a full station that signs off for good (nothing deleted), and it can be
// put back while its channel is free. No network: every fetch is a fake, and the clock is pinned.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { REMOVED_CHANNEL_HOLD_MS, type Fetch } from "../src/v1/modules/network/external.js";
import { anon, createHarness, market, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let dee: User; // an Opencast admin
let lee: User; // the Inland Empire's market lead
let marketId: string;
const ids: Record<string, string> = {};

const COLTON_HLS = "https://colton.example.gov/live/council.m3u8";
const COLTON_NEW = "https://stream.colton.example.gov/council/index.m3u8";
const REDLANDS_EMBED = "https://redlands.example.gov/meetings/player";
const NASA_HLS = "https://nasa.example.gov/live/master.m3u8";
const MARIA = { grantedBy: "Maria Lopez, City Clerk, City of Colton", grantedOn: "2026-09-24", evidence: "Email to network@opencast.tv, Sept 24" };

/** A fake network: each address answers what `routes` says, and every call is kept. */
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const route = routes[url];
    if (!route) throw new TypeError("fetch failed");
    return route();
  }) as Fetch;
  return { fn, calls };
}
const playlist = () => new Response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000\nhd/index.m3u8\n");

const listing = async (id: string) => {
  const [listed, removed] = await Promise.all([dee.get(`/v1/admin/listed-sources?marketId=${marketId}`).expect(200), dee.get(`/v1/admin/listed-sources?marketId=${marketId}&show=removed`).expect(200)]);
  return [...listed.body, ...removed.body].find((s: { id: string }) => s.id === id);
};
const dialSigns = async () => (await anon(h).get("/v1/markets/inland-empire/dial").expect(200)).body.rows.map((r: { station: { callSign: string } }) => r.station.callSign);
const changes = async (id: string, who: User = dee) => (await who.get(`/v1/admin/listed-sources/${id}/changes`).expect(200)).body;

beforeAll(async () => {
  h = await createHarness();
  // Saturday, September 26, 8:42 pm in the Inland Empire (the reference's moment).
  h.clock.set("2026-09-27T03:42:00.000Z");
  dee = await h.signIn("Dee A.", { admin: true });
  lee = await h.signIn("Lee R.");
  marketId = (await market(h)).id;
  await h.db.update(schema.users).set({ email: "lee@opencast.test" }).where(eq(schema.users.id, lee.id));
  await dee.post("/v1/admin/desk/team", { email: "lee@opencast.test", roles: [{ role: "market_lead", marketId }] }).expect(200);
  await stationFixture(h, { callSign: "BEAT", marketId, tenths: 121, signedOn: true });
  const add = async (key: string, body: object) => (ids[key] = (await dee.post("/v1/admin/listed-sources", { marketId, band: "tv", ...body }).expect(201)).body.id);
  await add("RDLS", { channel: "9.1", callSign: "RDLS", name: "City of Redlands", streamUrl: REDLANDS_EMBED, plays: "embed", embedTerms: "allowed", evidence: { termsUrl: "https://redlands.example.gov/terms", termsCheckedOn: "2026-09-21" } });
  await add("COLT", { channel: "9.2", callSign: "COLT", name: "City of Colton", description: "Council meetings", streamUrl: COLTON_HLS, plays: "stream_link", evidence: { permission: MARIA } });
  await add("NASA", { channel: "61.1", callSign: "NASA", name: "NASA", streamUrl: NASA_HLS, plays: "stream_link", evidence: { publicBasis: "US government, public" } });
  expect(await dialSigns()).toEqual(expect.arrayContaining(["RDLS", "COLT", "NASA"]));
}, 60_000);
afterAll(() => h.close());

describe("changing a listing", () => {
  it("makes a stream link with written permission wait when its address changes, keeping the old permission as it was", async () => {
    const before = await h.db.select().from(schema.streamPermissions);
    const res = await dee.patch(`/v1/admin/listed-sources/${ids.COLT}`, { streamUrl: COLTON_NEW }).expect(200);
    expect(res.body).toMatchObject({ streamUrl: COLTON_NEW, onDial: false, waiting: "needs_permission", listingState: "checking", evidence: { basis: null, permission: null }, health: { state: "unchecked" } });
    expect(res.body.earlierPermissions).toEqual([expect.objectContaining({ grantedBy: MARIA.grantedBy, streamUrl: COLTON_HLS, recordedBy: "Dee A." })]);
    expect(await dialSigns()).not.toContain("COLT");
    // Never edited: the record is exactly as it was.
    expect(await h.db.select().from(schema.streamPermissions)).toEqual(before);

    // New evidence for the new address, and it's back.
    const yes = await dee.post(`/v1/admin/listed-sources/${ids.COLT}/evidence`, { permission: { ...MARIA, grantedOn: "2026-09-26", evidence: "Email to network@opencast.tv, Sept 26" } }).expect(200);
    expect(yes.body).toMatchObject({ onDial: true, waiting: null, evidence: { basis: "written_permission", permission: { streamUrl: COLTON_NEW, grantedOn: "2026-09-26" } } });
    expect(yes.body.earlierPermissions.map((p: { streamUrl: string }) => p.streamUrl)).toEqual([COLTON_HLS]);
    expect(await dialSigns()).toContain("COLT");
    expect(await h.db.select().from(schema.streamPermissions)).toHaveLength(before.length + 1);
  });

  it("is covered again by the permission recorded for an address it goes back to", async () => {
    const back = await dee.patch(`/v1/admin/listed-sources/${ids.COLT}`, { streamUrl: COLTON_HLS }).expect(200);
    expect(back.body).toMatchObject({ onDial: true, evidence: { basis: "written_permission", permission: { streamUrl: COLTON_HLS, grantedOn: "2026-09-24" } } });
    await dee.patch(`/v1/admin/listed-sources/${ids.COLT}`, { streamUrl: COLTON_NEW }).expect(200);
    expect(await listing(ids.COLT)).toMatchObject({ onDial: true, evidence: { permission: { streamUrl: COLTON_NEW } } });
  });

  it("keeps an embed's terms for an address on the same host, and waits for them on another", async () => {
    const same = await dee.patch(`/v1/admin/listed-sources/${ids.RDLS}`, { streamUrl: "https://redlands.example.gov/meetings/player?v=2" }).expect(200);
    expect(same.body).toMatchObject({ onDial: true, evidence: { basis: "embed_terms", termsUrl: "https://redlands.example.gov/terms", termsCheckedOn: "2026-09-21" } });
    const other = await dee.patch(`/v1/admin/listed-sources/${ids.RDLS}`, { streamUrl: "https://video.example-host.com/redlands/player" }).expect(200);
    expect(other.body).toMatchObject({ onDial: false, waiting: "needs_terms", evidence: { basis: null, termsUrl: "https://redlands.example.gov/terms", termsCheckedOn: null } });
    const checked = await dee.post(`/v1/admin/listed-sources/${ids.RDLS}/evidence`, { termsUrl: "https://video.example-host.com/terms", termsCheckedOn: "2026-09-26" }).expect(200);
    expect(checked.body).toMatchObject({ onDial: true, evidence: { basis: "embed_terms", termsCheckedOn: "2026-09-26" } });
    // Their terms turning unclear takes it off too.
    const unclear = await dee.patch(`/v1/admin/listed-sources/${ids.RDLS}`, { embedTerms: "unclear" }).expect(200);
    expect(unclear.body).toMatchObject({ onDial: false, waiting: "terms_unclear" });
    await dee.patch(`/v1/admin/listed-sources/${ids.RDLS}`, { embedTerms: "allowed" }).expect(200);
    expect((await listing(ids.RDLS)).onDial).toBe(true);
  });

  it("keeps a public basis when the address changes, since it's about the source", async () => {
    const res = await dee.patch(`/v1/admin/listed-sources/${ids.NASA}`, { streamUrl: "https://nasa.example.gov/live/public/master.m3u8" }).expect(200);
    expect(res.body).toMatchObject({ onDial: true, evidence: { basis: "public_source", publicBasis: "US government, public" } });
  });

  it("needs the new kind's evidence when how it plays changes, either way", async () => {
    await dee.patch(`/v1/admin/listed-sources/${ids.NASA}`, { plays: "embed" }).expect(400);
    const embed = await dee.patch(`/v1/admin/listed-sources/${ids.NASA}`, { plays: "embed", embedTerms: "allowed", streamUrl: "https://nasa.example.gov/live/embed" }).expect(200);
    expect(embed.body).toMatchObject({ plays: "embed", onDial: false, waiting: "needs_terms", streamFormat: null, evidence: { basis: null, publicBasis: null } });
    const back = await dee.patch(`/v1/admin/listed-sources/${ids.NASA}`, { plays: "stream_link", streamUrl: NASA_HLS }).expect(200);
    // The public basis was set aside with the switch (it's in the history): recorded again, it's back.
    expect(back.body).toMatchObject({ plays: "stream_link", onDial: false, waiting: "needs_permission" });
    expect((await dee.post(`/v1/admin/listed-sources/${ids.NASA}/evidence`, { publicBasis: "US government, public" }).expect(200)).body.onDial).toBe(true);
    const link = await dee.patch(`/v1/admin/listed-sources/${ids.RDLS}`, { plays: "stream_link", streamUrl: "https://redlands.example.gov/live.m3u8" }).expect(200);
    expect(link.body).toMatchObject({ plays: "stream_link", onDial: false, waiting: "needs_permission" });
    await dee.patch(`/v1/admin/listed-sources/${ids.RDLS}`, { plays: "embed", embedTerms: "allowed", streamUrl: REDLANDS_EMBED }).expect(200);
    const again = await dee.post(`/v1/admin/listed-sources/${ids.RDLS}/evidence`, { termsUrl: "https://redlands.example.gov/terms", termsCheckedOn: "2026-09-26" }).expect(200);
    expect(again.body.onDial).toBe(true);
  });

  it("starts health afresh on a new address, not hidden for the old one's outage, and keeps the outage", async () => {
    let up = false;
    const { fn } = fakeFetch({ [NASA_HLS]: () => (up ? playlist() : new Response("", { status: 503 })), [COLTON_NEW]: playlist, [REDLANDS_EMBED]: () => new Response(null), "https://nasa.example.gov/live/v2.m3u8": playlist });
    h.clock.set("2026-09-27T03:50:00.000Z");
    await h.services.network.checkExternalStations({ fetch: fn });
    h.clock.set("2026-09-27T03:56:00.000Z");
    await h.services.network.checkExternalStations({ fetch: fn });
    expect(await listing(ids.NASA)).toMatchObject({ onDial: false, waiting: "down", health: { state: "hidden" } });
    const moved = await dee.patch(`/v1/admin/listed-sources/${ids.NASA}`, { streamUrl: "https://nasa.example.gov/live/v2.m3u8" }).expect(200);
    expect(moved.body).toMatchObject({ onDial: true, waiting: null, health: { state: "unchecked", since: null, lastCheckedAt: null, detail: null } });
    expect(await dialSigns()).toContain("NASA");
    const outages = await dee.get(`/v1/admin/listed-sources/${ids.NASA}/outages`).expect(200);
    expect(outages.body[0]).toMatchObject({ downSince: "2026-09-27T03:50:00.000Z", hiddenAt: "2026-09-27T03:56:00.000Z", backAt: "2026-09-27T03:56:00.000Z", detail: "HTTP 503", ended: "address_changed" });
    // The next minute checks the new address.
    h.clock.set("2026-09-27T03:57:00.000Z");
    await h.services.network.checkExternalStations({ fetch: fn });
    expect((await listing(ids.NASA)).health).toMatchObject({ state: "up" });
    up = true;
  });

  it("reads a new schedule feed at once, and a schedule of none drops what the old feed listed from now", async () => {
    const feed = JSON.stringify({ events: [{ id: "cc-9", title: "City Council, special meeting", start: "2026-09-29T01:00:00Z", end: "2026-09-29T03:00:00Z" }] });
    const { fn, calls } = fakeFetch({ "https://colton.example.gov/agenda.json": () => new Response(feed, { headers: { "content-type": "application/json" } }) });
    const res = await h.services.network.updateListedSource(null, ids.COLT, { schedule: { source: "feed", calendarUrl: "https://colton.example.gov/agenda.json" } }, fn);
    expect(calls).toEqual(["https://colton.example.gov/agenda.json"]);
    expect(res).toMatchObject({ calendarSync: "synced", upcoming: 1, schedule: { source: "feed", format: "json", url: "https://colton.example.gov/agenda.json" } });
    const none = await dee.patch(`/v1/admin/listed-sources/${ids.COLT}`, { schedule: { source: "none" } }).expect(200);
    expect(none.body).toMatchObject({ calendarUrl: null, calendarSync: "not_set", upcoming: 0, schedule: { source: "none", url: null } });
  });

  it("changes the channel and call sign by the rules for listing, holding the old call sign", async () => {
    // A full station's major, a subchannel alone, and a taken call sign are refused as when listing.
    expect((await dee.patch(`/v1/admin/listed-sources/${ids.COLT}`, { channel: "12.2" }).expect(409)).body.error.code).toBe("channel_taken");
    await dee.patch(`/v1/admin/listed-sources/${ids.NASA}`, { channel: "14.2" }).expect(400);
    expect((await dee.patch(`/v1/admin/listed-sources/${ids.COLT}`, { callSign: "BEAT" }).expect(409)).body.error.code).toBe("call_sign_taken");
    // A subchannel beside other external stations, and a new call sign.
    const res = await dee.patch(`/v1/admin/listed-sources/${ids.COLT}`, { channel: "9.4", callSign: "CLTN", name: "Colton City Council" }).expect(200);
    expect(res.body).toMatchObject({ name: "Colton City Council", station: { channel: "9.4", callSign: "CLTN", name: "Colton City Council" }, onDial: true });
    expect(await dialSigns()).toContain("CLTN");
    await anon(h).get("/v1/stations/cltn").expect(200);
    // COLT is held for it: nobody else can take it, and it can take it back.
    expect((await dee.post("/v1/admin/listed-sources", { marketId, band: "tv", channel: "9.5", callSign: "COLT", name: "Someone", streamUrl: "https://x.example.gov/a.m3u8", plays: "stream_link" }).expect(409)).body.error.code).toBe("call_sign_taken");
    const back = await dee.patch(`/v1/admin/listed-sources/${ids.COLT}`, { channel: "9.2", callSign: "COLT", name: "City of Colton" }).expect(200);
    expect(back.body.station).toMatchObject({ channel: "9.2", callSign: "COLT" });
    // Only admins change a listing.
    await lee.patch(`/v1/admin/listed-sources/${ids.COLT}`, { name: "Nope" }).expect(403);
  });

  it("keeps every change: who, when, which fields from and to, with addresses in full to admins only", async () => {
    const all = await changes(ids.COLT);
    const first = all[all.length - 1];
    expect(first).toMatchObject({ by: "Dee A.", action: "changed", fields: [{ field: "streamUrl", from: COLTON_HLS, to: COLTON_NEW }], effects: ["waits_for_evidence", "checks_restart"], at: "2026-09-27T03:42:00.000Z" });
    expect(all.find((c: { fields: Array<{ field: string; from: string | null }> }) => c.fields.some((f: { field: string; from: string | null }) => f.field === "callSign" && f.from === "COLT"))).toMatchObject({ fields: expect.arrayContaining([{ field: "channel", from: "9.2", to: "9.4" }, { field: "callSign", from: "COLT", to: "CLTN" }]) });
    expect(all.find((c: { effects: string[] }) => c.effects.includes("schedule_reread"))).toMatchObject({ by: null, fields: expect.arrayContaining([{ field: "schedule", from: "none", to: "feed" }]) });
    // The market's lead reads it too, with each address as its host.
    const theirs = await changes(ids.COLT, lee);
    expect(theirs[theirs.length - 1].fields).toEqual([{ field: "streamUrl", from: "https://colton.example.gov/…", to: "https://stream.colton.example.gov/…" }]);
    // Nothing changed, nothing kept.
    const n = all.length;
    await dee.patch(`/v1/admin/listed-sources/${ids.COLT}`, { name: "City of Colton" }).expect(200);
    expect(await changes(ids.COLT)).toHaveLength(n);
  });
});

describe("taking a listing off for good", () => {
  let counts: Record<string, number>;
  const tally = async () => ({
    listings: (await h.db.select({ n: count() }).from(schema.listedSources))[0].n,
    permissions: (await h.db.select({ n: count() }).from(schema.streamPermissions))[0].n,
    outages: (await h.db.select({ n: count() }).from(schema.externalOutages))[0].n,
    airings: (await h.db.select({ n: count() }).from(schema.listedAirings))[0].n,
    stations: (await h.db.select({ n: count() }).from(schema.stations))[0].n
  });

  it("takes it off the dial, the guide and search at once, stops its checks and feed, and deletes nothing", async () => {
    // A feed for Redlands, so there's something to stop reading.
    const feed = JSON.stringify({ events: [{ title: "Planning Commission", start: "2026-09-27T04:00:00Z", end: "2026-09-27T06:00:00Z" }] });
    const { fn: feedFn } = fakeFetch({ "https://redlands.example.gov/agenda.json": () => new Response(feed, { headers: { "content-type": "application/json" } }) });
    await h.services.network.updateListedSource(null, ids.RDLS, { schedule: { source: "feed", calendarUrl: "https://redlands.example.gov/agenda.json" } }, feedFn);
    expect((await anon(h).get("/v1/search?q=planning&market=inland-empire").expect(200)).body.airings).toHaveLength(1);
    counts = await tally();

    await lee.post(`/v1/admin/listed-sources/${ids.RDLS}/remove`).expect(403);
    const res = await dee.post(`/v1/admin/listed-sources/${ids.RDLS}/remove`).expect(200);
    expect(res.body).toMatchObject({ listingState: "not_listed", onDial: false, removed: { at: "2026-09-27T03:57:00.000Z", by: "Dee A.", channel: "9.1", channelHeldUntil: new Date(Date.parse("2026-09-27T03:57:00.000Z") + REMOVED_CHANNEL_HOLD_MS).toISOString() } });
    expect(await dialSigns()).not.toContain("RDLS");
    const guide = await anon(h).get("/v1/markets/inland-empire/guide?from=2026-09-27T03:00:00.000Z&to=2026-09-27T06:00:00.000Z").expect(200);
    expect(guide.body.rows.map((r: { station: { callSign: string } }) => r.station.callSign)).not.toContain("RDLS");
    const search = await anon(h).get("/v1/search?q=planning&market=inland-empire").expect(200);
    expect(search.body.airings).toEqual([]);
    expect((await anon(h).get("/v1/search?q=9.1&market=inland-empire").expect(200)).body.tuneTo).toBeNull();
    expect((await anon(h).get("/v1/search?q=redlands&market=inland-empire").expect(200)).body.stations).toEqual([]);
    // Its page is gone, like a full station's that signed off for good, and says so.
    const page = await anon(h).get("/v1/stations/rdls").expect(404);
    expect(page.body.error.message).toBe("RDLS, City of Redlands is no longer on the dial.");

    // Checks and schedule reads stop.
    const { fn, calls } = fakeFetch({ [REDLANDS_EMBED]: () => new Response(null), [COLTON_NEW]: playlist, "https://nasa.example.gov/live/v2.m3u8": playlist, "https://redlands.example.gov/agenda.json": () => new Response(feed) });
    await h.services.network.checkExternalStations({ fetch: fn });
    await h.services.network.syncExternalSchedules({ fetch: fn });
    expect(calls).not.toContain(REDLANDS_EMBED);
    expect(calls).not.toContain("https://redlands.example.gov/agenda.json");
    await dee.post(`/v1/admin/listed-sources/${ids.RDLS}/sync`).expect(409);
    await dee.patch(`/v1/admin/listed-sources/${ids.RDLS}`, { name: "Nope" }).expect(409);

    // Nothing deleted.
    expect(await tally()).toEqual(counts);
    expect((await changes(ids.RDLS))[0]).toMatchObject({ action: "removed", by: "Dee A." });
  });

  it("lists it under the removed ones only, and keeps its channel and call sign held for it", async () => {
    const listed = (await dee.get(`/v1/admin/listed-sources?marketId=${marketId}`).expect(200)).body.map((s: { id: string }) => s.id);
    expect(listed).not.toContain(ids.RDLS);
    const removed = (await lee.get(`/v1/admin/listed-sources?marketId=${marketId}&show=removed`).expect(200)).body;
    expect(removed.map((s: { id: string }) => s.id)).toEqual([ids.RDLS]);
    // The number is held 90 days, like a full station's that signs off for good; the call sign stays its own.
    const base = { marketId, band: "tv", name: "Somewhere", streamUrl: "https://x.example.gov/live.m3u8", plays: "stream_link", evidence: { publicBasis: "Public body" } };
    expect((await dee.post("/v1/admin/listed-sources", { ...base, channel: "9.1", callSign: "SOME" }).expect(409)).body.error.code).toBe("channel_taken");
    expect((await dee.post("/v1/admin/listed-sources", { ...base, channel: "9.5", callSign: "RDLS" }).expect(409)).body.error.code).toBe("call_sign_taken");
    const board = await dee.get("/v1/admin/markets/inland-empire/board?band=tv").expect(200);
    expect(board.body.slots.find((s: { major: number }) => s.major === 9)).toMatchObject({ state: "listed", status: "Taken off the dial" });
    const outages = await lee.get(`/v1/admin/listed-sources/${ids.RDLS}/outages`).expect(200);
    expect(outages.body).toEqual([]);
  });

  it("puts it back on the list on its channel, waiting for its checks", async () => {
    h.clock.set("2026-09-28T03:00:00.000Z");
    await lee.post(`/v1/admin/listed-sources/${ids.RDLS}/restore`, {}).expect(403);
    // Its feed is read again as it comes back (a fake network here).
    const { fn, calls } = fakeFetch({ "https://redlands.example.gov/agenda.json": () => new Response("{\"events\":[]}", { headers: { "content-type": "application/json" } }) });
    const res = await h.services.network.restoreListedSource(null, ids.RDLS, {}, fn);
    expect(calls).toEqual(["https://redlands.example.gov/agenda.json"]);
    expect(res).toMatchObject({ removed: null, listingState: "listed", onDial: true, station: { channel: "9.1", callSign: "RDLS" }, health: { state: "unchecked" } });
    expect(await dialSigns()).toContain("RDLS");
    await anon(h).get("/v1/stations/rdls").expect(200);
    expect((await changes(ids.RDLS))[0]).toMatchObject({ action: "restored", fields: [] });
    await dee.post(`/v1/admin/listed-sources/${ids.RDLS}/restore`, {}).expect(409);
  });

  it("frees its channel 90 days after it's taken off, and refuses to put it back on a number that's gone", async () => {
    await dee.post(`/v1/admin/listed-sources/${ids.RDLS}/remove`).expect(200);
    h.clock.advance(REMOVED_CHANNEL_HOLD_MS - 60_000);
    expect((await h.services.network.syncExternalSchedules({ fetch: fakeFetch({}).fn })).released).toBe(0);
    h.clock.advance(120_000);
    expect((await h.services.network.syncExternalSchedules({ fetch: fakeFetch({}).fn })).released).toBe(1);
    // Someone else takes 9.1 now.
    await dee.post("/v1/admin/listed-sources", { marketId, band: "tv", channel: "9.1", callSign: "SBCO", name: "San Bernardino County", streamUrl: "https://sbco.example.gov/live.m3u8", plays: "stream_link", evidence: { publicBasis: "Public body" } }).expect(201);
    expect((await dee.post(`/v1/admin/listed-sources/${ids.RDLS}/restore`, {}).expect(409)).body.error.code).toBe("channel_taken");
    // Another free number, beside the other external stations.
    const res = await h.services.network.restoreListedSource(null, ids.RDLS, { channel: "9.3" }, fakeFetch({}).fn);
    expect(res).toMatchObject({ onDial: true, station: { channel: "9.3", callSign: "RDLS" } });
    expect((await changes(ids.RDLS))[0]).toMatchObject({ action: "restored", fields: [{ field: "channel", from: "9.1", to: "9.3" }] });
  });

  it("sends a lead back to the stage it had, a lead again, and puts it on air again when it's back", async () => {
    const [lead] = await h.db
      .insert(schema.creators)
      .values({ marketId, displayName: "Inland Community TV", sourcePlatform: "other", sourceUrl: "https://icv.example.net/live/playlist.m3u8", stage: "found", leadSource: "iptv_list", streamUrl: "https://icv.example.net/live/playlist.m3u8" })
      .returning();
    const listed = await dee
      .post("/v1/admin/listed-sources", { marketId, band: "tv", channel: "9.6", callSign: "ICTV", name: "Inland Community TV", streamUrl: "https://icv.example.net/live/playlist.m3u8", plays: "stream_link", creatorId: lead.id, evidence: { permission: { grantedBy: "Rosa Diaz, station manager", grantedOn: "2026-09-26", evidence: "Signed letter" } } })
      .expect(201);
    const pipeline = async () => (await dee.get(`/v1/admin/creators?marketId=${marketId}`).expect(200)).body.find((c: { id: string }) => c.id === lead.id);
    expect(await pipeline()).toMatchObject({ stage: "on_air", listedSourceId: listed.body.id });
    // Down when it's taken off: its outage ends there, and stays in the history.
    await h.services.network.checkExternalStations({ fetch: fakeFetch({}).fn });
    await dee.post(`/v1/admin/listed-sources/${listed.body.id}/remove`).expect(200);
    const outages = await dee.get(`/v1/admin/listed-sources/${listed.body.id}/outages`).expect(200);
    expect(outages.body).toEqual([expect.objectContaining({ detail: "Couldn't connect", backAt: expect.any(String), ended: "removed" })]);
    expect(await pipeline()).toMatchObject({ stage: "found", listedSourceId: null, station: null, nextAction: "Was external station 9.6 ICTV. Taken off the dial" });
    // The lead link stays on the listing; its permission record too.
    expect((await listing(listed.body.id)).creatorId).toBe(lead.id);
    await dee.post(`/v1/admin/listed-sources/${listed.body.id}/restore`, {}).expect(200);
    expect(await pipeline()).toMatchObject({ stage: "on_air", listedSourceId: listed.body.id, station: { callSign: "ICTV" } });
  });
});
