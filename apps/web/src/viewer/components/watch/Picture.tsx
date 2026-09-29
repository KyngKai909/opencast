// The picture: the player's surface (it draws the airing station's bug, lower thirds and codes
// from the stream's tags). On the phone a
// vertical swipe changes channel, showing the next station's number and call sign as it moves,
// so it reads as tuning, not scrolling.

import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { cx } from "@opencast/ui";
import { PlayerSurface } from "@opencast/player";
import { MARKET_TZ, now } from "../../../lib/clock";
import type { DialRowX } from "../../api/ext";
import type { WatchData } from "./useWatch";
import { neighbourOf, swipeChannel, swipePreview } from "./logic";

export function Picture({ w, swipe, className, children }: { w: WatchData; swipe?: boolean; className?: string; children?: ReactNode }) {
  const s = w.state;
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const [drag, setDrag] = useState<{ dy: number; dx: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const from = s.pendingId ?? s.currentId;
  const heading = drag ? swipePreview(drag.dy, drag.dx) : null;
  const next: DialRowX | null = heading ? neighbourOf(w.channels, from, heading) : null;

  const handlers = swipe
    ? {
        onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        },
        onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
          if (!start.current || start.current.id !== e.pointerId) return;
          const dy = e.clientY - start.current.y;
          const dx = e.clientX - start.current.x;
          if (!drag && Math.abs(dy) > 6) e.currentTarget.setPointerCapture?.(e.pointerId);
          setDrag({ dy, dx });
        },
        onPointerUp: (e: PointerEvent<HTMLDivElement>) => {
          const st = start.current;
          start.current = null;
          setDrag(null);
          if (!st) return;
          const dir = swipeChannel(e.clientY - st.y, box.current?.offsetHeight ?? 0, e.clientX - st.x);
          if (dir) w.engine.handle({ type: "channel", dir }, { input: "touch" });
        },
        onPointerCancel: () => {
          start.current = null;
          setDrag(null);
        }
      }
    : {};

  return (
    <div ref={box} className={cx("vw-pic", swipe && "vw-pic--swipe", className)} {...handlers}>
      <PlayerSurface timeZone={MARKET_TZ} clock={now} />
      {next && (
        <div className="vw-pic__next" aria-hidden="true" style={{ ["--vw-dy" as string]: `${Math.max(-60, Math.min(60, (drag?.dy ?? 0) / 3))}px` }}>
          <span className="vw-pic__ch oc-mono">{next.station.channel}</span>
          <span className="vw-pic__cs oc-cs">{next.station.callSign}</span>
        </div>
      )}
      {children}
    </div>
  );
}
