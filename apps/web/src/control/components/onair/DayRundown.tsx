// A246: the Day view's rundown (opencast-schedule 01, 04): one row per program, live block, break,
// dead air and planned off air, in air order, with a block's colour down its rows' edge and its
// label where it starts. Past rows dim; the row on air gets the red edge and ON AIR. A row picks
// out its pane (a program, a break, a block); dead air has Fill; planned off air links to the off
// air hours ("Every day" on the Templates tab). It opens scrolled to now, or to the row asked for.
//
// In edit mode the rows are the draft: moved rows in blue, a new row outlined, a removed one struck
// through, fixed points marked, locked rows saying why. Rows move by their handle (drag, or the
// arrow keys a place at a time), "Add here" sits between rows, a live block or sign-off has its
// end to drag, and each row has "Keep at this time" and Remove. Moving follows reorder.ts. A
// programming block's start and end are handle rows (Phase 4, blockHandles.ts): they drop between
// rows and take the start of the row below, the rows saying who joins or leaves while dragging, and
// each row says whether it's a member. A template's rundown (TemplateEditor.tsx) is drawn the same.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { Link } from "react-router";
import type { LogChange, LogEntry } from "@opencast/contracts";
import { BreakStrip, Icon, clock, snapTime } from "@opencast/ui";
import { STATION_TZ } from "../../../lib/clock";
import { ROW_CODE_WORDS, rowLength, rowTime, type DayRow } from "./dayRows";
import { handleRange, handleSpots, handleWords, memberNote, membershipChange, membershipWords, nudgeHandle, spotsIn, type HandleEdge, type HandleLimits } from "./blockHandles";
import type { DraftEntry, DraftSpan } from "./logEdit";
import { FIXED_WORDS, dropAfter, dropStart, endWithBreak, fixedReason, membershipNote, nudge, resizeTo, type Reflow } from "./reorder";
import { nextEpisodeMark } from "./whatAirs";

const MIN = 60_000;
const t = (s: string) => Date.parse(s);

export interface RundownEdit {
  locked: (e: DraftEntry) => string | null;
  /** Entries and spans with a problem in the dry run. */
  troubled: Set<string>;
  /** The log as it was, for "Moved from 10:00 pm". */
  original: Map<string, LogEntry>;
  reflow: Reflow;
  spans: DraftSpan[];
  /** Changes made on the rundown (a move and what it pushes; a new end; a removal). */
  onChanges: (changes: LogChange[]) => void;
  onKeep: (e: DraftEntry) => void;
  /** Undo a removal. */
  onRestore: (entryId: string) => void;
  /** "Add here": the drawer, at a time. */
  onAddAt: (at: string) => void;
  /** Nothing can go on sooner than this. */
  earliest: number;
  /** Phase 4: the draft's blocks as start and end handles. Left out, a block's label stays a label. */
  handles?: RundownHandles;
}

/** A246 (Phase 4): what the rundown needs to draw a block's start and end as handles. */
export interface RundownHandles {
  /** Each span's times before the draft ("Ends 12:30 am, was 1:00 am"). */
  original: Map<string, Pick<DraftSpan, "startsAt" | "endsAt">>;
  limits: HandleLimits;
  /** Whether a block airs its intro or outro (for its rows' words). */
  intro: (blockId: string) => boolean;
  outro: (blockId: string) => boolean;
  /** A handle's words picked: the span's typed times in the pane. */
  onPick?: (spanId: string) => void;
}

export interface DayRundownProps {
  rows: DayRow[];
  /** Signed on: the row on now is ON AIR. */
  onAir: boolean;
  selected: string | null;
  onSelect: (row: DayRow) => void;
  onFill: (row: DayRow) => void;
  /** Where the day opens: a row's id (it's scrolled into view once). */
  scrollTo: string | null;
  /** Where planned off air's rule is changed (the Templates tab's "Every day"). */
  offAirHref?: string | null;
  edit?: RundownEdit;
  className?: string;
}

/** The rundown's code, drawn as the reference does, with its words for screen readers. */
function RowCodeTag({ row }: { row: DayRow }) {
  return (
    <span className={`cc-code2 cc-code2--${row.code.toLowerCase()}`}>
      <span aria-hidden="true">{row.code}</span>
      <span className="oc-sr-only">{ROW_CODE_WORDS[row.code]}</span>
    </span>
  );
}

