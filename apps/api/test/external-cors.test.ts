// A238 (the user's decision, extending A237): a stream link whose server sends no CORS header for
// Opencast's apps plays nowhere in a browser, https or not, so it's checked (its playlist, first
// variant and first segment, with the web app's origin) at listing, on a change and hourly, and
// played through the relay in "all" mode (/v2/: every address relayed, https too), or waits
// (`browsers_blocked`) without the relay. Links that work only with another app's access (jmp2.uk,
// Pluto's stitcher with a partner's token, Samsung TV Plus headends, a partner's JWT) are never
// relayed: they wait (`platform_feed`) and stay listed. No network: every fetch here is a fake, the
// clock is pinned, the relay's secret is made up for this run, and the test JWT is built here.
import { createHmac, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { schema } from "@opencast/db";
import { Dial, StationPage } from "@opencast/contracts";
import { CORS_RECHECK_MS, type Fetch } from "../src/v1/modules/network/external.js";
import { relaySignature, relayUrl } from "../src/v1/lib/streamRelay.js";
import { firstDashSegment, ORIGIN_REFUSED_DETAIL, probeCors } from "../src/v1/lib/streamCors.js";
import { jwtPartner, platformFeedOf } from "../src/v1/lib/platformFeeds.js";
import { anon, createHarness, market, type Harness, type User } from "./harness.js";

let h: Harness;
let dee: User; // an Opencast admin
let marketId: string;

const RELAY = { base: "https://stream-relay.opencast.test", secret: `test-${randomUUID()}` };
// The harness's web app origin (deps.config.appOrigin).
const APP = "https://app.opencast.test";
const ALLOW = { "access-control-allow-origin": "*" };
const ALLOW_APP = { "access-control-allow-origin": APP };

/** A fake network: each address answers what `routes` says; every call is kept with the `Origin` it carried. */
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: Array<{ url: string; origin: string | null; range: string | null }> = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, origin: headers.get("origin"), range: headers.get("range") });
    const route = routes[url];
    if (!route) throw new TypeError("fetch failed");
    return route();
  }) as Fetch;
  return { fn, calls, urls: () => calls.map((c) => c.url), corsUrls: () => calls.filter((c) => c.origin).map((c) => c.url) };
}
const answer = (body: string, headers: Record<string, string> = {}) => () => new Response(body, { status: 200, headers });

/** An HLS stream on one server: a master, its first variant and that variant's first segment, each with its own CORS headers. */
function stream(master: string, cors: { master?: Record<string, string>; variant?: Record<string, string>; segment?: Record<string, string> }) {
  const variant = new URL("720p/index.m3u8", master).href;
  const segment = new URL("720p/seg-1041.ts", master).href;
  return {
    master,
    variant,
    segment,
    routes: {
      [master]: answer("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2400000\n720p/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n480p/index.m3u8\n", cors.master),
      [variant]: answer("#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nseg-1041.ts\n#EXTINF:6.0,\nseg-1042.ts\n", cors.variant),
      [segment]: answer("ts", cors.segment)
    } as Record<string, () => Response>
  };
}

const v2Sig = (origin: string) => createHmac("sha256", RELAY.secret).update(`${origin}|all`).digest("base64url");
const v2 = (address: string) => `${RELAY.base}/v2/${v2Sig(new URL(address).origin)}/${Buffer.from(address).toString("base64url")}`;

/** A JWT built here for the test (never a real one): its header, the payload given, and a signature with a key made up now. */
function testJwt(payload: Record<string, unknown>) {
  const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const body = `${part({ alg: "HS256", typ: "JWT" })}.${part(payload)}`;
  return `${body}.${createHmac("sha256", `key-${randomUUID()}`).update(body).digest("base64url")}`;
}

