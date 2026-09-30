// The player and the channel's playlist: pre-warming the neighbours (playlists and a first
// segment, nothing more), the graphics its DATERANGE tags time, joins between items, and the
// sign-off (ENDLIST after the slate) with coming back when a new playlist appears.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dateRangeTag, HLS_CLASS, parseDateRanges } from "@opencast/contracts";
import { PlayerEngine } from "./PlayerEngine";
import { CHANGE_MS, fakeDriver, fakeFetch, flush, until, frameDelay, livePlaylist, MASTER, station, stubMedia, type FakeHandle } from "../test-helpers";

const CIVC = station("CIVC", "7.1");
const BEAT = station("BEAT", "12.1");
const REEL = station("REEL", "24.1");
const dial = [CIVC, BEAT, REEL];
const slug = (c: typeof CIVC) => c.station.callSign!.toLowerCase();

const T0 = Date.parse("2026-09-27T03:30:00Z");
const s = (seconds: number) => T0 + seconds * 1000;
const tags = (...lines: string[]) => parseDateRanges(["#EXTM3U", ...lines].join("\n"));

let driver: ReturnType<typeof fakeDriver>;
let host: HTMLDivElement;
let engine: PlayerEngine | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(s(0));
  stubMedia();
  for (const k of Object.keys(frameDelay)) delete frameDelay[k];
  driver = fakeDriver();
  host = document.createElement("div");
});
afterEach(() => {
  engine?.destroy();
  engine = null;
  vi.useRealTimers();
});

function make(o: ConstructorParameters<typeof PlayerEngine>[0] = {}) {
  engine = new PlayerEngine({ driver, bannerMs: 5000, ...o });
  engine.attach(host);
  engine.setChannels(dial);
  return engine;
}
async function tuned(e: PlayerEngine, c: typeof CIVC) {
  await until(e.tune(c.station.id));
}
const handleFor = (c: typeof CIVC): FakeHandle => driver.handles.filter((h) => h.url.includes(`/${slug(c)}/`) && !h.destroyed).at(-1)!;
const videoFor = (c: typeof CIVC) => host.querySelector<HTMLVideoElement>(`video[data-station="${c.station.id}"]`);

describe("pre-warming the neighbours", () => {
  /** Each station's live playlist moves on one segment every 2 seconds of the fake clock. */
  const serve = (ended = () => false) => (url: string) => {
    if (url.endsWith("/master.m3u8")) return MASTER;
    if (url.endsWith(".m3u8")) return livePlaylist({ first: 100 + Math.floor((Date.now() - s(0)) / 2000), ended: ended() });
    if (url.endsWith(".ts")) return "segment";
    return null;
  };

  it("fetches only their playlists and the segment a switch starts on: no <video>, one rendition", async () => {
    const f = fakeFetch(serve());
    const e = make({ fetch: f.fetch });
    await tuned(e, BEAT);
    await flush(0);
    // BEAT is on screen; CIVC (down) and REEL (up) are its neighbours.
    for (const n of [CIVC, REEL]) {
      const mine = f.urls.filter((u) => u.includes(`/${slug(n)}/`)).map((u) => u.slice(u.lastIndexOf("/") + 1));
      // The master, the lowest rendition's playlist (not hi.m3u8), and its segment 3 from the end (100..105: 103).
      expect(mine).toEqual(["master.m3u8", "live.m3u8", "seg_103.ts"]);
    }
    expect(f.urls.some((u) => u.includes("/beat/"))).toBe(false);
    // Only the picture on screen has a player.
    expect(driver.handles.map((h) => h.url)).toEqual([BEAT.playback!.url]);
    expect(host.querySelectorAll("video")).toHaveLength(1);
    expect(e.getState().warm.map((w) => w.state)).toEqual(["prefetched", "prefetched"]);
  });

  it("keeps them fresh every two target durations: the playlist and one segment, not the master again", async () => {
    const f = fakeFetch(serve());
    const e = make({ fetch: f.fetch });
    await tuned(e, BEAT);
    await flush(0);
    f.urls.length = 0;
    await flush(4000);
    const civc = f.urls.filter((u) => u.includes("/civc/")).map((u) => u.slice(u.lastIndexOf("/") + 1));
    expect(civc).toEqual(["live.m3u8", "seg_105.ts"]);
  });

  it("a switch starts on the fetched segment, at its rendition, and counts as warm", async () => {
    const f = fakeFetch(serve());
    const e = make({ fetch: f.fetch });
    await tuned(e, BEAT);
    await flush(0);
    // A second on: the playlist hasn't moved a whole segment, so join 3 from the end, as fetched.
    await flush(1000);
    await tuned(e, CIVC);
    expect(handleFor(CIVC).start).toEqual({ bandwidth: 650000, syncCount: 3 });
    expect(e.getState().lastTune).toMatchObject({ stationId: CIVC.station.id, warm: true });
    // Now BEAT is a neighbour, warmed the same way; REEL isn't one any more (CIVC's neighbours are REEL, wrapping, and BEAT).
    await flush(0);
    expect(e.getState().warm.map((w) => w.stationId).sort()).toEqual([BEAT.station.id, REEL.station.id].sort());
  });

  it("a segment later, the switch joins one further back, so it still starts on the fetched segment", async () => {
    const f = fakeFetch(serve());
    const e = make({ fetch: f.fetch });
    await tuned(e, BEAT);
    await flush(0);
    await flush(2500);
    await tuned(e, REEL);
    expect(handleFor(REEL).start).toEqual({ bandwidth: 650000, syncCount: 4 });
  });

  it("'playlists' fetches the playlists only; 'best' prefetches the top rendition", async () => {
    const f = fakeFetch(serve());
    const e = make({ fetch: f.fetch, warm: "playlists" });
    await tuned(e, BEAT);
    await flush(0);
    expect(f.urls.filter((u) => u.endsWith(".ts"))).toEqual([]);
    e.destroy();
    const g = fakeFetch(serve());
    const e2 = make({ fetch: g.fetch, quality: "best" });
    await tuned(e2, BEAT);
    await flush(0);
    expect(g.urls.filter((u) => u.includes("/civc/")).map((u) => u.slice(u.lastIndexOf("/") + 1))).toEqual(["master.m3u8", "hi.m3u8", "seg_103.ts"]);
  });
});

