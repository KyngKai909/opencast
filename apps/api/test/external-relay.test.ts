// A237 (2026-10-01, the user's decision over Phase 6's "never proxied", for http:// only): an external
// station's plain-http stream link is tried over https first and played from there when it answers;
// otherwise it plays through Opencast's HTTPS relay (STREAM_RELAY_BASE and STREAM_RELAY_SECRET), or
// waits (`needs_https`) without one. https stream links and embeds are unchanged, and the minute's
// checks still fetch the source directly. No network: every fetch here is a fake, the clock is
// pinned, and the relay's secret is made up for this run.
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Dial, StationPage } from "@opencast/contracts";
import { HTTPS_RECHECK_MS, type Fetch } from "../src/v1/modules/network/external.js";
import { httpsVariant, relaySignature, relayUrl, streamRelayFromEnv } from "../src/v1/lib/streamRelay.js";
import { anon, createHarness, market, type Harness, type User } from "./harness.js";

let h: Harness;
let dee: User; // an Opencast admin
let marketId: string;

const RELAY = { base: "https://stream-relay.opencast.test", secret: `test-${randomUUID()}` };
const COLTON_HTTP = "http://colton.example.gov/live/council/master.m3u8?token=abc";
const COLTON_HTTPS = "https://colton.example.gov/live/council/master.m3u8?token=abc";
const LOMA_HTTP = "http://lomalinda.example.gov:8080/live/manifest.mpd";
const RIALTO_HTTPS = "https://rialto.example.gov/live/index.m3u8";
const PLAYLIST = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000\nhd/index.m3u8\n";

/**
 * A fake network: each address answers what `routes` says, and every call is kept. A238's CORS checks
 * (the ones with an `Origin`) are kept apart, in `corsCalls`: these tests are about A237's https
 * checks and the minute's checks (external-cors.test.ts has A238's).
 */
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const corsCalls: string[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    (new Headers(init?.headers).has("origin") ? corsCalls : calls).push(url);
    const route = routes[url];
    if (!route) throw new TypeError("fetch failed");
    return route();
  }) as Fetch;
  return { fn, calls, corsCalls };
}
// A server that lets browsers load it (A238): it plays straight from the source when it answers over https.
const hls = () => new Response(PLAYLIST, { status: 200, headers: { "access-control-allow-origin": "*" } });

/** The signature an origin should carry, worked out here independently of the API's code. */
const expectedSig = (origin: string) => createHmac("sha256", RELAY.secret).update(origin).digest("base64url");

const dialRow = async (callSign: string) => Dial.parse((await anon(h).get("/v1/markets/inland-empire/dial").expect(200)).body).rows.find((r) => r.station.callSign === callSign);
const listing = async (id: string) => (await dee.get(`/v1/admin/listed-sources?marketId=${marketId}`).expect(200)).body.find((l: { id: string }) => l.id === id);
const add = async (channel: string, callSign: string, streamUrl: string) =>
  (await dee.post("/v1/admin/listed-sources", { marketId, band: "tv", channel, callSign, name: `${callSign} stream`, streamUrl, plays: "stream_link", evidence: { publicBasis: "Public body, stream published for the public" } }).expect(201)).body;

beforeAll(async () => {
  h = await createHarness({ streamRelay: RELAY });
  // Wednesday, September 30, 8 pm in the Inland Empire (DASH stream links played from Sept 30, A201).
  h.clock.set("2026-10-01T03:00:00.000Z");
  dee = await h.signIn("Dee A.", { admin: true });
  marketId = (await market(h)).id;
}, 60_000);
afterAll(() => h.close());
beforeEach(() => {
  h.deps.config.streamRelay = RELAY;
  // https doesn't answer unless a test says so.
  h.deps.externalFetch = fakeFetch({}).fn;
});

