// The dial in other apps (programming Phase 5): the channel list (M3U) and the guide (XMLTV) for
// TiviMate, Jellyfin, Channels DVR, Kodi and VLC, and their viewers counted as "Other apps" (runs
// of `via=iptv` playlist polls), apart from everything billed. The clock is pinned: Thursday,
// October 1, 2026, noon Pacific.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gunzipSync } from "node:zlib";
import { eq, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import { foldBreaks, writeM3u } from "../src/v1/modules/iptv/format.js";
import { masterWithQuery } from "../src/v1/modules/playout/engine/playlist.js";
import { anon, createHarness, itemFixture, market, radioTenths, stationFixture, type Harness } from "./harness.js";

const NOW = "2026-10-01T19:00:00.000Z";
const at = (iso: string) => new Date(iso);

/** A channel list as an IPTV app reads it: the header's attributes, then each `#EXTINF` and the URL after it. */
function parseM3u(text: string) {
  const lines = text.split("\n").filter(Boolean);
  if (!lines[0].startsWith("#EXTM3U")) throw new Error("not an M3U");
  const attrsOf = (s: string) => Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const entries: Array<{ attrs: Record<string, string>; title: string; url: string }> = [];
  for (let i = 1; i < lines.length; i++) {
    const m = /^#EXTINF:(-?\d+)((?:\s+[\w-]+="[^"]*")*),(.*)$/.exec(lines[i]);
    if (!m) throw new Error(`bad line: ${lines[i]}`);
    const url = lines[++i];
    if (!url || url.startsWith("#")) throw new Error(`no URL after ${lines[i - 1]}`);
    entries.push({ attrs: attrsOf(m[2]), title: m[3], url });
  }
  return { header: attrsOf(lines[0]), entries };
}

/** The guide's programmes for a channel, each element's text (and attributes) by tag. */
function programmesOf(xml: string, channel: string) {
  return [...xml.matchAll(/<programme start="(\d{14} \+0000)" stop="(\d{14} \+0000)" channel="([^"]+)">([\s\S]*?)<\/programme>/g)]
    .filter((m) => m[3] === channel)
    .map((m) => {
      const body = m[4];
      const text = (tag: string) => [...body.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map((x) => x[1]);
      return {
        start: m[1],
        stop: m[2],
        title: text("title")[0],
        subTitle: text("sub-title")[0] ?? null,
        desc: text("desc")[0] ?? null,
        categories: text("category"),
        episodeNum: [...body.matchAll(/<episode-num system="([^"]+)">([^<]*)<\/episode-num>/g)].map((x) => `${x[1]}:${x[2]}`),
        isNew: body.includes("<new />"),
        rating: /<rating system="([^"]+)">\s*<value>([^<]+)<\/value>/.exec(body)?.slice(1, 3).join(":") ?? null
      };
    });
}

let h: Harness;
let ie: Awaited<ReturnType<typeof market>>;
let desert: Awaited<ReturnType<typeof market>>;
const ids: Record<string, string> = {};