const dialRow = async (callSign: string) => Dial.parse((await anon(h).get("/v1/markets/inland-empire/dial").expect(200)).body).rows.find((r) => r.station.callSign === callSign);
const listing = async (id: string) => (await dee.get(`/v1/admin/listed-sources?marketId=${marketId}`).expect(200)).body.find((l: { id: string }) => l.id === id);
const add = async (channel: string, callSign: string, streamUrl: string) =>
  (await dee.post("/v1/admin/listed-sources", { marketId, band: "tv", channel, callSign, name: `${callSign} stream`, streamUrl, plays: "stream_link", evidence: { publicBasis: "Published for the public by the source" } }).expect(201)).body;

beforeAll(async () => {
  h = await createHarness({ streamRelay: RELAY });
  h.clock.set("2026-10-01T03:00:00.000Z");
  dee = await h.signIn("Dee A.", { admin: true });
  marketId = (await market(h)).id;
}, 60_000);
afterAll(() => h.close());
beforeEach(() => {
  h.deps.config.streamRelay = RELAY;
  h.deps.externalFetch = fakeFetch({}).fn;
});

describe("the relay's all mode (/v2/)", () => {
  it("signs `<origin>|all`, so an http-only signature never stands for it", () => {
    // The same vector as apps/stream-relay's tests.
    expect(relaySignature("known-vector-key", "https://news.example.com", "all")).toBe("nje21UYkjFsILY7Q97gNpLcWi6Etb6Kxa3wx_dwGzzI");
    expect(relaySignature("known-vector-key", "https://news.example.com", "all")).not.toBe(relaySignature("known-vector-key", "https://news.example.com"));
    const address = "https://news.example.com/media-manifest/streams/us.m3u8";
    expect(relayUrl(RELAY, address, "hls", "all")).toBe(v2(address));
    const origin = "https://news.example.com";
    expect(relayUrl(RELAY, "https://news.example.com/dash/live.mpd?x=1", "dash", "all")).toBe(`${RELAY.base}/v2/${v2Sig(origin)}/${Buffer.from(origin).toString("base64url")}/dash/live.mpd?x=1`);
    // A237's addresses are unchanged.
    expect(relayUrl(RELAY, "http://colton.example.gov/a.m3u8").startsWith(`${RELAY.base}/v1/`)).toBe(true);
  });
});

