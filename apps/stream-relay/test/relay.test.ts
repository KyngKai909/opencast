// The stream relay (A237), with `fetch` mocked: no network. Signatures, playlist rewriting (HLS and
// DASH), segments streamed with their ranges, CORS, the size cap, errors and what's refused.
import { afterEach, describe, expect, it, vi } from "vitest";
import { handle, PLAYLIST_MAX_BYTES, USER_AGENT, type Env } from "../src/relay.js";
import { b64urlDecode, b64urlEncode, signOrigin } from "../src/sign.js";

const RELAY = "https://relay.opencast.test";
// A fresh secret for this run only.
const SECRET = `test-${crypto.randomUUID()}`;
const ENV: Env = { STREAM_RELAY_SECRET: SECRET };

const SOURCE = "http://colton.example.gov";
const CDN = "http://cdn2.example.net:8080";

interface Call {
  url: string;
  init: RequestInit & { cf?: unknown };
}

/** A fake network: each address answers what `routes` says, and every call is kept. */
function network(routes: Record<string, (init: RequestInit) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes[url];
    if (!route) return new Response("not found", { status: 404 });
    return route(init);
  }) as typeof fetch;
  return { fn, calls };
}

const relayFull = async (upstream: string, secret = SECRET) => `${RELAY}/v1/${await signOrigin(secret, new URL(upstream).origin)}/${b64urlEncode(upstream)}`;
const relayPath = async (upstream: string) => {
  const u = new URL(upstream);
  return `${RELAY}/v1/${await signOrigin(SECRET, u.origin)}/${b64urlEncode(u.origin)}${u.pathname}${u.search}`;
};
/** The upstream a relay address in a rewritten playlist stands for. */
const upstreamOf = (relayAddress: string) => b64urlDecode(new URL(relayAddress).pathname.split("/")[3]!);

const get = (url: string, init: RequestInit = {}, env: Env = ENV, fetchFn?: typeof fetch) => handle(new Request(url, init), env, fetchFn);

const m3u8 = (body: string, type = "application/vnd.apple.mpegurl") => () => new Response(body, { headers: { "content-type": type } });

afterEach(() => vi.useRealTimers());

