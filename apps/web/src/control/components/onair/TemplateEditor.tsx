// A246 (Phase 4, opencast-schedule 06; decisions 6 and 7): one day template opened on the
// Templates tab. Its head says which dates were edited by hand ("Oct 10 edited", amber) with "Reset
// Oct 10 to template", and "Edit template"; under it, what saving does ("Saving changes here
// rebuilds 3 upcoming Saturdays. Oct 3, edited by hand, is kept as an exception."). Then its
// rundown, drawn as the day's (programs, live, sign-offs, its blocks, the off air hours; no breaks
// or dead air), edited with the day's own rows, drawer and block handles (templateDraft.ts). The
// tray says what each change does and what blocks saving, checked here (a template has no dry run),
// and Save replaces the template's entries and blocks at once, then says how many dates were
// rebuilt and how many edited ones kept. Leaving with unsaved changes asks first.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { StationIdent } from "@opencast/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { blocksApi, libraryApi, logApi, stationsApi, type DayTemplate, type LogChange, type TemplateGeneration } from "@opencast/contracts";
import { Button, Modal, Notice, clock, useToast } from "@opencast/ui";
import { ApiError, call } from "../../../api/client";
import { useApi } from "../../../api/hooks";
import { now as clockNow, STATION_TZ } from "../../../lib/clock";
import { useLeaveGuard } from "../station/settings/useLeaveGuard";
import { AddDrawer, type AddSpace } from "./AddDrawer";
import { DayRundown } from "./DayRundown";
import { LOG_READS } from "./data";
import { blockWords, dayRows } from "./dayRows";
import { itemOf, AddBlockDialog, EntrySection, SpanSection } from "./LogEditor";
import { draftEntries, draftSpans, insertId, isBlockChange, newSpanId, withChange, type DraftEntry, type DraftItem } from "./logEdit";
import { edgesOf, fixedReason, type Reflow } from "./reorder";
import { BLOCK_CROSSES_DAY, blocksInput, checkTemplate, dayEndOf, entriesInput, minuteBreaks, placeOn, templateEntries, templateSpans } from "./templateDraft";
import { monthDate, referenceDate, resetLine, saveCounts, savedLine, shortDate, templateName } from "./templates";
import { RepeatDialog, StopDialog } from "./RepeatDay";
import { broadcastDay, isoDate } from "./time";

const MIN = 60_000;
const t = (s: string) => Date.parse(s);