describe("the CORS check", () => {
  const master = "https://cdn.example.com/live/master.m3u8";

  it("sends the app's origin, lightly, and finds a playlist without the header blocked", async () => {
    const s = stream(master, {});
    const net = fakeFetch(s.routes);
    expect(await probeCors(master, APP, net.fn)).toEqual({ state: "blocked", detail: "Its playlist has no CORS header for Opencast's apps" });
    expect(net.calls).toEqual([{ url: master, origin: APP, range: "bytes=0-65535" }]);
  });

  it("follows an allowed playlist to its first variant and first segment, where many CDNs stop allowing it", async () => {
    const segments = fakeFetch(stream(master, { master: ALLOW, variant: ALLOW_APP }).routes);
    expect(await probeCors(master, APP, segments.fn)).toEqual({ state: "blocked", detail: "Its segments have no CORS header for Opencast's apps" });
    const s = stream(master, {});
    expect(segments.calls.map((c) => [c.url, c.origin, c.range])).toEqual([
      [master, APP, "bytes=0-65535"],
      [s.variant, APP, "bytes=0-65535"],
      [s.segment, APP, "bytes=0-1023"]
    ]);
    expect(await probeCors(master, APP, fakeFetch(stream(master, { master: ALLOW }).routes).fn)).toMatchObject({ state: "blocked", detail: "Its variant playlists have no CORS header for Opencast's apps" });
    expect(await probeCors(master, APP, fakeFetch(stream(master, { master: ALLOW, variant: ALLOW, segment: ALLOW_APP }).routes).fn)).toEqual({ state: "ok", detail: null });
    // Another site's origin isn't Opencast's.
    expect(await probeCors(master, APP, fakeFetch(stream(master, { master: { "access-control-allow-origin": "https://elsewhere.example" } }).routes).fn)).toMatchObject({ state: "blocked" });
    // A media playlist's init section is its first segment.
    const media = "https://cdn.example.com/live/720p.m3u8";
    const init = fakeFetch({ [media]: answer('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6,\nseg-1.m4s\n', ALLOW), "https://cdn.example.com/live/init.mp4": answer("", ALLOW) });
    expect(await probeCors(media, APP, init.fn)).toEqual({ state: "ok", detail: null });
    expect(init.urls()).toEqual([media, "https://cdn.example.com/live/init.mp4"]);
  });

  it("can't tell when something doesn't answer", async () => {
    expect(await probeCors(master, APP, fakeFetch({}).fn)).toEqual({ state: "unknown", detail: "Its playlist didn't answer the check" });
    const s = stream(master, { master: ALLOW, variant: ALLOW });
    delete s.routes[s.segment];
    expect(await probeCors(master, APP, fakeFetch(s.routes).fn)).toMatchObject({ state: "unknown" });
  });

  it("checks a DASH manifest's first init when it's simple to work out, and otherwise the MPD only, saying so", async () => {
    const mpd = "https://cdn.example.com/dash/live.mpd";
    const simple = `<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period><AdaptationSet><SegmentTemplate initialization="init-$RepresentationID$.mp4" media="seg-$Number$.m4s"/><Representation id="720p" bandwidth="2400000"/></AdaptationSet></Period></MPD>`;
    expect(firstDashSegment(simple, mpd)).toBe("https://cdn.example.com/dash/init-720p.mp4");
    const blocked = fakeFetch({ [mpd]: answer(simple, ALLOW), "https://cdn.example.com/dash/init-720p.mp4": answer("") });
    expect(await probeCors(mpd, APP, blocked.fn)).toEqual({ state: "blocked", detail: "Its segments have no CORS header for Opencast's apps" });
    const withBase = simple.replace("<Period>", "<BaseURL>https://edge.example.net/dash/</BaseURL><Period>");
    expect(await probeCors(mpd, APP, fakeFetch({ [mpd]: answer(withBase, ALLOW) }).fn)).toEqual({ state: "ok", detail: "Checked its MPD only (its segments' addresses aren't simple to work out)" });
    expect(await probeCors(mpd, APP, fakeFetch({ [mpd]: answer(simple) }).fn)).toMatchObject({ state: "blocked", detail: "Its playlist has no CORS header for Opencast's apps" });
  });
});