describe("signatures", () => {
  const playlist = `${SOURCE}/live/council/master.m3u8`;
  const net = () => network({ [playlist]: m3u8("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow/index.m3u8\n") });

  it("relays a signed address, and any address on its signed origin", async () => {
    const n = net();
    expect((await get(await relayFull(playlist), {}, ENV, n.fn)).status).toBe(200);
    // Another path on the same origin: the same signature.
    const sig = (await relayFull(playlist)).split("/")[4];
    const other = `${RELAY}/v1/${sig}/${b64urlEncode(`${SOURCE}/live/council/low/index.m3u8`)}`;
    expect((await get(other, {}, ENV, n.fn)).status).toBe(404); // the fake has no such route: the source's 404, passed on
    expect(n.calls.map((c) => c.url)).toEqual([playlist, `${SOURCE}/live/council/low/index.m3u8`]);
  });

  it("refuses a bad signature, one for another origin, one made with another secret, and none at all", async () => {
    const n = net();
    const good = await relayFull(playlist);
    const parts = good.split("/");
    const bad = [...parts.slice(0, 4), "A".repeat(43), ...parts.slice(5)].join("/");
    const forOther = `${RELAY}/v1/${await signOrigin(SECRET, "http://elsewhere.example.org")}/${b64urlEncode(playlist)}`;
    const otherSecret = await relayFull(playlist, `other-${crypto.randomUUID()}`);
    // A different port is a different origin.
    const otherPort = `${RELAY}/v1/${parts[4]}/${b64urlEncode("http://colton.example.gov:8081/live/council/master.m3u8")}`;
    for (const url of [bad, forOther, otherSecret, otherPort]) {
      const res = await get(url, {}, ENV, n.fn);
      expect(res.status).toBe(403);
      expect(await res.text()).toBe("Bad signature");
    }
    for (const url of [`${RELAY}/v1/${b64urlEncode(playlist)}`, `${RELAY}/v1//${b64urlEncode(playlist)}`]) {
      expect((await get(url, {}, ENV, n.fn)).status).toBe(403);
    }
    expect(n.calls).toEqual([]);
  });

  it("answers 503 without its secret, and 404 off /v1", async () => {
    expect((await get(await relayFull(playlist), {}, {})).status).toBe(503);
    expect((await get(`${RELAY}/elsewhere`)).status).toBe(404);
    expect((await get(`${RELAY}/health`)).status).toBe(200);
  });

  it("relays only http and https: nothing else, signed or not", async () => {
    const n = net();
    for (const upstream of ["ftp://files.example.gov/live.m3u8", "file:///etc/passwd", "data:text/plain,hi", "javascript:alert(1)", "ws://colton.example.gov/live"]) {
      const origin = new URL(upstream).origin;
      const res = await get(`${RELAY}/v1/${await signOrigin(SECRET, origin)}/${b64urlEncode(upstream)}`, {}, ENV, n.fn);
      expect(res.status, upstream).toBe(400);
    }
    expect((await get(`${RELAY}/v1/${await signOrigin(SECRET, SOURCE)}/!!notbase64`, {}, ENV, n.fn)).status).toBe(400);
    expect(n.calls).toEqual([]);
  });

  it("never reaches a local or private address (unless RELAY_ALLOW_PRIVATE=1, for wrangler dev)", async () => {
    const local = "http://127.0.0.1:8099/live/index.m3u8";
    const n = network({ [local]: m3u8("#EXTM3U\n") });
    for (const upstream of [local, "http://10.0.0.5/x.m3u8", "http://169.254.169.254/latest", "http://localhost:8080/a.m3u8", "http://[::1]/a.m3u8", "http://192.168.1.2/a.ts"]) {
      expect((await get(await relayFull(upstream), {}, ENV, n.fn)).status, upstream).toBe(403);
    }
    expect(n.calls).toEqual([]);
    expect((await get(await relayFull(local), {}, { ...ENV, RELAY_ALLOW_PRIVATE: "1" }, n.fn)).status).toBe(200);
  });
});