describe("relay addresses", () => {
  it("signs the origin, the address in full for HLS and with its path kept for DASH", () => {
    // The same vector as apps/stream-relay's tests: the Worker signs the same way.
    expect(relaySignature("known-vector-key", "http://colton.example.gov")).toBe("uBIqo_knFS-LdJk2Pl2knW8AjqZTu4_7vpQmVLuZBS0");
    const sig = expectedSig("http://colton.example.gov");
    expect(relayUrl(RELAY, COLTON_HTTP)).toBe(`${RELAY.base}/v1/${sig}/${Buffer.from(COLTON_HTTP).toString("base64url")}`);
    const dashSig = expectedSig("http://lomalinda.example.gov:8080");
    expect(relayUrl(RELAY, LOMA_HTTP, "dash")).toBe(`${RELAY.base}/v1/${dashSig}/${Buffer.from("http://lomalinda.example.gov:8080").toString("base64url")}/live/manifest.mpd`);
  });

  it("tries https on 443, or on the link's own port when it names one other than 80", () => {
    expect(httpsVariant("http://a.example.gov/live.m3u8?x=1")).toBe("https://a.example.gov/live.m3u8?x=1");
    expect(httpsVariant("http://a.example.gov:80/live.m3u8")).toBe("https://a.example.gov/live.m3u8");
    expect(httpsVariant("http://a.example.gov:8080/live.m3u8")).toBe("https://a.example.gov:8080/live.m3u8");
    expect(httpsVariant("https://a.example.gov/live.m3u8")).toBeNull();
  });

  it("is configured only with both variables", () => {
    expect(streamRelayFromEnv({ STREAM_RELAY_BASE: "https://r.example.dev/", STREAM_RELAY_SECRET: "s" })).toEqual({ base: "https://r.example.dev", secret: "s" });
    expect(streamRelayFromEnv({ STREAM_RELAY_BASE: "https://r.example.dev" })).toBeNull();
    expect(streamRelayFromEnv({ STREAM_RELAY_SECRET: "s" })).toBeNull();
  });
});

describe("an http:// stream link", () => {
  let coltonId: string;

  it("with the relay configured and no https at the source, is on the dial with the signed relay address", async () => {
    const tried = fakeFetch({});
    h.deps.externalFetch = tried.fn;
    const body = await add("9.1", "COLT", COLTON_HTTP);
    coltonId = body.id;
    // https was tried first, at the same host and path.
    expect(tried.calls).toEqual([COLTON_HTTPS]);
    expect(body).toMatchObject({ onDial: true, waiting: null, playsOver: "relay", relayed: true, streamUrl: COLTON_HTTP, streamFormat: "hls" });
    const row = await dialRow("COLT");
    const relayed = `${RELAY.base}/v1/${expectedSig("http://colton.example.gov")}/${Buffer.from(COLTON_HTTP).toString("base64url")}`;
    // A239: and the source's own address, for the native apps' direct mode.
    expect(row?.playback).toEqual({ kind: "hls", url: relayed, sourceUrl: COLTON_HTTP });
    const page = StationPage.parse((await anon(h).get("/v1/stations/colt").expect(200)).body);
    expect(page.playback).toEqual({ kind: "hls", url: relayed, sourceUrl: COLTON_HTTP });
  });

  it("without the relay, waits with needs_https and is off the dial", async () => {
    h.deps.config.streamRelay = null;
    expect(await listing(coltonId)).toMatchObject({ onDial: false, waiting: "needs_https", playsOver: "needs_https", relayed: false, listingState: "checking" });
    expect(await dialRow("COLT")).toBeUndefined();
  });

  it("on the dial through the relay, is checked at the source directly, never through the relay", async () => {
    const check = fakeFetch({ [COLTON_HTTP]: hls });
    await h.services.network.checkExternalStations({ fetch: check.fn });
    // Tried over https at listing a moment ago: not again within the hour.
    expect(check.calls).toEqual([COLTON_HTTP]);
    expect(await listing(coltonId)).toMatchObject({ onDial: true, playsOver: "relay", health: { state: "up" } });
  });

  it("waiting for https (or run where the relay's variables aren't, like the worker), is still checked at the source, and tried over https hourly", async () => {
    h.deps.config.streamRelay = null;
    const soon = fakeFetch({ [COLTON_HTTP]: hls, [COLTON_HTTPS]: hls });
    await h.services.network.checkExternalStations({ fetch: soon.fn });
    expect(soon.calls).toEqual([COLTON_HTTP]);

    h.clock.advance(HTTPS_RECHECK_MS);
    const later = fakeFetch({ [COLTON_HTTP]: hls, [COLTON_HTTPS]: hls });
    await h.services.network.checkExternalStations({ fetch: later.fn });
    expect(later.calls).toEqual([COLTON_HTTP, COLTON_HTTPS]);
    expect(await listing(coltonId)).toMatchObject({ onDial: true, waiting: null, playsOver: "https", relayed: false });
    // Straight from the source over https: no relay, even with none configured.
    expect((await dialRow("COLT"))?.playback).toEqual({ kind: "hls", url: COLTON_HTTPS, sourceUrl: COLTON_HTTPS });
    // And from the next minute it's checked there.
    const next = fakeFetch({ [COLTON_HTTPS]: hls });
    await h.services.network.checkExternalStations({ fetch: next.fn });
    expect(next.calls).toEqual([COLTON_HTTPS]);
    expect(await listing(coltonId)).toMatchObject({ health: { state: "up" } });
  });

  it("is checked over https while it plays there, and goes back to the relay when https stops answering", async () => {
    const both = fakeFetch({ [COLTON_HTTPS]: hls, [COLTON_HTTP]: hls });
    await h.services.network.checkExternalStations({ fetch: both.fn });
    expect(both.calls).toEqual([COLTON_HTTPS]);

    const httpOnly = fakeFetch({ [COLTON_HTTP]: hls });
    await h.services.network.checkExternalStations({ fetch: httpOnly.fn });
    expect(httpOnly.calls).toEqual([COLTON_HTTPS, COLTON_HTTP]);
    expect(await listing(coltonId)).toMatchObject({ onDial: true, playsOver: "relay", relayed: true, health: { state: "up" } });
    expect((await dialRow("COLT"))?.playback?.url.startsWith(`${RELAY.base}/v1/`)).toBe(true);
  });

  it("listed when the source already answers over https, plays the https address straight from the source", async () => {
    h.deps.externalFetch = fakeFetch({ ["https://redlands.example.gov/live/index.m3u8"]: hls }).fn;
    const body = await add("11.1", "RDLS", "http://redlands.example.gov/live/index.m3u8");
    expect(body).toMatchObject({ onDial: true, playsOver: "https", relayed: false });
    expect((await dialRow("RDLS"))?.playback).toEqual({ kind: "hls", url: "https://redlands.example.gov/live/index.m3u8", sourceUrl: "https://redlands.example.gov/live/index.m3u8" });
  });

  it("isn't upgraded when https only redirects back to http", async () => {
    const back = (async () => {
      const res = new Response(PLAYLIST, { status: 200 });
      Object.defineProperty(res, "url", { value: "http://fontana.example.gov/live/index.m3u8" });
      return res;
    }) as unknown as Fetch;
    h.deps.externalFetch = back;
    expect(await add("13.1", "FONT", "http://fontana.example.gov/live/index.m3u8")).toMatchObject({ playsOver: "relay", relayed: true });
  });

  it("a DASH manifest over http plays through the relay with its path kept", async () => {
    const body = await add("17.1", "LOMA", LOMA_HTTP);
    expect(body).toMatchObject({ onDial: true, playsOver: "relay", streamFormat: "dash" });
    const origin = "http://lomalinda.example.gov:8080";
    expect((await dialRow("LOMA"))?.playback).toEqual({ kind: "hls", format: "dash", url: `${RELAY.base}/v1/${expectedSig(origin)}/${Buffer.from(origin).toString("base64url")}/live/manifest.mpd`, sourceUrl: LOMA_HTTP });
  });

  it("changed to another http address (A215), is tried over https afresh", async () => {
    const tried = fakeFetch({ ["https://colton.example.gov/live/council2/master.m3u8"]: hls });
    h.deps.externalFetch = tried.fn;
    const after = await h.services.network.updateListedSource(null, coltonId, { streamUrl: "http://colton.example.gov/live/council2/master.m3u8" });
    expect(tried.calls).toEqual(["https://colton.example.gov/live/council2/master.m3u8"]);
    expect(after).toMatchObject({ playsOver: "https", onDial: true });
  });
});