describe("an https stream link browsers can't load", () => {
  const NEWS = "https://news.example.com/media-manifest/streams/us.m3u8";
  let newsId: string;

  it("blocked at its playlist, plays through the relay with every address relayed (/v2/)", async () => {
    const net = fakeFetch(stream(NEWS, {}).routes);
    h.deps.externalFetch = net.fn;
    const body = await add("9.1", "NEWS", NEWS);
    newsId = body.id;
    expect(net.calls).toEqual([{ url: NEWS, origin: APP, range: "bytes=0-65535" }]);
    expect(body).toMatchObject({
      onDial: true,
      waiting: null,
      playsOver: "relay",
      relayed: true,
      relayReason: "cors",
      cors: { state: "blocked", detail: "Its playlist has no CORS header for Opencast's apps", checkedAt: "2026-10-01T03:00:00.000Z" },
      platformFeed: null
    });
    expect((await dialRow("NEWS"))?.playback).toEqual({ kind: "hls", url: v2(NEWS), sourceUrl: NEWS });
    expect(StationPage.parse((await anon(h).get("/v1/stations/news").expect(200)).body).playback).toEqual({ kind: "hls", url: v2(NEWS), sourceUrl: NEWS });
  });

  it("without the relay, waits with browsers_blocked, and is still checked every minute at the source", async () => {
    h.deps.config.streamRelay = null;
    expect(await listing(newsId)).toMatchObject({ onDial: false, waiting: "browsers_blocked", playsOver: null, relayed: false, relayReason: null, listingState: "checking" });
    expect(await dialRow("NEWS")).toBeUndefined();
    const net = fakeFetch(stream(NEWS, {}).routes);
    await h.services.network.checkExternalStations({ fetch: net.fn });
    // The minute's check only (no Origin): CORS was checked at listing, so not again within the hour.
    expect(net.calls).toEqual([{ url: NEWS, origin: null, range: "bytes=0-65535" }]);
    expect(await listing(newsId)).toMatchObject({ health: { state: "up" }, waiting: "browsers_blocked" });
  });

  it("plays straight from the source again once an hourly check finds CORS fixed", async () => {
    h.clock.advance(CORS_RECHECK_MS);
    const net = fakeFetch(stream(NEWS, { master: ALLOW, variant: ALLOW, segment: ALLOW }).routes);
    await h.services.network.checkExternalStations({ fetch: net.fn });
    const s = stream(NEWS, {});
    expect(net.corsUrls()).toEqual([s.master, s.variant, s.segment]);
    expect(await listing(newsId)).toMatchObject({ onDial: true, waiting: null, playsOver: null, relayed: false, relayReason: null, cors: { state: "ok", detail: null } });
    expect((await dialRow("NEWS"))?.playback).toEqual({ kind: "hls", url: NEWS, sourceUrl: NEWS });
  });

  it("blocked again later goes back through the relay; a check that can't tell leaves it as it was", async () => {
    h.clock.advance(CORS_RECHECK_MS);
    await h.services.network.checkExternalStations({ fetch: fakeFetch(stream(NEWS, { master: ALLOW, variant: ALLOW }).routes).fn });
    expect(await listing(newsId)).toMatchObject({ onDial: true, relayReason: "cors", cors: { state: "blocked", detail: "Its segments have no CORS header for Opencast's apps" } });
    expect((await dialRow("NEWS"))?.playback?.url).toBe(v2(NEWS));
    h.clock.advance(CORS_RECHECK_MS);
    const s = stream(NEWS, { master: ALLOW, variant: ALLOW });
    delete s.routes[s.segment];
    await h.services.network.checkExternalStations({ fetch: fakeFetch(s.routes).fn });
    expect(await listing(newsId)).toMatchObject({ relayReason: "cors", cors: { state: "blocked", checkedAt: h.clock.now().toISOString() } });
  });

  it("blocked only at its segments, plays through the relay too", async () => {
    const SEG = "https://edge.example.net/hls/live/master.m3u8";
    const net = fakeFetch(stream(SEG, { master: ALLOW, variant: ALLOW }).routes);
    h.deps.externalFetch = net.fn;
    const body = await add("11.1", "EDGE", SEG);
    expect(net.corsUrls()).toHaveLength(3);
    expect(body).toMatchObject({ onDial: true, playsOver: "relay", relayReason: "cors", cors: { state: "blocked", detail: "Its segments have no CORS header for Opencast's apps" } });
    expect((await dialRow("EDGE"))?.playback).toEqual({ kind: "hls", url: v2(SEG), sourceUrl: SEG });
  });

  it("allowed everywhere, or not answering the check, plays straight from the source as before", async () => {
    const OK = "https://open.example.org/live/master.m3u8";
    h.deps.externalFetch = fakeFetch(stream(OK, { master: ALLOW, variant: ALLOW, segment: ALLOW }).routes).fn;
    expect(await add("13.1", "OPEN", OK)).toMatchObject({ onDial: true, playsOver: null, relayed: false, relayReason: null, cors: { state: "ok" } });
    expect((await dialRow("OPEN"))?.playback).toEqual({ kind: "hls", url: OK, sourceUrl: OK });
    h.deps.externalFetch = fakeFetch({}).fn;
    expect(await add("17.1", "QUIE", "https://quiet.example.org/live.m3u8")).toMatchObject({ onDial: true, playsOver: null, relayReason: null, cors: { state: "unknown" } });
  });

  it("changed to another address (A215), is checked afresh", async () => {
    const MOVED = "https://news.example.com/media-manifest/streams/us-2.m3u8";
    h.deps.externalFetch = fakeFetch(stream(MOVED, { master: ALLOW, variant: ALLOW, segment: ALLOW }).routes).fn;
    const after = await h.services.network.updateListedSource(null, newsId, { streamUrl: MOVED });
    expect(after).toMatchObject({ playsOver: null, relayReason: null, cors: { state: "ok", checkedAt: h.clock.now().toISOString() } });
  });
});