describe("HLS playlists", () => {
  const master = `${SOURCE}/live/council/master.m3u8?token=abc`;
  const MASTER = [
    "#EXTM3U",
    "#EXT-X-VERSION:6",
    '#EXT-X-SESSION-KEY:METHOD=AES-128,URI="keys/session.key?k=1"',
    '#EXT-X-SESSION-DATA:DATA-ID="com.example.title",URI="/meta/title.json"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",DEFAULT=YES,URI="audio/en.m3u8"',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",URI="https://captions.example.com/en.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x720,AUDIO="aud"',
    "720p/index.m3u8?token=abc",
    "#EXT-X-STREAM-INF:BANDWIDTH=800000",
    `${CDN}/council/480p/index.m3u8?sig=x%2By&exp=1`,
    "#EXT-X-STREAM-INF:BANDWIDTH=400000",
    "//colton.example.gov/live/council/240p/index.m3u8",
    '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=90000,URI="iframes/index.m3u8"',
    "# a comment with URI=\"left/alone.m3u8\"",
    ""
  ].join("\n");

  it("rewrites every URI: relative and absolute, in attributes, http relayed and https direct, query strings kept", async () => {
    const n = network({ [master]: m3u8(MASTER) });
    const res = await get(await relayFull(master), {}, ENV, n.fn);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.apple.mpegurl");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const lines = (await res.text()).split("\n");
    const attr = (line: string) => /URI="([^"]*)"/.exec(line)![1]!;
    const relayed = (address: string) => {
      expect(address.startsWith(`${RELAY}/v1/`), address).toBe(true);
      return upstreamOf(address);
    };
    expect(relayed(attr(lines[2]!))).toBe(`${SOURCE}/live/council/keys/session.key?k=1`);
    expect(relayed(attr(lines[3]!))).toBe(`${SOURCE}/meta/title.json`);
    expect(relayed(attr(lines[4]!))).toBe(`${SOURCE}/live/council/audio/en.m3u8`);
    // https stays direct, straight from the source.
    expect(attr(lines[5]!)).toBe("https://captions.example.com/en.m3u8");
    expect(lines[6]).toBe('#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x720,AUDIO="aud"');
    expect(relayed(lines[7]!)).toBe(`${SOURCE}/live/council/720p/index.m3u8?token=abc`);
    // Another http origin the playlist lists: the relay signs it itself, and accepts its own address.
    expect(relayed(lines[9]!)).toBe(`${CDN}/council/480p/index.m3u8?sig=x%2By&exp=1`);
    expect(relayed(lines[11]!)).toBe(`${SOURCE}/live/council/240p/index.m3u8`);
    expect(relayed(attr(lines[12]!))).toBe(`${SOURCE}/live/council/iframes/index.m3u8`);
    expect(lines[13]).toBe('# a comment with URI="left/alone.m3u8"');

    const cdn = network({ [`${CDN}/council/480p/index.m3u8?sig=x%2By&exp=1`]: m3u8("#EXTM3U\n") });
    expect((await get(lines[9]!, {}, ENV, cdn.fn)).status).toBe(200);
  });

  it("rewrites a media playlist's keys, map, parts, hints and reports, and leaves other key schemes alone", async () => {
    const media = `${SOURCE}/live/council/720p/index.m3u8`;
    const MEDIA = [
      "#EXTM3U",
      "#EXT-X-TARGETDURATION:6",
      "#EXT-X-MEDIA-SEQUENCE:1041",
      '#EXT-X-KEY:METHOD=AES-128,URI="../keys/k1041.key",IV=0x1234',
      '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://fairplay-key-1",KEYFORMAT="com.apple.streamingkeydelivery"',
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXT-X-PART:DURATION=1.0,URI="seg1042.part1.m4s"',
      '#EXT-X-PRELOAD-HINT:TYPE=PART,URI="seg1042.part2.m4s"',
      '#EXT-X-RENDITION-REPORT:URI="../480p/index.m3u8",LAST-MSN=1041',
      "#EXTINF:6.0,",
      "seg1041.m4s?t=1",
      "#EXTINF:6.0,",
      "https://cdn.example.com/council/seg1042.m4s",
      ""
    ].join("\r\n");
    const n = network({ [media]: m3u8(MEDIA, "audio/mpegurl") });
    const res = await get(await relayFull(media), {}, ENV, n.fn);
    const lines = (await res.text()).split("\n");
    const attr = (line: string) => /URI="([^"]*)"/.exec(line)![1]!;
    expect(upstreamOf(attr(lines[3]!))).toBe(`${SOURCE}/live/council/keys/k1041.key`);
    expect(lines[3]).toContain(",IV=0x1234");
    expect(attr(lines[4]!)).toBe("skd://fairplay-key-1");
    expect(upstreamOf(attr(lines[5]!))).toBe(`${media.replace("index.m3u8", "init.mp4")}`);
    expect(upstreamOf(attr(lines[6]!))).toBe(`${SOURCE}/live/council/720p/seg1042.part1.m4s`);
    expect(upstreamOf(attr(lines[7]!))).toBe(`${SOURCE}/live/council/720p/seg1042.part2.m4s`);
    expect(upstreamOf(attr(lines[8]!))).toBe(`${SOURCE}/live/council/480p/index.m3u8`);
    expect(lines[8]).toContain(",LAST-MSN=1041");
    expect(upstreamOf(lines[10]!)).toBe(`${SOURCE}/live/council/720p/seg1041.m4s?t=1`);
    expect(lines[12]).toBe("https://cdn.example.com/council/seg1042.m4s");
    expect(res.headers.get("content-type")).toBe("audio/mpegurl");
  });

  it("knows a playlist by its type when its address doesn't say", async () => {
    const upstream = `${SOURCE}/live/playlist?channel=2`;
    const n = network({ [upstream]: m3u8("#EXTM3U\n#EXTINF:6,\nchunk-1.ts\n", "application/x-mpegURL; charset=utf-8") });
    const body = await (await get(await relayFull(upstream), {}, ENV, n.fn)).text();
    expect(upstreamOf(body.split("\n")[2]!)).toBe(`${SOURCE}/live/chunk-1.ts`);
  });

  it("resolves against where a redirect led", async () => {
    const upstream = `${SOURCE}/live.m3u8`;
    const moved = "http://origin3.example.gov/hls/live/index.m3u8";
    const n = network({ [upstream]: () => new Response(null, { status: 302, headers: { location: moved } }), [moved]: m3u8("#EXTM3U\nseg-9.ts\n") });
    const body = await (await get(await relayFull(upstream), {}, ENV, n.fn)).text();
    expect(upstreamOf(body.split("\n")[1]!)).toBe("http://origin3.example.gov/hls/live/seg-9.ts");
    expect(n.calls.every((c) => c.init.redirect === "manual")).toBe(true);
  });

  it("refuses what isn't a playlist at a playlist's address", async () => {
    const html = `${SOURCE}/live/page.m3u8`;
    const junk = `${SOURCE}/live/junk.m3u8`;
    const n = network({ [html]: m3u8("<html></html>", "text/html"), [junk]: m3u8("hello", "text/plain") });
    expect((await get(await relayFull(html), {}, ENV, n.fn)).status).toBe(502);
    expect((await get(await relayFull(junk), {}, ENV, n.fn)).status).toBe(502);
  });

  it("caps a playlist at 5 MB, by its length or as it's read", async () => {
    const big = `${SOURCE}/live/big.m3u8`;
    const endless = `${SOURCE}/live/endless.m3u8`;
    const chunk = new TextEncoder().encode(`#EXTM3U\n${"#EXTINF:6,\nseg.ts\n".repeat(65_536)}`);
    const n = network({
      [big]: () => new Response("#EXTM3U\n", { headers: { "content-type": "application/vnd.apple.mpegurl", "content-length": String(PLAYLIST_MAX_BYTES + 1) } }),
      [endless]: () => {
        let sent = 0;
        const stream = new ReadableStream<Uint8Array>({
          pull(c) {
            sent += chunk.byteLength;
            c.enqueue(chunk);
            if (sent > PLAYLIST_MAX_BYTES * 2) c.close();
          }
        });
        return new Response(stream, { headers: { "content-type": "application/vnd.apple.mpegurl" } });
      }
    });
    for (const url of [big, endless]) {
      const res = await get(await relayFull(url), {}, ENV, n.fn);
      expect(res.status).toBe(502);
      expect(await res.text()).toBe("The playlist is too large");
    }
  });
});

