import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cx } from "../lib/cx";
import type { TimeInput } from "../lib/format";
import { NowLine } from "./NowLine";
import { LiveText } from "./LiveText";
import { clockColumn, fraction, ms, shortClock, shortSpan } from "./time";

export interface GuideProgram {
  id: string;
  title: string;
  start: TimeInput;
  end: TimeInput;
  /** "Live" in red text. Never the tally: nothing in the guide is on your screen yet. */
  live?: boolean;
  /** An external station, the source's own stream: the line says ", external". */
  listed?: boolean;
  /** "From REEL". */
  carriedFrom?: string;
  /** Replaces the generated line under the title. */
  detail?: ReactNode;
}

export interface GuideStation {
  id: string;
  channel: string;
  callSign: string;
  programs: GuideProgram[];
}

export interface GuideGridProps {
  /** Stations down the side, in channel order. */
  rows: GuideStation[];
  /** The window across the top. Programs that began before it show the leading marker. */
  from: TimeInput;
  to: TimeInput;
  /** The current time: places the now line and marks what's on. */
  now?: TimeInput;
  timeZone?: string;
  /** web: the app guide. phone: the narrow station column. compact: the style guide's four half hours. */
  variant?: "web" | "phone" | "compact";
  /** The open listing's program. */
  selectedId?: string;
  /** A cell opens its listing. */
  onSelect?: (program: GuideProgram, station: GuideStation) => void;
  /** Open scrolled so the now line sits just after the station column (the phone). */
  scrollToNow?: boolean;
  /** For screen readers: "Tonight's guide". */
  label?: string;
  className?: string;
}

/** The grid resolution: five minutes a column. */
export const GUIDE_UNIT_MS = 5 * 60_000;
const SLOT_MS = 30 * 60_000;

export interface GuideCell {
  program: GuideProgram;
  /** CSS grid lines: the station column is line 1, so the window starts at line 2. */
  colStart: number;
  colEnd: number;
  /** Began before the window: drawn with the leading marker. */
  began: boolean;
  /** On air at `now`. */
  onNow: boolean;
}

/** Places programs on the grid: each spans its start to its end, clipped to the window. */
export function guideCells(programs: GuideProgram[], from: TimeInput, to: TimeInput, now?: TimeInput): GuideCell[] {
  const a0 = ms(from);
  const b0 = ms(to);
  const t = now != null ? ms(now) : NaN;
  const cells: GuideCell[] = [];
  for (const p of programs) {
    const s = ms(p.start);
    const e = ms(p.end);
    const a = Math.max(s, a0);
    const b = Math.min(e, b0);
    if (b <= a) continue;
    cells.push({
      program: p,
      colStart: Math.round((a - a0) / GUIDE_UNIT_MS) + 2,
      colEnd: Math.round((b - a0) / GUIDE_UNIT_MS) + 2,
      began: s < a0,
      onNow: s <= t && t < e
    });
  }
  return cells;
}

/** The head row's half hours. */
export function guideSlots(from: TimeInput, to: TimeInput): Date[] {
  const out: Date[] = [];
  for (let t = ms(from); t < ms(to); t += SLOT_MS) out.push(new Date(t));
  return out;
}

function cellLine(c: GuideCell, timeZone: string | undefined): string {
  const p = c.program;
  let text: string;
  if (c.began) text = `Began ${shortClock(p.start, timeZone)}`;
  else if (p.carriedFrom) text = `From ${p.carriedFrom}`;
  else if (c.onNow || p.live) text = shortSpan(p.start, p.end, timeZone);
  else text = shortClock(p.start, timeZone);
  return p.listed ? `${text}, external` : text;
}

/**
 * The guide: stations down the side, half hours across the top, one line for the current time.
 * The program on air sits on the raised colour. Live is red text, never the tally.
 */
export function GuideGrid({ rows, from, to, now, timeZone, variant = "web", selectedId, onSelect, scrollToNow, label, className }: GuideGridProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const units = Math.round((ms(to) - ms(from)) / GUIDE_UNIT_MS);
  const slots = guideSlots(from, to);
  const heads = clockColumn(slots, timeZone);
  const compact = variant === "compact";

  useLayoutEffect(() => {
    if (!scrollToNow || now == null || !wrap.current || !grid.current) return;
    const stc = parseFloat(getComputedStyle(grid.current).getPropertyValue("--oc-guide-stc")) || 0;
    const x = stc + (grid.current.offsetWidth - stc) * fraction(now, from, to);
    wrap.current.scrollLeft = Math.max(0, x - stc - 24);
  }, [scrollToNow, now, from, to]);

  const head = (
    <div className="oc-guide__head" aria-hidden="true">
      <div />
      {heads.map((h, i) => (
        <div key={i} style={{ gridColumn: `span ${SLOT_MS / GUIDE_UNIT_MS}` }}>
          {h}
        </div>
      ))}
    </div>
  );

  const body = rows.map((r) => (
    <div key={r.id} className="oc-guide__row" role="group" aria-label={`${r.callSign} ${r.channel}`}>
      <div className="oc-guide__st">
        <span className="oc-cs">{r.callSign}</span>
        <span className="oc-ch">{r.channel}</span>
      </div>
      {guideCells(r.programs, from, to, now).map((c) => {
        const p = c.program;
        const classes = cx(
          "oc-guide__p",
          c.onNow && "oc-guide__p--on",
          p.id === selectedId && "oc-guide__p--sel",
          c.began && "oc-guide__p--cont"
        );
        const inner = (
          <>
            <b>
              {c.onNow && <span className="oc-sr-only">On now: </span>}
              {p.title}
              {compact && p.live && (
                <>
                  {" "}
                  <LiveText className="oc-guide__lv" />
                </>
              )}
            </b>
            <small>
              {!compact && p.live && (
                <>
                  <LiveText className="oc-guide__lv" />{" "}
                </>
              )}
              {p.detail ?? cellLine(c, timeZone)}
            </small>
          </>
        );
        const style = { gridColumn: `${c.colStart} / ${c.colEnd}` };
        return onSelect ? (
          <button key={p.id} type="button" className={classes} style={style} aria-pressed={p.id === selectedId} onClick={() => onSelect(p, r)}>
            {inner}
          </button>
        ) : (
          <div key={p.id} className={classes} style={style}>
            {inner}
          </div>
        );
      })}
    </div>
  ));

  const nowLine = now != null ? <NowLine at={now} from={from} to={to} timeZone={timeZone} variant={compact ? "compact" : "web"} /> : null;

  return (
    <div ref={wrap} className={cx("oc-guide-wrap", `oc-guide-wrap--${variant}`, className)}>
      <div ref={grid} className={cx("oc-guide", `oc-guide--${variant}`)} style={{ ["--oc-guide-cols" as string]: units }} role="group" aria-label={label}>
        {head}
        {compact ? (
          <div className="oc-guide__body">
            {nowLine}
            {body}
          </div>
        ) : (
          <>
            {body}
            {nowLine}
          </>
        )}
      </div>
    </div>
  );
}
