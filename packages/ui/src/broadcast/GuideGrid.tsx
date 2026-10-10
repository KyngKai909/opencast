import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cx } from "../lib/cx";
import { clock, type TimeInput } from "../lib/format";
import { NowLine } from "./NowLine";
import { LiveText } from "./LiveText";
import { Tag } from "../primitives/Tag";
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

/**
 * A244: a programming block on a station's row ("Late Crate Nights"), from its first program's start
 * to its last one's end. Drawn as a thin band above the row's programs, in its colour.
 */
export interface GuideBlock {
  id: string;
  name: string;
  start: TimeInput;
  end: TimeInput;
  /** Its colour (4.5:1 against white, so its name is white on it); else the ink. */
  colour?: string | null;
}

export interface GuideStation {
  id: string;
  channel: string;
  callSign: string;
  programs: GuideProgram[];
  /** An external station (follow-up Phase 6): the dashed External tag under its channel. */
  external?: boolean;
  /**
   * A229: the station's own name, for a call sign shared across a channel's subchannels (15.1 SBCO,
   * 15.2 SBCO): shown as the column's last line, so each stream is told apart by more than its channel.
   */
  name?: string;
  /** A244: the station's programming blocks in the window (the compact variant leaves them out). */
  blocks?: GuideBlock[];
  /**
   * The swipe home's guide (A245; swipe home 06): a heading row before this station, where a new
   * part of the order starts ("Your presets", "The dial").
   */
  section?: string;
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
  /** The station being watched: its row is tinted (swipe home 06). */
  tunedId?: string | null;
  /** Tapping a station's column tunes it in (swipe home 06: "Tap a row to tune in"). */
  onTune?: (station: GuideStation) => void;
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

/**
 * Places programs on the grid: each spans its start to its end, clipped to the window, on one line.
 * An outside guide can overlap itself or list programs shorter than a grid unit (2026-10-06: Fizz's
 * "Cartoons" until 9:05 with "Batman Animated" at 9:00; HappyKids' 2-minute fillers): the grid would
 * push those onto a line of their own. So a program ends where the next one starts, and one that
 * comes to nothing at the grid's 5 minutes isn't drawn.
 */
export function guideCells(programs: GuideProgram[], from: TimeInput, to: TimeInput, now?: TimeInput): GuideCell[] {
  const a0 = ms(from);
  const b0 = ms(to);
  const t = now != null ? ms(now) : NaN;
  const cells: GuideCell[] = [];
  const sorted = [...programs].sort((x, y) => ms(x.start) - ms(y.start));
  for (const p of sorted) {
    const s = ms(p.start);
    const e = ms(p.end);
    const a = Math.max(s, a0);
    const b = Math.min(e, b0);
    if (b <= a) continue;
    const colStart = Math.round((a - a0) / GUIDE_UNIT_MS) + 2;
    const colEnd = Math.round((b - a0) / GUIDE_UNIT_MS) + 2;
    if (colEnd <= colStart) continue;
    const prev = cells[cells.length - 1];
    if (prev && prev.colEnd > colStart) {
      prev.colEnd = colStart;
      if (prev.colEnd <= prev.colStart) cells.pop();
    }
    cells.push({ program: p, colStart, colEnd, began: s < a0, onNow: s <= t && t < e });
  }
  return cells;
}

/** A244: a row's block bands, placed like its programs (clipped to the window, the leading marker when one began earlier). */
export function guideBands(blocks: GuideBlock[], from: TimeInput, to: TimeInput): Array<{ block: GuideBlock; colStart: number; colEnd: number; began: boolean }> {
  return guideCells(
    blocks.map((b) => ({ id: `${b.id}:${ms(b.start)}`, title: b.name, start: b.start, end: b.end })),
    from,
    to
  ).map((c) => ({ block: blocks.find((b) => `${b.id}:${ms(b.start)}` === c.program.id)!, colStart: c.colStart, colEnd: c.colEnd, began: c.began }));
}

/** "Late Crate Nights, 9:00 pm to 1:00 am": a block band's name for screen readers. */
export function guideBandLabel(b: Pick<GuideBlock, "name" | "start" | "end">, timeZone?: string): string {
  return `${b.name}, ${clock(b.start, { timeZone })} to ${clock(b.end, { timeZone })}`;
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
export function GuideGrid({ rows, from, to, now, timeZone, variant = "web", selectedId, onSelect, scrollToNow, label, tunedId, onTune, className }: GuideGridProps) {
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

  const body = rows.flatMap((r) => {
    // A244: a row with a programming block in the window has a band strip above its programs.
    const bands = compact ? [] : guideBands(r.blocks ?? [], from, to);
    const tuned = !!tunedId && r.id === tunedId;
    const ident = `${r.callSign} ${r.channel}`;
    const stInner = (
      <>
        <span className="oc-cs">{r.callSign}</span>
        <span className="oc-ch">{r.channel}</span>
        {r.name && !compact && (
          <small className="oc-guide__nm" title={r.name}>
            {r.name}
          </small>
        )}
        {r.external && !compact && (
          <Tag variant="listed" className="oc-guide__ext">
            External
          </Tag>
        )}
        {tuned && <span className="oc-sr-only">, watching</span>}
      </>
    );
    const head = r.section ? (
      <div key={`${r.id}:section`} className="oc-guide__sec" role="heading" aria-level={3}>
        {r.section}
      </div>
    ) : null;
    const row = (
    <div key={r.id} className={cx("oc-guide__row", bands.length > 0 && "oc-guide__row--blocks", tuned && "oc-guide__row--tuned")} role="group" aria-label={`${ident}${r.name ? `, ${r.name}` : ""}`}>
      {onTune ? (
        <button type="button" className="oc-guide__st oc-guide__st--tune" onClick={() => onTune(r)} aria-label={`Tune in to ${ident}`}>
          {stInner}
        </button>
      ) : (
        <div className="oc-guide__st">{stInner}</div>
      )}
      {bands.map(({ block, colStart, colEnd, began }) => (
        <div
          key={`${block.id}:${ms(block.start)}`}
          className={cx("oc-guide__band", began && "oc-guide__band--cont")}
          style={{ gridColumn: `${colStart} / ${colEnd}`, ...(block.colour ? { background: block.colour } : {}) }}
          role="note"
          aria-label={guideBandLabel(block, timeZone)}
        >
          <span aria-hidden="true">{block.name}</span>
        </div>
      ))}
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
    );
    return head ? [head, row] : [row];
  });

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
