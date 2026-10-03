// Edit mode on the program log (the user's request of 2026-09-29; A246 draws it, opencast-schedule
// 04). "Edit" makes the Schedule's rundown a draft for owners and operators: move a program by
// dragging it or typing a start, replace what airs, change a live block's or a sign-off's end, take
// something off, put something on from the Add drawer, or keep a row at its time (G18). Breaks
// follow the programs. Nothing goes out until it's published: the draft is checked by the API as a
// whole (a dry run) and summed up in the tray at the foot ("4 changes, checked: nothing blocks
// publishing"), with overlaps, dead air, held spots and anything locked said before it goes out,
// all at once. On air, the entry airing now and anything inside the assembler's lead is locked. The
// draft is kept for this tab (sessionStorage), so a trip to the market and back keeps it; it begins
// from the whole broadcast day, and a draft kept from another window is dropped. When someone else
// changes the day meanwhile (409 `log_changed`), it reloads the log and keeps the draft, checked
// again against the new version. Every published batch is in the log's history, with who and when.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { blocksApi, libraryApi, logApi, type LibraryItem, type LogChange, type LogChangeRecord, type LogChangesResult, type LogEntry, type ProgramLog } from "@opencast/contracts";
import { Button, Field, Modal, SelectField, Toggle, clock, duration, useToast } from "@opencast/ui";
import { ApiError, call } from "../../../api/client";
import { useApi } from "../../../api/hooks";
import { now as clockNow, STATION_TZ } from "../../../lib/clock";
import { LOG_READS } from "./data";
import { airable } from "./repeat";
import { draftBreaks, draftEntries, draftSpans, insertId, isBlockChange, lockOf, newSpanId, timeValue, typedTime, wholeMinutes, withChange, type DraftEntry, type DraftItem, type DraftSpan } from "./logEdit";
import { FIXED_WORDS, fixedReason } from "./reorder";
import { dayClock, spanText } from "./time";

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

export const itemOf = (i: LibraryItem): DraftItem => ({ id: i.id, title: i.title, durationMs: i.durationMs, code: i.code, programId: i.programId });

export type LogEdit = ReturnType<typeof useLogEdit>;

