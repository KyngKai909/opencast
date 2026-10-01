# The HTTPS stream relay (A237)

Added 2026-10-01. Opencast's apps are served over HTTPS, and browsers block an `http://` stream on an HTTPS page as mixed content, so an external station whose stream link is plain `http://` couldn't play. **The user decided** (A237, docs/open-decisions.md) to change Phase 6's "never proxy, cache or re-serve the stream" **for `http://` stream links only**. Everything else still plays straight from the source, as before:

- `https://` stream links;
- official embeds (even an `http://` one: it's the source's own page in a frame);
- DASH over https.

## What happens to an `http://` stream link

1. **https first.** When it's listed, when its address changes (A215), and then hourly with the minute's checks, the API tries the same address over https: the same host, path and query, on port 443, or on the link's own port when it names one other than 80. It uses the minute check's light request (a ranged GET of the playlist, a 5 s timeout, the public internet only), and a real HLS or DASH playlist has to come back (not after a redirect back to http). If it answers, the dial plays the https address **straight from the source**, and the desk says "Plays over https (its listed address is http)". If https later stops answering while http still does, the upgrade is dropped at the next minute's check.
2. **Otherwise, the relay**, when it's configured (`STREAM_RELAY_BASE` and `STREAM_RELAY_SECRET` on the API): the dial's `playback.url` is a signed relay address, and the desk says "Plays through Opencast's secure relay (its address is http)". The listing has `playsOver: "relay"` and `relayed: true`.
3. **Neither:** it waits, `waiting: "needs_https"`, off the dial, and the desk says "Needs an https address". It's still checked every minute at the source (the worker runs the checks without the relay's variables, so they never depend on them), and tried over https hourly, so it goes on the dial once its source answers there.

Its evidence still has to hold first (a written permission or a public basis), as for any stream link. **Through the relay, Opencast carries the stream**, so that evidence matters more than for a stream the viewer's player fetches from the source: check the permission covers it, or that the source is clearly public.

The minute's health checks always fetch the source directly from the server (never through the relay): the https address while it's upgraded, otherwise the listed http address.

## The relay

A Cloudflare Worker in `apps/stream-relay` (TypeScript, `wrangler.toml`, no runtime dependencies). It is **strictly pass-through**:

- **Nothing is stored.** No KV, R2, Durable Objects or Cache API. Playlists are rewritten in memory and sent on; segments and keys are streamed through as they arrive, never buffered whole.
- **Playlists are always `no-store`**, at the edge and in the browser.
- **Segments are `no-store` too, by default.** `RELAY_EDGE_CACHE_SECONDS` (a Worker variable in `wrangler.toml`, default `0`) lets Cloudflare's edge and viewers' browsers keep segments and keys for that many seconds (up to 3,600). 30 to 60 seconds saves requests to the source when many people watch the same channel at once; it doesn't save Worker requests (each viewer's request still runs the Worker). Leave it at 0 to keep "nothing kept".

### Addresses

```
GET|HEAD https://<relay>/v1/<sig>/<b64url(upstream URL)>            the address in full (HLS)
GET|HEAD https://<relay>/v1/<sig>/<b64url(origin)>/<path>?<query>   the path kept (DASH)
OPTIONS  (CORS preflight)        GET /health
```

- `sig` is HMAC-SHA256 over the upstream's **origin** (`http://host[:port]`, as `URL.origin` writes it) with `STREAM_RELAY_SECRET`, base64url without padding. The API signs the stream link's origin (`apps/api/src/v1/lib/streamRelay.ts`); the Worker relays **any** address on a signed origin, so a playlist's segments and variant playlists on the same origin work without the API signing each one.
- **A playlist that lists another `http://` origin** (a CDN, say): the Worker signs that origin itself while rewriting. It's following the listed source's own playlist, so that's acceptable, and it's the only way the Worker signs anything.
- Unsigned or badly signed: **403**. Only `http:` and `https:` upstreams (anything else: **400**), never one with a user name or password, and never a local or private address (localhost, 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16, IPv6 loopback, unique-local and link-local; **403**). Redirects are followed (up to 5), each checked the same way.
- The signature never expires: it says "this origin was listed", not "this viewer may watch". Changing the secret invalidates every relay address at once (players tuned in stand by and reload from the dial).

### What's rewritten

