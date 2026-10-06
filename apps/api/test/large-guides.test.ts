// A249 (2026-10-06, the user's choice: "large guide files"): XMLTV guides read as they download,
// gzipped or not, for the station's channel only; limits on size, airings and time; "changed
// since?" so an unchanged guide isn't downloaded again; one download and one pass for every station
// on a guide; and "Find this channel's guide" from iptv-org's public lists. Every guide and list
// here is made up; no network: every fetch is a fake, and the clock is pinned.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { asc, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { readScheduleAt, type Fetch } from "../src/v1/modules/network/external.js";
import { parseSchedule } from "../src/v1/lib/schedules.js";
import { GUIDE_CAPS, XmltvScanner } from "../src/v1/lib/guideStream.js";
import { fetchableGuide, jsonArrayItems } from "../src/v1/lib/guideFinder.js";
import { createHarness, market, type Harness, type User } from "./harness.js";

const ANIME = "5f00000000000000000a0001";
const COOK = "5f00000000000000000a0002";
const DRAMA = "5f00000000000000000a0003";
const at = (iso: string) => iso.replace(/[-:T]/g, "").slice(0, 14);
const prog = (channel: string, start: string, stop: string, title: string) =>
  `<programme channel="${channel}" start="${at(start)} +0000" stop="${at(stop)} +0000"><title lang="en">${title}</title><sub-title>An episode</sub-title><episode-num system="onscreen">S01E08</episode-num></programme>\n`;