/** The draft of a template's rundown: its changes, as the Log's edit mode keeps a day's. */
export function useTemplateEdit({ stationId, template, date, carriedFrom }: { stationId: string; template: DayTemplate; date: string; carriedFrom: (agreementId: string) => StationIdent | null }) {
  const qc = useQueryClient();
  const [changes, setChanges] = useState<LogChange[]>([]);
  const [items, setItems] = useState<Record<string, DraftItem>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const keys = useRef(0);
  const library = useApi(libraryApi.getLibrary, { params: { stationId }, query: {} }, { retry: false });
  const blockList = useApi(blocksApi.listBlocks, { params: { stationId } }, { retry: false });
  // A different template, or the same one saved: the draft starts again.
  useEffect(() => {
    setChanges([]);
    setItems({});
    setSaveError(null);
  }, [template.id]);

  const itemMap = useMemo(() => {
    const map = new Map<string, DraftItem>((library.data?.items ?? []).map((i) => [i.id, itemOf(i)]));
    for (const [id, item] of Object.entries(items)) map.set(id, item);
    return map;
  }, [library.data, items]);
  const base = useMemo(() => templateEntries(template, date, carriedFrom), [template, date, carriedFrom]);
  const baseSpans = useMemo(() => templateSpans(template, date), [template, date]);
  const entries = useMemo(() => draftEntries(base, changes, (id) => itemMap.get(id)), [base, changes, itemMap]);
  const removed = useMemo(() => base.filter((e) => changes.some((c) => c.op === "remove" && c.entryId === e.id)), [base, changes]);
  const blocks = blockList.data?.blocks ?? [];
  const spans = useMemo(
    () =>
      draftSpans(baseSpans, changes, (id) => {
        const b = blocks.find((x) => x.id === id);
        return b ? { name: b.name, colour: b.colour } : undefined;
      }),
    [baseSpans, changes, blocks]
  );
  const dayEnd = dayEndOf(date);
  const check = useMemo(() => checkTemplate({ changes, before: base, after: entries, spansBefore: baseSpans, spansAfter: spans, dayEnd }), [changes, base, entries, baseSpans, spans, dayEnd]);
  // Rows and spans with a problem, to mark on the rundown.
  const troubled = new Set(
    check.problems.flatMap((p) => {
      const c = p.index === null ? null : changes[p.index];
      if (!c) return [];
      return [isBlockChange(c) ? (c.op === "block_add" ? newSpanId(c.key ?? "") : c.spanId) : c.op === "insert" ? insertId(c.key ?? "") : c.entryId];
    })
  );

  return {
    changes,
    base,
    baseSpans,
    entries,
    removed,
    spans,
    blocks,
    library: library.data,
    check,
    troubled,
    dayEnd,
    saving,
    saveError,
    /** Nothing in a template is on air: nothing's locked. */
    locked: (_e: Pick<DraftEntry, "id" | "startsAt" | "endsAt">): string | null => null,
    add(change: LogChange | LogChange[], item?: DraftItem | DraftItem[]) {
      setSaveError(null);
      const more = Object.fromEntries((Array.isArray(item) ? item : item ? [item] : []).map((i) => [i.id, i]));
      setChanges((cs) => (Array.isArray(change) ? change : [change]).reduce(withChange, cs));
      setItems((x) => ({ ...x, ...more }));
    },
    keep(entry: DraftEntry) {
      setChanges((cs) => {
        const at = cs.findIndex((c) => c.op === "keep" && c.entryId === entry.id);
        if (at >= 0) return cs.filter((_, i) => i !== at);
        return withChange(cs, { op: "keep", entryId: entry.id, keep: !entry.keepTime });
      });
    },
    drop(index: number) {
      setChanges((cs) => cs.filter((_, i) => i !== index));
    },
    nextKey() {
      keys.current += 1;
      return `t${keys.current}-${Date.now().toString(36)}`;
    },
    discard() {
      setChanges([]);
      setItems({});
      setSaveError(null);
    },
    /** One `updateTemplate`: the entries and blocks as the draft leaves them. */
    async save(): Promise<{ generated: TemplateGeneration; template: DayTemplate } | null> {
      setSaving(true);
      setSaveError(null);
      try {
        const r = await call(logApi.updateTemplate, { params: { stationId, templateId: template.id }, body: { entries: entriesInput(entries, template), blocks: blocksInput(spans) } });
        await Promise.all([...LOG_READS, logApi.getTemplate, blocksApi.listBlocks, blocksApi.getBlock].map((e) => qc.invalidateQueries({ queryKey: [e.method, e.path] })));
        setChanges([]);
        setItems({});
        return r;
      } catch (e) {
        setSaveError(e instanceof ApiError && e.code === "block_crosses_day" ? BLOCK_CROSSES_DAY : e instanceof Error ? e.message : "That didn't save. Try again.");
        return null;
      } finally {
        setSaving(false);
      }
    }
  };
}

export type TemplateEdit = ReturnType<typeof useTemplateEdit>;

/** "2 changes, checked: nothing blocks saving". */
export function templateTrayTitle(count: number, problems: number): string {
  const n = count === 1 ? "1 change" : `${count} changes`;
  return problems ? `${n}, checked: ${problems === 1 ? "1 problem blocks" : `${problems} problems block`} saving` : `${n}, checked: nothing blocks saving`;
}