/** What a draft row says under its title in edit mode (with, near a block, whether it's a member). */
function editLine(row: DayRow, edit: RundownEdit): string | null {
  const e = row.entry!;
  if (row.removed) return "Coming off the log";
  const lock = edit.locked(e);
  if (lock) return lock;
  const was = edit.original.get(e.id);
  const member = edit.handles ? memberNote(e, edit.spans, edit.reflow.entries, { intro: edit.handles.intro }) : null;
  if (e.change === "inserted") return [`New. ${row.source ?? ""}`.trim(), member].filter(Boolean).join(". ");
  if (e.change === "replaced") return [was ? `Replaces ${was.title}` : row.source, member].filter(Boolean).join(". ");
  const moved = was && was.startsAt !== e.startsAt ? `Moved from ${clock(was.startsAt, { timeZone: STATION_TZ })}` : null;
  const ends = was && was.endsAt !== e.endsAt ? `Now ends ${clock(e.endsAt, { timeZone: STATION_TZ })}, was ${clock(was.endsAt, { timeZone: STATION_TZ })}` : null;
  const fixed = fixedReason(e, false);
  const words = [fixed && fixed !== "locked" ? FIXED_WORDS[fixed] : null, moved, ends].filter(Boolean);
  // As f-blockplace: a member's line is what it is to the block.
  if (member) return [...words, member].join(". ");
  return words.length ? words.join(". ") : row.source;
}