beforeAll(async () => {
  // Where a connection is: 92373 is the Inland Empire.
  h = await createHarness({ publicBase: "https://api.opencast.test", geo: { configured: true, lookup: async (ip) => (ip === "203.0.113.9" ? { zip: "92373", point: null } : null) } });
  h.clock.set(NOW);
  ie = await market(h);
  desert = await market(h, "high-desert", "High Desert");
  await h.db.insert(schema.zipMarkets).values({ zip: "92373", marketId: ie.id });

  const onAir = async (fields: Parameters<typeof stationFixture>[1], playing = true) => {
    const s = await stationFixture(h, { signedOn: true, ...fields });
    await h.db.insert(schema.playoutState).values({ stationId: s.id, onAir: playing });
    return s.id;
  };
  ids.beat = await onAir({ callSign: "BEAT", name: "Inland Beat", marketId: ie.id, tenths: 121 });
  ids.reel = await onAir({ callSign: "REEL", name: "Reel", marketId: ie.id, tenths: 241, kind: "claimable" });
  ids.hall = await onAir({ callSign: "HALL", name: "Hall Radio", marketId: ie.id, tenths: await radioTenths(h, 3), band: "radio" });
  ids.ocat = await onAir({ callSign: "OCAT", name: "Opencast Catalog", marketId: desert.id, tenths: 21, kind: "catalog" });
  // Left out: an External station, one signed on but not playing, one still setting up. (A studio never signs on.)
  ids.ext = await onAir({ callSign: "CITY", name: "City Hall", marketId: ie.id, tenths: 41, kind: "listed" });
  ids.idle = await onAir({ callSign: "IDLE", name: "Idle", marketId: ie.id, tenths: 51 }, false);
  ids.new = (await stationFixture(h, { callSign: "SOON", name: "Soon", marketId: ie.id, tenths: 61 })).id;
  await h.db.update(schema.stations).set({ logoUrl: "/objects/beat-logo.png" }).where(eq(schema.stations.id, ids.beat));
  await h.db.update(schema.stations).set({ logoUrl: "https://cdn.example/hall.png" }).where(eq(schema.stations.id, ids.hall));

  // BEAT's log: programs with seasons and episodes, a spot on the log, a live block, a repeat.
  const [owls] = await h.db.insert(schema.programs).values({ stationId: ids.beat, title: "Night Owls", description: "Calls from the night shift.", advisory: "mature" }).returning();
  const [crate] = await h.db.insert(schema.programs).values({ stationId: ids.beat, title: "Late Crate", category: "Music", rating: "TV-14" }).returning();
  const [hall] = await h.db.insert(schema.programs).values({ stationId: ids.beat, title: "Town Hall", isLive: true }).returning();
  const [reruns] = await h.db.insert(schema.programs).values({ stationId: ids.beat, title: "Reruns" }).returning();
  const a = await itemFixture(h, ids.beat, { title: "Pilot", programId: reruns.id, episodeNumber: 3 });
  await h.db.update(schema.assets).set({ seasonNumber: 1 }).where(eq(schema.assets.id, a.id));
  const b = await itemFixture(h, ids.beat, { title: "Graveyard Shift", programId: owls.id, episodeNumber: 7 });
  const c = await itemFixture(h, ids.beat, { title: "The Steamboat", programId: crate.id, episodeNumber: 14 });
  await h.db.update(schema.assets).set({ seasonNumber: 2, partNumber: 2 }).where(eq(schema.assets.id, c.id));
  const spot = await itemFixture(h, ids.beat, { title: "Mia's Tacos", code: "SPT", durationMs: 120_000 });
  ids.itemA = a.id;
  // Pilot aired before (the as-run log): not new.
  await h.db.insert(schema.asRun).values({ stationId: ids.beat, assetId: a.id, code: "PGM", reason: "planned", startedAt: at("2026-09-20T03:00:00Z"), endedAt: at("2026-09-20T03:28:00Z") });
  const entry = (startsAt: string, endsAt: string, fields: Partial<typeof schema.logEntries.$inferInsert>) =>
    h.db.insert(schema.logEntries).values({ stationId: ids.beat, startsAt: at(startsAt), endsAt: at(endsAt), kind: "program", code: "PGM", ...fields });
  await entry("2026-10-01T16:00:00Z", "2026-10-01T16:28:00Z", { assetId: a.id, programId: reruns.id });
  await entry("2026-10-01T17:30:00Z", "2026-10-01T17:58:00Z", { assetId: a.id, programId: reruns.id });
  await entry("2026-10-01T17:58:00Z", "2026-10-01T18:00:00Z", { assetId: spot.id, code: "SPT" });
  await entry("2026-10-01T18:00:00Z", "2026-10-01T18:30:00Z", { assetId: b.id, programId: owls.id });
  const [encoder] = await h.db.insert(schema.liveSources).values({ stationId: ids.beat, kind: "encoder", name: "Studio A" }).returning();
  await entry("2026-10-01T18:32:00Z", "2026-10-01T19:30:00Z", { kind: "live", programId: hall.id, liveSourceId: encoder.id });
  await entry("2026-10-01T19:30:00Z", "2026-10-01T20:00:00Z", { assetId: b.id, programId: owls.id });
  await entry("2026-10-01T20:00:00Z", "2026-10-01T20:30:00Z", { assetId: c.id, programId: crate.id, episodeDescription: "Tonight: a steamboat & a haunted barn." });
  await entry("2026-10-09T20:00:00Z", "2026-10-09T20:30:00Z", { assetId: c.id, programId: crate.id });
  // Off air every night, 1:00 am to 6:00 am Pacific.
  await h.db.insert(schema.offAirHours).values({ stationId: ids.beat, days: [0, 1, 2, 3, 4, 5, 6], signOffAt: "01:00", backAt: "06:00" });
  // CITY (External) has a log too, never shown; REEL's is empty.
  const meeting = await itemFixture(h, ids.ext, { title: "Council meeting" });
  await h.db.insert(schema.logEntries).values({ stationId: ids.ext, startsAt: at("2026-10-01T19:00:00Z"), endsAt: at("2026-10-01T20:00:00Z"), kind: "program", code: "PGM", assetId: meeting.id });
  // Something published on BEAT's channel, so its playlists answer.
  await h.db.insert(schema.channelItems).values({ stationId: ids.beat, run: 1, seq: 1, disc: 0, startsAt: at("2026-10-01T18:00:00Z"), endsAt: at("2026-10-01T20:00:00Z"), kind: "prepared", code: "PGM", label: "Night Owls", reason: "planned" });
}, 120_000);
afterAll(() => h?.close());