// The worker's tags for one minute of BEAT: a program with the bug, then a break (a spot with its
// code for the last 10 s, then a station ID). Items are separate discontinuities.
const minute = tags(
  dateRangeTag({ id: "item-1", class: HLS_CLASS.item, start: s(0), durationSeconds: 40, attributes: { code: "PGM", contentId: "bafy-p", title: "Saturday Reel", carriedFrom: "REEL" } }),
  dateRangeTag({ id: "bug-1", class: HLS_CLASS.bug, start: s(0), durationSeconds: 40, attributes: { mode: "call_sign_and_channel", callSign: "BEAT", channel: "12.1", position: "bottom_right", opacity: 78 } }),
  dateRangeTag({ id: "break-1", class: HLS_CLASS.break, start: s(40), durationSeconds: 20, scte35Out: "0xFC30", scte35In: "0xFC31", attributes: { breakId: "br-1" } }),
  dateRangeTag({ id: "item-2", class: HLS_CLASS.item, start: s(40), durationSeconds: 16, attributes: { code: "SPT", contentId: "bafy-s", title: "Fall at Orange Street" } }),
  dateRangeTag({ id: "code-1", class: HLS_CLASS.code, start: s(46), durationSeconds: 10, attributes: { spotId: "spot-1", code: "ORANGE10", offer: "10% off", qrUrl: "https://useopencast.org/c/ORANGE10" } })
);

describe("the graphics, timed from the playlist's tags", () => {
  it("follows the picture's program date-time: the bug over the program, the code in the spot's last seconds", async () => {
    const e = make({ warm: "none" });
    await tuned(e, BEAT);
    const h = handleFor(BEAT);
    h.playlist({ ranges: minute });
    h.programDate = s(12);
    await flush(300);
    expect(e.getState().onScreen).toMatchObject({ stationId: BEAT.station.id, item: { code: "PGM" }, bug: { callSign: "BEAT", channel: "12.1", position: "bottom_right", opacity: 78 }, code: null });
    h.programDate = s(44);
    await flush(300);
    expect(e.getState().onScreen).toMatchObject({ item: { code: "SPT" }, inBreak: { breakId: "br-1" }, bug: null, code: null });
    h.programDate = s(47);
    await flush(300);
    expect(e.getState().onScreen?.code).toMatchObject({ code: "ORANGE10", offer: "10% off" });
    h.programDate = s(56.5);
    await flush(300);
    expect(e.getState().onScreen?.code).toBeNull();
  });

  it("while paused the graphics hold with the picture; tuning away clears them", async () => {
    const e = make({ warm: "none" });
    await tuned(e, BEAT);
    const h = handleFor(BEAT);
    h.playlist({ ranges: minute });
    h.programDate = s(12);
    await flush(300);
    e.pause();
    await flush(1000);
    expect(e.getState().onScreen?.bug?.id).toBe("bug-1");
    await tuned(e, CIVC);
    expect(e.getState().onScreen).toMatchObject({ stationId: CIVC.station.id, bug: null });
  });
});

