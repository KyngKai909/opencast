// External stations (follow-up Phase 6): two ways to play with their evidence, the same channel and
// call sign rules as full stations, what's on from the source's own feed (or nothing made up), the
// minute's health checks taking a station off the dial after 5 minutes down and back when it's up,
// the Network desk told both times, nothing that pays, and IPTV-list channels as pipeline leads.
// No network: every fetch here is a fake, and the clock is pinned.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { checkStream, waitingFor, type Fetch } from "../src/v1/modules/network/external.js";
import { parseSchedule, detectScheduleFormat } from "../src/v1/lib/schedules.js";
import { isIptvOrgAddress, parseIptvJson, parseM3u } from "../src/v1/lib/iptv.js";
import { anon, createHarness, market, stationFixture, type Harness, type User } from "./harness.js";

let h: Harness;
let dee: User; // an Opencast admin
let marketId: string;

const COLTON_HLS = "https://colton.example.gov/live/council/master.m3u8";
const REDLANDS_EMBED = "https://redlands.example.gov/meetings/player";

/** A fake network: each address answers what `routes` says (a function of the call), and every call is kept. */
function fakeFetch(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: Array<{ url: string; method: string; range: string | null }> = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method ?? "GET", range: headers.get("range") });
    const route = routes[url];
    if (!route) throw new TypeError("fetch failed");
    return route();
  }) as Fetch;
  return { fn, calls };
}

const playlist = () => new Response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000\nhd/index.m3u8\n", { status: 200 });

beforeAll(async () => {
  h = await createHarness();
  // Saturday, September 26, 8:42 pm in the Inland Empire (the reference's moment).
  h.clock.set("2026-09-27T03:42:00.000Z");
  dee = await h.signIn("Dee A.", { admin: true });
  marketId = (await market(h)).id;
}, 60_000);
afterAll(() => h.close());