/** The channel list's text (superagent doesn't read audio/x-mpegurl as text by itself). */
const channelList = (path: string) =>
  anon(h)
    .get(path)
    .buffer(true)
    .parse((res, done) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (text += c));
      res.on("end", () => done(null, text));
    });

describe("GET /v1/iptv/channels.m3u", () => {
  it("lists every Opencast station on the air, not External stations or ones off the dial", async () => {
    const res = await channelList("/v1/iptv/channels.m3u").expect(200);
    expect(res.headers["content-type"]).toMatch(/^audio\/x-mpegurl/);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
    const list = parseM3u(res.body);
    expect(list.header["url-tvg"]).toBe("https://api.opencast.test/v1/iptv/xmltv.xml");
    // High Desert first (by market name), then the Inland Empire: TV in channel order, then radio.
    expect(list.entries.map((e) => e.attrs["tvg-name"])).toEqual(["OCAT", "BEAT", "REEL", "HALL"]);
  });

  it("gives each entry its id, number, call sign, mark, market, and the band", async () => {
    const { entries } = parseM3u((await channelList("/v1/iptv/channels.m3u").expect(200)).body);
    const beat = entries.find((e) => e.attrs["tvg-name"] === "BEAT")!;
    expect(beat.attrs).toEqual({
      "tvg-id": `${ids.beat}.opencast`,
      "tvg-chno": "12.1",
      "tvg-name": "BEAT",
      "tvg-logo": "https://api.opencast.test/objects/beat-logo.png",
      "group-title": "Inland Empire"
    });
    expect(beat.title).toBe("BEAT · Inland Beat");
    expect(beat.url).toBe(`https://api.opencast.test/hls/${ids.beat}/master.m3u8?via=iptv`);
    const hall = entries.find((e) => e.attrs["tvg-name"] === "HALL")!;
    expect(hall.attrs).toMatchObject({ radio: "true", "tvg-logo": "https://cdn.example/hall.png" });
    // No mark: no tvg-logo (the app shows the name).
    expect(entries.find((e) => e.attrs["tvg-name"] === "REEL")!.attrs["tvg-logo"]).toBeUndefined();
  });

  it("filters by market and band", async () => {
    const names = async (q: string) => parseM3u((await channelList(`/v1/iptv/channels.m3u?${q}`).expect(200)).body).entries.map((e) => e.attrs["tvg-name"]);
    expect(await names("market=high-desert")).toEqual(["OCAT"]);
    expect(await names("band=radio")).toEqual(["HALL"]);
    expect(await names("market=inland-empire&band=tv")).toEqual(["BEAT", "REEL"]);
    const filtered = parseM3u((await channelList("/v1/iptv/channels.m3u?market=high-desert").expect(200)).body);
    expect(filtered.header["url-tvg"]).toBe("https://api.opencast.test/v1/iptv/xmltv.xml?market=high-desert");
    await anon(h).get("/v1/iptv/channels.m3u?market=nowhere").expect(404);
    await anon(h).get("/v1/iptv/channels.m3u?band=am").expect(400);
  });

  it("answers an unchanged list with a 304", async () => {
    const first = await anon(h).get("/v1/iptv/channels.m3u").expect(200);
    expect(first.headers.etag).toMatch(/^"[0-9a-f]{32}"$/);
    await anon(h).get("/v1/iptv/channels.m3u").set("if-none-match", first.headers.etag).expect(304);
    await anon(h).get("/v1/iptv/channels.m3u").set("if-none-match", `W/${first.headers.etag}`).expect(304);
    await anon(h).get("/v1/iptv/channels.m3u").set("if-none-match", '"something-else"').expect(200);
  });

  it("writes attribute values on one line, without quotes", () => {
    const text = writeM3u(
      [{ tvgId: "x.opencast", number: "3.1", callSign: "QUOT", name: 'The "Best"\nStation', band: "tv", market: { slug: "m", name: "M", timezone: "UTC" }, logo: null, stream: "https://a/hls/x/master.m3u8?via=iptv" }],
      "https://a/v1/iptv/xmltv.xml"
    );
    const { entries } = parseM3u(text);
    expect(entries[0].title).toBe(`QUOT · The "Best" Station`);
  });
});