describe("segments and keys", () => {
  const segment = `${SOURCE}/live/council/720p/seg1041.ts`;
  const bytes = new Uint8Array(1000).map((_, i) => i % 256);

  it("passes a range through and keeps the 206, its length and range", async () => {
    const n = network({
      [segment]: (init) => {
        const range = new Headers(init.headers).get("range");
        expect(range).toBe("bytes=100-199");
        return new Response(bytes.slice(100, 200), { status: 206, headers: { "content-type": "video/mp2t", "content-length": "100", "content-range": "bytes 100-199/1000", "accept-ranges": "bytes", "set-cookie": "a=b" } });
      }
    });
    const res = await get(await relayFull(segment), { headers: { range: "bytes=100-199", cookie: "viewer=1", authorization: "Bearer viewer" } }, ENV, n.fn);
    expect(res.status).toBe(206);
    expect(res.headers.get("content-type")).toBe("video/mp2t");
    expect(res.headers.get("content-length")).toBe("100");
    expect(res.headers.get("content-range")).toBe("bytes 100-199/1000");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-expose-headers")).toContain("Content-Range");
    expect(res.headers.get("access-control-expose-headers")).toContain("Content-Length");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes.slice(100, 200));
    // Never the viewer's cookies or authorization; the relay's own user agent.
    const sent = new Headers(n.calls[0]!.init.headers);
    expect(sent.get("cookie")).toBeNull();
    expect(sent.get("authorization")).toBeNull();
    expect(sent.get("user-agent")).toBe(USER_AGENT);
    expect(n.calls[0]!.init.cache).toBe("no-store");
  });

  it("streams a segment through as it arrives, without waiting for the whole body", async () => {
    let push!: (chunk: Uint8Array | null) => void;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 10));
        push = (chunk) => (chunk ? c.enqueue(chunk) : c.close());
      }
    });
    const n = network({ [segment]: () => new Response(stream, { headers: { "content-type": "video/mp2t" } }) });
    const res = await get(await relayFull(segment), {}, ENV, n.fn);
    // The answer is here while the source is still sending.
    const reader = res.body!.getReader();
    expect((await reader.read()).value).toEqual(bytes.slice(0, 10));
    push(bytes.slice(10, 20));
    expect((await reader.read()).value).toEqual(bytes.slice(10, 20));
    push(null);
    expect((await reader.read()).done).toBe(true);
  });

  it("answers HEAD with the headers only", async () => {
    const n = network({ [segment]: () => new Response(null, { headers: { "content-type": "video/mp2t", "content-length": "1000" } }) });
    const res = await get(await relayFull(segment), { method: "HEAD" }, ENV, n.fn);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("1000");
    expect(n.calls[0]!.init.method).toBe("HEAD");
  });

  it("keeps nothing by default; RELAY_EDGE_CACHE_SECONDS lets the edge keep segments, never playlists", async () => {
    const playlist = `${SOURCE}/live/council/720p/index.m3u8`;
    const n = network({ [segment]: () => new Response(bytes, { headers: { "content-type": "video/mp2t" } }), [playlist]: m3u8("#EXTM3U\nseg1041.ts\n") });
    const env = { ...ENV, RELAY_EDGE_CACHE_SECONDS: "30" };
    const seg = await get(await relayFull(segment), {}, env, n.fn);
    expect(seg.headers.get("cache-control")).toBe("public, max-age=30");
    expect(n.calls[0]!.init.cf).toEqual({ cacheTtl: 30, cacheEverything: true });
    const list = await get(await relayFull(playlist), {}, env, n.fn);
    expect(list.headers.get("cache-control")).toBe("no-store");
    expect(n.calls[1]!.init.cf).toBeUndefined();
    expect(n.calls[1]!.init.cache).toBe("no-store");
  });
});

