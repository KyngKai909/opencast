// TV live blocks from our own storage (2026-09-30): the leading worker pulls each of Livepeer's
// segments once and stores it (livecopy.ts), and the channel's playlists point at the copies.
// Against a local fake of Livepeer's HLS output (no Livepeer stream is created, nothing paid is
// called), with a stand-in store or the harness's local one; the source's clock is frozen, the
// copying runs in real time (quickly: nothing here waits on FFmpeg or a real clock).
//
//   - the source alone: copied once per variant, only once the channel asks for it; a segment
//     that fails briefly is retried, one that keeps failing is skipped (a new part); a copy that
//     falls behind drops to the newest; copies that stop landing count as not connected;
//   - the engine: two stations airing one source copy it once; a skipped segment is a
//     discontinuity in the channel's playlist; the health endpoint's `liveCopy`; a takedown
//     deletes the copies.
import { promises as fs } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import { schema } from "@opencast/db";
import { LADDER, type RenditionName } from "../src/v1/modules/playout/engine/ladder.js";
import { LiveHlsSource, type LiveCopyEvent, type SegmentCopier } from "../src/v1/modules/playout/engine/live.js";
import { createLiveCopier, liveCopyCounter } from "../src/v1/modules/playout/engine/livecopy.js";
import { createEngine, type Engine } from "../src/v1/modules/playout/engine/index.js";
import { storedSegmentKey } from "../src/v1/modules/playout/engine/sender.js";
import { createHarness, dummyFile, fakeTranscoder, itemFixture, market, prepareQueued, stationFixture, type Harness } from "./harness.js";

const VIDEO: RenditionName[] = ["v1080", "v720", "v480", "v360"];
const SCRATCH = path.join(os.tmpdir(), "opencast-live-copy-test");

// ---- The source alone ----------------------------------------------------------------------

let server: http.Server;
let origin: string;
let clock = 0;
const state = { renditions: false, session: "a", fail: new Map<number, number>() };
const fetched = new Map<string, number>();

