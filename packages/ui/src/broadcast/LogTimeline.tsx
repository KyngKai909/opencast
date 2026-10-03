import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cx } from "../lib/cx";
import { clock, clockRange, duration, type TimeInput } from "../lib/format";
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

/**
 * A244: a programming block on the log, drawn as a rail in its colour beside the column with its
 * name written up it: solid where it airs (its programs, first to last; off-air time inside splits
 * it), dashed where it's placed but nothing of it airs. No fill over the programs.
 */
export interface TimelineBand {
  id: string;
  label: string;
  /** Where it's placed. */
  start: TimeInput;
  end: TimeInput;
  /** Where it airs (its members); none: an empty block, all dashed. */
  pieces: Array<{ start: TimeInput; end: TimeInput }>;
  colour?: string | null;
  /** Something to look at (an overrun, nothing in it yet, no room for its intro). */
  problems?: number;
}

/** Where a band's rail sits: its placement and its pieces, clipped to the window. */
export function placeBand(band: TimelineBand, from: TimeInput, to: TimeInput, pxPerMinute: number) {
  const a0 = ms(from);
  const z0 = ms(to);
  const y = (t: TimeInput) => ((Math.min(z0, Math.max(a0, ms(t))) - a0) / 60_000) * pxPerMinute;
  const all = [ms(band.start), ms(band.end), ...band.pieces.flatMap((p) => [ms(p.start), ms(p.end)])];
  const top = y(Math.min(...all));
  const bottom = y(Math.max(...all));
  return { top, height: Math.max(0, bottom - top), pieces: band.pieces.map((p) => ({ top: y(p.start) - top, height: Math.max(0, y(p.end) - y(p.start)) })) };
}

/** "Late Crate Nights, 9:00 pm to 1:00 am". */
export function bandLabel(band: Pick<TimelineBand, "label" | "start" | "end" | "pieces">, timeZone?: string): string {
  const s = band.pieces[0]?.start ?? band.start;
  const e = band.pieces.length ? band.pieces[band.pieces.length - 1].end : band.end;
  return `${band.label}, ${clock(s, { timeZone })} to ${clock(e, { timeZone })}`;
}

export interface TimelineBandsProps {
  bands: TimelineBand[];
  from: TimeInput;
  to: TimeInput;
  pxPerMinute: number;
  timeZone?: string;
  selectedId?: string | null;
  /** A band opens its pane. */
  onSelect?: (band: TimelineBand) => void;
  /** Edit mode: dragging a rail's top or bottom edge (or its arrow keys) moves its start or end, to the minute. */
  onResize?: (band: TimelineBand, edge: "start" | "end", at: string) => void;
}

