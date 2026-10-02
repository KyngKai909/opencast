// Captions as text (X2), no database and no FFmpeg: SRT turned into WebVTT, a track cut into an
// item's 4-second segments with its X-TIMESTAMP-MAP, and the channel's playlists: the master's
// SUBTITLES rendition, and the subtitle playlist on the same timeline as the pictures (empty
// WebVTT for anything without captions, discontinuities between items, live blocks' own).
import { describe, expect, it } from "vitest";
import { EMPTY_VTT, captionRendition, languageName, languageTag, parseVtt, segmentVtt, toWebVtt, vttContentId } from "../src/v1/lib/captions.js";
import { LADDER } from "../src/v1/modules/playout/engine/ladder.js";
import { parseSubtitles } from "../src/v1/modules/playout/engine/live.js";
import { renderMaster, renderMedia, renderSubtitles, type ChannelRow } from "../src/v1/modules/playout/engine/playlist.js";

describe("SRT to WebVTT", () => {
  it("renumbers nothing, turns commas into points, and keeps italics", () => {
    const srt = "﻿1\r\n00:00:01,000 --> 00:00:03,500\r\n<i>Good evening.</i>\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\nThis is Late Crate.\r\n";
    expect(toWebVtt(srt)).toBe("WEBVTT\n\n00:00:01.000 --> 00:00:03.500\n<i>Good evening.</i>\n\n00:00:04.000 --> 00:00:06.000\nThis is Late Crate.\n");
  });

  it("reads one-digit hours and points, drops font tags and position overrides, and escapes ampersands", () => {
    const srt = "7\n0:01:02.5 --> 0:01:04,250 X1:10 X2:20\n{\\an8}<font color=\"#ffff00\">Rock & roll</font>\n\n8\n00:01:05,000 --> 00:01:06,000\n";
    expect(toWebVtt(srt)).toBe("WEBVTT\n\n00:01:02.500 --> 00:01:04.250\nRock &amp; roll\n");
  });

  it("keeps WebVTT as it is, and refuses what's neither", () => {
    expect(toWebVtt("WEBVTT\r\n\r\n00:01.000 --> 00:02.000\r\nHi")).toBe("WEBVTT\n\n00:01.000 --> 00:02.000\nHi\n");
    expect(toWebVtt("just words")).toBeNull();
    expect(toWebVtt("1\n00:00:01,000 --> 00:00:02,000\n")).toBeNull();
  });
});

describe("a track cut into an item's segments", () => {
  const vtt = [
    "WEBVTT",
    "",
    "STYLE",
    "::cue { color: white }",
    "",
    "NOTE the producer's note",
    "",
    "intro",
    "00:00:01.000 --> 00:00:05.000 line:-2",
    "Good evening.",
    "",
    "00:09.000 --> 00:10.000",
    "This is Late Crate.",
    ""
  ].join("\n");

  it("gives every segment the cues that show during it, on the item's clock, mapped to its first timestamp", () => {
    const segments = segmentVtt(vtt, [4000, 4000, 4000, 1000], 126_000);
    expect(segments).toHaveLength(4);
    const head = "WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:126000,LOCAL:00:00:00.000\n\nSTYLE\n::cue { color: white }\n\n";
    // A cue across a boundary goes in both segments, whole.
    expect(segments[0]).toBe(`${head}intro\n00:00:01.000 --> 00:00:05.000 line:-2\nGood evening.\n`);
    expect(segments[1]).toBe(`${head}intro\n00:00:01.000 --> 00:00:05.000 line:-2\nGood evening.\n`);
    expect(segments[2]).toBe(`${head}00:00:09.000 --> 00:00:10.000\nThis is Late Crate.\n`);
    // No cues: the header alone (the timeline carries on).
    expect(segments[3]).toBe(head);
    const parsed = parseVtt(segments[2]);
    expect(parsed.timestampMap).toEqual({ mpegts: 126_000, localMs: 0 });
    expect(parsed.cues).toEqual([{ id: null, startMs: 9000, endMs: 10_000, settings: "", text: "This is Late Crate." }]);
  });

  it("is stored by content ID, in a folder named for it", () => {
    const { cid } = vttContentId(vtt);
    expect(cid).toMatch(/^bafkrei[a-z2-7]+$/);
    expect(vttContentId(vtt).cid).toBe(cid);
    expect(captionRendition(cid)).toMatch(/^cc[0-9a-f]{12}$/);
  });

  it("names languages as BCP 47, in themselves", () => {
    expect(languageTag("eng")).toBe("en");
    expect(languageTag("spa")).toBe("es");
    expect(languageTag("und")).toBeNull();
    expect(languageTag("pt-BR")).toBe("pt-br");
    expect(languageName("en")).toBe("English");
    expect(languageName("es")).toBe("Español");
  });
});