function media(prefix: string) {
  const newest = Math.floor(clock / 2_000);
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:2", `#EXT-X-MEDIA-SEQUENCE:${Math.max(0, newest - 3)}`];
  for (let i = Math.max(0, newest - 3); i <= newest; i++) lines.push("#EXTINF:2.000,", `${prefix}-${i}.ts?tkn=${state.session}`);
  return lines.join("\n") + "\n";
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "";
    if (url === "/hls/pb/index.m3u8") {
      const lines = ["#EXTM3U", '#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1920x1080,CODECS="avc1.42c028,mp4a.40.2"', "0_1/index.m3u8"];
      if (state.renditions) {
        for (const [i, [w, h, b]] of [[1920, 1080, 5500000], [1280, 720, 3100000], [854, 480, 1500000], [640, 360, 900000]].entries()) {
          lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${b},RESOLUTION=${w}x${h},CODECS="avc1.64001f,mp4a.40.2"`, `1_${i}/index.m3u8`);
        }
      }
      return void res.end(lines.join("\n") + "\n");
    }
    const list = /^\/hls\/pb\/(\d_\d)\/index\.m3u8$/.exec(url);
    if (list) return void res.end(media(list[1]));
    const seg = /^\/hls\/pb\/\d_\d\/(\d_\d)-(\d+)\.ts/.exec(url);
    if (seg) {
      fetched.set(`${seg[1]}-${seg[2]}`, (fetched.get(`${seg[1]}-${seg[2]}`) ?? 0) + 1);
      const failures = state.fail.get(Number(seg[2])) ?? 0;
      if (failures > 0) {
        state.fail.set(Number(seg[2]), failures - 1);
        return void res.writeHead(500).end();
      }
      return void res.end(Buffer.from(`${seg[1]} ${seg[2]} `.repeat(100)));
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

/** A stand-in for storage: keys and bytes, and a switch to make it fail. */
function fakeStore() {
  const objects = new Map<string, Buffer>();
  const control = { down: false };
  return {
    objects,
    control,
    store: async (key: string, file: string) => {
      if (control.down) throw new Error("storage unreachable");
      objects.set(key, await fs.readFile(file));
      return `https://storage.test/${key}`;
    }
  };
}

function reset(session: string) {
  clock = 0;
  fetched.clear();
  Object.assign(state, { renditions: false, session, fail: new Map() });
}

async function pollAt(source: LiveHlsSource, ms: number) {
  clock = ms;
  await source.poll();
}

describe("copying a TV live source into storage", () => {
  it("starts only once the channel asks, and copies each of Livepeer's variants once, whichever renditions read it", async () => {
    reset("a");
    const store = fakeStore();
    const counter = liveCopyCounter();
    const copy = createLiveCopier({ liveSourceId: "5f0c1d7e-0000-4000-8000-000000000001", scratchDir: SCRATCH, store: store.store, counter, deadlineMs: 1_000 });
    const source = new LiveHlsSource(`${origin}/hls/pb/index.m3u8`, VIDEO, LADDER, () => clock, { copy, onEvent: (e) => counter.event(e), waitMs: 500 });
    await pollAt(source, 10_000);
    await pollAt(source, 12_000);
    // Read ahead of its block: listed, nothing fetched.
    expect(source.connected()).toBe(true);
    expect(fetched.size).toBe(0);
    expect(source.after(null)).toEqual([]);
    // The block asks: from the newest the source has listed.
    await pollAt(source, 13_000);
    await vi.waitFor(() => expect(source.after(null).map((s) => s.seq)).toEqual([6]));
    for (let t = 14_000; t <= 20_000; t += 1_000) {
      await pollAt(source, t);
      source.after(null);
    }
    await vi.waitFor(() => expect(source.after(5).map((s) => s.seq)).toEqual([6, 7, 8, 9, 10]));

    // Before Livepeer lists its renditions every rendition reads the source's: fetched and stored once.
    expect([...fetched.entries()]).toEqual([6, 7, 8, 9, 10].map((i) => [`0_1-${i}`, 1]));
    const six = source.after(5)[0];
    expect(new Set(VIDEO.map((r) => six.uris[r])).size).toBe(1);
    expect(six.uris.v720).toMatch(/^https:\/\/storage\.test\/prepared\/live-5f0c1d7e0000-[a-z0-9]+\/v1080\/seg_00006\.ts$/);
    expect(store.objects.get(storedSegmentKey(six.uris.v720!)!)?.toString()).toContain("0_1 6 ");

    // Once they're listed, each rendition its own (four fetches a segment, one each).
    state.renditions = true;
    fetched.clear();
    for (let t = 26_000; t <= 34_000; t += 1_000) {
      await pollAt(source, t);
      source.after(null);
    }
    await vi.waitFor(() => expect(source.after(null)[0]?.seq).toBe(17));
    const edge = source.after(null)[0];
    expect(VIDEO.map((r) => /\/(v\d+)\/seg_/.exec(edge.uris[r]!)![1])).toEqual(VIDEO);
    expect([...fetched.values()].every((n) => n === 1)).toBe(true);
    expect(new Set([...fetched.keys()].map((k) => k.split("-")[0]))).toEqual(new Set(["1_0", "1_1", "1_2", "1_3"]));

    const stats = counter.stats();
    expect(stats.segments).toBeGreaterThanOrEqual(8);
    expect(stats.bytesPulled).toBeGreaterThan(0);
    expect(stats.objectsWritten).toBe(store.objects.size);
    expect(stats.addedLatencyMs).not.toBeNull();
    await source.close();
  });

  it("retries a segment that fails briefly, and skips one that keeps failing: the rest carry on as a new part", async () => {
    reset("b");
    const store = fakeStore();
    const events: LiveCopyEvent[] = [];
    const copy = createLiveCopier({ liveSourceId: "5f0c1d7e-0000-4000-8000-000000000002", scratchDir: SCRATCH, store: store.store, deadlineMs: 400 });
    const source = new LiveHlsSource(`${origin}/hls/pb/index.m3u8`, VIDEO, LADDER, () => clock, { copy, onEvent: (e) => events.push(e), waitMs: 1_000 });
    state.fail.set(6, 1);
    state.fail.set(7, 100);
    await pollAt(source, 10_000);
    source.after(null);
    for (let t = 11_000; t <= 17_000; t += 1_000) {
      await pollAt(source, t);
      source.after(null);
    }
    await vi.waitFor(() => expect(source.after(4).map((s) => s.seq)).toEqual([5, 6, 8]));
    const [five, six, eight] = source.after(4);
    // 6 failed once and was fetched again; 7 was given up on.
    expect(fetched.get("0_1-6")).toBe(2);
    expect(fetched.get("0_1-7")).toBeGreaterThanOrEqual(2);
    expect([five.part, six.part]).toEqual([0, 0]);
    expect(eight.part).toBe(1);
    expect(events.filter((e) => e.kind === "skipped")).toEqual([{ kind: "skipped", seq: 7 }]);
    await source.close();
  });

  it("falls to the newest segment when the copy falls behind, never adding delay", async () => {
    reset("c");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const copied: number[] = [];
    const copy: SegmentCopier = async ({ seq }) => {
      await gate;
      copied.push(seq);
      return Object.fromEntries(VIDEO.map((r) => [r, `https://storage.test/${r}/${seq}.ts`]));
    };
    const events: LiveCopyEvent[] = [];
    const source = new LiveHlsSource(`${origin}/hls/pb/index.m3u8`, VIDEO, LADDER, () => clock, { copy, onEvent: (e) => events.push(e), waitMs: 10 });
    await pollAt(source, 10_000);
    source.after(null);
    // Storage stalls for four segments: 6 to 9 wait behind 5.
    for (let t = 12_000; t <= 18_000; t += 2_000) await pollAt(source, t);
    release();
    await vi.waitFor(() => expect(copied).toEqual([5, 9]));
    expect(events.find((e) => e.kind === "caught_up")).toEqual({ kind: "caught_up", dropped: 3 });
    const [five, nine] = source.after(4);
    expect([five.seq, nine.seq]).toEqual([5, 9]);
    expect(nine.part).not.toBe(five.part);
    await source.close();
  });

  it("isn't connected while its copies stop landing (the stand-by slate airs), and copies again once they can", async () => {
    reset("d");
    const store = fakeStore();
    const copy = createLiveCopier({ liveSourceId: "5f0c1d7e-0000-4000-8000-000000000003", scratchDir: SCRATCH, store: store.store, deadlineMs: 300 });
    const source = new LiveHlsSource(`${origin}/hls/pb/index.m3u8`, VIDEO, LADDER, () => clock, { copy, waitMs: 1_000 });
    await pollAt(source, 10_000);
    source.after(null);
    await vi.waitFor(() => expect(source.after(null).length).toBe(1));
    store.control.down = true;
    // The channel reads the source every second while it airs it.
    let t = 11_000;
    for (; t <= 30_000 && source.connected(); t += 1_000) {
      await pollAt(source, t);
      source.after(null);
    }
    // Livepeer is still sending, but nothing has been stored for three segments or 8 s.
    expect(source.connected()).toBe(false);
    expect(t).toBeLessThanOrEqual(22_000);
    // Standing by, the channel stops asking; copying stops after 15 s, and the source is back as
    // soon as it lists segments again. Asking starts the copying again.
    store.control.down = false;
    for (t += 1_000; !source.connected() && t < 60_000; t += 1_000) await pollAt(source, t);
    expect(source.connected()).toBe(true);
    source.after(null);
    await pollAt(source, t + 1_000);
    await vi.waitFor(() => expect(source.after(null)[0]?.seq).toBeGreaterThanOrEqual(Math.floor(t / 2_000)));
    await source.close();
  });
});

// ---- Through the engine --------------------------------------------------------------------

describe("TV live copies through the engine", () => {
  let h: Harness;
  let engine: Engine;
  let lp: http.Server;
  let lpOrigin: string;
  let sourceId: string;
  const stations: string[] = [];
  const lpFetched = new Map<string, number>();
  const on = { from: Date.parse("2026-10-01T20:00:44.000Z"), to: Date.parse("2026-10-01T20:02:00.000Z") };
  /** Livepeer's segment 6 never comes (in its 720p rendition). */
  const LOST = 6;

  beforeAll(async () => {
    h = await createHarness();
    h.clock.set("2026-10-01T19:59:40.000Z");
    lp = http.createServer((req, res) => {
      const now = h.clock.now().getTime();
      const url = req.url ?? "";
      const live = now >= on.from && now < on.to;
      const newest = Math.floor((now - on.from) / 2_000);
      if (url === "/hls/fake/index.m3u8") {
        return void res.end(["#EXTM3U", '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"', "720p0/index.m3u8", '#EXT-X-STREAM-INF:BANDWIDTH=130000,CODECS="mp4a.40.2"', "audio/index.m3u8", ""].join("\n"));
      }
      const seg = /^\/hls\/fake\/(720p0|audio)\/(\d+)\.ts$/.exec(url);
      if (seg && live) {
        lpFetched.set(url, (lpFetched.get(url) ?? 0) + 1);
        if (seg[1] === "720p0" && Number(seg[2]) === LOST) return void res.writeHead(500).end();
        return void res.end(Buffer.from(`${seg[1]} ${seg[2]} `.repeat(100)));
      }
      if (/^\/hls\/fake\/(720p0|audio)\/index\.m3u8$/.test(url) && live) {
        const first = Math.max(0, newest - 4);
        const lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:2", `#EXT-X-MEDIA-SEQUENCE:${first}`];
        for (let i = first; i <= newest; i++) lines.push("#EXTINF:2.000,", `${i}.ts`);
        return void res.end(lines.join("\n") + "\n");
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => lp.listen(0, "127.0.0.1", resolve));
    lpOrigin = `http://127.0.0.1:${(lp.address() as AddressInfo).port}`;
    const m = await market(h);
    const kai = await h.signIn("Kai");
    for (const [callSign, tenths] of [["COPY", 151], ["ALSO", 161]] as const) {
      const id = (await stationFixture(h, { callSign, name: callSign, ownerId: kai.id, marketId: m.id, tenths, signedOn: true })).id;
      stations.push(id);
      await itemFixture(h, id, { title: `${callSign} ident`, code: "SID", durationMs: 4_000, location: await dummyFile() });
      const show = await itemFixture(h, id, { title: "Before", durationMs: 40_000, location: await dummyFile() });
      await kai.post(`/v1/stations/${id}/log`, { kind: "program", startsAt: "2026-10-01T20:00:00.000Z", endsAt: "2026-10-01T20:00:40.000Z", itemId: show.id }).expect(201);
      await h.db.insert(schema.playoutState).values({ stationId: id, onAir: true });
    }
    const [source] = await h.db.insert(schema.liveSources).values({ stationId: stations[0], kind: "encoder", name: "Studio A", livepeerPlaybackId: "fake" }).returning();
    sourceId = source.id;
    const [program] = await h.db.insert(schema.programs).values({ stationId: stations[0], title: "Town Hall", isLive: true }).returning();
    const live = await kai.post(`/v1/stations/${stations[0]}/log`, { kind: "live", startsAt: "2026-10-01T20:00:40.000Z", endsAt: "2026-10-01T20:01:40.000Z", liveSourceId: sourceId, programId: program.id }).expect(201);
    // The second station airs the same source (as a carrier would): its own log entry, the same source.
    const [entry] = await h.db.select().from(schema.logEntries).where(eq(schema.logEntries.id, live.body.id));
    const { id: _id, ...copyOfEntry } = entry;
    await h.db.insert(schema.logEntries).values({ ...copyOfEntry, stationId: stations[1] });
    engine = createEngine({ deps: h.deps, services: h.services }, { transcoder: fakeTranscoder(), liveCopyDeadlineMs: 300, liveUrl: async (id) => (id === sourceId ? `${lpOrigin}/hls/fake/index.m3u8` : null) });
    const end = Date.parse("2026-10-01T20:01:30.000Z");
    while (h.clock.now().getTime() < end) {
      h.clock.advance(1_000);
      await engine.tick();
      await prepareQueued(h, engine.preparer);
    }
  }, 120_000);

  afterAll(async () => {
    await engine?.stopAll();
    lp?.close();
    await h?.close();
  });

  const seqOf = (uri: string) => Number(/seg_(\d{5})\.ts$/.exec(uri)![1]);

  it("copies the source once for every station airing it, and they point at the same copies", async () => {
    const good = [...lpFetched.entries()].filter(([url]) => !url.endsWith(`/720p0/${LOST}.ts`));
    expect(good.length).toBeGreaterThanOrEqual(2 * 10);
    expect(good.every(([, n]) => n === 1)).toBe(true);
    const [a, b] = await Promise.all(stations.map((s) => h.services.playout.playlist(s, "v720.m3u8")));
    const own = (body: string) => body.split("\n").filter((l) => /\/prepared\/live-/.test(l));
    expect(own(a!.body).length).toBeGreaterThanOrEqual(8);
    expect(own(b!.body).length).toBeGreaterThanOrEqual(8);
    const shared = own(a!.body).filter((u) => own(b!.body).includes(u));
    expect(shared.length).toBeGreaterThanOrEqual(8);
    expect(a!.body).not.toContain(lpOrigin);
    expect(b!.body).not.toContain(lpOrigin);
  });

  it("puts a discontinuity where a segment couldn't be copied, and carries on from the next", async () => {
    const body = (await h.services.playout.playlist(stations[0], "v720.m3u8"))!.body;
    const lines = body.split("\n");
    const seqs = lines.filter((l) => /\/prepared\/live-/.test(l)).map(seqOf);
    expect(seqs).not.toContain(LOST);
    const before = lines.findIndex((l) => /\/prepared\/live-/.test(l) && seqOf(l) === LOST - 1);
    const after = lines.findIndex((l, i) => i > before && /\/prepared\/live-/.test(l));
    expect(before).toBeGreaterThan(-1);
    expect(seqOf(lines[after])).toBeGreaterThan(LOST);
    const between = lines.slice(before + 1, after);
    expect(between).toContain("#EXT-X-DISCONTINUITY");
    expect(between.some((l) => l.startsWith("#EXT-X-PROGRAM-DATE-TIME:"))).toBe(true);
    // Never silent: the rows run on from each other.
    const rows = await h.db.select().from(schema.channelItems).where(eq(schema.channelItems.stationId, stations[0])).orderBy(asc(schema.channelItems.seq));
    for (let i = 1; i < rows.length; i++) if (rows[i].kind !== "end" && rows[i - 1].kind !== "end") expect(rows[i].startsAt.getTime()).toBe(rows[i - 1].endsAt.getTime());
  });

  it("reports what copying cost in the worker's health", async () => {
    const { liveCopy } = await engine.stats();
    expect(liveCopy.segments).toBeGreaterThanOrEqual(10);
    expect(liveCopy.skipped).toBeGreaterThanOrEqual(1);
    expect(liveCopy.bytesPulled).toBeGreaterThan(0);
    expect(liveCopy.bytesWritten).toBeGreaterThan(0);
    // Two variants a segment (the 720p and the audio): pictures once for 1080/720/480/360, sound once.
    expect(liveCopy.objectsWritten).toBe(liveCopy.segments * 2);
    expect(liveCopy.bytesPulledPerLiveHour).toBeGreaterThan(0);
    expect(liveCopy.cpuSeconds).toBeGreaterThanOrEqual(0);
    expect(liveCopy.addedLatencyMs!.p95).toBeLessThan(4_000);
  });

  it("deletes a source's copies on a takedown", async () => {
    const rows = await h.db.select().from(schema.channelItems).where(eq(schema.channelItems.liveSourceId, sourceId));
    const keys = rows.flatMap((r) => Object.values(r.liveUris ?? {}).flat()).map((u) => storedSegmentKey(u)!);
    expect(keys.length).toBeGreaterThan(0);
    await expect(h.deps.storage.objects.open!(keys[0])).resolves.toBeTruthy();
    await engine.stopAll();
    const { sessions } = await h.services.playout.dropLiveCopies(sourceId);
    expect(sessions.length).toBe(1);
    for (const key of keys) await expect(h.deps.storage.objects.open!(key)).rejects.toThrow();
  });
});