/** The rails of a log timeline's programming blocks (beside its column). */
export function TimelineBands({ bands, from, to, pxPerMinute, timeZone, selectedId, onSelect, onResize }: TimelineBandsProps) {
  const drag = useRef<{ id: string; edge: "start" | "end"; y: number } | null>(null);
  const [offset, setOffset] = useState<{ id: string; edge: "start" | "end"; dy: number } | null>(null);
  const shifted = (b: TimelineBand, edge: "start" | "end", dy: number) => {
    const at = ms(edge === "start" ? b.start : b.end) + (dy / pxPerMinute) * 60_000;
    return new Date(Math.round(at / 60_000) * 60_000).toISOString();
  };
  const handle = (b: TimelineBand, edge: "start" | "end") =>
    onResize ? (
      <button
        type="button"
        className={cx("oc-tl__edge", `oc-tl__edge--${edge}`)}
        aria-label={`${edge === "start" ? "Start" : "End"} of ${b.label}, ${clock(edge === "start" ? b.start : b.end, { timeZone })}`}
        onPointerDown={(e: PointerEvent<HTMLButtonElement>) => {
          drag.current = { id: b.id, edge, y: e.clientY };
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e: PointerEvent<HTMLButtonElement>) => {
          const d = drag.current;
          if (d && d.id === b.id && d.edge === edge) setOffset({ id: b.id, edge, dy: e.clientY - d.y });
        }}
        onPointerUp={(e: PointerEvent<HTMLButtonElement>) => {
          const d = drag.current;
          drag.current = null;
          setOffset(null);
          if (d && d.id === b.id && Math.abs(e.clientY - d.y) > 3) onResize(b, edge, shifted(b, edge, e.clientY - d.y));
        }}
        onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          e.preventDefault();
          onResize(b, edge, shifted(b, edge, (e.shiftKey ? 5 : 1) * (e.key === "ArrowUp" ? -1 : 1) * pxPerMinute));
        }}
      />
    ) : null;
  return (
    <div className="oc-tl__bands">
      {bands.map((b) => {
        const placed = placeBand(b, from, to, pxPerMinute);
        if (placed.height <= 0) return null;
        const dy = offset?.id === b.id ? offset.dy : 0;
        const top = placed.top + (offset?.id === b.id && offset.edge === "start" ? dy : 0);
        const height = placed.height + (offset?.id === b.id ? (offset.edge === "start" ? -dy : dy) : 0);
        const label = bandLabel(b, timeZone);
        const inner = (
          <>
            {placed.pieces.map((p, i) => (
              <span key={i} className="oc-tl__rail-on" style={{ top: p.top, height: p.height }} />
            ))}
            <span className="oc-tl__rail-name" style={placed.pieces.length ? { top: placed.pieces[0].top + 6, maxHeight: Math.max(0, placed.pieces[0].height - 12) } : { color: "var(--oc-band)", textShadow: "none" }} aria-hidden="true">
              {b.label}
            </span>
          </>
        );
        const style = { top, height, ["--oc-band" as string]: b.colour ?? "var(--ink-70)" } as CSSProperties;
        const classes = cx("oc-tl__rail", b.id === selectedId && "oc-tl__rail--sel", (b.problems ?? 0) > 0 && "oc-tl__rail--warn");
        return (
          <div key={b.id} className="oc-tl__band" style={style}>
            {onSelect ? (
              <button type="button" className={classes} aria-pressed={b.id === selectedId} aria-label={`${label}${b.problems ? `, ${b.problems === 1 ? "1 thing to look at" : `${b.problems} things to look at`}` : ""}`} onClick={() => onSelect(b)}>
                {inner}
              </button>
            ) : (
              <div className={classes} role="img" aria-label={label}>
                {inner}
              </div>
            )}
            {handle(b, "start")}
            {handle(b, "end")}
          </div>
        );
      })}
    </div>
  );
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
  /** Which blocks open a pane when `onSelect` is given (default: every block). The rest draw as they are, not as buttons. */
  selectable?: (block: TimelineBlock) => boolean;
  /** Scroll inside this height (px). */
  maxHeight?: number;
  className?: string;
  /** A244: programming blocks, as rails beside the column. */
  bands?: TimelineBand[];
  /** The band whose pane is open. */
  selectedBandId?: string | null;
  /** A band opens its pane. */
  onSelectBand?: (band: TimelineBand) => void;
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
export function LogTimeline({ blocks, from, to, pxPerMinute = 1.12, timeZone, selectedId, onSelect, selectable, maxHeight, className, bands, selectedBandId, onSelectBand }: LogTimelineProps) {
  const a0 = ms(from);
  const total = ((ms(to) - a0) / 60_000) * pxPerMinute;
  const hours: number[] = [];
  for (let t = a0; t <= ms(to); t += 3_600_000) hours.push(t);
  const style: CSSProperties | undefined = maxHeight ? { maxHeight, overflow: "auto" } : undefined;

  return (
    <div className={cx("oc-tl", bands?.length ? "oc-tl--bands" : false, className)} style={style}>
      <div className="oc-tl__hrs" style={{ height: total }}>
        <div aria-hidden="true">
          {hours.map((t, i) => (
            <span key={t} style={{ top: i * 60 * pxPerMinute }}>
              {hourLabel(t, timeZone)}
            </span>
          ))}
        </div>
        {bands?.length ? <TimelineBands bands={bands} from={from} to={to} pxPerMinute={pxPerMinute} timeZone={timeZone} selectedId={selectedBandId} onSelect={onSelectBand} /> : null}
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
              {onSelect && (!selectable || selectable(b)) ? (
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
