import type { CSSProperties, ReactNode } from "react";
import { cx } from "../lib/cx";
import { clockRange, duration, type TimeInput } from "../lib/format";
import { LogCode, type LogCodeName } from "./LogCode";
import { hourLabel, ms } from "./time";

export type TimelineBlockKind =
  | "pgm"   /* a program from the library, or a live source */
  | "car"   /* carried from another station */
  | "brk"   /* a break, placed by the break rule */
  | "dead"; /* nothing scheduled: dead air */

export interface TimelineBlock {
  id: string;
  kind: TimelineBlockKind;
  start: TimeInput;
  end: TimeInput;
  /** The program's title (programs and carried blocks). */
  title?: ReactNode;
  /** Where it comes from: "From your library", "Carried from REEL 24.1", "Live source". */
  source?: ReactNode;
  /** Its log code. Defaults to PGM. */
  code?: LogCodeName;
}

export interface LogTimelineProps {
  /** The day as it will actually be, in time order. */
  blocks: TimelineBlock[];
  /** The window, on the hour: "6:00 pm to 2:00 am". */
  from: TimeInput;
  to: TimeInput;
  /** The scale. The reference draws 1.12px a minute. */
  pxPerMinute?: number;
  timeZone?: string;
  /** The block whose pane is open. */
  selectedId?: string;
  /** A block opens its pane (how to fill a gap, a program's details). */
  onSelect?: (block: TimelineBlock) => void;
  /** Scroll inside this height (px). */
  maxHeight?: number;
  className?: string;
}

export interface PlacedBlock {
  block: TimelineBlock;
  top: number;
  height: number;
}

/** Where each block sits, as the reference draws them: programs inset a pixel, breaks at least 7px tall. */
export function placeBlocks(blocks: TimelineBlock[], from: TimeInput, pxPerMinute: number): PlacedBlock[] {
  const a0 = ms(from);
  return blocks.map((b) => {
    const top = ((ms(b.start) - a0) / 60_000) * pxPerMinute;
    const h = ((ms(b.end) - ms(b.start)) / 60_000) * pxPerMinute;
    if (b.kind === "brk") return { block: b, top: top - 2, height: Math.max(h, 7) };
    if (b.kind === "dead") return { block: b, top, height: h };
    return { block: b, top: top + 1, height: h - 2 };
  });
}

/**
 * Master control's program log as a timeline, not a playlist (A3): each program at its start time,
 * breaks where they'll fall, and a gap drawn as dead air.
 */
export function LogTimeline({ blocks, from, to, pxPerMinute = 1.12, timeZone, selectedId, onSelect, maxHeight, className }: LogTimelineProps) {
  const a0 = ms(from);
  const total = ((ms(to) - a0) / 60_000) * pxPerMinute;
  const hours: number[] = [];
  for (let t = a0; t <= ms(to); t += 3_600_000) hours.push(t);
  const style: CSSProperties | undefined = maxHeight ? { maxHeight, overflow: "auto" } : undefined;

  return (
    <div className={cx("oc-tl", className)} style={style}>
      <div className="oc-tl__hrs" style={{ height: total }} aria-hidden="true">
        {hours.map((t, i) => (
          <span key={t} style={{ top: i * 60 * pxPerMinute }}>
            {hourLabel(t, timeZone)}
          </span>
        ))}
      </div>
      <div className="oc-tl__col" style={{ height: total }} role="list">
        {hours.map((t, i) => (
          <div key={t} className="oc-tl__hl" style={{ top: i * 60 * pxPerMinute }} />
        ))}
        {placeBlocks(blocks, from, pxPerMinute).map(({ block: b, top, height }) => {
          const sel = b.id === selectedId;
          const classes = cx("oc-blk", `oc-blk--${b.kind}`, sel && "oc-blk--sel");
          const span = clockRange(b.start, b.end, { timeZone });
          let inner: ReactNode;
          if (b.kind === "brk") inner = <span className="oc-sr-only">{`Break ${duration(ms(b.end) - ms(b.start))}, ${span}`}</span>;
          else if (b.kind === "dead") inner = `Dead air, ${span}`;
          else
            inner = (
              <>
                <LogCode code={b.code ?? "PGM"} />
                <div>
                  <b>{b.title}</b> <small>{b.source}</small>
                  <span className="oc-sr-only">, {span}</span>
                </div>
              </>
            );
          const pos = { top, height };
          return (
            <div key={b.id} role="listitem" className="oc-tl__item" style={pos}>
              {onSelect ? (
                <button type="button" className={classes} aria-pressed={sel} onClick={() => onSelect(b)}>
                  {inner}
                </button>
              ) : (
                <div className={classes}>{inner}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