describe("two ways to play, each with its evidence", () => {
  let embedId: string;
  let linkId: string;

  it("saves an official embed without its terms page, but keeps it off the dial until it's recorded", async () => {
    const res = await dee
      .post("/v1/admin/listed-sources", { marketId, band: "tv", channel: "9.1", callSign: "RDLS", name: "City of Redlands", description: "Council and planning meetings", streamUrl: REDLANDS_EMBED, plays: "embed", embedTerms: "allowed" })
      .expect(201);
    embedId = res.body.id;
    expect(res.body).toMatchObject({ plays: "embed", onDial: false, waiting: "needs_terms", listingState: "checking", evidence: { basis: null }, schedule: { source: "none" } });
    const dial = await anon(h).get("/v1/markets/inland-empire/dial").expect(200);
    expect(dial.body.rows.map((r: { station: { callSign: string } }) => r.station.callSign)).not.toContain("RDLS");

    const recorded = await dee.post(`/v1/admin/listed-sources/${embedId}/evidence`, { termsUrl: "https://redlands.example.gov/terms", termsCheckedOn: "2026-09-21" }).expect(200);
    expect(recorded.body).toMatchObject({ onDial: true, waiting: null, listingState: "listed", evidence: { basis: "embed_terms", termsUrl: "https://redlands.example.gov/terms", termsCheckedOn: "2026-09-21" } });
  });

  it("keeps a stream link off the dial until the source's written permission is recorded, never edited", async () => {
    const res = await dee
      .post("/v1/admin/listed-sources", { marketId, band: "tv", channel: "9.2", callSign: "COLT", name: "City of Colton", streamUrl: COLTON_HLS, plays: "stream_link", evidence: { note: "Asked Sept 22" } })
      .expect(201);
    linkId = res.body.id;
    expect(res.body).toMatchObject({ plays: "stream_link", streamFormat: "hls", onDial: false, waiting: "needs_permission", evidence: { note: "Asked Sept 22", permission: null } });

    const yes = await dee
      .post(`/v1/admin/listed-sources/${linkId}/evidence`, { permission: { grantedBy: "Maria Lopez, City Clerk, City of Colton", grantedOn: "2026-09-24", evidence: "Email to network@opencast.tv, Sept 24" } })
      .expect(200);
    expect(yes.body).toMatchObject({
      onDial: true,
      evidence: { basis: "written_permission", permission: { grantedBy: "Maria Lopez, City Clerk, City of Colton", grantedOn: "2026-09-24", streamUrl: COLTON_HLS, recordedBy: "Dee A." } }
    });
    const again = await dee.post(`/v1/admin/listed-sources/${linkId}/evidence`, { permission: { grantedBy: "Someone else", grantedOn: "2026-09-25", evidence: "A phone call" } }).expect(409);
    expect(again.body.error.code).toBe("permission_recorded");
    await dee.post(`/v1/admin/listed-sources/${embedId}/evidence`, { permission: { grantedBy: "Someone", grantedOn: "2026-09-25", evidence: "Email" } }).expect(400);
  });

  it("puts a clearly public source's stream link on the dial with its basis; a DASH-only one waits (A201)", async () => {
    const nasa = await dee
      .post("/v1/admin/listed-sources", { marketId, band: "tv", channel: "61.1", callSign: "NASA", name: "NASA", description: "Launches and live coverage", streamUrl: "https://nasa.example.gov/live/master.m3u8", plays: "stream_link", evidence: { publicBasis: "US government, public" } })
      .expect(201);
    expect(nasa.body).toMatchObject({ onDial: true, evidence: { basis: "public_source", publicBasis: "US government, public" } });
    const dash = await dee
      .post("/v1/admin/listed-sources", { marketId, band: "tv", channel: "61.2", callSign: "SBCO", name: "San Bernardino County", streamUrl: "https://sbco.example.gov/live/manifest.mpd", plays: "stream_link", evidence: { publicBasis: "Public body, stream published for the public" } })
      .expect(201);
    expect(dash.body).toMatchObject({ streamFormat: "dash", onDial: false, waiting: "dash_not_played" });
    // Another market's stream waits too (A200).
    const other = await dee
      .post("/v1/admin/listed-sources", { marketId, band: "tv", channel: "61.3", callSign: "RIVC", name: "Riverside County", streamUrl: "https://rivco.example.gov/live.m3u8", plays: "stream_link", outsideMarket: true, evidence: { publicBasis: "Public body" } })
      .expect(201);
    expect(other.body).toMatchObject({ onDial: false, waiting: "other_market" });
  });

  it("puts both on the dial with the source and no made-up titles, and plays each straight from the source", async () => {
    const dial = await anon(h).get("/v1/markets/inland-empire/dial").expect(200);
    const row = (cs: string) => dial.body.rows.find((r: { station: { callSign: string } }) => r.station.callSign === cs);
    expect(row("RDLS")).toMatchObject({ onAir: true, now: null, playback: { kind: "embed", url: REDLANDS_EMBED }, external: { source: "City of Redlands", plays: "embed", schedule: "none" } });
    expect(row("COLT")).toMatchObject({ onAir: true, now: null, playback: { kind: "hls", url: COLTON_HLS }, external: { source: "City of Colton", plays: "stream_link" } });
    expect(row("SBCO")).toBeUndefined();
    const page = await anon(h).get("/v1/stations/colt").expect(200);
    expect(page.body).toMatchObject({ onAir: true, now: null, upNext: [], external: { source: "City of Colton", down: false }, playback: { kind: "hls", url: COLTON_HLS } });
  });

  it("follows the same channel and call sign rules as full stations", async () => {
    const base = { marketId, band: "tv", name: "Somewhere", streamUrl: "https://x.example.gov/live.m3u8", plays: "stream_link", evidence: { publicBasis: "Public body" } };
    await stationFixture(h, { callSign: "BEAT", marketId, tenths: 121, signedOn: true });
    // A full station's number, or its subchannel.
    expect((await dee.post("/v1/admin/listed-sources", { ...base, channel: "12.2", callSign: "SOME" }).expect(409)).body.error.code).toBe("channel_taken");
    // A subchannel on its own.
    await dee.post("/v1/admin/listed-sources", { ...base, channel: "14.2", callSign: "SOME" }).expect(400);
    // Out of the band, a taken call sign, a malformed one.
    await dee.post("/v1/admin/listed-sources", { ...base, channel: "70.1", callSign: "SOME" }).expect(400);
    expect((await dee.post("/v1/admin/listed-sources", { ...base, channel: "14.1", callSign: "BEAT" }).expect(409)).body.error.code).toBe("call_sign_taken");
    await dee.post("/v1/admin/listed-sources", { ...base, channel: "14.1", callSign: "ab" }).expect(400);
    // An embed has to say what its terms allow.
    await dee.post("/v1/admin/listed-sources", { ...base, plays: "embed", evidence: undefined, channel: "14.1", callSign: "SOME" }).expect(400);
  });
});

