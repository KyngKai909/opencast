// Programming Phase 6 in other apps: a `via=iptv` media playlist is a variant in which a program
// not cleared for other apps (a carried program its maker cleared for Opencast only; a licensed one
// outside its territories, or for a viewer whose country can't be told) is the station's "Airing on
// Opencast" slate: a prepared slate segment in place of each of its segments, with the same media
// and discontinuity sequences, stable across refreshes; the plain playlist (Opencast's own players)
// is untouched. Before the slate is prepared, the generated station ID stands in; with neither, the
// playlist holds. The guide lists those slots as "Airing on Opencast", per the requester's country,
// and the licensor's minutes gain an "other_apps" line from the Other apps sessions. Against the
// local Postgres (no ffmpeg); iptv-where-it-airs-stream.test.ts plays the swapped stream for real.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { elsewhereSlateKey, generatedStationIdKey } from "../src/v1/modules/playout/engine/stationId.js";
import { anon, createHarness, itemFixture, market, stationFixture, type Harness, type User } from "./harness.js";

/** With DEMO_DIR set, what the test saw is kept there (the STOP's evidence). */
async function demo(name: string, body: string) {
  if (!process.env.DEMO_DIR) return;
  const { promises: fs } = await import("node:fs");
  const path = await import("node:path");
  await fs.mkdir(process.env.DEMO_DIR, { recursive: true });
  await fs.writeFile(path.join(process.env.DEMO_DIR, name), body);
}

// Thursday, October 22, 2026, noon in Los Angeles.
const NOW = Date.parse("2026-10-22T19:00:00.000Z");
const T0 = NOW - 40_000;
const BASE = "https://api.opencast.test";
const IP = { us: "198.51.100.7", ca: "198.51.100.8", nowhere: "203.0.113.50" };

let h: Harness;
let kai: User;
let desk: User;
let beat: { id: string };
let agreementId: string;
let licenceId: string;
const items: Record<string, { id: string }> = {};
let look: { callSign: string | null; channel: string | null; name: string; colour: string | null; homeCity: string | null };

/** A playlist's lines, and its segments (each EXTINF's length and the URL after it). */
function parse(body: string) {
  const lines = body.trim().split("\n");
  expect(lines[0]).toBe("#EXTM3U");
  const segments: Array<{ seconds: number; uri: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^#EXTINF:([\d.]+),$/.exec(lines[i]);
    if (!m) continue;
    const uri = lines[i + 1];
    expect(uri && !uri.startsWith("#")).toBe(true);
    segments.push({ seconds: Number(m[1]), uri });
  }
  const tag = (name: string) => Number(lines.find((l) => l.startsWith(`#EXT-X-${name}:`))?.split(":")[1]);
  return {
    lines,
    segments,
    mediaSequence: tag("MEDIA-SEQUENCE"),
    discontinuitySequence: tag("DISCONTINUITY-SEQUENCE"),
    discontinuities: lines.filter((l) => l === "#EXT-X-DISCONTINUITY").length,
    dates: lines.filter((l) => l.startsWith("#EXT-X-PROGRAM-DATE-TIME:")),
    ended: lines.includes("#EXT-X-ENDLIST")
  };
}

const playlist = async (file: string, ip?: string | null) => (await h.services.playout.playlist(beat.id, file, ip === undefined ? undefined : { via: "iptv", ip, userAgent: "TiviMate/5.1" }))?.body ?? "";
const tick = (ms = 1_500) => h.clock.set(new Date(h.clock.now().getTime() + ms).toISOString());

async function ready(key: string, segmentMs: number[]) {
  await h.db.insert(schema.preparedItems).values({ key, kind: "slate", mediaKind: "video", status: "ready", renditions: ["a128", "v1080", "v360", "v480", "v720"], durationMs: segmentMs.reduce((a, b) => a + b, 0) });
  await h.db.insert(schema.preparedRenditions).values(["v1080", "v720", "v480", "v360", "a128"].map((rendition) => ({ key, rendition, segments: segmentMs.length, segmentMs })));
}

