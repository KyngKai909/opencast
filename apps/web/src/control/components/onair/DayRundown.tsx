// A246: the Day view's rundown (opencast-schedule 01, 04): one row per program, live block, break,
// dead air and planned off air, in air order, with a block's colour down its rows' edge and its
// label where it starts. Past rows dim; the row on air gets the red edge and ON AIR. A row picks
// out its pane (a program, a break, a block); dead air has Fill; planned off air links to the off
// air hours ("Every day" on the Templates tab). It opens scrolled to now, or to the row asked for.
//
// In edit mode the rows are the draft: moved rows in blue, a new row outlined, a removed one struck
// through, fixed points marked, locked rows saying why. Rows move by their handle (drag, or the
// arrow keys a place at a time), "Add here" sits between rows, a live block or sign-off has its
// end to drag, and each row has "Keep at this time" and Remove. Moving follows reorder.ts.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Link } from "react-router";
import type { LogChange, LogEntry } from "@opencast/contracts";
import { BreakStrip, Icon, clock, snapTime } from "@opencast/ui";
import { STATION_TZ } from "../../../lib/clock";
import { ROW_CODE_WORDS, rowLength, rowTime, type DayRow } from "./dayRows";
import type { DraftEntry, DraftSpan } from "./logEdit";
import { FIXED_WORDS, dropAfter, dropStart, endWithBreak, fixedReason, membershipNote, nudge, resizeTo, type Reflow } from "./reorder";

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

/** What a draft row says under its title in edit mode. */
function editLine(row: DayRow, edit: RundownEdit): string | null {
  const e = row.entry!;
  if (row.removed) return "Coming off the log";
  const lock = edit.locked(e);
  if (lock) return lock;
  const was = edit.original.get(e.id);
  if (e.change === "inserted") return `New. ${row.source ?? ""}`.trim();
  if (e.change === "replaced") return was ? `Replaces ${was.title}` : row.source;
  const moved = was && was.startsAt !== e.startsAt ? `Moved from ${clock(was.startsAt, { timeZone: STATION_TZ })}` : null;
  const ends = was && was.endsAt !== e.endsAt ? `Now ends ${clock(e.endsAt, { timeZone: STATION_TZ })}, was ${clock(was.endsAt, { timeZone: STATION_TZ })}` : null;
  const fixed = fixedReason(e, false);
  const words = [fixed && fixed !== "locked" ? FIXED_WORDS[fixed] : null, moved, ends].filter(Boolean);
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
                </b>
                {state && <span className="oc-sr-only">, {state}</span>}
              </button>
              <small>{line}</small>
              {isDragged && drag?.after !== undefined && edit && (
                <small className="cc-rr__in">{membershipNote(edit.spans, e.startsAt, dropStart(edit.reflow, row.id, drag.after) ?? e.startsAt)}</small>
              )}
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
    </ol>
  );
}