describe("what's on", () => {
  it("reads a JSON schedule feed into the source's own titles, and the banner's airing from it", async () => {
    const feed = JSON.stringify({ events: [{ id: "cc-1", title: "City Council, regular meeting", start: "2026-09-27T03:00:00Z", end: "2026-09-27T05:00:00Z" }, { title: "No start, left out" }] });
    const { fn } = fakeFetch({ "https://colton.example.gov/agenda.json": () => new Response(feed, { headers: { "content-type": "application/json" } }) });
    const [row] = await h.db.select().from(schema.listedSources).where(eq(schema.listedSources.name, "City of Colton"));
    await h.db.update(schema.listedSources).set({ calendarUrl: "https://colton.example.gov/agenda.json", scheduleSource: "feed" }).where(eq(schema.listedSources.id, row.id));
    // The meeting started at 8 pm; the feed read at 7:30 keeps it (only what starts after now is replaced).
    h.clock.set("2026-09-27T02:30:00.000Z");
    const synced = await h.services.network.syncListedSource(row.id, fn);
    h.clock.set("2026-09-27T03:42:00.000Z");
    expect(synced).toMatchObject({ calendarSync: "synced", schedule: { source: "feed", format: "json" }, upcoming: 1 });
    const dial = await anon(h).get("/v1/markets/inland-empire/dial").expect(200);
    const colt = dial.body.rows.find((r: { station: { callSign: string } }) => r.station.callSign === "COLT");
    expect(colt.now).toMatchObject({ title: "City Council, regular meeting", kind: "listed", startsAt: "2026-09-27T03:00:00.000Z", endsAt: "2026-09-27T05:00:00.000Z" });
    const guide = await anon(h).get("/v1/markets/inland-empire/guide?from=2026-09-27T03:00:00.000Z&to=2026-09-27T06:00:00.000Z").expect(200);
    expect(guide.body.rows.find((r: { station: { callSign: string } }) => r.station.callSign === "COLT").airings.map((a: { title: string }) => a.title)).toEqual(["City Council, regular meeting"]);
  });

  it("parses RSS (with the event module), XMLTV guide data for one channel, and iCal", () => {
    const rss = `<?xml version="1.0"?><rss xmlns:ev="http://purl.org/rss/1.0/modules/event/"><channel>
      <item><title><![CDATA[Planning Commission &amp; Design Review]]></title><ev:startdate>2026-10-01T18:00:00-07:00</ev:startdate><ev:enddate>2026-10-01T20:00:00-07:00</ev:enddate><guid>pc-1</guid></item>
      <item><title>Budget workshop</title><pubDate>Thu, 02 Oct 2026 01:00:00 GMT</pubDate></item>
    </channel></rss>`;
    expect(detectScheduleFormat("https://city.example.gov/agendas.rss", "application/rss+xml", rss)).toBe("rss");
    expect(parseSchedule(rss, "rss")).toEqual([
      { uid: "pc-1", summary: "Planning Commission & Design Review", start: new Date("2026-10-02T01:00:00Z"), end: new Date("2026-10-02T03:00:00Z") },
      { uid: null, summary: "Budget workshop", start: new Date("2026-10-02T01:00:00Z"), end: null }
    ]);
    const xmltv = `<tv><programme start="20260926200000 -0700" stop="20260926210000 -0700" channel="NASA.us"><title lang="en">Launch coverage</title></programme>
      <programme start="20260926200000 -0700" stop="20260926203000 -0700" channel="Other.us"><title>Something else</title></programme></tv>`;
    expect(detectScheduleFormat("https://epg.example.org/guide.xml", "text/xml", xmltv)).toBe("xmltv");
    expect(parseSchedule(xmltv, "xmltv", "https://epg.example.org/guide.xml#channel=NASA.us").map((e) => [e.summary, e.start.toISOString()])).toEqual([["Launch coverage", "2026-09-27T03:00:00.000Z"]]);
    const ics = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "SUMMARY:Board of Supervisors", "DTSTART:20261006T170000Z", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    expect(detectScheduleFormat("https://sbco.example.gov/cal", "text/calendar", ics)).toBe("ical");
    expect(parseSchedule(ics, "ical")[0].summary).toBe("Board of Supervisors");
  });
});