describe("the master playlist", () => {
  it("names a subtitle rendition on the TV band, off unless chosen, and every variant points at it", () => {
    const master = renderMaster("tv", LADDER, { language: "en", name: "English" });
    const lines = master.split("\n");
    expect(lines[3]).toBe(
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=YES,FORCED=NO,CHARACTERISTICS="public.accessibility.transcribes-spoken-dialog,public.accessibility.describes-music-and-sound",URI="subs.m3u8"'
    );
    const variants = lines.filter((l) => l.startsWith("#EXT-X-STREAM-INF"));
    expect(variants).toHaveLength(5);
    for (const v of variants) expect(v.endsWith(',SUBTITLES="subs"')).toBe(true);
    expect(lines.filter((l) => l && !l.startsWith("#"))).toEqual(["v720.m3u8", "v1080.m3u8", "v480.m3u8", "v360.m3u8", "a128.m3u8"]);
  });

  it("has none without captions to offer (the radio band)", () => {
    const radio = renderMaster("radio", LADDER);
    expect(radio).not.toContain("SUBTITLES");
  });
});

describe("the subtitle playlist", () => {
  const t0 = Date.parse("2026-10-02T03:00:00.000Z");
  const row = (over: Partial<ChannelRow>): ChannelRow => ({
    id: "r",
    run: 1,
    seq: 0,
    disc: 0,
    discontinuity: true,
    startsAt: new Date(t0),
    endsAt: new Date(t0),
    kind: "prepared",
    preparedKey: null,
    firstSegment: 0,
    segments: 0,
    segmentMs: [],
    liveUris: null,
    tags: [],
    ...over
  });
  // A program joined at its second segment (captions), a spot (none), a live block whose source
  // has captions for its second segment only.
  const rows = [
    row({ id: "pgm", seq: 10, disc: 3, preparedKey: "bafyprogram", firstSegment: 1, segments: 2, segmentMs: [4000, 4000], startsAt: new Date(t0), endsAt: new Date(t0 + 8000), tags: ['#EXT-X-DATERANGE:ID="pgm-item"'] }),
    row({ id: "spt", seq: 12, disc: 4, preparedKey: "bafyspot", segments: 2, segmentMs: [4000, 3000], startsAt: new Date(t0 + 8000), endsAt: new Date(t0 + 15_000) }),
    row({ id: "live", seq: 14, disc: 5, kind: "live", segments: 2, segmentMs: [4000, 4000], liveUris: { v720: ["https://lp/a.ts", "https://lp/b.ts"], subs: ["", "https://lp/b.vtt"] }, startsAt: new Date(t0 + 15_000), endsAt: new Date(t0 + 23_000) })
  ];
  const now = t0 + 30_000;
  const uri = (r: ChannelRow, index: number) => (r.preparedKey === "bafyprogram" && index < 3 ? `https://cdn/prepared/bafyprogram/cc0123456789ab/seg_${String(index).padStart(5, "0")}.vtt` : null);

  it("follows the pictures' timeline: the same sequences, discontinuities and program date-times", () => {
    const subs = renderSubtitles({ rows, now, uri, empty: "empty.vtt" })!;
    const media = renderMedia({ rows, rendition: "v720", now, lengths: () => null, uri: (k, i) => `https://cdn/prepared/${k}/v720/seg_${i}.ts` })!;
    const header = (text: string) => text.split("\n").filter((l) => /^#EXT-X-(MEDIA-SEQUENCE|DISCONTINUITY-SEQUENCE|TARGETDURATION)/.test(l));
    expect(header(subs)).toEqual(header(media));
    const structure = (text: string) => text.split("\n").filter((l) => l === "#EXT-X-DISCONTINUITY" || l.startsWith("#EXT-X-PROGRAM-DATE-TIME") || l.startsWith("#EXTINF"));
    expect(structure(subs)).toEqual(structure(media));
    // No DATERANGE tags: they're on the media playlists.
    expect(subs).not.toContain("#EXT-X-DATERANGE");
  });

  it("points at the item's caption segments from where it was joined, empty WebVTT for what has none, and a live block's own", () => {
    const subs = renderSubtitles({ rows, now, uri, empty: "empty.vtt" })!;
    const uris = subs.split("\n").filter((l) => l && !l.startsWith("#"));
    expect(uris).toEqual([
      "https://cdn/prepared/bafyprogram/cc0123456789ab/seg_00001.vtt",
      "https://cdn/prepared/bafyprogram/cc0123456789ab/seg_00002.vtt",
      "empty.vtt",
      "empty.vtt",
      "empty.vtt",
      "https://lp/b.vtt"
    ]);
    expect(subs.split("\n").filter((l) => l === "#EXT-X-DISCONTINUITY")).toHaveLength(2);
    expect(EMPTY_VTT).toBe("WEBVTT\n");
  });

  it("ends with the playlist at a planned sign-off", () => {
    const ended = [...rows, row({ id: "end", seq: 16, disc: 5, kind: "end", discontinuity: false, startsAt: new Date(t0 + 23_000), endsAt: new Date(t0 + 23_000) })];
    expect(renderSubtitles({ rows: ended, now, uri, empty: "empty.vtt" })!.trimEnd().endsWith("#EXT-X-ENDLIST")).toBe(true);
  });
});

describe("a live source's captions", () => {
  it("are read from its master's subtitle rendition, when it names one", () => {
    const master = '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",NAME="English",URI="subs/index.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1280x720\n720p/index.m3u8\n';
    expect(parseSubtitles(master, "https://lp.example/hls/abc/index.m3u8")).toBe("https://lp.example/hls/abc/subs/index.m3u8");
    expect(parseSubtitles("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n720p/index.m3u8\n", "https://lp.example/")).toBeNull();
  });
});