describe("CORS and errors", () => {
  it("answers a preflight", async () => {
    const res = await get(`${RELAY}/v1/x/y`, { method: "OPTIONS", headers: { origin: "https://opencast-web.vercel.app", "access-control-request-headers": "range" } });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-headers")).toBe("Range");
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, HEAD, OPTIONS");
    expect((await get(`${RELAY}/v1/x/y`, { method: "POST" })).status).toBe(405);
  });

  it("passes on the source's errors, and says when it can't be reached or doesn't answer", async () => {
    const gone = `${SOURCE}/live/gone.m3u8`;
    const broken = `${SOURCE}/live/broken.m3u8`;
    const n = network({ [gone]: () => new Response("no", { status: 404 }), [broken]: () => Promise.reject(new TypeError("fetch failed")) });
    const res404 = await get(await relayFull(gone), {}, ENV, n.fn);
    expect(res404.status).toBe(404);
    expect(res404.headers.get("access-control-allow-origin")).toBe("*");
    expect((await get(await relayFull(broken), {}, ENV, n.fn)).status).toBe(502);
    const n503 = network({ [gone]: () => new Response("busy", { status: 503 }) });
    expect((await get(await relayFull(gone), {}, ENV, n503.fn)).status).toBe(503);
  });

  it("gives up on a source that hasn't answered in 10 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const slow = `${SOURCE}/live/slow.m3u8`;
    let asked!: () => void;
    const reached = new Promise<void>((resolve) => (asked = resolve));
    const n = network({
      [slow]: (init) =>
        new Promise((_, reject) => {
          asked();
          init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        })
    });
    const pending = get(await relayFull(slow), {}, ENV, n.fn);
    await reached;
    await vi.advanceTimersByTimeAsync(9_999);
    expect(n.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).status).toBe(504);
  });
});

