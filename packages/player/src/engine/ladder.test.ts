// The station's playback URL is a master playlist with a rendition ladder (prepare once, then
// assemble): TV 1080p, 720p, 480p, 360p and an audio-only rendition, the reference (720p) listed
// first; radio AAC 128k and 64k. The pre-warm starts on the lowest picture, never the audio-only
// rendition; hls.js never plays the audio-only rendition for a picture; radio keeps its ladder.

import { describe, expect, it } from "vitest";
import { audioOnlyLevels, bestLevel, dataSaverLevel } from "./driver";
import { loadMedia, pictureVariants, startVariant, variants } from "./playlist";
import { fakeFetch, livePlaylist, MASTER, RADIO_MASTER } from "../test-helpers";

/** The API's master for a TV station (renderMaster), reference first. */
const API_TV = [
  "#EXTM3U",
  "#EXT-X-VERSION:6",
  "#EXT-X-INDEPENDENT-SEGMENTS",
  '#EXT-X-STREAM-INF:BANDWIDTH=3208000,AVERAGE-BANDWIDTH=2928000,CODECS="avc1.64001f,mp4a.40.2",RESOLUTION=1280x720,FRAME-RATE=30.000',
  "v720.m3u8",
  '#EXT-X-STREAM-INF:BANDWIDTH=5628000,AVERAGE-BANDWIDTH=5128000,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=30.000',
  "v1080.m3u8",
  '#EXT-X-STREAM-INF:BANDWIDTH=1668000,AVERAGE-BANDWIDTH=1528000,CODECS="avc1.64001e,mp4a.40.2",RESOLUTION=854x480,FRAME-RATE=30.000',
  "v480.m3u8",
  '#EXT-X-STREAM-INF:BANDWIDTH=976000,AVERAGE-BANDWIDTH=896000,CODECS="avc1.64001e,mp4a.40.2",RESOLUTION=640x360,FRAME-RATE=30.000',
  "v360.m3u8",
  '#EXT-X-STREAM-INF:BANDWIDTH=128000,AVERAGE-BANDWIDTH=128000,CODECS="mp4a.40.2"',
  "a128.m3u8",
  ""
].join("\n");

const BASE = "http://localhost/hls/beat/master.m3u8";
const names = (list: { url: string }[]) => list.map((v) => v.url.slice(v.url.lastIndexOf("/") + 1));

describe("reading the ladder", () => {
  it("reads every rendition with its bandwidth (not the average), height, and whether it's sound only", () => {
    const list = variants(API_TV, BASE);
    expect(names(list)).toEqual(["v720.m3u8", "v1080.m3u8", "v480.m3u8", "v360.m3u8", "a128.m3u8"]);
    expect(list.map((v) => [v.bandwidth, v.height, v.audioOnly])).toEqual([
      [3208000, 720, false],
      [5628000, 1080, false],
      [1668000, 480, false],
      [976000, 360, false],
      [128000, 0, true]
    ]);
    expect(list[0]!.url).toBe("http://localhost/hls/beat/v720.m3u8");
  });

  it("without CODECS, the rendition with no RESOLUTION next to pictures is the sound-only one", () => {
    const bare = ["#EXTM3U", "#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360", "v360.m3u8", "#EXT-X-STREAM-INF:BANDWIDTH=128000", "a128.m3u8", ""].join("\n");
    expect(variants(bare, BASE).map((v) => v.audioOnly)).toEqual([false, true]);
    // Radio with no CODECS: nothing has a picture, so nothing is left out.
    const radio = ["#EXTM3U", "#EXT-X-STREAM-INF:BANDWIDTH=140000", "a128.m3u8", "#EXT-X-STREAM-INF:BANDWIDTH=72000", "a64.m3u8", ""].join("\n");
    expect(pictureVariants(variants(radio, BASE))).toHaveLength(2);
  });
});

describe("where the pre-warm starts", () => {
  it("TV: the lowest picture, never the audio-only rendition (its bandwidth is lower)", () => {
    const list = variants(API_TV, BASE);
    expect(names([startVariant(list, "auto")!])).toEqual(["v360.m3u8"]);
    expect(names([startVariant(list, "data_saver")!])).toEqual(["v360.m3u8"]);
    expect(names([startVariant(list, "best")!])).toEqual(["v1080.m3u8"]);
  });

  it("radio: the lowest rendition (64k); best, the 128k", () => {
    const list = variants(RADIO_MASTER, BASE);
    expect(names([startVariant(list, "auto")!])).toEqual(["a64.m3u8"]);
    expect(names([startVariant(list, "best")!])).toEqual(["a128.m3u8"]);
  });

  it("fetches the master, then the lowest picture's playlist", async () => {
    const f = fakeFetch((url) => (url.endsWith("master.m3u8") ? MASTER : url.endsWith(".m3u8") ? livePlaylist({ first: 1 }) : null));
    const { variant, media } = await loadMedia(f.fetch, "http://localhost/mock-hls/beat/master.m3u8");
    expect(variant).toMatchObject({ bandwidth: 650000, height: 360, audioOnly: false });
    expect(media.segments).toHaveLength(6);
    expect(names(f.urls.map((url) => ({ url })))).toEqual(["master.m3u8", "live.m3u8"]);
  });
});

describe("hls.js levels", () => {
  // As hls.js sorts them: height, then bitrate.
  const tv = [
    { bitrate: 128000, height: 0 },
    { bitrate: 976000, height: 360, videoCodec: "avc1.64001e" },
    { bitrate: 1668000, height: 480, videoCodec: "avc1.64001e" },
    { bitrate: 3208000, height: 720, videoCodec: "avc1.64001f" },
    { bitrate: 5628000, height: 1080, videoCodec: "avc1.640028" }
  ];

  it("a picture drops the audio-only level (when hls.js hasn't already)", () => {
    expect(audioOnlyLevels(tv)).toEqual([0]);
    expect(audioOnlyLevels(tv.slice(1))).toEqual([]);
  });

  it("radio keeps every level", () => {
    expect(audioOnlyLevels([{ bitrate: 72000 }, { bitrate: 140000 }])).toEqual([]);
  });

  it("data saver holds 480 lines and best the top, on the ladder without its audio-only level", () => {
    const pictures = tv.slice(1);
    expect(pictures[dataSaverLevel(pictures)]!.height).toBe(480);
    expect(pictures[bestLevel(pictures)]!.height).toBe(1080);
  });
});