describe("health checks", () => {
  it("are one small request each, with a timeout, and never a segment", async () => {
    const { fn, calls } = fakeFetch({ [COLTON_HLS]: playlist });
    expect(await checkStream({ plays: "stream_link", streamUrl: COLTON_HLS }, fn)).toEqual({ ok: true, detail: null, format: "hls" });
    expect(calls).toEqual([{ url: COLTON_HLS, method: "GET", range: "bytes=0-65535" }]);

    const wrong = fakeFetch({ [COLTON_HLS]: () => new Response("<html>Maintenance</html>") });
    expect(await checkStream({ plays: "stream_link", streamUrl: COLTON_HLS }, wrong.fn)).toEqual({ ok: false, detail: "Not a stream playlist" });
    const gone = fakeFetch({ [COLTON_HLS]: () => new Response("", { status: 404 }) });
    expect(await checkStream({ plays: "stream_link", streamUrl: COLTON_HLS }, gone.fn)).toEqual({ ok: false, detail: "HTTP 404" });
    const slow = (async (_: unknown, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("timed out"), { name: "TimeoutError" }))))) as Fetch;
    expect(await checkStream({ plays: "stream_link", streamUrl: COLTON_HLS }, slow, 20)).toEqual({ ok: false, detail: "No answer in 0 seconds" });
    const dash = fakeFetch({ ["https://x.example/m.mpd"]: () => new Response('<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011">') });
    expect((await checkStream({ plays: "stream_link", streamUrl: "https://x.example/m.mpd" }, dash.fn)).format).toBe("dash");

    // An embed: a HEAD (a GET's first bytes when HEAD isn't allowed), and it has to still allow embedding.
    const embed = fakeFetch({ [REDLANDS_EMBED]: () => new Response(null, { status: 200 }) });
    expect(await checkStream({ plays: "embed", streamUrl: REDLANDS_EMBED }, embed.fn)).toEqual({ ok: true, detail: null });
    expect(embed.calls.map((c) => c.method)).toEqual(["HEAD"]);
    let n = 0;
    const noHead = fakeFetch({ [REDLANDS_EMBED]: () => new Response("<html>", { status: n++ === 0 ? 405 : 200 }) });
    expect(await checkStream({ plays: "embed", streamUrl: REDLANDS_EMBED }, noHead.fn)).toEqual({ ok: true, detail: null });
    expect(noHead.calls.map((c) => [c.method, c.range])).toEqual([["HEAD", null], ["GET", "bytes=0-4095"]]);
    const refused = fakeFetch({ [REDLANDS_EMBED]: () => new Response(null, { headers: { "x-frame-options": "DENY" } }) });
    expect(await checkStream({ plays: "embed", streamUrl: REDLANDS_EMBED }, refused.fn)).toEqual({ ok: false, detail: "Their player no longer allows embedding" });
  });

  it("take a listing off the dial, the guide and the swipe order after 5 minutes down, and back when it's up, telling the desk both times", async () => {
    let coltonUp = true;
    const { fn } = fakeFetch({
      [COLTON_HLS]: () => (coltonUp ? playlist() : new Response("", { status: 503 })),
      [REDLANDS_EMBED]: () => new Response(null),
      "https://nasa.example.gov/live/master.m3u8": playlist
    });
    const dialSigns = async () => (await anon(h).get("/v1/markets/inland-empire/dial").expect(200)).body.rows.map((r: { station: { callSign: string } }) => r.station.callSign);

    expect(await h.services.network.checkExternalStations({ fetch: fn })).toMatchObject({ checked: 3, up: 3 });
    // Down: still on the dial for its first 5 minutes.
    coltonUp = false;
    h.clock.set("2026-09-27T03:43:00.000Z");
    expect(await h.services.network.checkExternalStations({ fetch: fn })).toMatchObject({ down: 1, hidden: 0 });
    expect(await dialSigns()).toContain("COLT");
    h.clock.set("2026-09-27T03:47:00.000Z");
    await h.services.network.checkExternalStations({ fetch: fn });
    expect(await dialSigns()).toContain("COLT");
    // Five minutes down: off the dial, the guide and search; the station page says it's down.
    h.clock.set("2026-09-27T03:48:00.000Z");
    expect(await h.services.network.checkExternalStations({ fetch: fn })).toMatchObject({ hidden: 1 });
    await h.deps.bus.settle();
    expect(await dialSigns()).toEqual(expect.arrayContaining(["RDLS", "NASA"]));
    expect(await dialSigns()).not.toContain("COLT");
    const guide = await anon(h).get("/v1/markets/inland-empire/guide?from=2026-09-27T03:00:00.000Z&to=2026-09-27T06:00:00.000Z").expect(200);
    expect(guide.body.rows.map((r: { station: { callSign: string } }) => r.station.callSign)).not.toContain("COLT");
    const search = await anon(h).get("/v1/search?q=council&market=inland-empire").expect(200);
    expect(search.body.airings.map((a: { station: { callSign: string } }) => a.station.callSign)).not.toContain("COLT");
    expect((await anon(h).get("/v1/search?q=9.2&market=inland-empire").expect(200)).body.tuneTo).toBeNull();
    const page = await anon(h).get("/v1/stations/colt").expect(200);
    expect(page.body).toMatchObject({ onAir: false, playback: null, external: { down: true } });
    const desk = await dee.get("/v1/me/notices").expect(200);
    expect(desk.body[0]).toMatchObject({ kind: "external_station", title: "COLT 9.2 is off the dial", link: "/desk/markets/inland-empire/listed" });
    expect(desk.body[0].body).toContain("down since 8:43 pm");
    const listing = (await dee.get(`/v1/admin/listed-sources?marketId=${marketId}`).expect(200)).body.find((s: { name: string }) => s.name === "City of Colton");
    expect(listing).toMatchObject({ onDial: false, waiting: "down", listingState: "listed", health: { state: "hidden", since: "2026-09-27T03:43:00.000Z", detail: "HTTP 503" } });

    // Back: on the dial again at once, and the desk hears.
    coltonUp = true;
    h.clock.set("2026-09-27T04:02:00.000Z");
    expect(await h.services.network.checkExternalStations({ fetch: fn })).toMatchObject({ back: 1 });
    await h.deps.bus.settle();
    expect(await dialSigns()).toContain("COLT");
    const told = await dee.get("/v1/me/notices").expect(200);
    expect(told.body[0]).toMatchObject({ kind: "external_station", title: "COLT 9.2 is back on the dial", body: "City of Colton's stream is back after 19 minutes down. It's on the dial again." });
    const outages = await dee.get(`/v1/admin/listed-sources/${listing.id}/outages`).expect(200);
    expect(outages.body).toEqual([{ id: expect.any(String), downSince: "2026-09-27T03:43:00.000Z", hiddenAt: "2026-09-27T03:48:00.000Z", backAt: "2026-09-27T04:02:00.000Z", detail: "HTTP 503" }]);
  });

  it("don't hide a blip, and don't check what's waiting for its evidence", async () => {
    let up = false;
    const { fn, calls } = fakeFetch({ [COLTON_HLS]: () => (up ? playlist() : new Response("", { status: 502 })), [REDLANDS_EMBED]: () => new Response(null), "https://nasa.example.gov/live/master.m3u8": playlist });
    h.clock.set("2026-09-27T04:10:00.000Z");
    await h.services.network.checkExternalStations({ fetch: fn });
    up = true;
    h.clock.set("2026-09-27T04:12:00.000Z");
    expect(await h.services.network.checkExternalStations({ fetch: fn })).toMatchObject({ back: 0, up: 3 });
    // SBCO (DASH, waiting) and RIVC (another market) weren't asked.
    expect(calls.map((c) => c.url)).not.toContain("https://sbco.example.gov/live/manifest.mpd");
    const listing = (await dee.get(`/v1/admin/listed-sources?marketId=${marketId}`).expect(200)).body.find((s: { name: string }) => s.name === "City of Colton");
    expect(listing.outages[0]).toMatchObject({ downSince: "2026-09-27T04:10:00.000Z", hiddenAt: null, backAt: "2026-09-27T04:12:00.000Z" });
  });

  it("say what's waiting, evidence first", () => {
    const base = { plays: "embed" as const, embedTerms: "allowed" as const, basis: "embed_terms" as const, streamFormat: null, outsideMarket: false, health: "up" as const };
    const rules = { otherMarkets: false, dash: false };
    expect(waitingFor(base, rules)).toBeNull();
    expect(waitingFor({ ...base, embedTerms: "unclear" }, rules)).toBe("terms_unclear");
    expect(waitingFor({ ...base, health: "hidden" }, rules)).toBe("down");
    expect(waitingFor({ ...base, health: "down" }, rules)).toBeNull();
    expect(waitingFor({ ...base, plays: "stream_link", basis: null }, rules)).toBe("needs_permission");
    expect(waitingFor({ ...base, plays: "stream_link", basis: "public_source", streamFormat: "dash" }, { ...rules, dash: true })).toBeNull();
    expect(waitingFor({ ...base, outsideMarket: true }, { ...rules, otherMarkets: true })).toBeNull();
  });
});

