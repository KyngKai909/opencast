// The delivered spot, to check before approving (production orders 05.1, 06.1): the picture and
// its playhead. A real file plays in a <video>; the mock's deliveries carry the still the frames
// draw for them (a `#card=` fragment: title, line, colour), and a still "plays" on a timer so the
// scrub bar and notes work the same.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { PictureFrame } from "@opencast/ui";
import "./DeliveryPicture.css";

export interface Card {
  title: string;
  line: string;
  colour: string;
}

/** The still a mock delivery carries in its URL, if any. */
export function cardOf(url: string): Card | null {
  const hash = url.split("#card=")[1];
  if (!hash) return null;
  const q = new URLSearchParams(decodeURIComponent(hash));
  const title = q.get("title");
  return title ? { title, line: q.get("line") ?? "", colour: q.get("colour") ?? "#6B4A2B" } : null;
}

export interface Playhead {
  position: number;
  playing: boolean;
  toggle: () => void;
  seek: (ms: number) => void;
  /** For a <video>: follow its clock. */
  follow: (ms: number) => void;
  stop: () => void;
}

/** Where the spot is and whether it's playing; a still advances on a timer. */
export function usePlayhead(lengthMs: number, timed: boolean): Playhead {
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing || !timed) return;
    const started = Date.now() - position;
    const i = setInterval(() => {
      const p = Math.min(lengthMs, Date.now() - started);
      setPosition(p);
      if (p >= lengthMs) setPlaying(false);
    }, 100);
    return () => clearInterval(i);
    // Restart the timer only when play starts or stops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, timed, lengthMs]);
  return {
    position,
    playing,
    toggle: () => {
      if (!playing && position >= lengthMs) setPosition(0);
      setPlaying((p) => !p);
    },
    seek: (ms) => setPosition(Math.max(0, Math.min(lengthMs, ms))),
    follow: setPosition,
    stop: () => setPlaying(false)
  };
}

export function DeliveryPicture({ url, fallback, head, label, phone }: { url: string; fallback: Card; head: Playhead; label: string; phone?: boolean }) {
  const card = cardOf(url);
  const [broken, setBroken] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const still = card ?? (broken ? fallback : null);

  const stop = useRef(head.stop);
  stop.current = head.stop;
  useEffect(() => {
    const v = video.current;
    if (!v || still) return;
    if (head.playing) void v.play().catch(() => stop.current());
    else v.pause();
  }, [head.playing, still]);
  useEffect(() => {
    const v = video.current;
    if (v && !still && Math.abs(v.currentTime * 1000 - head.position) > 400) v.currentTime = head.position / 1000;
  }, [head.position, still]);

  return (
    <PictureFrame label={label} className={phone ? "bz-deliv bz-deliv--phone" : "bz-deliv"}>
      {still ? (
        <div className="bz-deliv__card" style={{ "--bz-deliv": still.colour } as CSSProperties}>
          <b>{still.title}</b>
          {still.line && <span>{still.line}</span>}
        </div>
      ) : (
        <video
          ref={video}
          src={url}
          playsInline
          preload="metadata"
          onError={() => setBroken(true)}
          onTimeUpdate={(e) => head.follow(e.currentTarget.currentTime * 1000)}
          onEnded={() => head.stop()}
        />
      )}
    </PictureFrame>
  );
}