describe("an http:// stream link still follows A237", () => {
  it("not answering over https: relayed in http mode (/v1/), no CORS check", async () => {
    const HTTP = "http://plain.example.gov/live/index.m3u8";
    const net = fakeFetch({});
    h.deps.externalFetch = net.fn;
    const body = await add("21.1", "PLAN", HTTP);
    expect(net.urls()).toEqual(["https://plain.example.gov/live/index.m3u8"]);
    expect(net.corsUrls()).toEqual([]);
    expect(body).toMatchObject({ playsOver: "relay", relayed: true, relayReason: "http", cors: null });
    expect((await dialRow("PLAN"))?.playback).toEqual({ kind: "hls", url: relayUrl(RELAY, HTTP), sourceUrl: HTTP });
  });

  it("answering over https where browsers are blocked: its https address through the relay, every address relayed", async () => {
    const HTTP = "http://upgr.example.gov/live/master.m3u8";
    const HTTPS = "https://upgr.example.gov/live/master.m3u8";
    h.deps.externalFetch = fakeFetch(stream(HTTPS, {}).routes).fn;
    expect(await add("23.1", "UPGR", HTTP)).toMatchObject({ onDial: true, playsOver: "relay", relayReason: "cors", cors: { state: "blocked" } });
    // A239: the source's own address is its https one (it answered there), for the native apps' direct mode.
    expect((await dialRow("UPGR"))?.playback).toEqual({ kind: "hls", url: v2(HTTPS), sourceUrl: HTTPS });
  });
});

describe("A239: a server that refuses web pages but answers the native apps", () => {
  // Made-up addresses: a source that answers 500 and an HTML page to any request with an Origin, and
  // its master without one (naming an http chunklist elsewhere), as some live sources do.
  const TOON = "https://api.toonami.example/est/playlist.m3u8";
  const refusing = () => {
    const calls: Array<{ url: string; origin: string | null }> = [];
    const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const origin = new Headers(init?.headers).get("origin");
      calls.push({ url, origin });
      if (url !== TOON) throw new TypeError("fetch failed");
      if (origin) return new Response("<html><body>Internal Server Error</body></html>", { status: 500, headers: { "content-type": "text/html" } });
      return new Response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1500000\nhttp://n3.toonami.example:1934/live/abc-chunklist-1.m3u8\n");
    }) as Fetch;
    return { fn, calls };
  };

  it("the check asks again without an Origin, and says it plays in the TV app only (still unknown, so browsers play it as before)", async () => {
    const net = refusing();
    expect(await probeCors(TOON, APP, net.fn)).toEqual({ state: "unknown", detail: ORIGIN_REFUSED_DETAIL });
    expect(net.calls).toEqual([
      { url: TOON, origin: APP },
      { url: TOON, origin: null }
    ]);
    // No answer at all (not an error status) is just "didn't answer", and isn't asked again.
    const silent = fakeFetch({});
    expect(await probeCors(TOON, APP, silent.fn)).toEqual({ state: "unknown", detail: "Its playlist didn't answer the check" });
    expect(silent.calls).toHaveLength(1);
  });

  let toonId: string;

  it("is on the dial as listed, with its own address for the native apps, and the desk's listing says native only", async () => {
    h.deps.externalFetch = refusing().fn;
    const body = await add("29.1", "TOON", TOON);
    toonId = body.id;
    expect(body).toMatchObject({ onDial: true, waiting: null, playsOver: null, relayed: false, relayReason: null, nativeOnly: true, cors: { state: "unknown", detail: ORIGIN_REFUSED_DETAIL } });
    // Browsers get what they had before (the address as listed); the native apps go direct.
    expect((await dialRow("TOON"))?.playback).toEqual({ kind: "hls", url: TOON, sourceUrl: TOON });
  });

  it("isn't native only once web pages are let in, or for one that's simply allowed", async () => {
    // The hourly check finds its server letting web pages in now.
    h.clock.advance(CORS_RECHECK_MS);
    await h.services.network.checkExternalStations({ fetch: fakeFetch(stream(TOON, { master: ALLOW, variant: ALLOW, segment: ALLOW }).routes).fn });
    expect(await listing(toonId)).toMatchObject({ nativeOnly: false, cors: { state: "ok" } });
    expect((await listing((await add("39.1", "OKAY", "https://okay.example.org/live/master.m3u8")).id)).nativeOnly).toBe(false);
  });
});