describe("no playout, spots or earnings", () => {
  it("refuses them for an external station, whoever asks, and master control doesn't list it", async () => {
    const colt = (await h.db.select().from(schema.stations).where(eq(schema.stations.callSign, "COLT")))[0];
    for (const [method, url, body] of [
      ["post", `/v1/stations/${colt.id}/sign-on`, undefined],
      ["put", `/v1/stations/${colt.id}/rotations/main`, { spotIds: [] }],
      ["post", `/v1/stations/${colt.id}/pledges`, { cadence: "monthly", amountMicros: 5_000_000 }],
      ["post", `/v1/stations/${colt.id}/programs`, { title: "Council" }]
    ] as const) {
      const res = await (dee as unknown as Record<string, (u: string, b?: object) => { expect(n: number): Promise<{ body: { error: { code: string } } }> }>)[method](url, body).expect(409);
      expect(res.body.error.code).toBe("external_station");
    }
    // A sponsorship offered to it, from any business, is refused before anything else is looked at.
    const offer = await dee
      .post("/v1/businesses/00000000-0000-4000-8000-0000000b0001/sponsorships", { stationId: colt.id, monthlyMicros: 50_000_000, creditText: "Stater Bros., on Orange Street", startsOn: "2026-10-01" })
      .expect(409);
    expect(offer.body.error.code).toBe("external_station");
    const me = await dee.get("/v1/me").expect(200);
    expect(me.body.memberships.map((m: { station?: { callSign: string } }) => m.station?.callSign)).not.toContain("COLT");
  });
});