beforeAll(async () => {
  h = await createHarness({
    publicBase: BASE,
    geo: { configured: true, lookup: async (ip) => (ip === IP.us ? { zip: null, point: null, country: "US" } : ip === IP.ca ? { zip: null, point: null, country: "CA" } : null) }
  });
  h.clock.set(new Date(NOW).toISOString());
  const m = await market(h);
  kai = await h.signIn("Kai");
  const dee = await h.signIn("Dee");
  desk = await h.signIn("Desk", { admin: true });
  const reel = await stationFixture(h, { callSign: "REEL", ownerId: dee.id, marketId: m.id, tenths: 241, signedOn: true });
  beat = await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId: m.id, tenths: 121, signedOn: true, colour: "#8C3B7A" });
  await h.db.insert(schema.playoutState).values({ stationId: beat.id, onAir: true });

  // A carried program the maker clears for Opencast only.
  const reelProgram = (await dee.post(`/v1/stations/${reel.id}/programs`, { title: "Night Reel" }).expect(201)).body.id;
  items.reel = await itemFixture(h, reel.id, { title: "Night Reel 1", programId: reelProgram, episodeNumber: 1 });
  const offer = await dee
    .post(`/v1/programs/${reelProgram}/offer`, { termsOffered: ["barter"], cashPriceMicros: null, cashPriceUnit: null, barterMakerMsPerHour: 120_000, airingsPerEpisode: null, windowDays: 7, liveOnly: false, noticeDays: 7, approval: "any_station", radioBandAllowed: true, outlets: ["opencast"] })
    .expect(201);
  agreementId = (await kai.post(`/v1/catalog/offers/${offer.body.id}/requests`, { carrierStationId: beat.id, term: "barter", slots: [{ weekday: 6, time: "20:00" }], startsOn: "2026-10-21" }).expect(201)).body.agreementId;
  expect(agreementId).toBeTruthy();
  // BEAT's own program, and a western it licenses for other apps in the US only.
  const westerns = (await kai.post(`/v1/stations/${beat.id}/programs`, { title: "Prairie Westerns" }).expect(201)).body.id;
  items.own = await itemFixture(h, beat.id, { title: "Beat Tape" });
  items.west = await itemFixture(h, beat.id, { title: "Western 1", programId: westerns, episodeNumber: 1 });
  licenceId = (
    await desk
      .post("/v1/admin/licences", { licensor: "Prairie Films", name: "Westerns package", outlets: ["other_apps"], worldwide: false, countries: ["US"], startsOn: "2026-10-01", endsOn: "2026-12-31", deal: { kind: "rev_share", percent: 10 }, programIds: [westerns], itemIds: [] })
      .expect(201)
  ).body.id;

  // The channel: its own program, the carried one, the western, its own again; 12 s each, three 4 s segments.
  const row = (seq: number, disc: number, key: string, item: { id: string }, label: string, agreement: string | null = null) => ({
    stationId: beat.id,
    run: 1,
    seq,
    disc,
    discontinuity: true,
    startsAt: new Date(T0 + (seq - 1) * 4_000),
    endsAt: new Date(T0 + (seq + 2) * 4_000),
    kind: "prepared" as const,
    preparedKey: key,
    segments: 3,
    segmentMs: [4_000, 4_000, 4_000],
    code: "PGM",
    label,
    reason: "planned",
    assetId: item.id,
    agreementId: agreement,
    tags: [`#EXT-X-DATERANGE:ID="item-${seq}",CLASS="org.useopencast.item",START-DATE="${new Date(T0 + (seq - 1) * 4_000).toISOString()}",X-OC-TITLE="${label}"`]
  });
  await h.db.insert(schema.channelItems).values([
    row(1, 0, "k-own", items.own, "Beat Tape"),
    row(4, 1, "k-reel", items.reel, "Night Reel", agreementId),
    row(7, 2, "k-west", items.west, "Western 1"),
    row(10, 3, "k-own", items.own, "Beat Tape")
  ]);
  const ident = (await h.services.stations.idents([beat.id])).get(beat.id)!;
  look = { callSign: ident.callSign, channel: ident.channel, name: ident.name, colour: ident.colour ?? null, homeCity: ident.homeCity ?? null };
}, 60_000);
afterAll(() => h?.close());