describe("another app's access (platform feeds)", () => {
  const SAMSUNG_JWT = testJwt({ sub: "test-device", deviceType: "samsung-tvplus", iat: 1790000000 });

  it("knows the patterns by the address alone", () => {
    expect(platformFeedOf("https://jmp2.uk/plu-5a4d3a00ad95e4718ae8d8db.m3u8")).toBe("jmp2.uk, which forwards to other apps' feeds");
    expect(platformFeedOf(`https://service-stitcher.clusters.pluto.tv/v2/stitch/hls/channel/5a4d3a00ad95e4718ae8d8db/master.m3u8?jwt=${SAMSUNG_JWT}`)).toBe("Pluto via Samsung TV Plus");
    expect(platformFeedOf("https://stitcher.pluto.tv/stitch/hls/channel/abc/master.m3u8?deviceType=rokuChannel&authToken=opaque")).toBe("Pluto via The Roku Channel");
    expect(platformFeedOf("https://service-stitcher.clusters.pluto.tv/stitch/hls/channel/abc/master.m3u8?authToken=opaque")).toBe("Pluto via a partner app");
    expect(platformFeedOf(`https://cdn.example.net/live/master.m3u8?token=${testJwt({ partner: "rokuChannel" })}`)).toBe("The Roku Channel");
    // The source's own: a Pluto stitch address with nothing of another app's, a JWT naming no partner, anything else.
    expect(platformFeedOf("https://service-stitcher.clusters.pluto.tv/stitch/hls/channel/abc/master.m3u8?deviceType=web")).toBeNull();
    // Only a token is someone's access: partner parameters alone, or a partner's name in the path
    // (AMC's own feed for Samsung's headend), aren't.
    expect(platformFeedOf("https://stitcher.pluto.tv/stitch/hls/channel/abc/master.m3u8?deviceType=rokuChannel")).toBeNull();
    expect(platformFeedOf("https://service-stitcher.clusters.pluto.tv/stitch/hls/channel/abc/master.m3u8?embedPartner=examplepartner")).toBeNull();
    expect(platformFeedOf("https://d3f088nnrrvkwf.cloudfront.net/v1/amc_anime_x_hidive_1/samsungheadend_us/latest/main/hls/playlist.m3u8")).toBeNull();
    expect(platformFeedOf(`https://cdn.example.net/live/master.m3u8?token=${testJwt({ sub: "viewer", exp: 1 })}`)).toBeNull();
    expect(platformFeedOf("https://cdn.example.net/live/master.m3u8?token=not-a-jwt")).toBeNull();
    expect(platformFeedOf("https://news.example.com/media-manifest/streams/us.m3u8")).toBeNull();
    expect(jwtPartner(SAMSUNG_JWT)).toBe("Samsung TV Plus");
  });

  it("wait with platform_feed and are never relayed or even fetched, whatever their CORS", async () => {
    const net = fakeFetch({});
    h.deps.externalFetch = net.fn;
    const feeds = [
      ["25.1", "JUMP", "https://jmp2.uk/plu-5a4d3a00ad95e4718ae8d8db.m3u8", "jmp2.uk, which forwards to other apps' feeds"],
      ["27.1", "PLUT", `https://service-stitcher.clusters.pluto.tv/v2/stitch/hls/channel/5a4d3a00ad95e4718ae8d8db/master.m3u8?deviceId=test&jwt=${SAMSUNG_JWT}`, "Pluto via Samsung TV Plus"]
    ] as const;
    for (const [channel, callSign, url, label] of feeds) {
      const body = await add(channel, callSign, url);
      expect(body, callSign).toMatchObject({ onDial: false, waiting: "platform_feed", platformFeed: label, playsOver: null, relayed: false, relayReason: null, listingState: "checking", removed: null });
      expect(await dialRow(callSign)).toBeUndefined();
    }
    // Not tried over https, not checked for CORS.
    expect(net.calls).toEqual([]);
    // And not checked every minute either.
    const check = fakeFetch({});
    await h.services.network.checkExternalStations({ fetch: check.fn });
    expect(check.urls().filter((u) => feeds.some(([, , url]) => u.includes(new URL(url).host)))).toEqual([]);
    // Without the relay, the same.
    h.deps.config.streamRelay = null;
    const jump = (await dee.get(`/v1/admin/listed-sources?marketId=${marketId}`).expect(200)).body.find((l: { station: { callSign: string } }) => l.station.callSign === "JUMP");
    expect(jump).toMatchObject({ waiting: "platform_feed", playsOver: null });
  });

  it("an existing listing on the dial leaves it at the checks' next pass, and stays listed", async () => {
    const OWN = "https://legacy.example.org/live/master.m3u8";
    h.deps.externalFetch = fakeFetch(stream(OWN, { master: ALLOW, variant: ALLOW, segment: ALLOW }).routes).fn;
    const body = await add("31.1", "LEGA", OWN);
    expect(body).toMatchObject({ onDial: true });
    // As a listing from before A238: its address is another app's, and nothing has matched it yet.
    const PLATFORM = "https://jmp2.uk/stvp-USBD1000001A.m3u8";
    await h.db.update(schema.listedSources).set({ streamUrl: PLATFORM, platformFeed: null }).where(eq(schema.listedSources.id, body.id));
    expect(await listing(body.id)).toMatchObject({ onDial: true, platformFeed: null });
    expect(await dialRow("LEGA")).toBeDefined();

    h.clock.advance(CORS_RECHECK_MS);
    const check = fakeFetch({});
    await h.services.network.checkExternalStations({ fetch: check.fn });
    expect(check.urls()).not.toContain(PLATFORM);
    expect(await listing(body.id)).toMatchObject({ onDial: false, waiting: "platform_feed", platformFeed: "jmp2.uk, which forwards to other apps' feeds", listingState: "checking", removed: null });
    expect(await dialRow("LEGA")).toBeUndefined();
    expect((await anon(h).get("/v1/stations/lega").expect(200)).body.playback).toBeNull();
  });

  it("changed to another app's address (A215), waits; changed back to the source's own, is checked and plays", async () => {
    const OWN = "https://change.example.org/live/master.m3u8";
    h.deps.externalFetch = fakeFetch(stream(OWN, { master: ALLOW, variant: ALLOW, segment: ALLOW }).routes).fn;
    const { id } = await add("33.1", "CHNG", OWN);
    const away = await h.services.network.updateListedSource(null, id, { streamUrl: "https://jmp2.uk/stvp-USBD2000001A.m3u8" });
    expect(away).toMatchObject({ waiting: "platform_feed", platformFeed: "jmp2.uk, which forwards to other apps' feeds", onDial: false, cors: null });
    const back = await h.services.network.updateListedSource(null, id, { streamUrl: OWN });
    expect(back).toMatchObject({ waiting: null, platformFeed: null, onDial: true, cors: { state: "ok" } });
  });
});
