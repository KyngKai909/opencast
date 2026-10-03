// Captions on: one track showing, never two, when a stream carries the same words twice (a subtitle
// rendition and the captions embedded in the video).

import { describe, expect, it } from "vitest";
import { captionTrackToShow, showTextTracks } from "./textTracks";

const track = (kind: TextTrackKind, language = "", label = "") => ({ kind, language, label, mode: "disabled" as TextTrackMode });

describe("one caption track at a time", () => {
  it("prefers the subtitle rendition in the viewer's language, then English, then any, then the embedded captions", () => {
    const cc = track("captions", "en", "CC1");
    const en = track("subtitles", "en", "English");
    const es = track("subtitles", "es", "Español");
    expect(captionTrackToShow([cc, en, es], ["es-US"])).toBe(es);
    expect(captionTrackToShow([cc, en, es], ["fr"])).toBe(en);
    expect(captionTrackToShow([cc, es], ["fr"])).toBe(cc);
    expect(captionTrackToShow([track("subtitles", "de")], ["fr"])?.language).toBe("de");
    expect(captionTrackToShow([cc], ["en"])).toBe(cc);
    expect(captionTrackToShow([track("metadata")], ["en"])).toBeNull();
  });

  it("shows exactly one when on, none when off, and leaves metadata tracks alone", () => {
    const cc = track("captions", "en", "CC1");
    const en = track("subtitles", "en", "English");
    const meta = { ...track("metadata"), mode: "hidden" as TextTrackMode };
    const video = { textTracks: [cc, en, meta] } as unknown as HTMLVideoElement;
    showTextTracks(video, true);
    expect([cc.mode, en.mode, meta.mode]).toEqual(["hidden", "showing", "hidden"]);
    showTextTracks(video, false);
    expect([cc.mode, en.mode, meta.mode]).toEqual(["hidden", "hidden", "hidden"]);
  });
});