export function DayRundown({ rows, onAir, selected, onSelect, onFill, scrollTo, offAirHref, edit, className }: DayRundownProps) {
  const list = useRef<HTMLOListElement>(null);
  const scrolled = useRef<string | null>(null);
  // A drag: which row, how far, and where it would land (the row it would follow; null: the top).
  const [drag, setDrag] = useState<{ id: string; dy: number; after: string | null; moved: boolean } | null>(null);
  const start = useRef<{ id: string; y: number } | null>(null);
  // A live block's or sign-off's end being dragged: its new end.
  const [resizing, setResizing] = useState<{ id: string; endsAt: string } | null>(null);
  const resizeStart = useRef<{ id: string; y: number; endsAt: string } | null>(null);

  useLayoutEffect(() => {
    if (!scrollTo || scrolled.current === scrollTo || !list.current) return;
    const el = list.current.querySelector<HTMLElement>(`[data-row="${scrollTo}"]`);
    if (!el) return;
    scrolled.current = scrollTo;
    el.scrollIntoView?.({ block: "center" });
  }, [scrollTo, rows]);

  // The entries in air order, as the draft leaves them (removed ones aren't places to drop).
  const entryRows = useMemo(() => rows.filter((r) => r.kind === "entry" && !r.removed), [rows]);

  /** The rows a dragged one can't go above: everything up to the last that can't change. */
  const firstSlot = (id: string) => {
    if (!edit) return 0;
    const others = entryRows.filter((r) => r.id !== id);
    let last = -1;
    others.forEach((r, i) => {
      if (edit.locked(r.entry!)) last = i;
    });
    return last + 1;
  };

  /** Where a pointer at `y` would drop the row: after the entry above that point. */
  const afterAt = (id: string, y: number): string | null => {
    const others = entryRows.filter((r) => r.id !== id);
    let index = others.length;
    for (let i = 0; i < others.length; i++) {
      const el = list.current?.querySelector<HTMLElement>(`[data-row="${others[i].id}"]`);
      const box = el?.getBoundingClientRect();
      if (box && y < box.top + box.height / 2) {
        index = i;
        break;
      }
    }
    index = Math.max(index, firstSlot(id));
    return index === 0 ? null : others[index - 1].id;
  };

  const down = (id: string) => (e: PointerEvent<HTMLButtonElement>) => {
    start.current = { id, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    if (!s) return;
    const dy = e.clientY - s.y;
    if (!drag && Math.abs(dy) < 4) return;
    setDrag({ id: s.id, dy, after: afterAt(s.id, e.clientY), moved: true });
  };
  const up = () => {
    const d = drag;
    start.current = null;
    setDrag(null);
    if (!d || !edit) return;
    const changes = dropAfter(edit.reflow, d.id, d.after);
    if (changes.length) edit.onChanges(changes);
  };
  const key = (id: string) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!edit || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const changes = nudge(edit.reflow, id, e.key === "ArrowUp" ? -1 : 1, (x) => !!edit.locked(x));
    if (changes?.length) edit.onChanges(changes);
  };

  // A new end, five minutes a step (four pixels a minute while dragging).
  const resizeDown = (row: DayRow) => (e: PointerEvent<HTMLButtonElement>) => {
    resizeStart.current = { id: row.id, y: e.clientY, endsAt: row.endsAt };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const resizeMove = (e: PointerEvent<HTMLButtonElement>) => {
    const s = resizeStart.current;
    if (!s) return;
    const steps = Math.round((e.clientY - s.y) / 20);
    const endsAt = snapTime(t(s.endsAt) + steps * 5 * MIN);
    setResizing({ id: s.id, endsAt });
  };
  const resizeUp = () => {
    const r = resizing;
    resizeStart.current = null;
    setResizing(null);
    if (!r || !edit) return;
    const row = rows.find((x) => x.id === r.id);
    if (row && t(r.endsAt) > t(row.at)) {
      const changes = resizeTo(edit.reflow, r.id, r.endsAt);
      if (changes.length) edit.onChanges(changes);
    }
  };
  const resizeKey = (row: DayRow) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!edit || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const endsAt = snapTime(t(row.endsAt) + (e.key === "ArrowUp" ? -5 : 5) * MIN);
    if (t(endsAt) <= t(row.at)) return;
    const changes = resizeTo(edit.reflow, row.id, endsAt);
    if (changes.length) edit.onChanges(changes);
  };

  useEffect(() => {
    if (!edit) setDrag(null);
  }, [edit]);

  // ---- A block's start and end (Phase 4) ----
  const handles = edit?.handles;
  // A handle being dragged: which edge of which span, how far, and the start it would take.
  const [handleDrag, setHandleDrag] = useState<{ spanId: string; edge: HandleEdge; dy: number; at: string | null } | null>(null);
  const handleStart = useRef<{ spanId: string; edge: HandleEdge; y: number } | null>(null);
  const spots = useMemo(() => (handles ? handleSpots(rows, handles.limits.dayEnd) : []), [rows, handles]);
  const spanOf = (id: string) => edit?.spans.find((x) => x.id === id);
  const edgeAt = (span: DraftSpan, edge: HandleEdge) => (edge === "start" ? span.startsAt : span.endsAt);
  const rangeOf = (span: DraftSpan, edge: HandleEdge) => (handles && edit ? handleRange(span, edit.spans, edge, handles.limits) : null);
  /** The row a spot sits above (the first that starts there), or null for the day's end. */
  const rowAtSpot = (at: string) => rows.find((r) => r.at === at && ((r.kind === "entry" && !r.removed) || r.kind === "gap" || r.kind === "off_air")) ?? null;
  /** The spot nearest the pointer, inside what the edge can reach. */
  const spotAt = (span: DraftSpan, edge: HandleEdge, y: number): string | null => {
    const range = rangeOf(span, edge);
    if (!range || !list.current) return null;
    let best: { at: string; d: number } | null = null;
    for (const at of spotsIn(spots, range)) {
      const row = rowAtSpot(at);
      const el = row ? list.current.querySelector<HTMLElement>(`[data-row="${row.id}"]`) : null;
      const top = el ? el.getBoundingClientRect().top : list.current.getBoundingClientRect().bottom;
      const d = Math.abs(top - y);
      if (!best || d < best.d) best = { at, d };
    }
    return best?.at ?? null;
  };
  const moveEdge = (span: DraftSpan, edge: HandleEdge, at: string | null) => {
    if (!edit || !at || at === edgeAt(span, edge)) return;
    edit.onChanges([{ op: "block_resize", spanId: span.id, ...(edge === "start" ? { startsAt: at } : { endsAt: at }) }]);
  };
  const handleDown = (spanId: string, edge: HandleEdge) => (e: PointerEvent<HTMLButtonElement>) => {
    handleStart.current = { spanId, edge, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const handleMove = (e: PointerEvent<HTMLButtonElement>) => {
    const s = handleStart.current;
    const span = s && spanOf(s.spanId);
    if (!s || !span) return;
    const dy = e.clientY - s.y;
    if (!handleDrag && Math.abs(dy) < 4) return;
    setHandleDrag({ spanId: s.spanId, edge: s.edge, dy, at: spotAt(span, s.edge, e.clientY) });
  };
  const handleUp = () => {
    const d = handleDrag;
    handleStart.current = null;
    setHandleDrag(null);
    const span = d && spanOf(d.spanId);
    if (d && span) moveEdge(span, d.edge, d.at);
  };
  const handleKey = (span: DraftSpan, edge: HandleEdge) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const range = rangeOf(span, edge);
    if (range) moveEdge(span, edge, nudgeHandle(spots, edgeAt(span, edge), e.key === "ArrowUp" ? -1 : 1, range));
  };
  // While an edge is dragged: who joins the block and who leaves it, by the start-time rule.
  const dragSpan = handleDrag ? spanOf(handleDrag.spanId) : undefined;
  const dragNext = dragSpan && handleDrag?.at ? { startsAt: handleDrag.edge === "start" ? handleDrag.at : dragSpan.startsAt, endsAt: handleDrag.edge === "end" ? handleDrag.at : dragSpan.endsAt } : null;
  const dragChange = dragSpan && dragNext && edit ? membershipChange(dragSpan, dragNext, edit.reflow.entries) : null;
  const joining = new Set(dragChange?.joins.map((x) => x.id) ?? []);
  const leaving = new Set(dragChange?.leaves.map((x) => x.id) ?? []);

  /** A block's start or end: a handle row (f-blockplace's .spanhandle). */
  const handleRow = (span: DraftSpan, edge: HandleEdge) => {
    if (!handles || !edit) return null;
    const range = rangeOf(span, edge);
    const locked = !range;
    const was = handles.original.get(span.id);
    const moved = !!was && edgeAt(was as DraftSpan, edge) !== edgeAt(span, edge);
    const words = handleWords(span, edge, { was, entries: edit.reflow.entries, outro: handles.outro(span.blockId), locked: edge === "start" && locked });
    const dragging = handleDrag?.spanId === span.id && handleDrag.edge === edge;
    // While dragged it stays put: the line where it would land moves, with who that brings in or lets go.
    const style = { "--cc-edge": span.colour ?? "var(--ink-70)" } as CSSProperties;
    const now = edgeAt(span, edge);
    return (
      <li key={`handle:${span.id}:${edge}`} data-handle={`${span.id}:${edge}`} className={["cc-rr", "cc-rr--handle", moved && "cc-rr--handle-moved", dragging && "cc-rr--handle-dragging"].filter(Boolean).join(" ")} style={style}>
        <div className="cc-span">
          {locked ? (
            <span className="cc-span__grip cc-span__grip--off" aria-hidden="true" />
          ) : (
            <button
              type="button"
              className="cc-span__grip"
              aria-label={`Move the ${edge} of ${span.name}, now ${clock(now, { timeZone: STATION_TZ })}`}
              aria-roledescription="draggable"
              onPointerDown={handleDown(span.id, edge)}
              onPointerMove={handleMove}
              onPointerUp={handleUp}
              onPointerCancel={() => {
                handleStart.current = null;
                setHandleDrag(null);
              }}
              onKeyDown={handleKey(span, edge)}
            >
              <span aria-hidden="true" />
            </button>
          )}
          <button type="button" className="cc-span__pick" onClick={() => handles.onPick?.(span.id)} disabled={!handles.onPick}>
            <b>{words.title}</b> <small>{words.detail}</small>
          </button>
          {edge === "start" && !locked && (
            <button type="button" className="cc-rr__icon" aria-label={`Take ${span.name} off this day`} title="Take it off" onClick={() => edit.onChanges([{ op: "block_remove", spanId: span.id }])}>
              <Icon name="x" size={14} />
            </button>
          )}
        </div>
      </li>
    );
  };
  // Where each end handle goes: above the first row that starts at or after the block's end.
  const endsBefore = new Map<string, DraftSpan[]>();
  const endsLast: DraftSpan[] = [];
  if (handles && edit) {
    for (const span of edit.spans) {
      if (span.endsAt <= (rows[0]?.at ?? span.endsAt) || span.endsAt > handles.limits.dayEnd) continue;
      const below = rows.find((r) => r.kind !== "break" && r.at >= span.endsAt && r.span?.id !== span.id);
      if (below) endsBefore.set(below.id, [...(endsBefore.get(below.id) ?? []), span]);
      else endsLast.push(span);
    }
  }
  /** The line where a dragged edge would land. */
  const handleDropLine = (beforeRowId: string | null) => {
    if (!handleDrag?.at || !dragSpan) return null;
    const target = rowAtSpot(handleDrag.at);
    if ((target?.id ?? null) !== beforeRowId) return null;
    const what = handleDrag.edge === "start" ? `${dragSpan.name} starts ${clock(handleDrag.at, { timeZone: STATION_TZ })}` : `Ends ${clock(handleDrag.at, { timeZone: STATION_TZ })}`;
    return (
      <li key={`hdrop:${beforeRowId ?? "end"}`} className="cc-rr__drop" aria-hidden="true">
        <span>
          {what}. {dragChange ? membershipWords(dragChange) : ""}
        </span>
      </li>
    );
  };

  // "Add here" before an entry or dead air: right after the entry above (and its break).
  const addAt = (row: DayRow, i: number): string | null => {
    if (!edit || row.removed || (row.kind !== "entry" && row.kind !== "gap")) return null;
    const prev = [...rows.slice(0, i)].reverse().find((r) => r.kind === "entry" && !r.removed);
    const at = row.kind === "gap" ? row.at : prev ? new Date(endWithBreak(prev.entry!, edit.reflow.breaks)).toISOString() : row.at;
    return t(at) >= edit.earliest && t(at) <= t(row.at) ? at : null;
  };

  const dragged = drag ? rows.find((r) => r.id === drag.id) : null;
  const dropLine = (after: string | null) => {
    if (!edit || !drag || !dragged?.entry) return null;
    const at = dropStart(edit.reflow, drag.id, after);
    const note = at ? membershipNote(edit.spans, dragged.entry.startsAt, at) : null;
    return (
      <li className="cc-rr__drop" aria-hidden="true">
        <span>
          {at ? `Drop here: ${clock(at, { timeZone: STATION_TZ })}` : "Drop here"}
          {note ? `. ${note}` : ""}
        </span>
      </li>
    );
  };

  return (
    <ol ref={list} className={["cc-rd", edit && "cc-rd--edit", className].filter(Boolean).join(" ")} aria-label={edit ? "The rundown, being edited" : "The rundown"}>
      {drag && drag.after === null && dropLine(null)}
      {rows.map((row, i) => {
        const edge = row.block ? { "--cc-edge": row.block.colour ?? "var(--ink-70)" } : undefined;
        const add = addAt(row, i);
        const addLine = add ? (
          <li key={`add:${row.id}`} className="cc-rr__add">
            <button type="button" onClick={() => edit!.onAddAt(add)}>
              Add here<span className="oc-sr-only">, {clock(add, { timeZone: STATION_TZ })}</span>
            </button>
          </li>
        ) : null;
        const after = drag && drag.after === row.id ? dropLine(row.id) : null;
        // Phase 4: a block's end handle above the row it ends at, and a dragged edge's landing line.
        const ends = (endsBefore.get(row.id) ?? []).map((sp) => handleRow(sp, "end"));
        const edgeDrop = handleDropLine(row.id);

        if (row.kind === "band" && handles && row.span) {
          const span = spanOf(row.span.id);
          return span ? [...ends, edgeDrop, handleRow(span, "start")] : ends;
        }

        if (row.kind === "band") {
          return (
            <li key={row.id} data-row={row.id} className={["cc-rr", "cc-rr--band", selected === row.id && "cc-rr--sel"].filter(Boolean).join(" ")} style={edge as never}>
              <button type="button" className="cc-rr__pick" onClick={() => onSelect(row)} aria-pressed={selected === row.id}>
                <span className="cc-rr__sw" aria-hidden="true" />
                <span className="cc-rr__band">{row.title}</span> <small>{row.detail}</small>
              </button>
            </li>
          );
        }

        const time = <span className="cc-rr__t">{rowTime(row.at, row.kind)}</span>;
        const len = <span className="cc-rr__len">{rowLength(t(row.endsAt) - t(row.at))}</span>;
        const now = row.state === "now" && onAir && (row.kind === "entry" || row.kind === "break");
        const base = ["cc-rr", `cc-rr--${row.kind === "off_air" ? "off" : row.kind}`, row.code === "OFF" && "cc-rr--off", row.state === "past" && "cc-rr--past", now && "cc-rr--now", selected === row.id && "cc-rr--sel"];

        if (row.kind === "break") {
          return [
            ...ends,
            addLine,
            <li key={row.id} data-row={row.id} className={base.filter(Boolean).join(" ")} style={edge as never}>
              <span className="cc-rr__edge" aria-hidden="true" />
              {time}
              <RowCodeTag row={row} />
              <button type="button" className="cc-rr__pick cc-rr__bline" onClick={() => onSelect(row)} aria-pressed={selected === row.id} disabled={!!edit}>
                {/* The line beside it says the same in words. */}
                <span aria-hidden="true" className="cc-rr__barwrap">
                  <BreakStrip parts={row.parts ?? []} variant="bar" className="cc-rr__bar" />
                </span>
                <span>{row.title}</span>
                {now && <span className="cc-rr__tag">ON AIR</span>}
              </button>
              {len}
            </li>,
            after
          ];
        }

        if (row.kind === "gap") {
          return [
            ...ends,
            edgeDrop,
            addLine,
            <li key={row.id} data-row={row.id} className={base.filter(Boolean).join(" ")} style={edge as never}>
              <span className="cc-rr__edge" aria-hidden="true" />
              {time}
              <RowCodeTag row={row} />
              <div className="cc-rr__main">
                <b>{row.title}</b>
                <small>{row.source}</small>
              </div>
              <span className="cc-rr__act">
                <button type="button" className="cc-btn-xs cc-btn-xs--warn" onClick={() => onFill(row)}>
                  Fill<span className="oc-sr-only"> {row.source?.replace("Nothing until", "the dead air until")}</span>
                </button>
              </span>
            </li>,
            after
          ];
        }

        if (row.kind === "off_air") {
          return [
            ...ends,
            edgeDrop,
            <li key={row.id} data-row={row.id} className={base.filter(Boolean).join(" ")}>
              <span className="cc-rr__edge" aria-hidden="true" />
              {time}
              <RowCodeTag row={row} />
              <div className="cc-rr__main">
                <b>{row.title}</b>
                <small>
                  {row.source}
                  {offAirHref && (
                    <>
                      {". "}
                      <Link to={offAirHref} className="cc-log__link">
                        Change the hours
                      </Link>
                    </>
                  )}
                </small>
              </div>
              {len}
            </li>,
            after
          ];
        }

        // A program, live block or sign-off.
        const e = row.entry!;
        const lock = edit ? edit.locked(e) : null;
        const fixed = edit ? fixedReason(e, !!lock) : null;
        const movable = !!edit && !row.removed && !fixed;
        const resizable = !!edit && !row.removed && !lock && (e.kind === "live" || e.kind === "off_air");
        const isDragged = drag?.id === row.id;
        const shownEnd = resizing?.id === row.id ? resizing.endsAt : row.endsAt;
        const classes = [
          ...base,
          edit && e.change && e.change !== "inserted" && "cc-rr--moved",
          edit && e.change === "inserted" && "cc-rr--ins",
          row.removed && "cc-rr--rem",
          lock && "cc-rr--lock",
          edit?.troubled.has(row.id) && "cc-rr--problem",
          isDragged && "cc-rr--dragging",
          row.warn && "cc-rr--warn"
        ];
        const line = edit ? editLine(row, edit) : row.source;
        // Its name with its time: a series airs more than once a day.
        const named = `${row.title}, ${clock(row.at, { timeZone: STATION_TZ })}`;
        const state = edit ? [e.change === "inserted" ? "new" : e.change, row.removed ? "coming off" : null, lock ? "locked" : null, e.keepTime ? "kept at this time" : null, edit.troubled.has(row.id) ? "has a problem" : null].filter(Boolean).join(", ") : "";
        return [
          ...ends,
          edgeDrop,
          addLine,
          <li key={row.id} data-row={row.id} className={classes.filter(Boolean).join(" ")} style={{ ...(edge as object), ...(isDragged ? { transform: `translateY(${drag!.dy}px)` } : {}) }}>
            {movable ? (
              <button
                type="button"
                className="cc-rr__drag"
                aria-label={`Move ${named}`}
                aria-roledescription="draggable"
                onPointerDown={down(row.id)}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={() => {
                  start.current = null;
                  setDrag(null);
                }}
                onKeyDown={key(row.id)}
              >
                <Icon name="guide" size={14} />
              </button>
            ) : (
              <span className="cc-rr__edge" aria-hidden="true" />
            )}
            <span className="cc-rr__t">
              {rowTime(row.at, row.kind)}
              {lock && <small className="cc-rr__locked">locked</small>}
            </span>
            <RowCodeTag row={row} />
            <div className="cc-rr__main">
              <button type="button" className="cc-rr__pick" onClick={() => onSelect(row)} aria-pressed={selected === row.id}>
                <b>
                  {row.title}
                  {now && <span className="cc-rr__tag">ON AIR</span>}
                  {edit && fixed && fixed !== "locked" && !row.removed && <span className="cc-rr__fixed">FIXED</span>}
                  {!edit && e.keepTime && <span className="cc-rr__fixed">KEPT</span>}
                  {nextEpisodeMark(e) && !row.removed && (
                    <span className="cc-rr__next" title={`From the ${e.templateSlot!.label} template`}>
                      Next episode
                    </span>
                  )}
                </b>
                {state && <span className="oc-sr-only">, {state}</span>}
              </button>
              <small>{line}</small>
              {isDragged && drag?.after !== undefined && edit && (
                <small className="cc-rr__in">{membershipNote(edit.spans, e.startsAt, dropStart(edit.reflow, row.id, drag.after) ?? e.startsAt)}</small>
              )}
              {dragSpan && (joining.has(e.id) || leaving.has(e.id)) && <small className="cc-rr__in">{joining.has(e.id) ? `Joins ${dragSpan.name}` : `Leaves ${dragSpan.name}`}</small>}
            </div>
            {edit && !row.removed && !lock ? (
              <span className="cc-rr__tools">
                {resizable ? (
                  <button
                    type="button"
                    className="cc-rr__resize"
                    aria-label={`Change when ${named} ends, now ${clock(shownEnd, { timeZone: STATION_TZ })}`}
                    onPointerDown={resizeDown(row)}
                    onPointerMove={resizeMove}
                    onPointerUp={resizeUp}
                    onPointerCancel={() => {
                      resizeStart.current = null;
                      setResizing(null);
                    }}
                    onKeyDown={resizeKey(row)}
                  >
                    {resizing?.id === row.id ? `Ends ${clock(shownEnd, { timeZone: STATION_TZ })}` : rowLength(t(row.endsAt) - t(row.at))}
                  </button>
                ) : (
                  len
                )}
                {e.kind !== "off_air" && (
                  <button type="button" className="cc-rr__icon" aria-pressed={!!e.keepTime} aria-label={`Keep ${named}, at this time`} title="Keep at this time" onClick={() => edit.onKeep(e)}>
                    <Icon name="pin" size={14} />
                  </button>
                )}
                <button type="button" className="cc-rr__icon" aria-label={`Remove ${named}`} title="Remove" onClick={() => edit.onChanges([{ op: "remove", entryId: e.id }])}>
                  <Icon name="x" size={14} />
                </button>
              </span>
            ) : edit && row.removed ? (
              <span className="cc-rr__tools">
                <button type="button" className="cc-btn-xs" onClick={() => edit.onRestore(e.id)}>
                  Undo<span className="oc-sr-only">: {named} stays on</span>
                </button>
              </span>
            ) : (
              len
            )}
          </li>,
          after
        ];
      })}
      {endsLast.map((sp) => handleRow(sp, "end"))}
      {handleDropLine(null)}
    </ol>
  );
}