/** The tray at the foot of a template being edited: its changes, what blocks saving, what saving does. */
function TemplateTray({ edit, counts, onSave }: { edit: TemplateEdit; counts: string; onSave: () => void }) {
  if (!edit.changes.length) return null;
  const { lines, problems } = edit.check;
  return (
    <section className="cc-tray" aria-label="Your changes" role="region">
      <div className="cc-tray__body">
        <b aria-live="polite">{templateTrayTitle(edit.changes.length, problems.length)}</b>
        <ul className="cc-tray__lines">
          {lines.map((l) => (
            <li key={l.index}>
              <span>{l.line}</span>
              <button type="button" className="cc-tray__undo" onClick={() => edit.drop(l.index)} aria-label={`Undo: ${l.line}`}>
                Undo
              </button>
            </li>
          ))}
          {problems.map((p, i) => (
            <li key={`p${i}`} className="cc-tray__problem">
              {p.message}
            </li>
          ))}
        </ul>
        {!problems.length && <p className="cc-tray__p">{counts}</p>}
        {edit.saveError && <p className="cc-log__err">{edit.saveError}</p>}
      </div>
      <div className="cc-tray__btns">
        <Button size="sm" onClick={edit.discard} disabled={edit.saving}>
          Discard
        </Button>
        <Button size="sm" variant="ink" onClick={onSave} disabled={!!problems.length || edit.saving}>
          Save template
        </Button>
      </div>
    </section>
  );
}

export interface TemplateEditorProps {
  stationId: string;
  /** "BEAT", for a block's words. */
  callSign: string;
  template: DayTemplate;
  /** "/control/beat": the station's routes. */
  base: string | null;
  canEdit: boolean;
  editing: boolean;
  /** Edit mode on or off (`?edit=1`). */
  onEditing: (on: boolean) => void;
  /** `?addBlock=<blockId>`: a block's "Place on the log", in this template. */
  addBlock?: string | null;
  onAddBlockDone?: () => void;
  /** The tab's head, given the guarded way to another page. */
  head: (go: (to: string) => void) => ReactNode;
  /** The template list, beside the template (left out while editing: the rundown takes the room). */
  list: ReactNode;
}