describe("DASH manifests", () => {
  const mpd = `${SOURCE}/live/council/manifest.mpd`;
  const MPD = `<?xml version="1.0" encoding="utf-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic">
  <Location>http://colton.example.gov/live/council/manifest.mpd?v=2</Location>
  <BaseURL>http://media.example.gov/council/</BaseURL>
  <BaseURL serviceLocation="b">https://cdn.example.com/council/</BaseURL>
  <Period id="1">
    <AdaptationSet mimeType="video/mp4" bitstreamSwitching="true">
      <SegmentTemplate initialization="init-$RepresentationID$.mp4" media="seg-$RepresentationID$-$Number%05d$.m4s" startNumber="1"/>
      <Representation id="720p" bandwidth="2400000"/>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4">
      <SegmentTemplate initialization="/audio/init.mp4" media='http://media.example.gov:8080/audio/$Number$.m4s?a=1&amp;b=2'/>
      <Representation id="a" bandwidth="128000"><BaseURL>audio/</BaseURL></Representation>
    </AdaptationSet>
  </Period>
</MPD>
`;

  it("sends a manifest asked for in full to its path form, where relative addresses resolve as at the source", async () => {
    const n = network({ [mpd]: () => new Response(MPD, { headers: { "content-type": "application/dash+xml" } }) });
    const res = await get(await relayFull(mpd), {}, ENV, n.fn);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(await relayPath(mpd));
    expect(n.calls).toEqual([]);
  });

  it("rewrites absolute and root-relative addresses onto the relay, leaving https and relative ones", async () => {
    const n = network({ [mpd]: () => new Response(MPD, { headers: { "content-type": "application/dash+xml" } }) });
    const res = await get(await relayPath(mpd), {}, ENV, n.fn);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.text();
    const prefix = async (origin: string) => `${RELAY}/v1/${await signOrigin(SECRET, origin)}/${b64urlEncode(origin)}`;
    expect(body).toContain(`<Location>${await prefix(SOURCE)}/live/council/manifest.mpd?v=2</Location>`);
    expect(body).toContain(`<BaseURL>${await prefix("http://media.example.gov")}/council/</BaseURL>`);
    expect(body).toContain('<BaseURL serviceLocation="b">https://cdn.example.com/council/</BaseURL>');
    expect(body).toContain('bitstreamSwitching="true"');
    expect(body).toContain('initialization="init-$RepresentationID$.mp4" media="seg-$RepresentationID$-$Number%05d$.m4s"');
    expect(body).toContain(`initialization="${await prefix(SOURCE)}/audio/init.mp4"`);
    expect(body).toContain(`media='${await prefix("http://media.example.gov:8080")}/audio/$Number$.m4s?a=1&amp;b=2'`);
    expect(body).toContain("<BaseURL>audio/</BaseURL>");
  });

  it("relays a segment asked for on the path form, template filled in by the player", async () => {
    const seg = `${SOURCE}/live/council/seg-720p-00007.m4s`;
    const n = network({ [seg]: () => new Response("moof", { headers: { "content-type": "video/iso.segment" } }) });
    // As a player resolves "seg-720p-00007.m4s" against the manifest's relay address.
    const url = new URL("seg-720p-00007.m4s", await relayPath(mpd)).href;
    const res = await get(url, {}, ENV, n.fn);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("moof");
    expect(n.calls[0]!.url).toBe(seg);
  });

  it("follows the manifest to where the source redirected it", async () => {
    const moved = "http://origin3.example.gov/dash/manifest.mpd";
    const n = network({ [mpd]: () => new Response(null, { status: 301, headers: { location: moved } }), [moved]: () => new Response(MPD, { headers: { "content-type": "application/dash+xml" } }) });
    const res = await get(await relayPath(mpd), {}, ENV, n.fn);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(await relayPath(moved));
  });
});

describe("addresses", () => {
  it("round-trips base64url, and refuses what isn't", () => {
    const url = `${SOURCE}/live/ünïcode.m3u8?a=1&b=two`;
    expect(b64urlDecode(b64urlEncode(url))).toBe(url);
    expect(b64urlEncode(url)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(b64urlDecode("@@@")).toBeNull();
  });

  it("signs as the API does (a shared vector: apps/api/test/external-relay.test.ts has the same one)", async () => {
    expect(await signOrigin("known-vector-key", "http://colton.example.gov")).toBe("uBIqo_knFS-LdJk2Pl2knW8AjqZTu4_7vpQmVLuZBS0");
  });
});