const guide = (channels: Array<[string, string]>, programmes: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE tv SYSTEM "xmltv.dtd">\n<tv generator-info-name="made-up">\n${channels.map(([id, name]) => `<channel id="${id}"><display-name>${name}</display-name><icon src="https://img.example/${id}.png"/></channel>\n`).join("")}${programmes.join("")}</tv>\n`;
const CHANNELS: Array<[string, string]> = [
  [ANIME, "Anime Corner"],
  [COOK, "Cooking Now"],
  [DRAMA, "Retro Drama"]
];
/** Tuesday, October 6, 10:00 am Pacific. */
const NOW = new Date("2026-10-06T17:00:00.000Z");
const PLATFORM = guide(CHANNELS, [
  prog(ANIME, "2026-10-06T16:00:00Z", "2026-10-06T16:30:00Z", "Over Already"),
  prog(ANIME, "2026-10-06T16:30:00Z", "2026-10-06T17:30:00Z", "Golden Hour"),
  prog(ANIME, "2026-10-06T17:30:00Z", "2026-10-06T18:00:00Z", "Demon Girl &amp; Friends"),
  prog(COOK, "2026-10-06T17:00:00Z", "2026-10-06T18:00:00Z", "Kitchen Rescue"),
  prog(DRAMA, "2026-10-06T17:00:00Z", "2026-10-06T19:00:00Z", "Old Western"),
  prog(ANIME, "2026-10-06T18:00:00Z", "2026-10-06T18:30:00Z", "Space Rangers")
]);
const titles = (events: Array<{ summary: string; start: Date; end: Date | null }>) => events.map((e) => [e.summary, e.start.toISOString(), e.end?.toISOString() ?? null]);

/** A body that arrives in small pieces, so every element is split somewhere. */
const pieces = (bytes: Uint8Array, size = 97) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += size) c.enqueue(bytes.slice(i, i + size));
      c.close();
    }
  });
const gz = (text: string) => new Uint8Array(gzipSync(Buffer.from(text)));

interface Route {
  body: () => Uint8Array | string;
  type?: string;
  etag?: string;
}
/** A fake network: each address's answer, the calls made, and "not changed" for a matching If-None-Match. */
function network(routes: Record<string, Route>) {
  const calls: Array<{ url: string; ifNoneMatch: string | null }> = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, ifNoneMatch: headers.get("if-none-match") });
    const r = routes[url];
    if (!r) throw new TypeError("fetch failed");
    if (r.etag && headers.get("if-none-match") === r.etag) return new Response(null, { status: 304, headers: { etag: r.etag } });
    const body = r.body();
    return new Response(pieces(typeof body === "string" ? new TextEncoder().encode(body) : body), { headers: { "content-type": r.type ?? "application/octet-stream", ...(r.etag ? { etag: r.etag } : {}) } });
  }) as Fetch;
  const count = (url: string) => calls.filter((c) => c.url === url).length;
  return { fn, calls, count, routes };
}

/** GUIDE_CAPS lowered for one test. */
async function withCaps<T>(caps: Partial<typeof GUIDE_CAPS>, work: () => Promise<T>): Promise<T> {
  const was = { ...GUIDE_CAPS };
  Object.assign(GUIDE_CAPS, caps);
  try {
    return await work();
  } finally {
    Object.assign(GUIDE_CAPS, was);
  }
}

describe("a guide read as it downloads (lib/guideStream.ts)", () => {
  const GZ = "https://guides.example.org/Platform/us.xml.gz";
  const net = network({ [GZ]: { body: () => gz(PLATFORM) } });
  const read = (url: string, hints = {}) => readScheduleAt(url, null, net.fn, hints, "UTC", NOW);

  it("unzips a gzipped guide of several channels and keeps only the channel named, from now on", async () => {
    const answer = await read(`${GZ}#channel=${ANIME}`);
    expect(answer.format).toBe("xmltv");
    if (answer.format !== "xmltv") return;
    expect(titles(answer.events)).toEqual([
      ["Golden Hour", "2026-10-06T16:30:00.000Z", "2026-10-06T17:30:00.000Z"],
      ["Demon Girl & Friends", "2026-10-06T17:30:00.000Z", "2026-10-06T18:00:00.000Z"],
      ["Space Rangers", "2026-10-06T18:00:00.000Z", "2026-10-06T18:30:00.000Z"]
    ]);
    expect(answer.events[0]!.uid).toBe(`${ANIME}@20261006163000 +0000`);
    expect(answer.guide).toMatchObject({ url: GZ, gzip: true, channels: 3, channel: ANIME, channelName: "Anime Corner", programmes: 3, bytes: PLATFORM.length, large: true, limit: null });
    // The fragment isn't part of what's fetched.
    expect(net.calls.at(-1)!.url).toBe(GZ);
  });

  it("reads a file named .gz that isn't gzipped as it is", async () => {
    const PLAIN = "https://guides.example.org/plain/us.xml.gz";
    const plain = network({ [PLAIN]: { body: () => PLATFORM, type: "application/gzip" } });
    const answer = await readScheduleAt(`${PLAIN}#channel=${COOK}`, null, plain.fn, {}, "UTC", NOW);
    expect(answer.format === "xmltv" && titles(answer.events)).toEqual([["Kitchen Rescue", "2026-10-06T17:00:00.000Z", "2026-10-06T18:00:00.000Z"]]);
    expect(answer.format === "xmltv" && answer.guide).toMatchObject({ gzip: false, large: false });
  });

  it("takes Plex's channel by the second half of its id (the files' first half changes), an exact id first", () => {
    const PLEX = "5ef11486d33ab9004048a1cd";
    const text = guide(
      [
        [`6a1610bebdf296985fd95603-${PLEX}`, "Anime Corner"],
        ["6a1610bebdf296985fd95603-5ef11486d33ab9004048ffff", "Cooking Now"]
      ],
      [prog(`6a1610bebdf296985fd95603-${PLEX}`, "2026-10-06T18:00:00Z", "2026-10-06T18:30:00Z", "Plex Anime"), prog("6a1610bebdf296985fd95603-5ef11486d33ab9004048ffff", "2026-10-06T18:00:00Z", "2026-10-06T18:30:00Z", "Plex Cooking")]
    );
    expect(parseSchedule(text, "xmltv", `${GZ}#channel=${PLEX}`).map((e) => e.summary)).toEqual(["Plex Anime"]);
    const both = guide(
      [
        [`abc-${PLEX}`, "Suffixed"],
        [PLEX, "Exact"]
      ],
      [prog(`abc-${PLEX}`, "2026-10-06T18:00:00Z", "2026-10-06T18:30:00Z", "By its suffix"), prog(PLEX, "2026-10-06T18:00:00Z", "2026-10-06T18:30:00Z", "By its id")]
    );
    expect(parseSchedule(both, "xmltv", `${GZ}#channel=${PLEX}`).map((e) => e.summary)).toEqual(["By its id"]);
  });

  it("without a channel: one channel's guide whole; several, the one the listing's name or stream folder names exactly; else refused, with how many", async () => {
    const one = guide([[ANIME, "Anime Corner"]], [prog(ANIME, "2026-10-06T18:00:00Z", "2026-10-06T18:30:00Z", "Space Rangers")]);
    expect(parseSchedule(one, "xmltv", GZ, "UTC", { name: "Anything" }).map((e) => e.summary)).toEqual(["Space Rangers"]);
    expect(parseSchedule(PLATFORM, "xmltv", GZ, "UTC", { name: "Cooking Now TV" }).map((e) => e.summary)).toEqual(["Kitchen Rescue"]);
    expect(parseSchedule(PLATFORM, "xmltv", GZ, "UTC", { name: "Something", streamUrl: "https://cdn.example.org/retro-drama/index.m3u8" }).map((e) => e.summary)).toEqual(["Old Western"]);
    // "Anime" alone isn't "Anime Corner": nothing guessed, nothing mixed.
    expect(parseSchedule(PLATFORM, "xmltv", GZ, "UTC", { name: "Anime" })).toEqual([]);
    await expect(read(GZ, { name: "Anime" })).rejects.toMatchObject({ code: "pick_channel", message: expect.stringContaining("This guide has 3 channels. Pick one"), guide: { channels: 3, channel: null } });
    // Two channels of the same name: which is it? Refused too.
    const twice = guide(
      [
        [ANIME, "Anime Corner"],
        [COOK, "Anime Corner"]
      ],
      []
    );
    expect(parseSchedule(twice, "xmltv", GZ, "UTC", { name: "Anime Corner" })).toEqual([]);
  });

  it("says when the channel named isn't in the guide", async () => {
    await expect(read(`${GZ}#channel=USBC1500009LD`)).rejects.toMatchObject({ code: "not_in_guide", message: expect.stringContaining("Channel USBC1500009LD isn't in this guide right now (it lists 3 channels)") });
  });

  it("stops at a limit, and says which: its size unzipped, as it comes, airings for a channel", async () => {
    await withCaps({ bytes: 600 }, async () => {
      await expect(read(`${GZ}#channel=${ANIME}`)).rejects.toMatchObject({ code: "too_big", message: expect.stringContaining("unzipped"), guide: { limit: "bytes", gzip: true } });
    });
    await withCaps({ compressedBytes: 200 }, async () => {
      await expect(read(`${GZ}#channel=${ANIME}`)).rejects.toMatchObject({ code: "too_big", guide: { limit: "compressed" } });
    });
    await withCaps({ programmes: 2 }, async () => {
      await expect(read(`${GZ}#channel=${ANIME}`)).rejects.toMatchObject({ code: "too_big", message: expect.stringContaining("airings to come"), guide: { limit: "programmes" } });
      // Another channel with fewer is read.
      expect((await read(`${GZ}#channel=${COOK}`)).format).toBe("xmltv");
    });
  });

  it("keeps several channels in one pass, and lists a guide's channels without reading its airings", () => {
    const scanner = new XmltvScanner([
      { fragment: ANIME, hints: {} },
      { fragment: null, hints: { name: "Retro Drama" } }
    ]);
    for (let i = 0; i < PLATFORM.length; i += 50) scanner.push(PLATFORM.slice(i, i + 50));
    const scan = scanner.end();
    expect(scan.wants.map((w) => [w.channel, w.events.length, w.problem])).toEqual([
      [ANIME, 4, null],
      [DRAMA, 1, null]
    ]);
    const channelsOnly = new XmltvScanner([], { channelsOnly: true });
    channelsOnly.push(PLATFORM);
    expect(channelsOnly.done).toBe(true);
    expect(channelsOnly.end().channels.map((c) => [c.id, c.names])).toEqual(CHANNELS.map(([id, name]) => [id, [name]]));
  });

  it("reads a small guide without a channel list as before: by the channel its programmes name", () => {
    const xmltv = `<tv><programme start="20260926200000 -0700" stop="20260926210000 -0700" channel="NASA.us"><title lang="en">Launch coverage</title></programme></tv>`;
    expect(parseSchedule(xmltv, "xmltv", "https://epg.example.org/guide.xml#channel=NASA.us").map((e) => e.summary)).toEqual(["Launch coverage"]);
    expect(parseSchedule(xmltv, "xmltv", "https://epg.example.org/guide.xml").map((e) => e.summary)).toEqual(["Launch coverage"]);
    expect(parseSchedule(xmltv, "xmltv", "https://epg.example.org/guide.xml#channel=Other.us")).toEqual([]);
  });
});

