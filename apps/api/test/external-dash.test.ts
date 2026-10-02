// DASH stream links (A201): with the rule `external.dash_stream_links` played, a DASH stream link
// with its evidence goes on the dial, and its row says so (`playback.format: "dash"`); not played,
// it's saved and waits. The minute's checks read a DASH manifest (`<MPD`) as up, like an HLS
// playlist. And the row stays readable by apps built before the field.
// No network: every fetch here is a fake, and the clock is pinned.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { Dial, StationPage } from "@opencast/contracts";
import { checkStream, type Fetch } from "../src/v1/modules/network/external.js";
import { anon, createHarness, market, type Harness, type User } from "./harness.js";

let h: Harness;
let dee: User; // an Opencast admin
let marketId: string;

const LOMA_DASH = "https://lomalinda.example.gov/live/manifest.mpd";
const COLTON_HLS = "https://colton.example.gov/live/council/master.m3u8";
const MPD = '<?xml version="1.0" encoding="utf-8"?>\n<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic" profiles="urn:mpeg:dash:profile:isoff-live:2011">\n</MPD>\n';

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

const setRule = (played: boolean) => dee.post("/v1/admin/rules/external.dash_stream_links/versions", { value: { played }, effectiveFrom: h.clock.now().toISOString(), note: "A201 test" }).expect(200);
const dialRows = async () => Dial.parse((await anon(h).get("/v1/markets/inland-empire/dial").expect(200)).body).rows;
const listing = async (id: string) => (await dee.get(`/v1/admin/listed-sources?marketId=${marketId}`).expect(200)).body.find((l: { id: string }) => l.id === id);

beforeAll(async () => {
  h = await createHarness();
  // Saturday, September 26, 8:42 pm in the Inland Empire (the reference's moment).
  h.clock.set("2026-09-27T03:42:00.000Z");
  dee = await h.signIn("Dee A.", { admin: true });
  marketId = (await market(h)).id;
}, 60_000);
afterAll(() => h.close());

describe("a DASH stream link (A201)", () => {
  let lomaId: string;

  it("waits while the rule says not played, saved with its evidence and its format", async () => {
    const res = await dee
      .post("/v1/admin/listed-sources", { marketId, band: "tv", channel: "27.1", callSign: "LOMA", name: "Loma Linda Community Access", streamUrl: LOMA_DASH, plays: "stream_link", evidence: { publicBasis: "Public access channel, stream published for the public" } })
      .expect(201);
    lomaId = res.body.id;
    expect(res.body).toMatchObject({ streamFormat: "dash", onDial: false, waiting: "dash_not_played", evidence: { basis: "public_source" } });
    expect((await dialRows()).map((r) => r.station.callSign)).not.toContain("LOMA");
    // An HLS stream link beside it, for comparison.
    await dee.post("/v1/admin/listed-sources", { marketId, band: "tv", channel: "9.1", callSign: "COLT", name: "City of Colton", streamUrl: COLTON_HLS, plays: "stream_link", evidence: { publicBasis: "Public body" } }).expect(201);
  });

  it("goes on the dial with DASH playback once the rule says played, straight from the source", async () => {
    await setRule(true);
    expect(await listing(lomaId)).toMatchObject({ onDial: true, waiting: null, listingState: "listed", streamFormat: "dash" });
    const rows = await dialRows();
    const loma = rows.find((r) => r.station.callSign === "LOMA")!;
    expect(loma).toMatchObject({ onAir: true, now: null, external: { source: "Loma Linda Community Access", plays: "stream_link", schedule: "none" } });
    expect(loma.playback).toEqual({ kind: "hls", url: LOMA_DASH, format: "dash", sourceUrl: LOMA_DASH });
    // An HLS stream link's row is as it was: no format.
    expect(rows.find((r) => r.station.callSign === "COLT")!.playback).toEqual({ kind: "hls", url: COLTON_HLS, sourceUrl: COLTON_HLS });
    const page = StationPage.parse((await anon(h).get("/v1/stations/loma").expect(200)).body);
    expect(page).toMatchObject({ onAir: true, playback: { kind: "hls", url: LOMA_DASH, format: "dash" }, external: { down: false } });
  });

  it("is read by apps built before the field: `format` is additive, where a new `kind` would fail their whole dial", async () => {
    const raw = (await anon(h).get("/v1/markets/inland-empire/dial").expect(200)).body;
    // The dial row's playback as those apps' contracts have it.
    const before = z.object({ kind: z.enum(["hls", "embed"]), url: z.string() }).nullable();
    const OldDial = z.object({ rows: z.array(z.object({ playback: before }).passthrough()) }).passthrough();
    expect(OldDial.safeParse(raw).success).toBe(true);
    const asKind = { ...raw, rows: raw.rows.map((r: { playback: { format?: string } | null }) => (r.playback?.format === "dash" ? { ...r, playback: { kind: "dash", url: LOMA_DASH } } : r)) };
    expect(OldDial.safeParse(asKind).success).toBe(false);
  });

  it("is checked every minute like an HLS stream link: an MPD is up, and down 5 minutes it leaves the dial and comes back", async () => {
    let up = true;
    const { fn, calls } = fakeFetch({
      [LOMA_DASH]: () => (up ? new Response(MPD, { status: 200, headers: { "content-type": "application/dash+xml" } }) : new Response("", { status: 503 })),
      [COLTON_HLS]: () => new Response("#EXTM3U\n", { status: 200 })
    });
    expect(await checkStream({ plays: "stream_link", streamUrl: LOMA_DASH }, fn)).toEqual({ ok: true, detail: null, format: "dash" });
    expect(await h.services.network.checkExternalStations({ fetch: fn })).toMatchObject({ checked: 2, up: 2 });
    expect(await listing(lomaId)).toMatchObject({ health: { state: "up" }, onDial: true });

    up = false;
    await h.services.network.checkExternalStations({ fetch: fn });
    expect((await dialRows()).map((r) => r.station.callSign)).toContain("LOMA");
    h.clock.advance(5 * 60_000);
    expect(await h.services.network.checkExternalStations({ fetch: fn })).toMatchObject({ hidden: 1 });
    expect((await dialRows()).map((r) => r.station.callSign)).not.toContain("LOMA");
    expect((await anon(h).get("/v1/stations/loma").expect(200)).body).toMatchObject({ playback: null, external: { down: true } });

    up = true;
    h.clock.advance(60_000);
    expect(await h.services.network.checkExternalStations({ fetch: fn })).toMatchObject({ back: 1 });
    const back = (await dialRows()).find((r) => r.station.callSign === "LOMA")!;
    expect(back.playback).toEqual({ kind: "hls", url: LOMA_DASH, format: "dash", sourceUrl: LOMA_DASH });
    // Only the manifest, never a segment.
    expect(calls.every((u) => u === LOMA_DASH || u === COLTON_HLS)).toBe(true);
  });

  it("waits again (and isn't checked) when the rule goes back to not played", async () => {
    h.clock.advance(60_000);
    await setRule(false);
    expect(await listing(lomaId)).toMatchObject({ onDial: false, waiting: "dash_not_played" });
    expect((await dialRows()).map((r) => r.station.callSign)).not.toContain("LOMA");
    const { fn, calls } = fakeFetch({ [LOMA_DASH]: () => new Response(MPD), [COLTON_HLS]: () => new Response("#EXTM3U\n") });
    await h.services.network.checkExternalStations({ fetch: fn });
    expect(calls).toEqual([COLTON_HLS]);
  });
});
