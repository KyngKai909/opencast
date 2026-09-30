// The drivers' side of the playlist: hls.js set up for seamless joins, the tags read from every
// playlist load, the program date-time of the picture, and a pre-warmed start.

import { afterEach, describe, expect, it, vi } from "vitest";
import { dateRangeTag, HLS_CLASS } from "@opencast/contracts";
import { fakeFetch, flush, livePlaylist, MASTER } from "../test-helpers";

type Listener = (event: string, data: unknown) => void;
const made: FakeHls[] = [];
class FakeHls {
  static Events = { MANIFEST_PARSED: "manifestParsed", LEVELS_UPDATED: "levelsUpdated", LEVEL_SWITCHED: "levelSwitched", LEVEL_LOADED: "levelLoaded", ERROR: "hlsError", SUBTITLE_TRACKS_UPDATED: "subtitleTracksUpdated", SUBTITLE_TRACK_SWITCH: "subtitleTrackSwitch" };
  static ErrorDetails = { BUFFER_STALLED_ERROR: "bufferStalledError", MANIFEST_LOAD_ERROR: "manifestLoadError", MANIFEST_LOAD_TIMEOUT: "manifestLoadTimeOut", MANIFEST_PARSING_ERROR: "manifestParsingError", MANIFEST_INCOMPATIBLE_CODECS_ERROR: "manifestIncompatibleCodecsError", LEVEL_LOAD_ERROR: "levelLoadError" };
  static ErrorTypes = { NETWORK_ERROR: "networkError", MEDIA_ERROR: "mediaError" };
  static isSupported = () => true;
  private listeners = new Map<string, Listener[]>();
  levels: Array<{ bitrate: number; height: number; videoCodec?: string }> = [
    { bitrate: 650000, height: 360 },
    { bitrate: 2400000, height: 720 }
  ];
  removed: number[] = [];
  removeLevel(i: number) {
    this.removed.push(i);
    this.levels = this.levels.filter((_, j) => j !== i);
  }
  startLevel = -1;
  autoLevelCapping = -1;
  loadLevel = -1;
  manualLevel = -1;
  playingDate: Date | null = null;
  liveSyncPosition = null;
  subtitleTracks: Array<{ id: number; lang: string; name: string }> = [];
  subtitleTrack = -1;
  subtitleDisplay = true;
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
  starts = 0;
  startLoad() {
    this.starts++;
  }
  recoverMediaError() {}
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

describe("hls.js and the rendition ladder", () => {
  it("never plays the audio-only rendition for a picture, and still starts where the pre-warm fetched", () => {
    hlsDriver().attach(document.createElement("video"), "/x/master.m3u8", () => {}, { start: { bandwidth: 650000, syncCount: 3 } });
    const hls = made[0]!;
    // A master without CODECS: hls.js keeps the sound-only level, lowest (height 0).
    hls.levels = [{ bitrate: 140000, height: 0 }, { bitrate: 650000, height: 360 }, { bitrate: 2400000, height: 720 }];
    hls.emit(FakeHls.Events.MANIFEST_PARSED);
    expect(hls.removed).toEqual([0]);
    expect(hls.levels.map((l) => l.height)).toEqual([360, 720]);
    expect(hls.startLevel).toBe(0);
  });

  it("radio keeps its ladder", () => {
    hlsDriver().attach(document.createElement("video"), "/x/master.m3u8", () => {});
    const hls = made[0]!;
    hls.levels = [{ bitrate: 72000, height: 0 }, { bitrate: 140000, height: 0 }];
    hls.emit(FakeHls.Events.MANIFEST_PARSED);
    expect(hls.removed).toEqual([]);
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

/** A video's text track list, as a browser keeps it (jsdom has none): tracks added later fire addtrack. */
function withTextTracks(video: HTMLVideoElement) {
  const list = Object.assign(new EventTarget(), { length: 0 }) as EventTarget & { length: number; [i: number]: { kind: string; mode: string } };
  Object.defineProperty(video, "textTracks", { value: list });
  return (kind: string) => {
    const track = { kind, mode: "disabled" };
    list[list.length] = track;
    list.length++;
    list.dispatchEvent(Object.assign(new Event("addtrack"), { track }));
    return track;
  };
}

describe("captions from the channel's subtitle rendition (X2)", () => {
  it("hls.js: turned on before the master is parsed, the subtitle track is picked once hls.js knows it; off hides it", () => {
    const video = document.createElement("video");
    const add = withTextTracks(video);
    const handle = hlsDriver().attach(video, "/hls/beat/master.m3u8", () => {});
    const hls = made[0]!;
    handle.setCaptions(true);
    // Nothing to pick yet: the master isn't parsed.
    expect(hls.subtitleTrack).toBe(-1);
    expect(hls.subtitleDisplay).toBe(true);
    hls.subtitleTracks = [{ id: 0, lang: "en", name: "English" }];
    hls.emit(FakeHls.Events.MANIFEST_PARSED, { levels: hls.levels });
    expect(hls.subtitleTrack).toBe(0);
    const track = add("subtitles");
    hls.emit(FakeHls.Events.SUBTITLE_TRACK_SWITCH, { id: 0 });
    expect(track.mode).toBe("showing");
    handle.setCaptions(false);
    expect(hls.subtitleDisplay).toBe(false);
    expect(track.mode).toBe("hidden");
  });

  it("hls.js: captions left off never pick a track", () => {
    const video = document.createElement("video");
    hlsDriver().attach(video, "/hls/beat/master.m3u8", () => {});
    const hls = made[0]!;
    hls.subtitleTracks = [{ id: 0, lang: "en", name: "English" }];
    hls.emit(FakeHls.Events.SUBTITLE_TRACKS_UPDATED, { subtitleTracks: hls.subtitleTracks });
    expect(hls.subtitleTrack).toBe(-1);
    expect(hls.subtitleDisplay).toBe(false);
  });

  it("Safari: a caption track that arrives after the setting takes it; metadata tracks are left alone", () => {
    const video = document.createElement("video");
    const add = withTextTracks(video);
    const handle = nativeDriver().attach(video, "/hls/beat/master.m3u8", () => {});
    handle.setCaptions(true);
    const captions = add("captions");
    const metadata = add("metadata");
    expect(captions.mode).toBe("showing");
    expect(metadata.mode).toBe("disabled");
    handle.setCaptions(false);
    expect(captions.mode).toBe("hidden");
    handle.destroy();
  });

  it("hls.js: a master playlist that won't load is said at once (startLoad() can't fetch it again); other network errors are retried first", () => {
    const fatal: string[] = [];
    hlsDriver().attach(document.createElement("video"), "/hls/beat/master.m3u8", (m) => fatal.push(m));
    const hls = made[0]!;
    hls.emit(FakeHls.Events.ERROR, { fatal: true, type: FakeHls.ErrorTypes.NETWORK_ERROR, details: FakeHls.ErrorDetails.MANIFEST_LOAD_ERROR });
    expect(fatal).toEqual(["manifestLoadError"]);
    expect(hls.starts).toBe(0);
    // A media playlist's error: three tries at loading again, then it's said.
    for (let i = 0; i < 4; i++) hls.emit(FakeHls.Events.ERROR, { fatal: true, type: FakeHls.ErrorTypes.NETWORK_ERROR, details: FakeHls.ErrorDetails.LEVEL_LOAD_ERROR });
    expect(hls.starts).toBe(3);
    expect(fatal).toEqual(["manifestLoadError", "levelLoadError"]);
  });
});