describe("watch data", () => {
  it("records tuned-in time for external stations, labelled external, and keeps it out of what pays", async () => {
    const colt = (await h.db.select().from(schema.stations).where(eq(schema.stations.callSign, "COLT")))[0];
    h.clock.set("2026-09-27T05:10:00.000Z");
    const sessionId = "00000000-0000-4000-8000-00000000e601";
    for (let i = 0; i < 6; i++) {
      await h.services.audience.heartbeat({ stationId: colt.id, sessionId, platform: "web", mediaTimeMs: i * 30_000, playing: true });
      h.clock.advance(30_000);
    }
    const minutes = await h.db.select().from(schema.sessionMinutes).where(eq(schema.sessionMinutes.sessionId, sessionId));
    expect(minutes.length).toBeGreaterThan(0);
    expect(await h.db.select().from(schema.minuteSamples).where(eq(schema.minuteSamples.stationId, colt.id))).toEqual([]);
    expect((await h.services.audience.watchMinutes(new Date("2026-09-27T00:00:00Z"), new Date("2026-09-28T00:00:00Z"))).has(colt.id)).toBe(false);

    h.clock.set("2026-09-27T07:30:00.000Z");
    await h.services.audience.watch.aggregate();
    const stats = await h.db.select().from(schema.airingStats).where(eq(schema.airingStats.stationId, colt.id));
    expect(stats).toEqual([expect.objectContaining({ airingKey: `external:${colt.id}:2026-09-27T05:00:00.000Z`, external: true, programId: null, asRunId: null, peakAudience: 1, final: true })]);
  });
});