describe("iptv-org's lists, as they download (lib/guideFinder.ts)", () => {
  it("cuts a JSON array into its items, whatever the pieces", async () => {
    const text = JSON.stringify([{ id: "A.us", name: "A \"quoted\" {brace}", alt_names: ["[x]"] }, { id: "B.us", name: "B", alt_names: [] }]);
    async function* chunks() {
      for (let i = 0; i < text.length; i += 7) yield text.slice(i, i + 7);
    }
    const items: unknown[] = [];
    for await (const v of jsonArrayItems(chunks())) items.push(v);
    expect(items).toEqual(JSON.parse(text));
  });

  it("builds i.mjh.nz's and nzxmltv.com's addresses from a site's id, and nothing for sites that need their pages read", () => {
    expect(fetchableGuide({ site: "i.mjh.nz", siteId: "PlutoTV/us#6793eaa4bc03978b9bc63db1" })).toEqual({ label: "Pluto TV (US)", via: "i.mjh.nz", file: "https://i.mjh.nz/PlutoTV/us.xml.gz", channel: "6793eaa4bc03978b9bc63db1" });
    expect(fetchableGuide({ site: "i.mjh.nz", siteId: "Plex/us#5e20b730f2f8d5003d739db7-63dea56a2a2abb171ff6dadf" })).toMatchObject({ label: "Plex (US)", file: "https://i.mjh.nz/Plex/us.xml.gz", channel: "63dea56a2a2abb171ff6dadf" });
    expect(fetchableGuide({ site: "i.mjh.nz", siteId: "Roku/all#abc" })).toMatchObject({ label: "Roku", file: "https://i.mjh.nz/Roku/all.xml.gz" });
    expect(fetchableGuide({ site: "i.mjh.nz", siteId: "SamsungTVPlus/us#US15000032I" })).toMatchObject({ label: "Samsung TV Plus (US)" });
    expect(fetchableGuide({ site: "i.mjh.nz", siteId: "au/Adelaide/epg#mjh-7flix" })).toMatchObject({ label: "Australian free-to-air (Adelaide)", file: "https://i.mjh.nz/au/Adelaide/epg.xml.gz" });
    expect(fetchableGuide({ site: "nzxmltv.com", siteId: "xmltv/guide#1" })).toEqual({ label: "Freeview NZ", via: "nzxmltv.com", file: "https://nzxmltv.com/xmltv/guide.xml", channel: "1" });
    // Its IPTV files reuse ids; other sites need their pages read; nothing odd in a path is fetched.
    expect(fetchableGuide({ site: "nzxmltv.com", siteId: "iptv/plutotv#0" })).toBeNull();
    expect(fetchableGuide({ site: "pluto.tv", siteId: "6793eaa4bc03978b9bc63db1" })).toBeNull();
    expect(fetchableGuide({ site: "epgshare01.online", siteId: "PLEX1#plex.tv.ANIME" })).toBeNull();
    expect(fetchableGuide({ site: "i.mjh.nz", siteId: "../secrets#x" })).toBeNull();
    expect(fetchableGuide({ site: "i.mjh.nz", siteId: "Unknown/us#x" })).toBeNull();
  });
});