describe("everything else plays as it did", () => {
  it("an https stream link: its own address, no https check, no relay", async () => {
    const tried = fakeFetch({});
    h.deps.externalFetch = tried.fn;
    const body = await add("21.1", "RIAL", RIALTO_HTTPS);
    expect(tried.calls).toEqual([]);
    expect(body).toMatchObject({ onDial: true, playsOver: null, relayed: false });
    expect((await dialRow("RIAL"))?.playback).toEqual({ kind: "hls", url: RIALTO_HTTPS, sourceUrl: RIALTO_HTTPS });
    const check = fakeFetch({ [RIALTO_HTTPS]: hls });
    await h.services.network.checkExternalStations({ fetch: check.fn });
    expect(check.calls).toContain(RIALTO_HTTPS);
  });

  it("an official embed, even on http: unchanged (never relayed)", async () => {
    const body = (
      await dee
        .post("/v1/admin/listed-sources", { marketId, band: "tv", channel: "27.1", callSign: "UPLD", name: "Upland", streamUrl: "http://upland.example.gov/player", plays: "embed", embedTerms: "allowed", evidence: { termsUrl: "https://upland.example.gov/terms", termsCheckedOn: "2026-09-29" } })
        .expect(201)
    ).body;
    expect(body).toMatchObject({ onDial: true, playsOver: null, relayed: false });
    expect((await dialRow("UPLD"))?.playback).toEqual({ kind: "embed", url: "http://upland.example.gov/player" });
  });
});