describe("other apps' playlists, before the slate is prepared", () => {
  it("hold before a program not cleared for them, with nothing to show in its place", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const held = parse(await playlist("v720.m3u8", IP.us));
    // Its own program's three segments, then nothing: the carried program never goes out.
    expect(held.segments.map((s) => s.uri)).toEqual([0, 1, 2].map((i) => `${BASE}/objects/prepared/k-own/v720/seg_0000${i}.ts`));
    expect(held.ended).toBe(false);
    expect(warn.mock.calls.map((c) => c[0])).toEqual([`[playout] BEAT: the other apps' "Airing on Opencast" slate isn't prepared yet, so Night Reel (not cleared for them) holds the playlist until it is`]);
    warn.mockRestore();
  });

  it("show the generated station ID in its place while it's the only thing ready", async () => {
    const sid = generatedStationIdKey(look, "tv");
    await ready(sid, [4_000, 4_000, 2_000]);
    tick();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const stand = parse(await playlist("v720.m3u8", IP.us));
    expect(stand.segments.slice(3, 6).map((s) => s.uri)).toEqual([0, 1, 2].map((i) => `${BASE}/hls/elsewhere/${sid}/v720/${i}-${i * 4_000}.ts`));
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("other apps' playlists", () => {
  let plain: ReturnType<typeof parse>;
  const slate4 = () => elsewhereSlateKey(look, "tv", 4);

  beforeAll(async () => {
    // The engine prepares these ahead (index.ts, `queueElsewhereSlates`); here they're recorded as prepared.
    for (const seconds of [1, 2, 3, 4]) await ready(elsewhereSlateKey(look, "tv", seconds), [seconds * 1_000]);
    tick();
    plain = parse(await playlist("v720.m3u8"));
  });

  it("leave the plain playlist alone: Opencast's own players get every program", async () => {
    expect(plain.segments).toHaveLength(10);
    expect(plain.segments.map((s) => s.uri.split("/prepared/")[1]?.split("/")[0])).toEqual(["k-own", "k-own", "k-own", "k-reel", "k-reel", "k-reel", "k-west", "k-west", "k-west", "k-own"]);
    expect(plain.lines.filter((l) => l.startsWith("#EXT-X-DATERANGE"))).toHaveLength(4);
    // A player without via=iptv, or asking with another via, gets the same.
    expect(await h.services.playout.playlist(beat.id, "v720.m3u8", { via: "web", ip: IP.ca })).toEqual(await h.services.playout.playlist(beat.id, "v720.m3u8"));
  });

  it("swap a carried program not cleared for them for the slate's segments, the rest untouched", async () => {
    const us = parse(await playlist("v720.m3u8", IP.us));
    await demo("v720-plain.m3u8", plain.lines.join("\n") + "\n");
    await demo("v720-iptv-US.m3u8", us.lines.join("\n") + "\n");
    // The same media and discontinuity sequences, discontinuities and program date-times.
    expect(us.mediaSequence).toBe(plain.mediaSequence);
    expect(us.discontinuitySequence).toBe(plain.discontinuitySequence);
    expect(us.discontinuities).toBe(plain.discontinuities);
    expect(us.dates).toEqual(plain.dates);
    expect(us.segments).toHaveLength(plain.segments.length);
    // Night Reel's three segments: the 4 s slate, each played on from the one before.
    expect(us.segments.slice(3, 6)).toEqual([0, 1, 2].map((i) => ({ seconds: 4, uri: `${BASE}/hls/elsewhere/${slate4()}/v720/${i}-${i * 4_000}.ts` })));
    // Everything else as in the plain playlist (the western is licensed for other apps in the US).
    expect([...us.segments.slice(0, 3), ...us.segments.slice(6)]).toEqual([...plain.segments.slice(0, 3), ...plain.segments.slice(6)]);
    // Its tags (its title) aren't what's showing; the others' are kept.
    expect(us.lines.some((l) => l.includes("Night Reel"))).toBe(false);
    expect(us.lines.filter((l) => l.startsWith("#EXT-X-DATERANGE"))).toHaveLength(3);
    // And it's its own: the plain playlist's cache isn't shared.
    expect(parse(await playlist("v720.m3u8")).segments).toEqual(plain.segments);
  });

  it("follow the licence's territories by the viewer's country: not in Canada, and not where the country can't be told", async () => {
    const ca = parse(await playlist("v720.m3u8", IP.ca));
    const unknown = parse(await playlist("v720.m3u8", IP.nowhere));
    const noAddress = parse(await playlist("v720.m3u8", null));
    await demo("v720-iptv-CA.m3u8", ca.lines.join("\n") + "\n");
    for (const p of [ca, unknown, noAddress]) {
      expect(p.segments.slice(3, 9).every((s) => s.uri.includes("/hls/elsewhere/"))).toBe(true);
      expect(p.segments.slice(6, 9).map((s) => s.uri)).toEqual([0, 1, 2].map((i) => `${BASE}/hls/elsewhere/${slate4()}/v720/${i}-${i * 4_000}.ts`));
      expect([...p.segments.slice(0, 3), ...p.segments.slice(9)]).toEqual([...plain.segments.slice(0, 3), ...plain.segments.slice(9)]);
      expect(p.mediaSequence).toBe(plain.mediaSequence);
      expect(p.discontinuities).toBe(plain.discontinuities);
    }
    // The answer behind it, from the domain's one function.
    const at = new Date(T0 + 24_000);
    const answers = await Promise.all(["US", "CA", null].map(async (c) => (await h.services.licences.clearance([{ assetId: items.west.id }], "other_apps", c, { at }))[0].reason));
    expect(answers).toEqual(["cleared", "outside_territory", "territory_unknown"]);
  });

  it("stay one continuous live playlist across refreshes", async () => {
    const before = parse(await playlist("v720.m3u8", IP.ca));
    tick(8_000);
    const after = parse(await playlist("v720.m3u8", IP.ca));
    expect(after.mediaSequence).toBe(before.mediaSequence);
    expect(after.discontinuitySequence).toBe(before.discontinuitySequence);
    // Two more segments of its own program; what was there before is as it was.
    expect(after.segments).toHaveLength(before.segments.length + 2);
    expect(after.segments.slice(0, before.segments.length)).toEqual(before.segments);
    expect(after.segments.slice(-3).map((s) => s.uri)).toEqual(plain.segments.slice(-1).map((s) => s.uri).concat([1, 2].map((i) => `${BASE}/objects/prepared/k-own/v720/seg_0000${i}.ts`)));
  });

  it("give a swapped program's subtitle segments no captions, on the same timeline", async () => {
    const subs = parse(await playlist("subs.m3u8", IP.ca));
    const plainSubs = parse(await playlist("subs.m3u8"));
    expect(subs.mediaSequence).toBe(plainSubs.mediaSequence);
    expect(subs.segments.map((s) => s.seconds)).toEqual(plainSubs.segments.map((s) => s.seconds));
    expect(subs.segments.slice(3, 9).every((s) => s.uri === "empty.vtt")).toBe(true);
  });

  it("hand the master's via=iptv on, the master itself unchanged", async () => {
    const master = await playlist("master.m3u8", IP.ca);
    expect(master).toContain("v720.m3u8?via=iptv");
    expect(master.replace(/\?via=iptv/g, "")).toBe((await h.services.playout.playlist(beat.id, "master.m3u8"))!.body);
  });

  it("serve only the slates, re-timed", async () => {
    // Nothing else can be re-timed through it (and a slate not in storage is nothing).
    expect(await h.services.playout.elsewhereSegment("k-reel", "v720", 0, 0)).toBeNull();
    expect(await h.services.playout.elsewhereSegment(slate4(), "v720", 0, 0)).toBeNull();
    expect(await h.services.playout.elsewhereSegment(slate4(), "v720", -1, 0)).toBeNull();
  });
});

describe("the guide in other apps", () => {
  const SAT = { reel: "2026-10-25T03:00:00.000Z", west: "2026-10-25T03:30:00.000Z", own: "2026-10-25T04:00:00.000Z" };

  beforeAll(async () => {
    const entry = (startsAt: string, item: { id: string }, fields: Partial<typeof schema.logEntries.$inferInsert> = {}) =>
      h.db.insert(schema.logEntries).values({ stationId: beat.id, startsAt: new Date(startsAt), endsAt: new Date(Date.parse(startsAt) + 30 * 60_000), kind: "program", code: "PGM", assetId: item.id, ...fields });
    const [west] = await h.db.select({ programId: schema.assets.programId }).from(schema.assets).where(eq(schema.assets.id, items.west.id));
    await entry(SAT.reel, items.reel, { carriageAgreementId: agreementId });
    await entry(SAT.west, items.west, { programId: west.programId });
    await entry(SAT.own, items.own);
  });

  const programmes = async (ip: string) => {
    const xml = (await anon(h).get("/v1/iptv/xmltv.xml").set("x-forwarded-for", ip).expect(200)).text;
    const list = [...xml.matchAll(/<programme start="(\d{14}) \+0000" stop="\d{14} \+0000" channel="([^"]+)">([\s\S]*?)<\/programme>/g)]
      .filter((m) => m[2] === `${beat.id}.opencast`)
      .map((m) => ({ start: m[1], title: /<title[^>]*>([^<]*)<\/title>/.exec(m[3])?.[1], desc: /<desc[^>]*>([^<]*)<\/desc>/.exec(m[3])?.[1] ?? null, body: m[3] }));
    return { xml, list };
  };

  it("lists a slot not cleared for other apps as Airing on Opencast, with the station and channel, by the requester's country", async () => {
    const us = await programmes(IP.us);
    const ca = await programmes(IP.ca);
    const slot = (p: Awaited<ReturnType<typeof programmes>>, start: string) => p.list.find((x) => x.start === start.replace(/[-:T]/g, "").slice(0, 14));
    const elsewhere = { title: "Airing on Opencast", desc: "On Opencast only. Watch it on BEAT, channel 12.1, in the Opencast app." };
    expect(slot(us, SAT.reel)).toMatchObject(elsewhere);
    expect(slot(us, SAT.reel)!.body).not.toContain("<episode-num");
    expect(slot(us, SAT.west)).toMatchObject({ title: "Prairie Westerns" });
    expect(slot(ca, SAT.west)).toMatchObject(elsewhere);
    expect(slot(ca, SAT.reel)).toMatchObject(elsewhere);
    expect(slot(us, SAT.own)!.title).toBe("Beat Tape");
    expect(slot(ca, SAT.own)!.title).toBe("Beat Tape");
    // Nowhere does the carried program's own title show.
    expect(us.xml).not.toContain("Night Reel");
    // Unknown country: as Canada (only a worldwide licence clears it).
    expect(slot(await programmes(IP.nowhere), SAT.west)).toMatchObject(elsewhere);
    const excerpt = (p: Awaited<ReturnType<typeof programmes>>) => [...p.xml.matchAll(/<programme [^>]*channel="[^"]+">[\s\S]*?<\/programme>/g)].map((m) => m[0]).filter((x) => x.includes(`${beat.id}.opencast`) && /start="2026102(5|4)/.test(x)).join("\n");
    await demo("xmltv-excerpt.xml", `<!-- requested from the US -->\n${excerpt(us)}\n\n<!-- requested from Canada -->\n${excerpt(ca)}\n`);
  });
});

describe("the licensor's minutes", () => {
  it("add other apps: the airing's time while a session in another app watched it, cleared for them, and those sessions' hours", async () => {
    const at = (iso: string) => new Date(iso);
    const [west] = await h.db.select({ programId: schema.assets.programId }).from(schema.assets).where(eq(schema.assets.id, items.west.id));
    const aired = (startsAt: string) =>
      h.db.insert(schema.asRun).values({ stationId: beat.id, code: "PGM", reason: "planned", assetId: items.west.id, programId: west.programId, startedAt: at(startsAt), endedAt: new Date(Date.parse(startsAt) + 30 * 60_000) });
    await aired("2026-10-10T03:00:00.000Z");
    await aired("2026-10-17T03:00:00.000Z");
    // Two sessions in other apps over the first airing (20 minutes of it each, together all 30); none over the second.
    await h.db.insert(schema.otherAppSessions).values([
      { stationId: beat.id, clientKey: "a", startedAt: at("2026-10-10T02:50:00.000Z"), lastPollAt: at("2026-10-10T03:20:00.000Z"), polls: 400 },
      { stationId: beat.id, clientKey: "b", startedAt: at("2026-10-10T03:10:00.000Z"), lastPollAt: at("2026-10-10T03:40:00.000Z"), polls: 400 },
      // Polls spanning less than a minute never count.
      { stationId: beat.id, clientKey: "c", startedAt: at("2026-10-17T03:05:00.000Z"), lastPollAt: at("2026-10-17T03:05:30.000Z"), polls: 3 }
    ]);
    const report = (await desk.get(`/v1/admin/licences/${licenceId}/minutes?month=2026-10`).expect(200)).body;
    expect(report.rows).toEqual([
      { station: expect.objectContaining({ callSign: "BEAT" }), outlet: "opencast", airings: 2, minutesAired: 60, viewerHours: null },
      { station: expect.objectContaining({ callSign: "BEAT" }), outlet: "other_apps", airings: 1, minutesAired: 30, viewerHours: 0.7 }
    ]);
    expect(report.outlets).toEqual([
      { outlet: "opencast", minutesAired: 60, viewerHours: null },
      { outlet: "other_apps", minutesAired: 30, viewerHours: 0.7 }
    ]);
    expect(report.stations).toEqual([{ station: expect.objectContaining({ callSign: "BEAT" }), airings: 2, minutesAired: 60, viewerHours: 0.7 }]);
    const csv = (await desk.get(`/v1/admin/licences/${licenceId}/minutes/csv?month=2026-10`).expect(200)).body;
    expect(csv.csv).toContain("2026-10,Prairie Films,Westerns package,BEAT 12.1,other_apps,1,30,0.7");
    await demo("minutes-report.json", JSON.stringify(report, null, 2));
    await demo(csv.filename, csv.csv);
  });

  it("leave other apps out where the licence doesn't clear them", async () => {
    // Narrowed to relays: the same sessions, no other apps line.
    await desk.patch(`/v1/admin/licences/${licenceId}`, { outlets: ["relays"] }).expect(200);
    const report = (await desk.get(`/v1/admin/licences/${licenceId}/minutes?month=2026-10`).expect(200)).body;
    expect(report.rows.map((r: { outlet: string }) => r.outlet)).toEqual(["opencast"]);
  });
});