describe("on the desk, with a fake network", () => {
  let h: Harness;
  let dee: User;
  let marketId: string;
  const ids: Record<string, string> = {};
  const GZ = "https://i.mjh.nz/PlutoTV/us.xml.gz";
  const SMALL = "https://guides.example.org/small.xml";
  const PLEX = "https://i.mjh.nz/Plex/us.xml.gz";
  const SAMSUNG = "https://i.mjh.nz/SamsungTVPlus/us.xml.gz";
  const NZ = "https://nzxmltv.com/xmltv/guide.xml";
  const PLEX_ID = "63dea56a2a2abb171ff6dadf";
  // The platform's guide, with shows later in the day too.
  const DESK_PLATFORM = PLATFORM.replace(
    "</tv>",
    [prog(ANIME, "2026-10-06T20:00:00Z", "2026-10-06T21:00:00Z", "Night Patrol"), prog(COOK, "2026-10-06T20:00:00Z", "2026-10-06T21:00:00Z", "Late Cooking"), prog(DRAMA, "2026-10-06T20:00:00Z", "2026-10-06T22:00:00Z", "Late Western")].join("") + "</tv>"
  );
  let platform = DESK_PLATFORM;
  let etag = '"v1"';
  let listsUp = true;
  let day = "2026-10-06";
  const lists = {
    channels: [
      { id: "AnimeCorner.us", name: "Anime Corner", alt_names: [], network: null, country: "US" },
      { id: "CookingNow.nz", name: "Cooking Now", alt_names: ["Kitchen Now"], country: "NZ" },
      { id: "OnlyScraped.us", name: "Only Scraped", alt_names: [], country: "US" },
      { id: "Unrelated.us", name: "Anime Corner Kids", alt_names: [], country: "US" }
    ],
    guides: [
      { channel: "AnimeCorner.us", feed: "SD", site: "i.mjh.nz", site_id: `PlutoTV/us#${ANIME}`, site_name: "ANIME CORNER", lang: "en", sources: [] },
      { channel: "AnimeCorner.us", feed: "SD", site: "i.mjh.nz", site_id: `Plex/us#5e20b730f2f8d5003d739db7-${PLEX_ID}`, site_name: "ANIME CORNER", lang: "en", sources: [] },
      // Out of date: the file doesn't have it now.
      { channel: null, feed: null, site: "i.mjh.nz", site_id: "SamsungTVPlus/us#USBC1500009LD", site_name: "Anime Corner", lang: "en", sources: [] },
      { channel: "AnimeCorner.us", feed: "SD", site: "pluto.tv", site_id: ANIME, site_name: "ANIME CORNER", lang: "en", sources: [] },
      { channel: "CookingNow.nz", feed: "SD", site: "nzxmltv.com", site_id: "xmltv/guide#7", site_name: "Cooking Now", lang: "en", sources: [] },
      { channel: "OnlyScraped.us", feed: "SD", site: "tvpassport.com", site_id: "only-scraped", site_name: "Only Scraped", lang: "en", sources: [] }
    ]
  };
  const net = network({
    [GZ]: { body: () => gz(platform), get etag() {
      return etag;
    } } as Route,
    [SMALL]: { body: () => guide([[ANIME, "Anime Corner"]], [prog(ANIME, `${day}T17:00:00Z`, `${day}T17:20:00Z`, "Short One")]), type: "text/xml" },
    [PLEX]: { body: () => gz(guide([[`6a1610bebdf296985fd95603-${PLEX_ID}`, "ANIME CORNER"]], [prog(`6a1610bebdf296985fd95603-${PLEX_ID}`, `${day}T18:00:00Z`, `${day}T18:30:00Z`, "Plex Anime")])) },
    [SAMSUNG]: { body: () => gz(guide([["US1500000AA", "Something"]], [])) },
    [NZ]: { body: () => guide([["7", "Cooking Now"]], [prog("7", `${day}T18:00:00Z`, `${day}T19:00:00Z`, "Hangi Hour")]), type: "text/xml" },
    "https://iptv-org.github.io/api/channels.json": { body: () => (listsUp ? JSON.stringify(lists.channels) : "oops"), type: "application/json" },
    "https://iptv-org.github.io/api/guides.json": { body: () => JSON.stringify(lists.guides), type: "application/json" }
  });
  const airings = async (id: string) =>
    (await h.db.select().from(schema.listedAirings).where(eq(schema.listedAirings.listedSourceId, id)).orderBy(asc(schema.listedAirings.startsAt))).map((a) => [a.title, a.startsAt.toISOString()]);
  const listing = async (id: string) => (await dee.get(`/v1/admin/listed-sources?marketId=${marketId}`).expect(200)).body.find((s: { id: string }) => s.id === id);
  const listIt = async (channel: string, callSign: string, name: string, calendarUrl: string) => {
    const id = (
      await dee
        .post("/v1/admin/listed-sources", { marketId, band: "tv", channel, callSign, name, streamUrl: `https://fast.example.org/${callSign.toLowerCase()}/index.m3u8`, plays: "stream_link", evidence: { publicBasis: "A free channel's public stream" } })
        .expect(201)
    ).body.id as string;
    await h.services.network.updateListedSource(null, id, { schedule: { source: "feed", calendarUrl } }, net.fn);
    return id;
  };
  const pass = async (iso: string, url = GZ) => {
    h.clock.set(iso);
    const before = net.count(url);
    await h.services.network.syncExternalSchedules({ fetch: net.fn });
    return net.count(url) - before;
  };

  beforeAll(async () => {
    h = await createHarness({ externalFetch: net.fn });
    h.clock.set(NOW.toISOString());
    dee = await h.signIn("Dee A.", { admin: true });
    marketId = (await market(h)).id;
  }, 60_000);
  afterAll(() => h.close());

  it("lists each station's own channel from one guide, and shows what was read", async () => {
    ids.ANIM = await listIt("51.1", "ANIM", "Anime Corner", `${GZ}#channel=${ANIME}`);
    ids.COOK = await listIt("52.1", "COOK", "Cooking Now", `${GZ}#channel=${COOK}`);
    expect(await airings(ids.ANIM)).toEqual([
      ["Golden Hour", "2026-10-06T16:30:00.000Z"],
      ["Demon Girl & Friends", "2026-10-06T17:30:00.000Z"],
      ["Space Rangers", "2026-10-06T18:00:00.000Z"],
      ["Night Patrol", "2026-10-06T20:00:00.000Z"]
    ]);
    expect(await airings(ids.COOK)).toEqual([
      ["Kitchen Rescue", "2026-10-06T17:00:00.000Z"],
      ["Late Cooking", "2026-10-06T20:00:00.000Z"]
    ]);
    const view = await listing(ids.ANIM);
    expect(view).toMatchObject({ calendarSync: "synced", schedule: { format: "xmltv", guide: { channel: ANIME, channelName: "Anime Corner", channels: 3, programmes: 4, gzip: true, large: true, unchangedAt: null, limit: null } } });
    // The validators stay on the API's side.
    expect(view.schedule.guide).not.toHaveProperty("etag");
  });

  it("asks an unchanged guide 'changed since?' and keeps what's stored; a changed one is downloaded once, in one pass for both stations", async () => {
    expect(await pass("2026-10-06T18:01:00.000Z")).toBe(1);
    expect(net.calls.at(-1)).toEqual({ url: GZ, ifNoneMatch: '"v1"' });
    expect(await listing(ids.ANIM)).toMatchObject({ calendarSync: "synced", lastSyncedAt: "2026-10-06T18:01:00.000Z", schedule: { guide: { unchangedAt: "2026-10-06T18:01:00.000Z" } } });
    expect((await airings(ids.ANIM)).map((a) => a[0])).toContain("Space Rangers");

    platform = DESK_PLATFORM.replace("Night Patrol", "Night Patrol Special").replace("Late Cooking", "Hotel Fixers");
    etag = '"v2"';
    expect(await pass("2026-10-06T19:02:00.000Z")).toBe(1);
    expect((await airings(ids.ANIM)).map((a) => a[0])).toEqual(["Golden Hour", "Demon Girl & Friends", "Space Rangers", "Night Patrol Special"]);
    expect((await airings(ids.COOK)).map((a) => a[0])).toEqual(["Kitchen Rescue", "Hotel Fixers"]);
    expect(await listing(ids.COOK)).toMatchObject({ schedule: { guide: { unchangedAt: null, readAt: "2026-10-06T19:02:00.000Z" } } });
  });

  it("downloads afresh for a station new to the guide, rather than telling it 'not changed'", async () => {
    // Retro Drama, by its name: the guide is asked again within the hour for it, without validators.
    h.clock.set("2026-10-06T19:30:00.000Z");
    ids.RETR = await listIt("53.1", "RETR", "Retro Drama", GZ);
    expect(net.calls.at(-1)).toEqual({ url: GZ, ifNoneMatch: null });
    // What's over by now isn't kept.
    expect(await airings(ids.RETR)).toEqual([["Late Western", "2026-10-06T20:00:00.000Z"]]);
    // All three due an hour on, each last read from version 2: one "changed since?", in one pass.
    expect(await pass("2026-10-06T20:31:00.000Z")).toBe(1);
    expect(net.calls.at(-1)!.ifNoneMatch).toBe('"v2"');
  });

  it("says when a guide has several channels and none is picked, and keeps nothing mixed", async () => {
    ids.ELSE = await listIt("54.1", "ELSE", "Something Else", GZ);
    expect(await listing(ids.ELSE)).toMatchObject({ calendarSync: "pick_channel", upcoming: 0, schedule: { format: "xmltv", guide: { channels: 3, channel: null } } });
    const res = await dee.post("/v1/admin/listed-sources/schedule-preview").field("calendarUrl", GZ).field("marketId", marketId).expect(422);
    expect(res.body.error).toMatchObject({ code: "pick_channel", message: expect.stringContaining("This guide has 3 channels. Pick one") });
  });

  it("stops at a limit with what was stored kept, and says which", async () => {
    const before = (await listing(ids.ANIM)).upcoming;
    etag = '"v2b"';
    await withCaps({ bytes: 800 }, () => h.services.network.syncListedSource(ids.ANIM, net.fn));
    expect(await listing(ids.ANIM)).toMatchObject({ calendarSync: "too_big", upcoming: before, schedule: { guide: { limit: "bytes" } } });
    // Back under: read again (without "changed since?", as the last read didn't work).
    await h.services.network.syncListedSource(ids.ANIM, net.fn);
    expect(net.calls.at(-1)).toEqual({ url: GZ, ifNoneMatch: null });
    expect(await listing(ids.ANIM)).toMatchObject({ calendarSync: "synced", schedule: { guide: { limit: null } } });
  });

  it("reads a large guide running dry at most every 30 minutes, a small feed every 2", async () => {
    // The next day, both list nothing past 10:20 am Pacific (17:20Z).
    day = "2026-10-07";
    platform = guide(CHANNELS, [prog(ANIME, "2026-10-07T17:00:00Z", "2026-10-07T17:20:00Z", "Short One")]);
    etag = '"v3"';
    expect(await pass("2026-10-07T17:00:00.000Z")).toBe(1);
    ids.SMAL = await listIt("55.1", "SMAL", "Small Feed", SMALL);
    const both = async (iso: string) => {
      const big = net.count(GZ);
      const small = net.count(SMALL);
      await pass(iso);
      return [net.count(GZ) - big, net.count(SMALL) - small];
    };
    // 10:16 am: running dry. The small feed is read; the large guide was read 16 minutes ago.
    expect(await both("2026-10-07T17:16:00.000Z")).toEqual([0, 1]);
    expect(await both("2026-10-07T17:19:00.000Z")).toEqual([0, 1]);
    // Half an hour after its last read.
    expect(await both("2026-10-07T17:31:00.000Z")).toEqual([1, 1]);
  });

  describe("Find this channel's guide", () => {
    const find = (body: Record<string, string>) => dee.post("/v1/admin/listed-sources/find-guide", body);

    it("finds the guide files for a channel's name, each checked for the channel, the out-of-date one last", async () => {
      const res = await find({ name: "Anime Corner" }).expect(200);
      expect(res.body.channels).toEqual([{ id: "AnimeCorner.us", name: "Anime Corner" }]);
      expect(res.body.guides).toEqual([
        { label: "Pluto TV (US)", via: "i.mjh.nz", url: `${GZ}#channel=${ANIME}`, siteName: "ANIME CORNER", channelId: "AnimeCorner.us", inGuide: true },
        { label: "Plex (US)", via: "i.mjh.nz", url: `${PLEX}#channel=${PLEX_ID}`, siteName: "ANIME CORNER", channelId: "AnimeCorner.us", inGuide: true },
        { label: "Samsung TV Plus (US)", via: "i.mjh.nz", url: `${SAMSUNG}#channel=USBC1500009LD`, siteName: "Anime Corner", channelId: null, inGuide: false }
      ]);
      // pluto.tv's own guide needs its pages read: counted, not offered.
      expect(res.body.skipped).toBe(1);
      // A trailing "TV" and case don't matter.
      expect((await find({ name: "anime corner TV" }).expect(200)).body.guides).toHaveLength(3);
    });

    it("reads the chosen guide's channel when it's checked: Plex's by its own id", async () => {
      const preview = await h.services.network.previewListedSchedule({ calendarUrl: `${PLEX}#channel=${PLEX_ID}`, marketId }, null, net.fn);
      expect(preview).toMatchObject({ format: "xmltv", upcoming: 1, airings: [{ title: "Plex Anime" }], guide: { channel: `6a1610bebdf296985fd95603-${PLEX_ID}`, channelName: "ANIME CORNER", channels: 1, gzip: true } });
    });

    it("matches another name the list gives, and nzxmltv.com's file", async () => {
      const res = await find({ name: "Kitchen Now" }).expect(200);
      expect(res.body.guides).toEqual([{ label: "Freeview NZ", via: "nzxmltv.com", url: `${NZ}#channel=7`, siteName: "Cooking Now", channelId: "CookingNow.nz", inGuide: true }]);
    });

    it("offers nothing when there's no file to fetch, or no such channel", async () => {
      expect((await find({ name: "Only Scraped" }).expect(200)).body).toEqual({ channels: [{ id: "OnlyScraped.us", name: "Only Scraped" }], guides: [], skipped: 1 });
      expect((await find({ name: "Nobody Here" }).expect(200)).body).toEqual({ channels: [], guides: [], skipped: 0 });
    });

    it("uses a lead's iptv-org id when its name doesn't match", async () => {
      const imported = await dee
        .post("/v1/admin/creators/iptv/import", { marketId, channels: [{ name: "AC Live (720p)", streamUrl: "https://ac.example.org/live/index.m3u8", tvgId: "AnimeCorner.us@SD", group: null, country: "US", logoUrl: null }] })
        .expect(201);
      const res = await find({ name: "AC Live (720p)", creatorId: imported.body.imported[0].id }).expect(200);
      expect(res.body.guides.map((g: { label: string }) => g.label)).toEqual(["Pluto TV (US)", "Plex (US)"]);
    });

    it("reads the lists once a day, and says when they can't be read", async () => {
      const LISTS = "https://iptv-org.github.io/api/channels.json";
      const before = net.count(LISTS);
      await find({ name: "Anime Corner" }).expect(200);
      expect(net.count(LISTS)).toBe(before);
      h.clock.advance(25 * 60 * 60_000);
      listsUp = false;
      // Unreadable now: the day-old lists rather than nothing.
      await find({ name: "Anime Corner" }).expect(200);
      expect(net.count(LISTS)).toBe(before + 1);
      listsUp = true;
      const fresh = await createHarness({ externalFetch: (async () => new Response("nope", { status: 503 })) as Fetch });
      try {
        const admin = await fresh.signIn("Ada", { admin: true });
        const res = await admin.post("/v1/admin/listed-sources/find-guide", { name: "Anime Corner" }).expect(502);
        expect(res.body.error.code).toBe("lists_unavailable");
      } finally {
        await fresh.close();
      }
    });
  });
});
