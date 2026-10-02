// Captions on: one caption or subtitle track showing, never two. A stream can carry the same words
// twice, a subtitle rendition and the captions embedded in the video (CEA-608, "CC1"), and showing
// both drew every line twice. The track shown is the subtitle rendition in the viewer's language (or
// English), else any subtitle rendition, else the embedded captions; the rest stay hidden. Metadata
// tracks are left alone.

type Track = Pick<TextTrack, "kind" | "language" | "label" | "mode">;

/** The one caption track to show, or null when there's none. */
export function captionTrackToShow<T extends Track>(tracks: readonly T[], languages: readonly string[] = viewerLanguages()): T | null {
  const text = tracks.filter((t) => t.kind === "subtitles" || t.kind === "captions");
  if (!text.length) return null;
  const lang = (t: T) => (t.language || "").toLowerCase().split("-")[0];
  const wanted = [...languages.map((l) => l.toLowerCase().split("-")[0]), "en"];
  const subtitles = text.filter((t) => t.kind === "subtitles");
  for (const l of wanted) {
    const match = subtitles.find((t) => lang(t) === l) ?? text.find((t) => lang(t) === l);
    if (match) return match;
  }
  return subtitles[0] ?? text[0]!;
}

/** Shows the one caption track (captions on), or hides them all (off). */
export function showTextTracks(video: HTMLVideoElement, on: boolean) {
  const tracks = Array.from(video.textTracks ?? []);
  const shown = on ? captionTrackToShow(tracks) : null;
  for (const t of tracks) {
    if (t.kind !== "subtitles" && t.kind !== "captions") continue;
    const mode = t === shown ? "showing" : "hidden";
    if (t.mode !== mode) t.mode = mode;
  }
}

function viewerLanguages(): string[] {
  if (typeof navigator === "undefined") return [];
  return [...(navigator.languages ?? []), navigator.language].filter((l): l is string => !!l);
}