export function TemplateEditor({ stationId, callSign, template, base, canEdit, editing, onEditing, addBlock, onAddBlockDone, head, list }: TemplateEditorProps) {
  const toast = useToast();
  const qc = useQueryClient();
  const today = isoDate(broadcastDay(clockNow()));
  const date = referenceDate(template, today);
  const from = placeOn("06:00", date);
  const to = dayEndOf(date);
  // The date's log: its off air hours, and the makers of what it carries.
  const log = useApi(logApi.getLog, { params: { stationId }, query: { from, to } }, { retry: false });
  const sources = useApi(stationsApi.listLiveSources, { params: { stationId } }, { retry: false });
  const carriedFrom = useMemo(() => {
    const byAgreement = new Map((log.data?.entries ?? []).filter((e) => e.carriageAgreementId && e.carriedFrom).map((e) => [e.carriageAgreementId!, e.carriedFrom!]));
    return (id: string) => byAgreement.get(id) ?? null;
  }, [log.data]);
  const edit = useTemplateEdit({ stationId, template, date, carriedFrom });
  const [picked, setPicked] = useState<string | null>(null);
  const [pickedSpan, setPickedSpan] = useState<string | null>(null);
  const [adding, setAdding] = useState<AddSpace | null>(null);
  const [addingBlock, setAddingBlock] = useState(false);
  const [resetting, setResetting] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [repeat, setRepeat] = useState<"change" | "stop" | null>(null);
  const [leaving, setLeaving] = useState(false);
  const dirty = edit.changes.length > 0;
  const guard = useLeaveGuard(dirty, edit.discard, { title: "Leave without saving?", subtitle: `Your changes to ${templateName(template)} haven't been saved. Leaving drops them.` });
  useEffect(() => {
    if (editing && addBlock) setAddingBlock(true);
  }, [editing, addBlock]);
  useEffect(() => {
    setSaved(null);
    setPicked(null);
    setPickedSpan(null);
  }, [template.id]);

  const offAir = useMemo(() => (log.data?.offAir ?? []).filter((o) => o.source === "hours"), [log.data]);
  const words = (blockId: string) => {
    const b = edit.blocks.find((x) => x.id === blockId);
    return b ? blockWords(b, callSign) : null;
  };
  const rows = useMemo(
    () =>
      dayRows({
        entries: edit.entries,
        removed: editing ? edit.removed : [],
        breaks: [],
        gaps: [],
        offAir,
        spans: edit.spans,
        from,
        to,
        now: -Infinity,
        liveSourceName: (id) => sources.data?.find((x) => x.id === id)?.name ?? null,
        blockWords: words,
        editing
      }),
    [edit.entries, edit.removed, edit.spans, offAir, from, to, editing, sources.data, edit.blocks] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const reflow: Reflow = {
    entries: edit.entries,
    breaks: minuteBreaks(edit.entries),
    fixed: (e) => !!fixedReason(e, false),
    edges: edgesOf(edit.spans, offAir)
  };
  /** The space at `at`: until the next thing in the template, or 6:00 am. */
  const spaceAt = (at: string): AddSpace => {
    const next = [...edit.entries].filter((e) => e.startsAt >= at).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
    const off = offAir.filter((o) => o.startsAt >= at).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
    const endsAt = [next?.startsAt, off?.startsAt, to].filter((x): x is string => !!x).sort()[0];
    const name = next?.startsAt === endsAt ? (next.kind === "off_air" ? "off air" : next.title) : off?.startsAt === endsAt ? "off air" : null;
    const covered = edit.entries.some((e) => e.startsAt <= at && at < e.endsAt);
    return { at, endsAt, next: name, gap: !covered && t(endsAt) - t(at) >= 5 * MIN };
  };
  const firstSpace = (): AddSpace => {
    const last = [...edit.entries].sort((a, b) => b.endsAt.localeCompare(a.endsAt))[0];
    return spaceAt(last ? new Date(Math.ceil(t(last.endsAt) / MIN) * MIN).toISOString() : placeOn("18:00", date));
  };

  const counts = saveCounts(template);
  const editedDates = template.dates.filter((d) => d.edited).map((d) => d.date);
  const doneEditing = () => (dirty ? setLeaving(true) : onEditing(false));
  const save = async () => {
    const r = await edit.save();
    if (!r) return;
    setSaved(savedLine(r.generated.dates, r.template.dates.filter((d) => d.edited).length));
    toast.show({ message: "Template saved." });
    onEditing(false);
  };
  const pickedEntry = editing && picked ? edit.entries.find((e) => e.id === picked) : undefined;
  const pickedSpanRow = editing && pickedSpan ? edit.spans.find((s) => s.id === pickedSpan) : undefined;

  const headButtons = canEdit ? (
    editing ? (
      <span className="cc-tpl__end">
        <Button size="sm" onClick={() => setAddingBlock(true)}>
          Add a block
        </Button>
        <Button size="sm" icon="plus" onClick={() => setAdding(firstSpace())}>
          Add
        </Button>
        <Button size="sm" onClick={doneEditing}>
          Done editing
        </Button>
      </span>
    ) : (
      <span className="cc-tpl__end">
        {editedDates.length === 1 && (
          <button type="button" className="cc-btn-xs" onClick={() => setResetting(editedDates[0])}>
            Reset {monthDate(editedDates[0])} to template
          </button>
        )}
        <button type="button" className="cc-btn-xs cc-btn-xs--pri" onClick={() => onEditing(true)}>
          Edit template
        </button>
      </span>
    )
  ) : null;

  const body = (
    <div className="cc-tpl">
      <div className="cc-daynav cc-tpl__head">
        <h2 className="cc-daynav__day">{templateName(template)}</h2>
        {editedDates.slice(0, 3).map((d) => (
          <span key={d} className="cc-tplchip">
            <i aria-hidden="true" />
            {monthDate(d)} edited
          </span>
        ))}
        {editedDates.length > 3 && <span className="cc-tplchip">{editedDates.length - 3} more edited</span>}
        {editing && <span className="cc-hchip cc-hchip--signal">Editing the template</span>}
        {headButtons}
      </div>
      {!editing && <p className="cc-applies">{counts.line}</p>}
      {canEdit && !editing && editedDates.length > 1 && (
        <ul className="cc-tpl__edited" aria-label="Dates edited by hand">
          {editedDates.map((d) => (
            <li key={d}>
              <span>{shortDate(d)}, edited by hand</span>
              <button type="button" className="cc-btn-xs" onClick={() => setResetting(d)}>
                Reset {monthDate(d)} to template
              </button>
            </li>
          ))}
        </ul>
      )}
      {saved && (
        <Notice
          tone="plain"
          icon={null}
          className="cc-log__record"
          title={saved}
          action={
            <Button size="sm" variant="text" onClick={() => setSaved(null)}>
              Close
            </Button>
          }
        />
      )}
      <div className={editing ? "cc-log__split" : undefined}>
        <div className="cc-log__main">
          {rows.length ? (
            <DayRundown
              rows={rows}
              onAir={false}
              selected={editing ? (pickedSpan ? `band:${pickedSpan}` : picked) : null}
              onSelect={(row) => {
                if (row.kind !== "entry" || row.removed) return;
                // A row picked opens it to change: in edit mode, as the Log's does.
                if (!editing && canEdit) onEditing(true);
                if (editing || canEdit) {
                  setPickedSpan(null);
                  setPicked(row.id);
                }
              }}
              onFill={() => undefined}
              scrollTo={null}
              offAirHref={base ? `${base}/schedule/templates` : null}
              className="cc-rd--template"
              edit={
                editing
                  ? {
                      locked: () => null,
                      troubled: edit.troubled,
                      original: new Map(edit.base.map((e) => [e.id, e])),
                      reflow,
                      spans: edit.spans,
                      onChanges: (c) => edit.add(c),
                      onKeep: (e) => edit.keep(e),
                      onRestore: (id) => {
                        const i = edit.changes.findIndex((c) => c.op === "remove" && c.entryId === id);
                        if (i >= 0) edit.drop(i);
                      },
                      onAddAt: (at) => setAdding(spaceAt(at)),
                      earliest: -Infinity,
                      handles: {
                        original: new Map(edit.baseSpans.map((s) => [s.id, { startsAt: s.startsAt, endsAt: s.endsAt }])),
                        // A block in a template ends by 6:00 am.
                        limits: { earliest: -Infinity, dayEnd: to },
                        intro: (id) => !!edit.blocks.find((b) => b.id === id)?.intro,
                        outro: (id) => !!edit.blocks.find((b) => b.id === id)?.outro,
                        onPick: (spanId) => (setPicked(null), setPickedSpan(spanId))
                      }
                    }
                  : undefined
              }
            />
          ) : (
            <p className="cc-log__quiet">Nothing in this template yet.</p>
          )}
        </div>
        {editing && (
          <aside className="cc-log__pane" aria-label="The row picked">
            {pickedEntry ? (
              <EntrySection edit={edit} entry={pickedEntry} base={base} place="template" onAdd={(at) => setAdding(spaceAt(at))} onClose={() => setPicked(null)} />
            ) : pickedSpanRow ? (
              <SpanSection edit={edit} span={pickedSpanRow} onAir={false} place="template" onClose={() => setPickedSpan(null)} />
            ) : (
              <section className="cc-epane">
                <h2 className="cc-pane__h">Editing {templateName(template)}</h2>
                <p className="cc-pane__sub">The same rows as the day: drag a row by its handle, or use the arrow keys; drag a block's start or end. Nothing changes on the dates it makes until you save.</p>
              </section>
            )}
          </aside>
        )}
      </div>
      {editing && <TemplateTray edit={edit} counts={counts.line} onSave={() => void save()} />}
      {canEdit && !editing && (
        <div className="cc-tpl__foot">
          <Button variant="text" size="sm" onClick={() => setRepeat("change")}>
            Change how it repeats
          </Button>
          <Button variant="text" size="sm" onClick={() => setRepeat("stop")}>
            Stop repeating
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <>
      {head(guard.go)}
      {editing ? (
        body
      ) : (
        <div className="cc-tpls">
          {list}
          {body}
        </div>
      )}
      {adding && (
        <AddDrawer
          stationId={stationId}
          space={adding}
          reflow={reflow}
          loaded={edit.entries}
          draftEmpty={false}
          onAdd={(changes, items) => {
            edit.add(changes, items);
            setAdding(null);
          }}
          onFilled={() => undefined}
          nextKey={edit.nextKey}
          base={base}
          onClose={() => setAdding(null)}
        />
      )}
      {editing && addingBlock && (
        <AddBlockDialog
          edit={edit}
          base={base}
          near={from}
          blockId={addBlock}
          onClose={() => {
            setAddingBlock(false);
            onAddBlockDone?.();
          }}
        />
      )}
      {resetting && <ResetDialog stationId={stationId} template={template} date={resetting} onDone={(line) => (setResetting(null), line && toast.show({ message: line }), void qc.invalidateQueries({ queryKey: [logApi.listTemplates.method, logApi.listTemplates.path] }))} />}
      {repeat === "change" && <RepeatDialog stationId={stationId} day={ymdOf(template.fromDay)} template={template} pattern={template.pattern} phone={false} onClose={() => setRepeat(null)} />}
      {repeat === "stop" && <StopDialog stationId={stationId} what={{ kind: "template", template }} phone={false} onClose={() => setRepeat(null)} />}
      {leaving && (
        <Modal
          open
          onClose={() => setLeaving(false)}
          width={420}
          title="Leave without saving?"
          subtitle={`${edit.changes.length === 1 ? "1 change" : `${edit.changes.length} changes`} to ${templateName(template)} haven't been saved. Leaving drops them.`}
          footer={
            <>
              <Button onClick={() => setLeaving(false)}>Keep editing</Button>
              <Button variant="primary" onClick={() => (setLeaving(false), edit.discard(), onEditing(false))}>
                Discard changes
              </Button>
            </>
          }
        />
      )}
      {guard.dialog}
    </>
  );
}

function ymdOf(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

/**
 * "Reset Oct 10 to template" (decision 6): what comes off the date (what the template didn't make,
 * from now on), then `resetTemplateDate`. The date is no longer an exception.
 */
function ResetDialog({ stationId, template, date, onDone }: { stationId: string; template: DayTemplate; date: string; onDone: (line: string | null) => void }) {
  const qc = useQueryClient();
  const from = placeOn("06:00", date);
  const to = dayEndOf(date);
  const log = useApi(logApi.getLog, { params: { stationId }, query: { from, to } }, { retry: false });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = templateName(template);
  const nowIso = clockNow().toISOString();
  const going = (log.data?.entries ?? []).filter((e) => e.repeatGroupId !== template.id && e.startsAt >= from && e.startsAt < to && e.startsAt > nowIso);
  const reset = async () => {
    setPending(true);
    setError(null);
    try {
      const r = await call(logApi.resetTemplateDate, { params: { stationId, templateId: template.id, date } });
      await Promise.all([...LOG_READS, logApi.getTemplate, blocksApi.getBlock, blocksApi.listBlocks].map((e) => qc.invalidateQueries({ queryKey: [e.method, e.path] })));
      onDone(resetLine(date, name, r.generated));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through. Try again.");
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal
      open
      onClose={() => onDone(null)}
      width={460}
      title={`Reset ${monthDate(date)} to ${name}?`}
      subtitle={`${shortDate(date)} goes back to the template: what was changed by hand comes off, and the template's programs and blocks go back on. It's no longer an exception.`}
      footer={
        <>
          <Button onClick={() => onDone(null)}>Keep it</Button>
          <Button variant="primary" onClick={() => void reset()} disabled={pending || log.isLoading}>
            Reset to template
          </Button>
        </>
      }
    >
      {going.length > 0 && (
        <div className="cc-tpl__going">
          <b>Comes off</b>
          <ul>
            {going.map((e) => (
              <li key={e.id}>
                {e.kind === "off_air" ? "Off air" : e.title}, {clock(e.startsAt, { timeZone: STATION_TZ })}
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p className="cc-log__err" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