describe("joins between items", () => {
  it("keeps the picture on screen across a discontinuity: no black, no tuning state, the graphics switch at the join", async () => {
    const e = make({ warm: "none" });
    await tuned(e, BEAT);
    const h = handleFor(BEAT);
    h.playlist({ ranges: minute });
    h.programDate = s(39.9);
    await flush(300);
    expect(e.getState().onScreen?.item?.code).toBe("PGM");
    // At the join the element may wait a moment for the next item's first frame.
    const v = videoFor(BEAT)!;
    v.dispatchEvent(new Event("waiting"));
    h.programDate = s(40.1);
    await flush(300);
    expect(v.classList.contains("is-on")).toBe(true);
    expect(e.getState()).toMatchObject({ status: "playing", pendingId: null, error: null });
    expect(e.getState().onScreen).toMatchObject({ item: { code: "SPT" }, bug: null });
    v.dispatchEvent(new Event("playing"));
    expect(e.getState().banner).not.toBeNull(); // (the tune's banner, not a new one)
  });
});

describe("the sign-off", () => {
  const BACK = "2026-09-27T03:32:00.000Z"; // s(120)
  const signOff = dateRangeTag({ id: "off-1", class: HLS_CLASS.signOff, start: s(54), durationSeconds: 6, attributes: { backAt: BACK } });

  it("plays the slate out, then shows off air with the back time; at the back time it tunes back in when the new playlist is there", async () => {
    let back = false;
    const f = fakeFetch((url) => (url.endsWith("master.m3u8") ? MASTER : url.endsWith(".m3u8") ? livePlaylist({ first: 1, ended: !back }) : null));
    const e = make({ warm: "none", fetch: f.fetch });
    await tuned(e, BEAT);
    const h = handleFor(BEAT);
    h.playlist({ ranges: minute, edge: s(50) });
    h.programDate = s(55);
    // The reload after the slate's last segment: ENDLIST.
    h.playlist({ ranges: tags(signOff), ended: true, edge: s(60) });
    await flush(100);
    // The slate is still playing.
    expect(e.getState().status).toBe("playing");
    h.programDate = s(60);
    videoFor(BEAT)!.dispatchEvent(new Event("ended"));
    expect(e.getState()).toMatchObject({ status: "off_air", currentId: BEAT.station.id, offAir: { stationId: BEAT.station.id, backAt: BACK }, onScreen: null });
    expect(h.destroyed).toBe(true);
    // Nothing is fetched until the back time (60 s on the stream's clock).
    await flush(59_000);
    expect(f.urls).toEqual([]);
    // At the back time it looks: still ended, so it waits and looks again.
    await flush(1_000);
    expect(f.urls.length).toBeGreaterThan(0);
    expect(e.getState().status).toBe("off_air");
    back = true;
    await flush(5_000);
    await flush(10);
    expect(e.getState()).toMatchObject({ status: "playing", currentId: BEAT.station.id, offAir: null });
    expect(handleFor(BEAT).destroyed).toBe(false);
    expect(e.getState().banner?.stationId).toBe(BEAT.station.id);
  });

  it("tuning to a station whose playlist has already ended shows off air at once, without playing the slate", async () => {
    const e = make({ warm: "none", fetch: fakeFetch(() => null).fetch });
    await tuned(e, BEAT);
    frameDelay[REEL.station.id] = 1000;
    const t = e.tune(REEL.station.id);
    await flush(10);
    handleFor(REEL).playlist({ ranges: tags(signOff), ended: true, edge: s(60) });
    await t;
    expect(e.getState()).toMatchObject({ status: "off_air", currentId: REEL.station.id, pendingId: null, offAir: { stationId: REEL.station.id, backAt: BACK }, lastId: BEAT.station.id });
    expect(videoFor(REEL)).toBeNull();
    // Channels still work from here.
    e.handle({ type: "channel", dir: "down" });
    await flush(CHANGE_MS);
    expect(e.getState()).toMatchObject({ currentId: BEAT.station.id, status: "playing", offAir: null });
  });

  it("off air by the dial, it tunes back in when the dial says it's on again", async () => {
    const e = make({ warm: "none" });
    const off = { ...REEL, onAir: false, playback: null };
    e.setChannels([CIVC, BEAT, off]);
    await e.tune(REEL.station.id);
    expect(e.getState().status).toBe("off_air");
    e.setChannels(dial);
    await flush(10);
    expect(e.getState()).toMatchObject({ status: "playing", currentId: REEL.station.id });
  });
});