- **HLS** (`.m3u8`/`.m3u`, or the type `application/vnd.apple.mpegurl`, `application/x-mpegurl`, `audio/mpegurl`): every URI, on its own line or in a `URI="…"` attribute (EXT-X-KEY, EXT-X-MAP, EXT-X-MEDIA, EXT-X-I-FRAME-STREAM-INF, EXT-X-SESSION-KEY, EXT-X-SESSION-DATA, EXT-X-PART, EXT-X-PRELOAD-HINT, EXT-X-RENDITION-REPORT, a DATERANGE's X-ASSET-URI), resolved against the playlist's own address (after any redirect). `http://` targets become signed relay addresses; `https://` targets are written out absolute and **stay direct**, to save Worker requests (that server's own CORS still applies: a direct https segment can still be blocked by it); `skd://` and `data:` are left alone. Query strings are kept.
- **DASH** over http: the API gives the manifest's relay address on the path form, so its relative addresses (BaseURL, SegmentTemplate's `media` and `initialization`, `$Number$` templates and all) resolve against the relay as they would at the source. Absolute `http://` addresses (BaseURL, Location, PatchLocation, `media`, `initialization`, `index`, `sourceURL`, `bitstreamSwitching`, `xlink:href`) move onto the relay's path form for their origin, root-relative ones (`/audio/init.mp4`) onto the manifest's own origin, and `https://` ones stay direct. A manifest asked for in full, or one the source redirects, is sent (302) to its path form. Not handled: a root-relative address under a BaseURL on another origin (it's put on the manifest's origin).
- **Refused:** a playlist bigger than 5 MB (by its length, or as it's read), and anything at a playlist's address whose type isn't a playlist's or a generic one (`text/plain`, `application/octet-stream`, XML) or whose body doesn't start `#EXTM3U` / contain `<MPD`: **502**.

### Requests and answers

- To the source: `User-Agent: Opencast stream relay`, `Accept: */*`, and for segments the viewer's `Range` (passed through; a 206 stays a 206 with its `Content-Range`). Never the viewer's cookies, authorization or other headers. A 10 s timeout for the source to start answering (**504** after it); a long segment then streams for as long as it takes.
- The source's errors are passed on as their status (404, 503, …); unreachable is **502**.
- To the viewer: the source's `Content-Type`, `Content-Length` (unless the body was decompressed), `Content-Range`, `Accept-Ranges`, `ETag` and `Last-Modified`; `Access-Control-Allow-Origin: *` and `Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges, Content-Type`; and `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, so nothing the relay sends runs as a page. Never the source's cookies.

## Deploying it

Nothing here has been deployed or set. The Worker lives on Cloudflare (the account R2 is on is fine), not Railway.

1. **Sign in to Cloudflare** from the repository: `npx wrangler@4 login` (a browser sign-in), or set `CLOUDFLARE_API_TOKEN` (a token from the "Edit Cloudflare Workers" template) and `CLOUDFLARE_ACCOUNT_ID` in the shell.
2. **Make a secret**, e.g. `openssl rand -base64 32`, and keep it in your password manager. Never commit it.
3. **Give it to the Worker:** `cd apps/stream-relay && npx wrangler@4 secret put STREAM_RELAY_SECRET` (it prompts for the value). One Worker serves staging and production alike, or deploy one per environment with `--env`, each with its own secret.
4. **Deploy:** `npx wrangler@4 deploy` (or `npm run deploy -w @opencast/stream-relay`). It answers at `https://opencast-stream-relay.<account>.workers.dev`. Once Opencast's domain is bought, a custom domain can go in `wrangler.toml` (`routes = [{ pattern = "stream-relay.<domain>", custom_domain = true }]`) and the address changes to it.
5. **Check it:** `curl https://opencast-stream-relay.<account>.workers.dev/health` says `Opencast stream relay`.
6. **On Railway's api service** (staging, then production), set `STREAM_RELAY_BASE` to the Worker's address (no trailing slash) and `STREAM_RELAY_SECRET` to **the same secret** (the dashboard, or `railway variables --set`). Both are declared in `.railway/railway.ts` as values kept in Railway. The worker service doesn't need them: its checks fetch the source directly.
7. With both set, every `http://` stream link with its evidence that doesn't answer over https is on the dial through the relay. Unset either, and they wait ("Needs an https address").

Rotating the secret: put the new one on the Worker and the API together (relay addresses on the dial change with the API; players already tuned in stand by and reload).

## Locally

- `npm test -w @opencast/stream-relay` runs the Worker's tests with `fetch` mocked (no network, no Workers runtime). `npm run typecheck -w @opencast/stream-relay` checks it against the Workers types.
- `npx wrangler@4 dev --port 8788 --var RELAY_ALLOW_PRIVATE:1` (in `apps/stream-relay`, with `STREAM_RELAY_SECRET=…` in an untracked `.dev.vars`) serves it on `http://localhost:8788`; no Cloudflare sign-in is needed for local mode. `RELAY_ALLOW_PRIVATE=1` lets it reach a stream on localhost, and is for local development only. Point the API at it with `STREAM_RELAY_BASE=http://localhost:8788` and the same secret.

## What it costs

Check current prices: Cloudflare's Workers pricing as of 2026-10-01.

- **Free plan**: 100,000 requests a day.
- **Paid plan**: $5 a month, which includes 10 million requests a month, then $0.30 a million. (CPU time is billed too past an included allowance; the relay does little work per request: a signature check, and for playlists a rewrite.)
- **No bandwidth charges**: Workers don't bill egress, so a segment costs one request however big it is.
- **Per viewer-hour**: at 6-second segments, a live HLS stream is about 600 segment requests and 600 playlist refreshes an hour, so **about 1,200 requests per viewer-hour** (more with a separate audio rendition or 2-second segments; fewer when the source's segments are https and stay direct). The free plan covers about 80 viewer-hours a day; the paid plan's included requests about 8,000 viewer-hours a month, and past that it's about **$0.0004 a viewer-hour**.
- Only relayed listings count: an http link that answers over https, https links and embeds cost the relay nothing.
