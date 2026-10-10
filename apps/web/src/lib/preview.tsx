// A prepared file's preview player (its VOD HLS: native where the browser has it, Safari, and
// hls.js elsewhere). The desk's station file plays uploads with it; the control room's library
// item (programming Phase 4) plays each suggested break point from two seconds before, `startAt`.

import { useEffect, useRef } from "react";

export function PreparedVideo({ url, title, startAt = 0, onFailed }: { url: string; title: string; startAt?: number; onFailed?: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const failed = useRef(onFailed);
  failed.current = onFailed;
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const fail = () => failed.current?.();
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      const cue = () => {
        if (startAt > 0) video.currentTime = startAt;
      };
      video.addEventListener("loadedmetadata", cue, { once: true });
      video.src = url;
      return () => video.removeEventListener("loadedmetadata", cue);
    }
    let destroy: (() => void) | undefined;
    let gone = false;
    void import("hls.js")
      .then(({ default: Hls }) => {
        if (gone) return;
        if (!Hls.isSupported()) return fail();
        const hls = new Hls(startAt > 0 ? { startPosition: startAt } : {});
        hls.on(Hls.Events.ERROR, (_e, data) => data.fatal && fail());
        hls.loadSource(url);
        hls.attachMedia(video);
        destroy = () => hls.destroy();
      })
      .catch(fail);
    return () => {
      gone = true;
      destroy?.();
    };
  }, [url, startAt]);
  return <video ref={ref} controls autoPlay playsInline aria-label={`Preview of ${title}`} />;
}
