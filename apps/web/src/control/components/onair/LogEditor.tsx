// Edit mode on the program log (the user's request of 2026-09-29; no frame draws it). "Edit log"
// makes the log editable again for owners and operators: move a program by dragging it or typing a
// start, replace what airs, change a live block's length, take something off, or put something on
// before or after another, from the library or a program the station carries. Breaks follow the
// programs. Nothing goes out until "Publish changes": the draft is checked by the API as a whole
// (a dry run) and summed up first ("3 changes: Late Crate moves to 9:10 pm, …"), with overlaps,
// dead air, held spots and anything locked said before it's published, all at once. On air, the
// entry airing now and anything inside the assembler's lead is locked; the rest goes live when
// it's published. The draft is kept for this tab (sessionStorage), so a trip to the market and back
// keeps it. Every published batch is in the log's history, with who and when.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { blocksApi, catalogApi, libraryApi, logApi, type LibraryItem, type LogChange, type LogChangesResult, type LogEntry, type ProgramLog } from "@opencast/contracts";
import { Button, ChoiceList, Field, LogCode, Modal, Notice, Segmented, SelectField, TimelineBands, clock, clockRange, duration, placeBlocks, useToast, type TimelineBand, type TimelineBlock } from "@opencast/ui";
import { ApiError, call } from "../../../api/client";
import { useApi } from "../../../api/hooks";
import { now as clockNow, STATION_TZ } from "../../../lib/clock";
import { LOG_READS } from "./data";
import { airable } from "./repeat";
import { draftBreaks, draftEntries, draftSpans, dragTo, insertId, isBlockChange, lockOf, newSpanId, rippleFrom, spanAt, spanPieces, timeValue, typedTime, wholeMinutes, withChange, type DraftEntry, type DraftItem, type DraftSpan } from "./logEdit";
import { dayClock, spanText } from "./time";
import { stationLabel } from "../../station/slug";

const MIN = 60_000;

interface Draft {
  /** The window and version the draft began from: the API refuses it if the log changed there since. */
  base: { from: string; to: string; version: string } | null;
  changes: LogChange[];
  /** Items the draft puts on the log (for their titles and lengths before it's published). */
  items: Record<string, DraftItem>;
  seq: number;
}

const storageKey = (stationId: string) => `oc-log-draft:${stationId}`;