describe("GET /v1/iptv/xmltv.xml", () => {
  let xml: string;
  beforeAll(async () => {
    xml = (await anon(h).get("/v1/iptv/xmltv.xml").expect(200)).text;
  });

  it("lists the same channels, with call sign, number and name, and icons", () => {
    expect(xml.startsWith(`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE tv SYSTEM "xmltv.dtd">\n<tv `)).toBe(true);
    const channels = [...xml.matchAll(/<channel id="([^"]+)">([\s\S]*?)<\/channel>/g)].map((m) => ({ id: m[1], names: [...m[2].matchAll(/<display-name lang="en">([^<]+)</g)].map((x) => x[1]), icon: /<icon src="([^"]+)"/.exec(m[2])?.[1] ?? null }));
    expect(channels.map((c) => c.id)).toEqual([ids.ocat, ids.beat, ids.reel, ids.hall].map((id) => `${id}.opencast`));
    expect(channels[1]).toEqual({ id: `${ids.beat}.opencast`, names: ["BEAT", "12.1", "Inland Beat"], icon: "https://api.opencast.test/objects/beat-logo.png" });
    expect(xml).not.toContain(ids.ext);
    expect(xml).not.toContain(ids.idle);
  });

  it("covers two hours back to seven days ahead, with breaks folded into the program around them", () => {
    const p = programmesOf(xml, `${ids.beat}.opencast`);
    expect(p.map((x) => [x.start.slice(0, 12), x.stop.slice(0, 12), x.title])).toEqual([
      // The 16:00 airing ended before the window; the spot at 17:58 is Reruns' break; the 2-minute gap before Town Hall too.
      ["202610011730", "202610011800", "Reruns"],
      ["202610011800", "202610011832", "Night Owls"],
      ["202610011832", "202610011930", "Town Hall"],
      ["202610011930", "202610012000", "Night Owls"],
      ["202610012000", "202610012030", "Late Crate"],
      // Planned off air, every night of the week ahead (the 9th's Late Crate is past seven days).
      ...["02", "03", "04", "05", "06", "07", "08"].map((d) => [`202610${d}0800`, `202610${d}1300`, "Off air"])
    ]);
    expect(p.find((x) => x.title === "Mia's Tacos")).toBeUndefined();
  });

  it("gives each programme its episode, description, category, episode number, rating, live and new", () => {
    const [reruns, owls, town, owlsAgain, crate, off] = programmesOf(xml, `${ids.beat}.opencast`);
    // Season and episode known: xmltv_ns, zero-based (season 1, episode 3). Aired before: not new.
    expect(reruns).toMatchObject({ subTitle: "Pilot", episodeNum: ["xmltv_ns:0.2."], isNew: false, rating: null, categories: [] });
    // Episode only: onscreen. The program's description; its advisory as the rating. Its first airing: new.
    expect(owls).toMatchObject({ subTitle: "Graveyard Shift", desc: "Calls from the night shift.", episodeNum: ["onscreen:Episode 7"], isNew: true, rating: "advisory:Mature" });
    // The repeat later the same evening isn't new.
    expect(owlsAgain).toMatchObject({ isNew: false });
    // A live block: the category Live (xmltv.dtd has no <live/>), never new.
    expect(town).toMatchObject({ categories: ["Live"], episodeNum: [], isNew: false, subTitle: null });
    // Season 2, episode 14, part 2; the airing's own description, escaped; the category and TV rating.
    expect(crate).toMatchObject({ subTitle: "The Steamboat", desc: "Tonight: a steamboat &amp; a haunted barn.", categories: ["Music"], episodeNum: ["xmltv_ns:1.13.1"], rating: "VCHIP:TV-14", isNew: true });
    expect(off).toMatchObject({ title: "Off air", desc: "Back at 6:00 am.", categories: [], isNew: false });
  });

  it("filters like the channel list", async () => {
    const radio = (await anon(h).get("/v1/iptv/xmltv.xml?band=radio").expect(200)).text;
    expect([...radio.matchAll(/<channel id="([^"]+)"/g)].map((m) => m[1])).toEqual([`${ids.hall}.opencast`]);
    await anon(h).get("/v1/iptv/xmltv.xml?market=nowhere").expect(404);
  });

  it("is gzipped for apps that take it, and as .xml.gz", async () => {
    const plain = await anon(h).get("/v1/iptv/xmltv.xml").set("accept-encoding", "identity").expect(200);
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(plain.headers.vary).toBe("Accept-Encoding");
    const zipped = await anon(h).get("/v1/iptv/xmltv.xml").set("accept-encoding", "gzip").buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => done(null, Buffer.concat(chunks)));
    });
    expect(zipped.headers["content-encoding"]).toBe("gzip");
    // superagent unzips a gzip encoding as it reads: the text is the guide either way.
    expect(String(zipped.body)).toBe(plain.text);
    const file = await anon(h)
      .get("/v1/iptv/xmltv.xml.gz")
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(file.headers["content-type"]).toBe("application/gzip");
    expect(file.headers["content-encoding"]).toBeUndefined();
    expect(gunzipSync(file.body as Buffer).toString()).toBe(plain.text);
    expect(file.headers.etag).toBe(plain.headers.etag.replace(/"$/, '-gz"'));
  });

  it("uses an ETag, and is built again after a minute", async () => {
    const first = await anon(h).get("/v1/iptv/xmltv.xml").expect(200);
    await anon(h).get("/v1/iptv/xmltv.xml").set("if-none-match", first.headers.etag).expect(304);
    await anon(h).get("/v1/iptv/xmltv.xml.gz").set("if-none-match", first.headers.etag.replace(/"$/, '-gz"')).expect(304);
    // A change to the log shows once the minute is up.
    await h.db.update(schema.programs).set({ title: "Late Crate Live" }).where(eq(schema.programs.title, "Late Crate"));
    expect((await anon(h).get("/v1/iptv/xmltv.xml").expect(200)).headers.etag).toBe(first.headers.etag);
    h.clock.advance(61_000);
    try {
      const after = await anon(h).get("/v1/iptv/xmltv.xml").set("if-none-match", first.headers.etag).expect(200);
      expect(after.headers.etag).not.toBe(first.headers.etag);
      expect(after.text).toContain("<title lang=\"en\">Late Crate Live</title>");
    } finally {
      await h.db.update(schema.programs).set({ title: "Late Crate" }).where(eq(schema.programs.title, "Late Crate Live"));
      h.clock.set(NOW);
    }
  });

  it("folds breaks: short gaps and a break's own entries join the programme before, never off air", () => {
    const row = (s: string, e: string, fold = false, offAir = false) => ({ start: at(`2026-10-01T${s}:00Z`), stop: at(`2026-10-01T${e}:00Z`), fold, offAir, id: `${s}` });
    const out = foldBreaks([row("10:00", "10:28"), row("10:28", "10:30", true), row("10:31", "11:00"), row("11:00", "11:30", false, true), row("11:30", "11:31", true), row("11:31", "12:00")]);
    expect(out.map((r) => [r.start.toISOString().slice(11, 16), r.stop.toISOString().slice(11, 16)])).toEqual([
      ["10:00", "10:31"],
      ["10:31", "11:00"],
      ["11:00", "11:30"],
      // After off air, a break's entry joins the programme after it.
      ["11:30", "12:00"]
    ]);
  });
});

describe("Other apps: via=iptv playlist polls", () => {
  const poll = async (stationId: string, file: string, client: { ip: string | null; ua: string }, via: string | null = "iptv") => {
    let counted: Promise<void> | undefined;
    const value = await h.services.playout.playlist(stationId, file, { via, ip: client.ip, userAgent: client.ua, counted: (p) => void (counted = p) });
    await counted;
    return value;
  };
  const tivimate = { ip: "203.0.113.9", ua: "TiviMate/5.1.6 (Android 12)" };
  const vlc = { ip: "198.51.100.20", ua: "VLC/3.0.21 LibVLC/3.0.21" };

  it("hands via=iptv on to the renditions in the master", async () => {
    const master = await poll(ids.beat, "master.m3u8", { ip: null, ua: "x" });
    const lines = master!.body.split("\n");
    const variants = lines.filter((l) => l && !l.startsWith("#"));
    expect(variants.length).toBeGreaterThan(0);
    expect(variants.every((l) => /^[a-z0-9]+\.m3u8\?via=iptv$/.test(l))).toBe(true);
    expect(lines.find((l) => l.startsWith("#EXT-X-MEDIA:TYPE=SUBTITLES"))).toContain('URI="subs.m3u8?via=iptv"');
    // Without it, the master is as before.
    const plain = await h.services.playout.playlist(ids.beat, "master.m3u8");
    expect(plain!.body).not.toContain("via=iptv");
    expect(masterWithQuery(plain!.body, "via=iptv")).toBe(master!.body);
  });

  // A rendition's playlist counts the same way as the master (any `.m3u8` with via=iptv); this
  // channel has nothing prepared, so only its master answers here, and the polls are the master's.
  it("counts a run of polls as one session, by station and market, once it spans a minute", async () => {
    await poll(ids.beat, "master.m3u8", tivimate);
    for (let i = 0; i < 20; i++) {
      h.clock.advance(4_000);
      await poll(ids.beat, "master.m3u8", tivimate);
    }
    // VLC for 30 seconds: polled, not yet a session that counts.
    await poll(ids.beat, "master.m3u8", vlc);
    h.clock.advance(30_000);
    await poll(ids.beat, "master.m3u8", vlc);
    // A player without via=iptv (Opencast's own) isn't counted here at all.
    await poll(ids.beat, "master.m3u8", { ip: "192.0.2.1", ua: "Safari" }, null);

    const rows = await h.db.select().from(schema.otherAppSessions);
    expect(rows).toHaveLength(2);
    const tm = rows.find((r) => r.marketId === ie.id)!;
    expect(tm.stationId).toBe(ids.beat);
    expect(tm.lastPollAt.getTime() - tm.startedAt.getTime()).toBeGreaterThanOrEqual(60_000);
    // The address is never kept: a hash of it with the day.
    expect(tm.clientKey).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(rows)).not.toContain("203.0.113.9");

    const counts = await h.services.audience.otherApps.counts(at("2026-10-01T18:00:00Z"), at("2026-10-01T20:00:00Z"));
    expect(counts).toHaveLength(1);
    expect(counts[0]).toMatchObject({ stationId: ids.beat, marketId: ie.id, sessions: 1 });
    expect(counts[0].minutes).toBeGreaterThan(1);

    const report = await h.services.audience.report(ids.beat, at("2026-10-01T18:00:00Z"), at("2026-10-01T20:00:00Z"));
    expect(report.otherApps).toMatchObject({ tunedInNow: 1, sessions: 1, byMarket: [{ market: { slug: "inland-empire" }, sessions: 1 }] });
  });

  it("is never counted toward the tuned-in numbers billing reads", async () => {
    const from = at("2026-10-01T18:00:00Z");
    const to = at("2026-10-01T20:00:00Z");
    const [samples] = await h.db.select({ n: sql<number>`count(*)::int` }).from(schema.minuteSamples);
    const [places] = await h.db.select({ n: sql<number>`count(*)::int` }).from(schema.minuteMarkets);
    expect([samples.n, places.n]).toEqual([0, 0]);
    expect(await h.services.audience.averageTunedIn(ids.beat, from, to)).toBe(0);
    expect(await h.services.audience.placedTunedIn(ids.beat, from, to, [ie.id])).toBe(0);
    expect((await h.services.audience.watchMinutes(from, to)).get(ids.beat) ?? 0).toBe(0);
    const report = await h.services.audience.report(ids.beat, from, to);
    expect([report.tunedInNow, report.hoursWatched, report.series.length]).toEqual([0, 0, 0]);
  });

  it("starts a new session after two minutes without a poll", async () => {
    h.clock.advance(3 * 60_000);
    for (let i = 0; i < 18; i++) {
      await poll(ids.beat, "master.m3u8", tivimate);
      h.clock.advance(4_000);
    }
    const mine = (await h.db.select().from(schema.otherAppSessions)).filter((r) => r.marketId === ie.id);
    expect(mine).toHaveLength(2);
    const counts = await h.services.audience.otherApps.counts(at("2026-10-01T18:00:00Z"), at("2026-10-01T20:00:00Z"), [ids.beat]);
    expect(counts.find((c) => c.marketId === ie.id)?.sessions).toBe(2);
  });

  it("shows on the desk's overview, apart from the totals", async () => {
    const admin = await h.signIn("Kai", { admin: true });
    const res = await admin.get("/v1/desk/analytics/overview").query({ from: "2026-10-01T07:00:00.000Z", to: "2026-10-02T07:00:00.000Z" });
    expect(res.status).toBe(200);
    expect(res.body.otherApps).toEqual([
      expect.objectContaining({ station: expect.objectContaining({ callSign: "BEAT" }), market: expect.objectContaining({ slug: "inland-empire" }), sessions: 2 })
    ]);
    expect(res.body.hoursWatched.value).toBe(0);
  });

  it("forgets where a session came from a day after it", async () => {
    h.clock.advance(2 * 86_400_000);
    try {
      await h.services.audience.watch.purge();
      const rows = await h.db.select().from(schema.otherAppSessions);
      expect(rows.length).toBe(3);
      expect(rows.every((r) => r.clientKey === null)).toBe(true);
    } finally {
      h.clock.set(NOW);
    }
  });
});