describe("IPTV lists are leads, not listings", () => {
  const M3U = [
    "#EXTM3U",
    '#EXTINF:-1 tvg-id="InlandCommunity.us" tvg-country="US" tvg-logo="https://i.example/icv.png" group-title="Local",Inland Community TV (720p)',
    "https://icv.example.net/live/playlist.m3u8",
    '#EXTINF:-1 tvg-id="Colton.us" group-title="Government",City of Colton',
    "#EXTVLCOPT:http-user-agent=Mozilla/5.0",
    COLTON_HLS,
    "#EXTINF:-1,A radio stream on rtmp",
    "rtmp://radio.example/live",
    '#EXTINF:-1 tvg-id="Dup.us",Inland Community TV again',
    "https://icv.example.net/live/playlist.m3u8"
  ].join("\n");

  it("reads an M3U and iptv-org's JSON, and only reads lists from iptv-org by address", () => {
    const m3u = parseM3u(M3U);
    expect(m3u.skipped).toBe(2);
    expect(m3u.channels).toEqual([
      { name: "Inland Community TV (720p)", streamUrl: "https://icv.example.net/live/playlist.m3u8", tvgId: "InlandCommunity.us", group: "Local", country: "US", logoUrl: "https://i.example/icv.png" },
      { name: "City of Colton", streamUrl: COLTON_HLS, tvgId: "Colton.us", group: "Government", country: null, logoUrl: null }
    ]);
    const json = parseIptvJson(JSON.stringify([{ channel: "NASATV.us", title: "NASA TV", url: "https://nasa.example.gov/tv.m3u8", quality: "720p" }, { channel: "NoUrl.us" }]));
    expect(json).toEqual({ channels: [{ name: "NASA TV", streamUrl: "https://nasa.example.gov/tv.m3u8", tvgId: "NASATV.us", group: null, country: "US", logoUrl: null }], skipped: 1 });
    expect(isIptvOrgAddress("https://iptv-org.github.io/iptv/countries/us.m3u")).toBe(true);
    expect(isIptvOrgAddress("https://raw.githubusercontent.com/iptv-org/iptv/master/streams/us.m3u")).toBe(true);
    expect(isIptvOrgAddress("https://example.com/list.m3u")).toBe(false);
    expect(isIptvOrgAddress("http://iptv-org.github.io/iptv/index.m3u")).toBe(false);
  });

  it("previews a pasted list with what's already known, and imports new channels as pipeline leads", async () => {
    const preview = await dee.post("/v1/admin/creators/iptv/preview", { m3u: M3U }).expect(200);
    expect(preview.body).toMatchObject({ listUrl: null, skipped: 2 });
    expect(preview.body.channels.map((c: { name: string; already: string | null }) => [c.name, c.already])).toEqual([
      ["Inland Community TV (720p)", null],
      ["City of Colton", "external"]
    ]);
    await dee.post("/v1/admin/creators/iptv/preview", { url: "https://example.com/list.m3u" }).expect(400);

    const imported = await dee.post("/v1/admin/creators/iptv/import", { marketId, channels: preview.body.channels.map(({ already: _, ...c }: { already: unknown }) => c) }).expect(201);
    expect(imported.body.skipped).toBe(1);
    expect(imported.body.imported).toEqual([
      expect.objectContaining({ displayName: "Inland Community TV (720p)", stage: "found", station: null, sourcePlatform: "other", lead: { from: "iptv_list", streamUrl: "https://icv.example.net/live/playlist.m3u8", listUrl: null, tvgId: "InlandCommunity.us", group: "Local", country: "US", logoUrl: "https://i.example/icv.png" }, listedSourceId: null })
    ]);
    // Never on the dial from a list.
    expect((await anon(h).get("/v1/markets/inland-empire/dial").expect(200)).body.rows.map((r: { station: { name: string } }) => r.station.name)).not.toContain("Inland Community TV (720p)");
    const again = await dee.post("/v1/admin/creators/iptv/preview", { m3u: M3U }).expect(200);
    expect(again.body.channels[0].already).toBe("lead");
  });

  it("reads an iptv-org list by its address (a fake network here)", async () => {
    const { fn, calls } = fakeFetch({ "https://iptv-org.github.io/iptv/countries/us.m3u": () => new Response(M3U) });
    const preview = await h.services.network.previewIptvList({ url: "https://iptv-org.github.io/iptv/countries/us.m3u" }, fn);
    expect(preview.listUrl).toBe("https://iptv-org.github.io/iptv/countries/us.m3u");
    expect(preview.channels).toHaveLength(2);
    // Only the list: never a stream.
    expect(calls.map((c) => c.url)).toEqual(["https://iptv-org.github.io/iptv/countries/us.m3u"]);
  });

  it("turns a lead into an external station once it says yes in writing", async () => {
    const lead = (await dee.get(`/v1/admin/creators?marketId=${marketId}`).expect(200)).body.find((c: { displayName: string }) => c.displayName === "Inland Community TV (720p)");
    const listed = await dee
      .post("/v1/admin/listed-sources", {
        marketId,
        band: "tv",
        channel: "9.3",
        callSign: "ICTV",
        name: "Inland Community TV",
        streamUrl: lead.lead.streamUrl,
        plays: "stream_link",
        creatorId: lead.id,
        evidence: { permission: { grantedBy: "Rosa Diaz, station manager, Inland Community TV", grantedOn: "2026-09-26", evidence: "Signed letter, scanned to the desk's drive" } }
      })
      .expect(201);
    expect(listed.body).toMatchObject({ onDial: true, creatorId: lead.id, evidence: { basis: "written_permission", permission: { creatorId: lead.id } } });
    const after = (await dee.get(`/v1/admin/creators?marketId=${marketId}`).expect(200)).body.find((c: { id: string }) => c.id === lead.id);
    expect(after).toMatchObject({ stage: "on_air", listedSourceId: listed.body.id, station: { callSign: "ICTV", kind: "listed" } });
    const twice = await dee.post("/v1/admin/listed-sources", { marketId, band: "tv", channel: "9.4", callSign: "ICTW", name: "Again", streamUrl: lead.lead.streamUrl, plays: "stream_link", creatorId: lead.id }).expect(409);
    expect(twice.body.error.code).toBe("already_external");
  });
});