function readDraft(stationId: string): Draft | null {
  try {
    const raw = sessionStorage.getItem(storageKey(stationId));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function writeDraft(stationId: string, draft: Draft | null) {
  try {
    if (draft) sessionStorage.setItem(storageKey(stationId), JSON.stringify(draft));
    else sessionStorage.removeItem(storageKey(stationId));
  } catch {
    // Private windows: the draft lives as long as the page.
  }
}

const itemOf = (i: LibraryItem): DraftItem => ({ id: i.id, title: i.title, durationMs: i.durationMs, code: i.code, programId: i.programId });

export type LogEdit = ReturnType<typeof useLogEdit>;

/** The draft, its check (the API's dry run), publishing and discarding. */
export function useLogEdit({ stationId, log, win, active, onAir, now, onDone }: { stationId: string; log: ProgramLog | undefined; win: { from: string; to: string }; active: boolean; onAir: boolean; now: number; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(() => (active ? readDraft(stationId) : null));
  const [publishError, setPublishError] = useState<ApiError | null>(null);
  const [publishing, setPublishing] = useState(false);

  // A draft begins from the log as it's shown; leaving edit mode (publishing, discarding) drops it.
  // Leaving the page keeps it for the tab.
  const wasActive = useRef(active);
  useEffect(() => {
    if (!active) {
      if (wasActive.current) writeDraft(stationId, null);
      setDraft(null);
    } else if (!draft && log) setDraft(readDraft(stationId) ?? { base: log.version ? { ...win, version: log.version } : null, changes: [], items: {}, seq: 0 });
    wasActive.current = active;
  }, [active, draft, log, stationId, win.from, win.to]);
  useEffect(() => {
    if (active) writeDraft(stationId, draft);
  }, [active, draft, stationId]);

  const library = useApi(libraryApi.getLibrary, { params: { stationId }, query: {} }, { enabled: active });
  const items = useMemo(() => {
    const map = new Map<string, DraftItem>((library.data?.items ?? []).map((i) => [i.id, itemOf(i)]));
    for (const [id, item] of Object.entries(draft?.items ?? {})) map.set(id, item);
    return map;
  }, [library.data, draft?.items]);

  const changes = draft?.changes ?? [];
  const body = draft && changes.length ? { dryRun: true, ...(draft.base ? { base: draft.base } : {}), changes } : null;
  const check = useQuery<LogChangesResult, ApiError>({
    queryKey: ["log-changes-check", stationId, JSON.stringify(body)],
    queryFn: () => call(logApi.applyLogChanges, { params: { stationId }, body: body! }),
    enabled: !!body,
    placeholderData: (prev) => prev,
    retry: false,
    staleTime: 10_000
  });

  const entries = useMemo(() => draftEntries(log?.entries ?? [], changes, (id) => items.get(id)), [log?.entries, changes, items]);
  // A244: programming blocks' spans as the draft leaves them.
  const blockList = useApi(blocksApi.listBlocks, { params: { stationId } }, { enabled: active, retry: false });
  const spans = useMemo(
    () =>
      draftSpans((log?.blocks ?? []).map((b) => ({ id: b.id, blockId: b.blockId, name: b.name, colour: b.colour, startsAt: b.startsAt, endsAt: b.endsAt })), changes, (id) => {
        const b = blockList.data?.blocks.find((x) => x.id === id);
        return b ? { name: b.name, colour: b.colour } : undefined;
      }),
    [log?.blocks, changes, blockList.data]
  );
  const breaks = useMemo(() => draftBreaks(log?.breaks ?? [], log?.entries ?? [], changes, entries), [log?.breaks, log?.entries, changes, entries]);
  const original = useMemo(() => new Map((log?.entries ?? []).map((e) => [e.id, e])), [log?.entries]);
  const locked = (e: Pick<LogEntry, "id" | "startsAt" | "endsAt">) => lockOf(original.get(e.id) ?? e, now, onAir);

  const result = body ? check.data : undefined;
  // Problems and changes by entry, to mark them on the timeline.
  const entryOfChange = (i: number) => {
    const c = changes[i];
    return c ? (isBlockChange(c) ? (c.op === "block_add" ? (c.key ? newSpanId(c.key) : null) : c.spanId) : c.op === "insert" ? (c.key ? insertId(c.key) : null) : c.entryId) : null;
  };
  const troubled = new Set((result?.problems ?? []).flatMap((p) => (p.index === null ? [] : [entryOfChange(p.index)])).filter((v): v is string => !!v));

  const shownWindow = draft?.base && draft.base.from === win.from && draft.base.to === win.to;
  const conflict =
    (check.error?.code === "log_changed" ? check.error : null) ??
    (publishError?.code === "log_changed" ? publishError : null) ??
    (shownWindow && log?.version && draft?.base && log.version !== draft.base.version ? new ApiError(409, "log_changed", "The log changed since you started editing. Reload it to see what changed, then make your changes again.") : null);

  const refresh = () => Promise.all([...LOG_READS, logApi.listLogChanges].map((e) => qc.invalidateQueries({ queryKey: [e.method, e.path] })));

  return {
    draft,
    changes,
    entries,
    breaks,
    spans,
    blocks: blockList.data?.blocks ?? [],
    items,
    library: library.data,
    result,
    checking: check.isFetching,
    checkError: check.error && check.error.code !== "log_changed" ? check.error.message : null,
    conflict,
    publishing,
    publishError: publishError && publishError.code !== "log_changed" ? publishError.message : null,
    troubled,
    locked,
    /** Adds a change (and the item it puts on the log, if any). */
    add(change: LogChange | LogChange[], item?: DraftItem) {
      setPublishError(null);
      setDraft((d) => (d ? { ...d, changes: (Array.isArray(change) ? change : [change]).reduce(withChange, d.changes), items: item ? { ...d.items, [item.id]: item } : d.items } : d));
    },
    /** Takes one change back out of the draft. */
    drop(index: number) {
      setDraft((d) => (d ? { ...d, changes: d.changes.filter((_, i) => i !== index) } : d));
    },
    /** A key for an insert (it has no id until it's published). */
    nextKey() {
      const key = `k${(draft?.seq ?? 0) + 1}-${Date.now().toString(36)}`;
      setDraft((d) => (d ? { ...d, seq: d.seq + 1 } : d));
      return key;
    },
    async publish() {
      if (!draft || !changes.length) return;
      setPublishing(true);
      setPublishError(null);
      try {
        const r = await call(logApi.applyLogChanges, { params: { stationId }, body: { dryRun: false, ...(draft.base ? { base: draft.base } : {}), changes } });
        writeDraft(stationId, null);
        setDraft(null);
        await refresh();
        toast.show({ message: r.changes.length === 1 ? "1 change published." : `${r.changes.length} changes published.` });
        onDone();
      } catch (e) {
        setPublishError(e instanceof ApiError ? e : new ApiError(0, "failed", "That didn't go through. Try again."));
      } finally {
        setPublishing(false);
      }
    },
    discard() {
      writeDraft(stationId, null);
      setDraft(null);
      setPublishError(null);
      onDone();
    },
    /** After a conflict: the log as it is now, and a fresh draft from it. */
    async reload() {
      writeDraft(stationId, null);
      setPublishError(null);
      await refresh();
      setDraft(null);
    }
  };
}

/** Dead air in the drafted window (planned off air isn't), from now on. */
export function draftGaps(entries: DraftEntry[], offAir: NonNullable<ProgramLog["offAir"]>, from: string, to: string): Array<{ startsAt: string; endsAt: string }> {
  const gaps: Array<{ startsAt: string; endsAt: string }> = [];
  let cursor = Date.parse(from);
  const blocks = [...entries, ...offAir].map((b) => ({ s: Date.parse(b.startsAt), e: Date.parse(b.endsAt) })).sort((a, b) => a.s - b.s);
  for (const b of blocks) {
    if (b.s > cursor) gaps.push({ startsAt: new Date(cursor).toISOString(), endsAt: new Date(Math.min(b.s, Date.parse(to))).toISOString() });
    cursor = Math.max(cursor, b.e);
  }
  if (cursor < Date.parse(to)) gaps.push({ startsAt: new Date(cursor).toISOString(), endsAt: to });
  // Shorter than five minutes between programs is a break, not dead air.
  return gaps.filter((g) => Date.parse(g.endsAt) - Date.parse(g.startsAt) >= 5 * MIN || g.endsAt === to);
}

export interface EditTimelineProps {
  blocks: TimelineBlock[];
  from: string;
  to: string;
  pxPerMinute: number;
  maxHeight?: number;
  entries: Map<string, DraftEntry>;
  locked: (e: DraftEntry) => string | null;
  troubled: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, startsAt: string) => void;
  /** A244: programming blocks' spans as the draft leaves them, their rails beside the column. */
  spans?: DraftSpan[];
  /** Spans with a problem in the draft. */
  troubledSpans?: Set<string>;
  onSelectSpan?: (id: string) => void;
  onResizeSpan?: (id: string, edge: "start" | "end", at: string) => void;
}

/** A244: the draft's spans as rails: solid where their programs air (as the draft leaves them), dashed elsewhere. */
export function draftBands(spans: DraftSpan[], entries: Array<Pick<LogEntry, "id" | "kind" | "startsAt" | "endsAt">>, troubled?: Set<string>): TimelineBand[] {
  return spans.map((sp) => ({ id: sp.id, label: sp.name, start: sp.startsAt, end: sp.endsAt, pieces: spanPieces(sp, entries).map((p) => ({ start: p.startsAt, end: p.endsAt })), colour: sp.colour, problems: troubled?.has(sp.id) ? 1 : 0 }));
}

/**
 * The timeline in edit mode: the log as the draft leaves it, drawn as the log's timeline is. A
 * program, live block or sign-off can be dragged to a new start (to the nearest whole minute, a
 * segment boundary) or moved a minute at a time with the arrow keys (five with Shift); a press
 * picks it for the pane. What's locked stays put.
 */
export function EditTimeline({ blocks, from, to, pxPerMinute, maxHeight, entries, locked, troubled, selectedId, onSelect, onMove, spans = [], troubledSpans, onSelectSpan, onResizeSpan }: EditTimelineProps) {
  const a0 = Date.parse(from);
  const total = ((Date.parse(to) - a0) / MIN) * pxPerMinute;
  const hours: number[] = [];
  for (let h = a0; h <= Date.parse(to); h += 3_600_000) hours.push(h);
  const drag = useRef<{ id: string; y: number; moved: boolean } | null>(null);
  const [offset, setOffset] = useState<{ id: string; dy: number } | null>(null);

  const down = (id: string) => (e: PointerEvent<HTMLButtonElement>) => {
    const entry = entries.get(id);
    if (!entry || locked(entry)) return;
    drag.current = { id, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y;
    if (Math.abs(dy) > 3) d.moved = true;
    if (d.moved) setOffset({ id: d.id, dy });
  };
  const up = (id: string) => (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    setOffset(null);
    if (!d || d.id !== id || !d.moved) return;
    const entry = entries.get(id)!;
    const startsAt = dragTo(entry.startsAt, e.clientY - d.y, pxPerMinute);
    if (startsAt !== entry.startsAt) onMove(id, startsAt);
  };
  const key = (id: string) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    const entry = entries.get(id);
    if (!entry || locked(entry)) return;
    e.preventDefault();
    const minutes = (e.shiftKey ? 5 : 1) * (e.key === "ArrowUp" ? -1 : 1);
    onMove(id, dragTo(entry.startsAt, minutes * pxPerMinute, pxPerMinute));
  };

  return (
    <div className={`oc-tl cc-edit__tl${spans.length ? " oc-tl--bands" : ""}`} style={maxHeight ? { maxHeight, overflow: "auto" } : undefined}>
      <div className="oc-tl__hrs" style={{ height: total }}>
        <div aria-hidden="true">
          {hours.map((h, i) => (
            <span key={h} style={{ top: i * 60 * pxPerMinute }}>
              {clock(h, { timeZone: STATION_TZ }).replace(":00 ", " ")}
            </span>
          ))}
        </div>
        {spans.length > 0 && (
          <TimelineBands
            bands={draftBands(spans, [...entries.values()], troubledSpans)}
            from={from}
            to={to}
            pxPerMinute={pxPerMinute}
            timeZone={STATION_TZ}
            selectedId={selectedId}
            onSelect={onSelectSpan ? (b) => onSelectSpan(b.id) : undefined}
            onResize={onResizeSpan ? (b, edge, at) => onResizeSpan(b.id, edge, at) : undefined}
          />
        )}
      </div>
      <div className="oc-tl__col" style={{ height: total }} role="list" aria-label="The log, being edited">
        {hours.map((h, i) => (
          <div key={h} className="oc-tl__hl" style={{ top: i * 60 * pxPerMinute }} />
        ))}
        {placeBlocks(blocks, from, pxPerMinute).map(({ block: b, top, height }) => {
          const entry = entries.get(b.id);
          const span = clockRange(b.start, b.end, { timeZone: STATION_TZ });
          const style = { top: top + (offset?.id === b.id ? offset.dy : 0), height };
          if (!entry || b.kind === "brk" || b.kind === "dead") {
            const words = b.kind === "brk" ? <span className="oc-sr-only">{`Break ${duration(Date.parse(String(b.end)) - Date.parse(String(b.start)))}, ${span}`}</span> : b.kind === "dead" ? `Dead air, ${span}` : (
              <>
                <LogCode code={b.code ?? "PGM"} />
                <div>
                  <b>{b.title}</b> <small>{b.source}</small>
                  <span className="oc-sr-only">, {span}</span>
                </div>
              </>
            );
            return (
              <div key={b.id} role="listitem" className="oc-tl__item" style={style}>
                <div className={`oc-blk oc-blk--${b.kind}`}>{words}</div>
              </div>
            );
          }
          const lock = locked(entry);
          const classes = [
            "oc-blk",
            `oc-blk--${b.kind}`,
            "cc-edit__blk",
            b.id === selectedId && "oc-blk--sel",
            entry.change && "cc-edit__blk--changed",
            lock && "cc-edit__blk--locked",
            troubled.has(b.id) && "cc-edit__blk--problem",
            offset?.id === b.id && "cc-edit__blk--dragging"
          ]
            .filter(Boolean)
            .join(" ");
          const state = [entry.change === "inserted" ? "new" : entry.change, lock ? "locked" : null, troubled.has(b.id) ? "has a problem" : null].filter(Boolean).join(", ");
          return (
            <div key={b.id} role="listitem" className="oc-tl__item" style={style}>
              <button
                type="button"
                className={classes}
                aria-pressed={b.id === selectedId}
                aria-roledescription={lock ? undefined : "draggable"}
                data-entry={b.id}
                onPointerDown={down(b.id)}
                onPointerMove={move}
                onPointerUp={up(b.id)}
                onPointerCancel={() => {
                  drag.current = null;
                  setOffset(null);
                }}
                onClick={() => onSelect(b.id)}
                onKeyDown={key(b.id)}
              >
                <LogCode code={b.code ?? "PGM"} />
                <div>
                  <b>{b.title}</b> <small>{b.source}</small>
                  {/* A244: dropped here, it's the block's. */}
                  {offset?.id === b.id && spanAt(spans, dragTo(entry.startsAt, offset.dy, pxPerMinute)) && <small className="cc-edit__in">In {spanAt(spans, dragTo(entry.startsAt, offset.dy, pxPerMinute))!.name}</small>}
                  <span className="oc-sr-only">
                    , {span}
                    {state ? `, ${state}` : ""}
                  </span>
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The top of the pane in edit mode: what the draft does, and publishing it. */
export function ChangesSection({ edit }: { edit: LogEdit }) {
  const r = edit.result;
  const count = edit.changes.length;
  const blocked = !!r?.problems.length || !!edit.conflict;
  return (
    <section className="cc-log__sec cc-edit__changes" aria-label="Your changes">
      <h2 className="cc-log__h">Your changes</h2>
      {edit.conflict ? (
        <Notice
          tone="standby"
          title="The log changed since you started editing."
          action={
            <Button size="sm" onClick={() => void edit.reload()}>
              Reload
            </Button>
          }
        >
          Reloading drops your changes. Make them again on the log as it is now.
        </Notice>
      ) : !count ? (
        <p className="cc-log__quiet">No changes yet. Drag a program to move it, or pick one to change it.</p>
      ) : (
        <>
          <p className="cc-edit__summary" aria-live="polite">
            {r ? r.summary : edit.checking ? "Checking your changes…" : null}
          </p>
          {r && (
            <ul className="cc-edit__lines">
              {r.changes.map((c) => (
                <li key={c.index}>
                  <span>{c.line}</span>
                  <Button variant="text" size="sm" onClick={() => edit.drop(c.index)} aria-label={`Undo: ${c.line}`}>
                    Undo
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {!!r?.problems.length && (
            <ul className="cc-edit__problems" aria-label="Problems">
              {r.problems.map((p, i) => (
                <li key={i}>{p.index === null ? p.message : `${r.changes[p.index]?.line ?? "A change"}: ${p.message}`}</li>
              ))}
            </ul>
          )}
          {!!r?.warnings.length && (
            <ul className="cc-edit__warnings" aria-label="Before you publish">
              {r.warnings.map((w, i) => (
                <li key={i}>{w.message}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {edit.checkError && <p className="cc-log__err">{edit.checkError}</p>}
      {edit.publishError && <p className="cc-log__err">{edit.publishError}</p>}
      <div className="cc-edit__actions">
        <Button variant="ink" size="sm" onClick={() => void edit.publish()} disabled={!count || blocked || !r || edit.checking || edit.publishing}>
          Publish changes
        </Button>
        <Button size="sm" onClick={edit.discard} disabled={edit.publishing}>
          {count ? "Discard" : "Done"}
        </Button>
      </div>
      {count > 0 && !blocked && <p className="cc-log__note">Everything goes out at once. On air, the channel switches at the next item.</p>}
    </section>
  );
}

/** The picked entry in edit mode: its start, its end (a live block, a sign-off), what airs, and taking it off. */
export function EntrySection({ edit, entry, base, onInsert, onClose }: { edit: LogEdit; entry: DraftEntry; base: string | null; onInsert: (where: "before" | "after") => void; onClose: () => void }) {
  const lock = edit.locked(entry);
  const [start, setStart] = useState(timeValue(entry.startsAt));
  const [end, setEnd] = useState(timeValue(entry.endsAt));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setStart(timeValue(entry.startsAt));
    setEnd(timeValue(entry.endsAt));
    setError(null);
  }, [entry.id, entry.startsAt, entry.endsAt]);

  const replacements = airable(edit.library?.items ?? []).filter((i) => i.id !== entry.itemId);
  const commitStart = () => {
    const at = typedTime(start, entry.startsAt);
    if (!at) return setError("Type a time like 9:10 pm or 21:10.");
    setError(null);
    if (at !== entry.startsAt) edit.add({ op: "move", entryId: entry.id, startsAt: at });
    else setStart(timeValue(at));
  };
  const commitEnd = () => {
    let at = typedTime(end, entry.startsAt);
    if (!at) return setError("Type a time like 9:10 pm or 21:10.");
    // An end at or before the start is the next day's.
    if (at <= entry.startsAt) at = new Date(Date.parse(at) + 24 * 3_600_000).toISOString();
    setError(null);
    if (at !== entry.endsAt) edit.add({ op: "resize", entryId: entry.id, endsAt: at });
  };

  return (
    <section className="cc-log__sec cc-edit__entry" aria-label={entry.title}>
      <div className="cc-log__hrow">
        <h2 className="cc-log__h">{entry.title}</h2>
        <Button variant="text" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <p className="cc-log__quiet">{spanText(entry.startsAt, entry.endsAt)}</p>
      {lock ? (
        <>
          <p className="cc-edit__lock">{lock}</p>
          {entry.kind === "live" && base && lock.startsWith("On air") && (
            <Button size="sm" href={`${base}/live/${entry.id}`}>
              End early in the studio
            </Button>
          )}
        </>
      ) : (
        <div className="cc-edit__fields">
          <Field
            label="Starts at"
            mono
            size="sm"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            onBlur={commitStart}
            onKeyDown={(e) => e.key === "Enter" && commitStart()}
            help="Snapped to the nearest 4 seconds, where the channel can change."
            error={error ?? undefined}
          />
          {entry.kind !== "program" && (
            <Field label={entry.kind === "live" ? "Ends at" : "Back on at"} mono size="sm" value={end} onChange={(e) => setEnd(e.target.value)} onBlur={commitEnd} onKeyDown={(e) => e.key === "Enter" && commitEnd()} />
          )}
          {entry.kind === "program" && !entry.carriageAgreementId && (
            <SelectField
              label="Airs"
              size="sm"
              value=""
              onChange={(e) => {
                const item = replacements.find((i) => i.id === e.target.value);
                if (item) edit.add({ op: "replace", entryId: entry.id, itemId: item.id }, itemOf(item));
              }}
            >
              <option value="">{entry.title}</option>
              {replacements.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.title} ({duration(wholeMinutes(i.durationMs ?? 0))})
                </option>
              ))}
            </SelectField>
          )}
          <div className="cc-edit__actions">
            <Button size="sm" onClick={() => onInsert("before")}>
              Put on before
            </Button>
            <Button size="sm" onClick={() => onInsert("after")}>
              Put on after
            </Button>
          </div>
          <Button variant="text" size="sm" onClick={() => edit.add({ op: "remove", entryId: entry.id })}>
            Take off the log
          </Button>
        </div>
      )}
    </section>
  );
}

type Source = "library" | "carried";

/**
 * Putting something on before or after an entry: from the library, or an episode of a program the
 * station carries (the market's own). What comes after moves down just enough.
 */
export function InsertDialog({ edit, stationId, anchor, where, base, onClose }: { edit: LogEdit; stationId: string; anchor: DraftEntry; where: "before" | "after"; base: string | null; onClose: () => void }) {
  const [source, setSource] = useState<Source>("library");
  const [chosen, setChosen] = useState<string | null>(null);
  const [agreementId, setAgreementId] = useState<string | null>(null);
  const agreements = useApi(catalogApi.listAgreements, { params: { stationId } }, { retry: false });
  const carrying = (agreements.data?.carrying ?? []).filter((a) => !a.endsAt || Date.parse(a.endsAt) > clockNow().getTime());
  const agreement = carrying.find((a) => a.id === agreementId) ?? carrying[0];
  const offer = useApi(catalogApi.getOffer, { params: { offerId: agreement?.offerId ?? "" } }, { enabled: source === "carried" && !!agreement?.offerId, retry: false });

  const library = airable(edit.library?.items ?? []);
  const episodes = (offer.data?.episodes ?? []).filter((e) => e.durationMs);
  const at = where === "after" ? anchor.endsAt : anchor.startsAt;

  const put = () => {
    const key = edit.nextKey();
    let item: DraftItem | undefined;
    let entry: Extract<LogChange, { op: "insert" }>["entry"];
    if (source === "library") {
      const i = library.find((x) => x.id === chosen);
      if (!i) return;
      item = itemOf(i);
      entry = { kind: "program", startsAt: at, itemId: i.id };
    } else {
      const ep = episodes.find((x) => x.id === chosen);
      if (!ep || !agreement) return;
      item = { id: ep.id, title: agreement.program.title, durationMs: ep.durationMs, programId: agreement.program.id, carriageAgreementId: agreement.id, carriedFrom: agreement.maker };
      entry = { kind: "program", startsAt: at, itemId: ep.id, carriageAgreementId: agreement.id, programId: agreement.program.id };
    }
    const length = wholeMinutes(item.durationMs ?? 30 * MIN);
    // Before an entry, it moves down too; after one, what follows it does.
    const ripple = rippleFrom(edit.entries, at, length, (e) => !!edit.locked(e));
    edit.add([{ op: "insert", key, entry }, ...ripple], item);
    onClose();
  };

  const options = source === "library"
    ? library.map((i) => ({ value: i.id, title: i.title, helper: duration(wholeMinutes(i.durationMs ?? 0)) }))
    : episodes.map((e) => ({ value: e.id, title: e.title, helper: duration(wholeMinutes(e.durationMs ?? 0)) }));

  return (
    <Modal
      open
      onClose={onClose}
      width={460}
      eyebrow={`${where === "after" ? "After" : "Before"} ${anchor.title}, ${clock(at, { timeZone: STATION_TZ })}`}
      title="Put something on"
      subtitle="What comes after it moves down to make room."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={put} disabled={!chosen}>
            Put it on
          </Button>
        </>
      }
    >
      <Segmented
        label="From"
        value={source}
        onChange={(v) => {
          setSource(v);
          setChosen(null);
        }}
        options={[
          { value: "library", label: "Your library" },
          { value: "carried", label: "Programs you carry" }
        ]}
        className="cc-edit__from"
      />
      {source === "carried" && carrying.length > 1 && (
        <SelectField label="Program" size="sm" value={agreement?.id ?? ""} onChange={(e) => (setAgreementId(e.target.value), setChosen(null))}>
          {carrying.map((a) => (
            <option key={a.id} value={a.id}>
              {a.program.title}, from {stationLabel(a.maker)}
            </option>
          ))}
        </SelectField>
      )}
      {options.length ? (
        <ChoiceList label="What goes on" options={options} value={chosen} onChange={setChosen} className="cc-edit__choices" />
      ) : (
        <p className="cc-log__quiet">{source === "library" ? "Nothing in your library can air yet." : agreements.isLoading || offer.isLoading ? null : "You don't carry anything yet."}</p>
      )}
      {source === "carried" && base && (
        <p className="cc-log__note">
          <a className="cc-log__link" href={`${base}/market`}>
            Find more in the syndication market
          </a>
          . Your changes are kept while you look.
        </p>
      )}
    </Modal>
  );
}

/** "Last changed by Kai M. at 8:42 pm", and the last few batches published. */
export function LogHistory({ stationId }: { stationId: string }) {
  const history = useApi(logApi.listLogChanges, { params: { stationId }, query: { limit: 5 } }, { retry: false });
  const list = history.data?.changes ?? [];
  if (!list.length) return null;
  const [last] = list;
  const at = (iso: string) => (clockNow().getTime() - Date.parse(iso) < 20 * 3_600_000 ? clock(iso, { timeZone: STATION_TZ }) : dayClock(iso));
  return (
    <section className="cc-log__sec cc-edit__history" aria-label="Changes to the log">
      <h2 className="cc-log__h">Changes</h2>
      <p className="cc-log__note cc-edit__last">{last.by.name ? `Last changed by ${last.by.name} at ${at(last.at)}` : `Last changed at ${at(last.at)}`}</p>
      <ul className="cc-edit__past">
        {list.map((c) => (
          <li key={c.id}>
            <span>{c.summary}</span>
            <small>
              {c.by.name ?? "Someone"}, {at(c.at)}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A244: a programming block's span picked in edit mode: its start and end (typed, like an entry's;
 * dragging its rail's edges does the same), and taking it off this day. One on air keeps its start.
 */
export function SpanSection({ edit, span, onAir, onClose }: { edit: LogEdit; span: DraftSpan; onAir: boolean; onClose: () => void }) {
  const [start, setStart] = useState(timeValue(span.startsAt));
  const [end, setEnd] = useState(timeValue(span.endsAt));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setStart(timeValue(span.startsAt));
    setEnd(timeValue(span.endsAt));
    setError(null);
  }, [span.id, span.startsAt, span.endsAt]);
  const started = Date.parse(span.startsAt) <= clockNow().getTime() + (onAir ? 20_000 : 0);
  const commit = (edge: "start" | "end") => {
    let at = typedTime(edge === "start" ? start : end, span.startsAt);
    if (!at) return setError("Type a time like 9:00 pm or 21:00.");
    // An end at or before the start is the next day's (a block may cross 6:00 am on a date).
    if (edge === "end" && at <= span.startsAt) at = new Date(Date.parse(at) + 24 * 3_600_000).toISOString();
    setError(null);
    if (at !== (edge === "start" ? span.startsAt : span.endsAt)) edit.add({ op: "block_resize", spanId: span.id, ...(edge === "start" ? { startsAt: at } : { endsAt: at }) });
  };
  return (
    <section className="cc-log__sec cc-edit__entry" aria-label={span.name}>
      <div className="cc-log__hrow">
        <h2 className="cc-log__h">{span.name}</h2>
        <Button variant="text" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <p className="cc-log__quiet">{spanText(span.startsAt, span.endsAt)}</p>
      <div className="cc-edit__fields">
        <Field label="Starts" mono size="sm" value={start} disabled={started} onChange={(e) => setStart(e.target.value)} onBlur={() => commit("start")} onKeyDown={(e) => e.key === "Enter" && commit("start")} error={error ?? undefined} />
        <Field label="Ends" mono size="sm" value={end} onChange={(e) => setEnd(e.target.value)} onBlur={() => commit("end")} onKeyDown={(e) => e.key === "Enter" && commit("end")} help="Programs that start between these times are the block's." />
        {!started && (
          <Button variant="text" size="sm" onClick={() => (edit.add({ op: "block_remove", spanId: span.id }), onClose())}>
            Take the block off this day
          </Button>
        )}
      </div>
    </section>
  );
}

/** A244: "Add a block": which block, from when to when (snapped like entries). */
export function AddBlockDialog({ edit, base, near, onClose }: { edit: LogEdit; base: string | null; near: string; onClose: () => void }) {
  const [blockId, setBlockId] = useState(edit.blocks[0]?.id ?? "");
  const [start, setStart] = useState("21:00");
  const [end, setEnd] = useState("23:00");
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const startsAt = typedTime(start, near);
    let endsAt = typedTime(end, near);
    if (!blockId) return setError("Choose a block.");
    if (!startsAt || !endsAt) return setError("Type times like 9:00 pm or 21:00.");
    if (endsAt <= startsAt) endsAt = new Date(Date.parse(endsAt) + 24 * 3_600_000).toISOString();
    edit.add({ op: "block_add", key: edit.nextKey(), blockId, startsAt, endsAt });
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      width={420}
      title="Add a block"
      subtitle="Programs that start between these times are the block's."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={add} disabled={!edit.blocks.length}>
            Add it
          </Button>
        </>
      }
    >
      {edit.blocks.length ? (
        <SelectField label="Block" size="sm" value={blockId} onChange={(e) => setBlockId(e.target.value)}>
          {edit.blocks.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </SelectField>
      ) : (
        <p className="cc-log__quiet">You don't have a block yet.</p>
      )}
      {base && (
        <p className="cc-log__note">
          <a className="cc-log__link" href={`${base}/schedule/blocks/new`}>
            New block…
          </a>
        </p>
      )}
      <div className="cc-edit__fields">
        <Field label="Starts" mono size="sm" value={start} onChange={(e) => setStart(e.target.value)} />
        <Field label="Ends" mono size="sm" value={end} onChange={(e) => setEnd(e.target.value)} error={error ?? undefined} />
      </div>
    </Modal>
  );
}
