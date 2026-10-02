import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { cx } from "../lib/cx";
import { duration } from "../lib/format";
import { IconButton } from "../primitives/Button";

export interface ScrubPin {
  /** Milliseconds into the piece. */
  at: number;
  /** What the note says, for the tooltip and screen readers. */
  label: string;
}

export interface ScrubBarProps {
  /** Where the playhead is, in milliseconds. */
  position: number;
  /** The length of the piece, in milliseconds. */
  length: number;
  playing?: boolean;
  onPlayPause?: () => void;
  /** Called with the new position when someone drags, clicks or uses the arrow keys. */
  onSeek?: (position: number) => void;
  /** Where the program's breaks fall, in milliseconds: amber marks under the bar (market preview). */
  breaks?: number[];
  /** Notes pinned to a moment (production-order review). */
  pins?: ScrubPin[];
  /** The round knob on the playhead. The order review draws none. */
  knob?: boolean;
  /** How far an arrow key moves, in milliseconds. */
  step?: number;
  className?: string;
}

/**
 * A scrub bar. Only for checking something, never for watching: the syndication market's episode
 * preview and the production-order review (market 03, production orders 05).
 */
export function ScrubBar({ position, length, playing, onPlayPause, onSeek, breaks = [], pins = [], knob = true, step = 5_000, className }: ScrubBarProps) {
  const bar = useRef<HTMLSpanElement>(null);
  const pct = length > 0 ? Math.min(100, Math.max(0, (position / length) * 100)) : 0;
  const at = (x: number) => `${length > 0 ? Math.min(100, Math.max(0, (x / length) * 100)) : 0}%`;
  const seek = (next: number) => onSeek?.(Math.min(length, Math.max(0, next)));

  const onKey = (e: KeyboardEvent) => {
    const map: Record<string, number> = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step };
    if (e.key in map) seek(position + map[e.key]);
    else if (e.key === "Home") seek(0);
    else if (e.key === "End") seek(length);
    else return;
    e.preventDefault();
  };
  const fromPointer = (e: PointerEvent) => {
    const r = bar.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    seek(((e.clientX - r.left) / r.width) * length);
  };

  return (
    <div className={cx("oc-scrub", breaks.length > 0 && "oc-scrub--breaks", className)}>
      <IconButton icon={playing ? "pause" : "play"} label={playing ? "Pause" : "Play"} onClick={onPlayPause} />
      <span>{duration(position)}</span>
      <span
        ref={bar}
        className="oc-scrub__bar"
        role="slider"
        tabIndex={0}
        aria-label="Position"
        aria-valuemin={0}
        aria-valuemax={Math.round(length / 1000)}
        aria-valuenow={Math.round(position / 1000)}
        aria-valuetext={`${duration(position)} of ${duration(length)}`}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) fromPointer(e);
        }}
      >
        <i style={{ width: `${pct}%` }} />
        {knob && <b style={{ left: `${pct}%` }} />}
        {pins.map((p, i) => (
          <span key={i} className="oc-scrub__pin" style={{ left: at(p.at) }} title={`${duration(p.at)}: ${p.label}`} />
        ))}
        {breaks.length > 0 && (
          <span className="oc-scrub__breaks" aria-hidden="true">
            {breaks.map((b, i) => (
              <i key={i} style={{ left: at(b) }} />
            ))}
          </span>
        )}
      </span>
      <span>{duration(length)}</span>
    </div>
  );
}