/** The draft, its check (the API's dry run), publishing and discarding. */
export function useLogEdit({ stationId, log, win, active, onAir, now, onDone }: { stationId: string; log: ProgramLog | undefined; win: { from: string; to: string }; active: boolean; onAir: boolean; now: number; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [publishError, setPublishError] = useState<ApiError | null>(null);
  const [publishing, setPublishing] = useState(false);
  // The record of the batch just published, shown until it's closed.
  const [published, setPublished] = useState<LogChangeRecord | null>(null);
  const keys = useRef(0);

  // A draft begins from the log as it's shown (the whole broadcast day); leaving edit mode
  // (publishing, discarding) drops it. Leaving the page keeps it for the tab, unless it was begun
  // from another window (a day, or the old Evening view).
  const wasActive = useRef(active);
  useEffect(() => {
    if (!active) {
      if (wasActive.current) writeDraft(stationId, null);
      setDraft(null);
    } else if (!draft && log) {
      const kept = readDraft(stationId);
      const fits = kept && (!kept.base || (kept.base.from === win.from && kept.base.to === win.to));
      setDraft(fits ? kept : { base: log.version ? { ...win, version: log.version } : null, changes: [], items: {}, seq: 0 });
    }
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
  // Coming off the log: kept in the draft's rows, struck through.
  const removed = useMemo(() => {
    const gone = new Set(changes.flatMap((c) => (c.op === "remove" ? [c.entryId] : [])));
    return (log?.entries ?? []).filter((e) => gone.has(e.id));
  }, [log?.entries, changes]);
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
  // Problems and changes by entry, to mark them on the rundown.
  const entryOfChange = (i: number) => {
    const c = changes[i];
    return c ? (isBlockChange(c) ? (c.op === "block_add" ? (c.key ? newSpanId(c.key) : null) : c.spanId) : c.op === "insert" ? (c.key ? insertId(c.key) : null) : c.entryId) : null;
  };
  const troubled = new Set((result?.problems ?? []).flatMap((p) => (p.index === null ? [] : [entryOfChange(p.index)])).filter((v): v is string => !!v));

  const shownWindow = draft?.base && draft.base.from === win.from && draft.base.to === win.to;
  const conflict =
    ((check.error?.code === "log_changed" ? check.error : null) ??
      (publishError?.code === "log_changed" ? publishError : null) ??
      (shownWindow && log?.version && draft?.base && log.version !== draft.base.version ? new ApiError(409, "log_changed", "The log changed since you started editing.") : null));

  const refresh = () => Promise.all([...LOG_READS, logApi.listLogChanges].map((e) => qc.invalidateQueries({ queryKey: [e.method, e.path] })));
  /** The draft takes the day's version as it is now (its changes stay), then everything reads again. */
  const rebase = async () => {
    const fresh = await call(logApi.getLog, { params: { stationId }, query: { from: win.from, to: win.to } });
    setDraft((d) => (d && fresh.version ? { ...d, base: { from: win.from, to: win.to, version: fresh.version } } : d));
    await refresh();
  };

  return {
    draft,
    changes,
    entries,
    removed,
    breaks,
    spans,
    blocks: blockList.data?.blocks ?? [],
    items,
    library: library.data,
    result,
    checking: check.isFetching,
    checkError: check.error && check.error.code !== "log_changed" ? check.error.message : null,
    conflict: conflict || null,
    publishing,
    publishError: publishError && publishError.code !== "log_changed" ? publishError.message : null,
    published,
    troubled,
    locked,
    /** Adds a change (and the item it puts on the log, if any). */
    add(change: LogChange | LogChange[], item?: DraftItem | DraftItem[]) {
      setPublishError(null);
      const more = Object.fromEntries((Array.isArray(item) ? item : item ? [item] : []).map((i) => [i.id, i]));
      setDraft((d) => (d ? { ...d, changes: (Array.isArray(change) ? change : [change]).reduce(withChange, d.changes), items: { ...d.items, ...more } } : d));
    },
    /**
     * G18: "Keep at this time", on or off. Turning it back the way the log has it takes the change
     * out of the draft rather than adding its opposite.
     */
    keep(entry: DraftEntry) {
      setPublishError(null);
      setDraft((d) => {
        if (!d) return d;
        const at = d.changes.findIndex((c) => c.op === "keep" && c.entryId === entry.id);
        if (at >= 0) return { ...d, changes: d.changes.filter((_, i) => i !== at) };
        return { ...d, changes: withChange(d.changes, { op: "keep", entryId: entry.id, keep: !entry.keepTime }) };
      });
    },
    /** Takes one change back out of the draft. */
    drop(index: number) {
      setDraft((d) => (d ? { ...d, changes: d.changes.filter((_, i) => i !== index) } : d));
    },
    /** A key for an insert (it has no id until it's published). */
    nextKey() {
      // Several at once (a quick fill's inserts) each get their own.
      keys.current = Math.max(keys.current, draft?.seq ?? 0) + 1;
      const key = `k${keys.current}-${Date.now().toString(36)}`;
      setDraft((d) => (d ? { ...d, seq: Math.max(d.seq, keys.current) } : d));
      return key;
    },
    /** "Check again": the dry run, asked for afresh. */
    recheck() {
      void check.refetch();
    },
    async publish() {
      if (!draft || !changes.length) return;
      setPublishing(true);
      setPublishError(null);
      try {
        const r = await call(logApi.applyLogChanges, { params: { stationId }, body: { dryRun: false, ...(draft.base ? { base: draft.base } : {}), changes } });
        writeDraft(stationId, null);
        setDraft(null);
        setPublished(r.record);
        await refresh();
        toast.show({ message: r.changes.length === 1 ? "1 change published." : `${r.changes.length} changes published.` });
        onDone();
      } catch (e) {
        setPublishError(e instanceof ApiError ? e : new ApiError(0, "failed", "That didn't go through. Try again."));
      } finally {
        setPublishing(false);
      }
    },
    /** Closes the record of what was just published. */
    closePublished() {
      setPublished(null);
    },
    discard() {
      writeDraft(stationId, null);
      setDraft(null);
      setPublishError(null);
      onDone();
    },
    /**
     * After a conflict: the log as it is now, and the draft kept, checked again against the new
     * version. A change to an entry that's gone comes back from the check as a problem.
     */
    async reload() {
      setPublishError(null);
      await rebase();
    },
    /** After something written at once (a fill with nothing drafted): the draft takes the new version. */
    rebase

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

/**
 * The picked entry in edit mode: its start, its end (a live block, a sign-off), what airs, keeping
 * it at its time (G18), putting something on before or after it (the Add drawer), and taking it off.
 */
export function EntrySection({ edit, entry, base, onAdd, onClose }: { edit: LogEdit; entry: DraftEntry; base: string | null; onAdd: (at: string) => void; onClose: () => void }) {
  const lock = edit.locked(entry);
  const fixed = fixedReason(entry, !!lock);
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
            disabled={!!entry.keepTime}
            onChange={(e) => setStart(e.target.value)}
            onBlur={commitStart}
            onKeyDown={(e) => e.key === "Enter" && commitStart()}
            help={entry.keepTime ? "Kept at this time. Turn it off to move it." : "Snapped to the nearest 4 seconds, where the channel can change."}
            error={error ?? undefined}
          />
          {entry.kind !== "off_air" && (
            <div className="cc-edit__keep">
              <span>
                Keep at this time
                <small>Moving the rows around it stops here</small>
              </span>
              <Toggle label="Keep at this time" checked={!!entry.keepTime} onChange={() => edit.keep(entry)} />
            </div>
          )}
          {fixed && fixed !== "locked" && fixed !== "kept" && <p className="cc-log__note">{FIXED_WORDS[fixed]}. Moving the rows around it stops here.</p>}
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
            <Button size="sm" onClick={() => onAdd(entry.startsAt)}>
              Put on before
            </Button>
            <Button size="sm" onClick={() => onAdd(entry.endsAt)}>
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

/**
 * Under "Tonight at a glance" (A246, decision 2): the log's last few published batches, who and
 * when ("Kai M., 6:12 pm · 2 changes"), and the template that made the day. A record doesn't say
 * which date it changed, so these are the station's latest.
 */
export function DayChanges({ stationId, origin }: { stationId: string; origin: string | null }) {
  const history = useApi(logApi.listLogChanges, { params: { stationId }, query: { limit: 3 } }, { retry: false });
  const list = history.data?.changes ?? [];
  if (!list.length && !origin) return null;
  const at = (iso: string) => (clockNow().getTime() - Date.parse(iso) < 20 * 3_600_000 ? clock(iso, { timeZone: STATION_TZ }) : dayClock(iso));
  return (
    <section className="cc-glance__sec" aria-labelledby="cc-day-changes">
      <h3 className="cc-glance__h3" id="cc-day-changes">
        Recent changes
      </h3>
      <dl className="cc-kv2">
        {list.map((c) => (
          <div key={c.id} title={c.lines.join("\n")}>
            <dt>
              {c.by.name ?? "Someone"}, {at(c.at)}
            </dt>
            <dd>{c.count === 1 ? "1 change" : `${c.count} changes`}</dd>
          </div>
        ))}
        {origin && (
          <div>
            <dt>{origin}</dt>
            <dd>Made</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

/**
 * A244: a programming block's span picked in edit mode: its start and end (typed, like an entry's;
 * typed, as an entry's), and taking it off this day. One on air keeps its start.
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
