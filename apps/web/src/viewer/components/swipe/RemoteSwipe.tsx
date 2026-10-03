// While this phone is a remote for a TV (casting or mirroring), Watch is the remote as designed
// (A245; swipe home 05): a swipe up or down over its now strip changes the TV's channel, the same
// gesture as the swipe home's. The TV keeps its own order (channel up and down in channel order).

import { useRef, type ReactNode } from "react";
import { remoteSwipe, velocityOf, type Sample } from "./gesture";

export function RemoteSwipe({ onChannel, children }: { onChannel: (dir: "up" | "down") => void; children: ReactNode }) {
  const start = useRef<{ id: number; x: number; y: number; samples: Sample[] } | null>(null);
  return (
    <div
      className="vw-rm-swipe"
      onPointerDown={(e) => void (start.current = { id: e.pointerId, x: e.clientX, y: e.clientY, samples: [{ y: e.clientY, t: e.timeStamp }] })}
      onPointerMove={(e) => {
        const s = start.current;
        if (s && s.id === e.pointerId) s.samples.push({ y: e.clientY, t: e.timeStamp });
      }}
      onPointerUp={(e) => {
        const s = start.current;
        start.current = null;
        if (!s || s.id !== e.pointerId) return;
        const dir = remoteSwipe(e.clientX - s.x, e.clientY - s.y, velocityOf(s.samples));
        if (dir) onChannel(dir === "next" ? "up" : "down");
      }}
      onPointerCancel={() => void (start.current = null)}
    >
      {children}
    </div>
  );
}
