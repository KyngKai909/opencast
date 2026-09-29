// The drivers' side of the playlist: hls.js set up for seamless joins, the tags read from every
// playlist load, the program date-time of the picture, and a pre-warmed start.

import { afterEach, describe, expect, it, vi } from "vitest";
import { dateRangeTag, HLS_CLASS } from "@opencast/contracts";
import { fakeFetch, flush, livePlaylist, MASTER } from "../test-helpers";

type Listener = (event: string, data: unknown) => void;
const made: FakeHls[] = [];
class FakeHls {
  static Events = { MANIFEST_PARSED: "manifestParsed", LEVELS_UPDATED: "levelsUpdated", LEVEL_SWITCHED: "levelSwitched", LEVEL_LOADED: "levelLoaded", ERROR: "hlsError" };
  static ErrorDetails = { BUFFER_STALLED_ERROR: "bufferStalledError" };
  static ErrorTypes = { NETWORK_ERROR: "networkError", MEDIA_ERROR: "mediaError" };
  static isSupported = () => true;
  private listeners = new Map<string, Listener[]>();
  levels = [
    { bitrate: 650000, height: 360 },
    { bitrate: 2400000, height: 720 }
  ];
  startLevel = -1;
  autoLevelCapping = -1;
  loadLevel = -1;
  manualLevel = -1;
  playingDate: Date | null = null;
  liveSyncPosition = null;
  constructor(public config: Record<string, unknown>) {
    made.push(this);
  }
  on(event: string, l: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), l]);
  }
  emit(event: string, data: unknown = {}) {
    for (const l of this.listeners.get(event) ?? []) l(event, data);
  }
  loadSource() {}
  attachMedia() {}
  destroy() {}
}

vi.mock("hls.js", () => ({ default: FakeHls }));

const { hlsDriver, nativeDriver, JOIN_CONFIG } = await import("./driver");

afterEach(() => {
  made.length = 0;
  vi.useRealTimers();
});

describe("hls.js, set up for joins", () => {
  it("stretches a short video track (the last frame holds), jumps small holes, fills gaps in the sound, and nudges past a stall quickly", () => {
    hlsDriver().attach(document.createElement("video"), "/mock-hls/beat/master.m3u8", () => {});
    const c = made[0]!.config;
    expect(c).toMatchObject({ stretchShortVideoTrack: true, maxBufferHole: 0.5, maxAudioFramesDrift: 1, forceKeyFrameOnDiscontinuity: true, highBufferWatchdogPeriod: 1, nudgeMaxRetry: 5, liveSyncDurationCount: 3 });
    expect(c).toMatchObject(JOIN_CONFIG);
    // The tags are read from the playlist text, so hls.js needn't make metadata cues of them.
    expect(c.enableDateRangeMetadataCues).toBe(false);
  });

  it("reads every playlist load's tags with the contract's parser, and whether it ended", () => {
    const loads: unknown[] = [];
    hlsDriver().attach(document.createElement("video"), "/x/master.m3u8", () => {}, { onPlaylist: (i) => loads.push(i) });
    const start = Date.parse("2026-09-27T03:30:00Z");
    const tag = dateRangeTag({ id: "bug-1", class: HLS_CLASS.bug, start, durationSeconds: 40, attributes: { mode: "call_sign_and_channel", callSign: "BEAT", channel: "12.1", position: "bottom_right", opacity: 78 } });
    const m3u8 = livePlaylist({ first: 10, count: 3, pdt: start, extra: [tag], ended: true });
    made[0]!.emit(FakeHls.Events.LEVEL_LOADED, { details: { m3u8, url: "http://localhost/x/live.m3u8" } });
    expect(loads).toEqual([
      {
        ended: true,
        edge: start + 6000,
        ranges: [{ id: "bug-1", class: HLS_CLASS.bug, start, end: start + 40_000, scte35Out: null, scte35In: null, attributes: { mode: "call_sign_and_channel", callSign: "BEAT", channel: "12.1", position: "bottom_right", opacity: 78 } }]
      }
    ]);
  });

  it("gives the picture's program date-time, and starts a pre-warmed station where its segment was fetched", () => {
    const h = hlsDriver().attach(document.createElement("video"), "/x/master.m3u8", () => {}, { start: { bandwidth: 650000, syncCount: 4 } });
    const hls = made[0]!;
    expect(hls.config.liveSyncDurationCount).toBe(4);
    hls.startLevel = -1;
    hls.emit(FakeHls.Events.MANIFEST_PARSED);
    expect(hls.startLevel).toBe(0);
    expect(h.programDate()).toBeNull();
    hls.playingDate = new Date(1_000_000);
    expect(h.programDate()).toBe(1_000_000);
  });
});

describe("the browser's own HLS", () => {
  it("polls the playlist for its tags, and maps its start date onto the timeline", async () => {
    vi.useFakeTimers();
    const f = fakeFetch((url) => (url.endsWith("master.m3u8") ? MASTER : url.endsWith(".m3u8") ? livePlaylist({ first: 1, pdt: 0 }) : null));
    const loads: unknown[] = [];
    const v = document.createElement("video");
    const h = nativeDriver().attach(v, "http://localhost/x/master.m3u8", () => {}, { fetch: f.fetch, onPlaylist: (i) => loads.push(i) });
    await flush(0);
    // The master once, then the first variant's playlist (the tags are the same in every rendition).
    expect(f.urls).toEqual(["http://localhost/x/master.m3u8", "http://localhost/x/hi.m3u8"]);
    expect(loads).toHaveLength(1);
    await flush(2000);
    expect(f.urls.filter((u) => u.endsWith("hi.m3u8"))).toHaveLength(2);
    Object.assign(v, { getStartDate: () => new Date(5_000_000) });
    Object.defineProperty(v, "currentTime", { value: 3, configurable: true });
    expect(h.programDate()).toBe(5_003_000);
    h.destroy();
    await flush(10_000);
    expect(f.urls.filter((u) => u.endsWith("hi.m3u8"))).toHaveLength(2);
  });
});
