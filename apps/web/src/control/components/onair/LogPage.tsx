// The program log (A.4), as the Schedule's Log tab (A246, opencast-schedule 01 to 04) and setup
// step 3. The Day view is a rundown of the broadcast day (6:00 am to 6:00 am) in air order:
// programs, live blocks, breaks as thin rows with what fills them, dead air with Fill, planned off
// air linking to the off air hours, and programming blocks as an edge with a label. It opens
// scrolled to now (or to `?entry`, `?break`, `?fill`). Above it, the day nav (arrows, Today, the
// template chip with "Make a template from this day", Day and Week) and the health chips, each
// scrolling to its row. Beside it, the pane: "Tonight at a glance" with the recent changes and the
// next break; a break, a program or a block picked. The Week view is seven days as columns.
//
// "Edit" (owners and operators) makes the rundown a draft (LogEditor.tsx, DayRundown.tsx): rows
// move by dragging (reorder.ts), "Add here" and Add open the drawer (AddDrawer.tsx), and the tray
// at the foot (EditTray.tsx) checks and publishes it with the day's version. `?edit=1` keeps edit
// mode across a visit to the market; `?add=<itemId>` (the library's "Schedule") opens the drawer on
// that item; `?fill=<gapStart>` opens the gap with Fill ready (on the phone, Fill's sheet, P.2).
// `?day=` is a date ("2026-10-03") or a weekday of this week ("sat"). Setup step 3 shows the Day
// view without the Schedule's tabs or the Week. Phase 4: in edit mode a block's start and end are
// handles on the rundown (`?addBlock=<blockId>`, a block's "Place on the log", opens Add a block set
// to it); on the phone the rundown is the whole screen, the day and its chips on top, and what's
// picked (a break, a program, the row being changed) opens as a bottom sheet.
// Times are on 4-second segment boundaries (prepare once, then assemble), as the API answers them.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { blocksApi, stationsApi, type LogChange, type LogEntry, type StationIdent } from "@opencast/contracts";
import { Button, ControlFoot, ControlTitle, IconButton, Modal, Notice, Segmented, Sheet, clock, minutesText, snapSpan, snapTime } from "@opencast/ui";
import { useApi } from "../../../api/hooks";
import { useIsPhone } from "../../layout/shell";
import { now, STATION_TZ, useNow } from "../../../lib/clock";
import { Quiet } from "../../pages/common";
import { useMarket } from "../spots/data";
import { useDeadAir, useLog, usePlayout, useTemplates } from "./data";
import { AddDrawer, type AddSpace } from "./AddDrawer";
import { DayRundown } from "./DayRundown";
import { blockWords, dayLabel, dayRows, glanceOf, healthChips, scrollTarget, templateChip, weekChips, weekColumns, weekLabel, type DayRow, type HealthChip } from "./dayRows";
import { EditTray } from "./EditTray";
import { FillOptions, useFill, type Gap } from "./Fill";
import { AddBlockDialog, DayChanges, draftGaps, EntrySection, SpanSection, useLogEdit } from "./LogEditor";
import { lockOf, type DraftItem } from "./logEdit";
import { BlockPane, BreakPane, EntryPane, GlancePane } from "./LogPane";
import { edgesOf, fixedReason, type Reflow } from "./reorder";
import { RepeatDialog } from "./RepeatDay";
import { shortDate, templateName } from "./templates";
import { DAY_KEYS, addDays, broadcastDay, isoDate, viewWindow, weekOf, weekdayOf, type Ymd } from "./time";
import { WeekView } from "./WeekView";
import "./LogPage.css";

const MIN = 60_000;
const t = (s: string) => Date.parse(s);

export interface LogPageProps {
  stationId: string;
  station: StationIdent;
  /** "/control/beat": the station's routes (the market, for carrying). Null while a station has no call sign. */
  base: string | null;
  /** Setup step 3: the foot with Back and Continue, no tabs and no Week. */
  setup?: { back: string; next: string };
  /** Owners and operators: Edit and Add. */
  canEdit?: boolean;
  /** A246: the Schedule's Log tab: its head, given the log's buttons for its end. */
  head?: (end: ReactNode) => ReactNode;
}

/**
 * The gaps still ahead in the window: from now at the earliest (in whole minutes), and, where a
 * gap runs to the window's edge, as far as it really goes (the next 24 hours' dead air). On
 * segment boundaries (whole minutes are), so a fill is sent, and shown, as the API will place it.
 */
export function openGaps(windowGaps: Gap[], deadAir: Gap[], windowTo: string, now: number): Array<Gap & { key: string }> {
  const nowMin = Math.ceil(now / MIN) * MIN;
  return windowGaps
    .filter((g) => t(g.endsAt) - Math.max(nowMin, t(g.startsAt)) >= 5 * MIN)
    .map((g) => {
      const startsAt = new Date(Math.max(nowMin, t(snapTime(g.startsAt)))).toISOString();
      const longer = g.endsAt === windowTo ? deadAir.find((d) => t(d.startsAt) <= t(startsAt) && t(d.endsAt) > t(g.endsAt)) : undefined;
      return { key: g.startsAt, startsAt, endsAt: snapTime(longer?.endsAt ?? g.endsAt) };
    });
}

function ymdOf(date: string): Ymd {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

/** A chip above the rundown; it scrolls to its row (and picks it out). */
function Chip({ chip, onGo }: { chip: HealthChip & { colour?: string | null }; onGo?: () => void }) {
  const body = (
    <>
      <i aria-hidden="true" style={chip.colour ? { background: chip.colour } : undefined} />
      {chip.text}
    </>
  );
  return onGo ? (
    <button type="button" className={`cc-hchip cc-hchip--${chip.tone}`} onClick={onGo}>
      {body}
    </button>
  ) : (
    <span className={`cc-hchip cc-hchip--${chip.tone}`}>{body}</span>
  );
}

export function LogPage({ stationId, station, base, setup, canEdit = false, head }: LogPageProps) {
  const phone = useIsPhone();
  const [params, setParams] = useSearchParams();
  const view = !setup && params.get("view") === "week" ? "week" : "day";
  const editing = canEdit && params.get("edit") === "1" && view === "day";
  // Edit mode counts down to what's locked, to the second.
  const tNow = useNow(editing ? 1_000 : 30_000).getTime();
  const today = broadcastDay(now());
  const dayParam = params.get("day") ?? DAY_KEYS[weekdayOf(today)];
  const thisWeek = weekOf(today);
  const day: Ymd = /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? ymdOf(dayParam) : (thisWeek.find((d) => DAY_KEYS[weekdayOf(d)] === dayParam) ?? today);
  const week = weekOf(day);
  const win = viewWindow(view, day);
  const isToday = isoDate(day) === isoDate(today);

  const log = useLog(stationId, win.from, win.to, { refetchInterval: 30_000 });
  const deadAir = useDeadAir(stationId);
  const playout = usePlayout(stationId);
  const templates = useTemplates(stationId);
  const rule = useApi(stationsApi.getBreakRule, { params: { stationId } }, { retry: false });
  const sources = useApi(stationsApi.listLiveSources, { params: { stationId } }, { retry: false, enabled: view === "day" });
  const blockList = useApi(blocksApi.listBlocks, { params: { stationId } }, { retry: false, enabled: !!log.data?.blocks?.length });
  const market = useMarket(stationId, {}, canEdit && !setup && isToday && view === "day");
  const onAir = !!playout.data?.onAir;

  const set = (patch: Record<string, string | null>) =>
    setParams(
      (p) => {
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) p.delete(k);
          else p.set(k, v);
        }
        return p;
      },
      { replace: true }
    );

  const edit = useLogEdit({ stationId, log: log.data, win, active: editing, onAir, now: tNow, onDone: () => set({ edit: null }) });
  const [picked, setPicked] = useState<string | null>(null);
  const [pickedSpan, setPickedSpan] = useState<string | null>(null);
  const [addingBlock, setAddingBlock] = useState(false);
  const [adding, setAdding] = useState<AddSpace | null>(null);
  const [repeating, setRepeating] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // Changes asked for from outside edit mode (the drawer, a block's pane), made once the draft exists.
  const [pending, setPending] = useState<{ changes: LogChange[]; items: DraftItem[] } | null>(null);
  useEffect(() => {
    if (pending && edit.draft) {
      edit.add(pending.changes, pending.items);
      setPending(null);
    }
  }, [pending, edit.draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const offAir = useMemo(() => log.data?.offAir ?? [], [log.data]);
  const gaps = useMemo(() => (log.data ? openGaps(log.data.gaps, deadAir.data?.gaps ?? [], win.to, tNow) : []), [log.data, deadAir.data, win.to, tNow]);

  const liveName = (id: string) => sources.data?.find((s) => s.id === id)?.name ?? null;
  const callSign = station.callSign ?? "the station";
  const wordsOfBlock = (blockId: string) => {
    const b = blockList.data?.blocks.find((x) => x.id === blockId);
    return b ? blockWords(b, callSign) : null;
  };

  const rows: DayRow[] = useMemo(() => {
    if (!log.data || view !== "day") return [];
    if (editing && edit.draft) {
      return dayRows({ entries: edit.entries, removed: edit.removed, breaks: edit.breaks, gaps: draftGaps(edit.entries, offAir, win.from, win.to), offAir, spans: edit.spans, from: win.from, to: win.to, now: tNow, liveSourceName: liveName, blockWords: wordsOfBlock, editing: true });
    }
    return dayRows({ entries: log.data.entries, breaks: log.data.breaks, gaps: log.data.gaps, offAir, spans: log.data.blocks ?? [], from: win.from, to: win.to, now: tNow, liveSourceName: liveName, blockWords: wordsOfBlock });
  }, [log.data, view, editing, edit.draft, edit.entries, edit.removed, edit.breaks, edit.spans, offAir, win.from, win.to, tNow, sources.data, blockList.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // The rows as they move: the draft's in edit mode, the log's otherwise (the drawer pushes either).
  const entriesNow = editing && edit.draft ? edit.entries : (log.data?.entries ?? []);
  const locked = (e: LogEntry) => (editing ? edit.locked(e) : lockOf(e, tNow, onAir));
  const reflow: Reflow = {
    entries: entriesNow,
    breaks: editing && edit.draft ? edit.breaks : (log.data?.breaks ?? []),
    fixed: (e) => !!fixedReason(e, !!locked(e)),
    edges: edgesOf(editing ? edit.spans : (log.data?.blocks ?? []), offAir.filter((o) => o.source === "hours"))
  };

  /** The space at `at`: until the next thing on the log or planned off air, or the day's end. */
  const spaceAt = (at: string, gapEnd?: string): AddSpace => {
    const next = [...entriesNow].filter((e) => e.startsAt >= at).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
    const off = offAir.filter((o) => o.startsAt >= at).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
    const ends = [next?.startsAt, off?.startsAt, gapEnd].filter((x): x is string => !!x).sort();
    const endsAt = ends[0] ?? null;
    const name = endsAt && next?.startsAt === endsAt ? (next.kind === "off_air" ? "off air" : next.title) : endsAt && off?.startsAt === endsAt ? "off air" : null;
    const covered = entriesNow.some((e) => e.startsAt <= at && at < e.endsAt);
    return { at, endsAt, next: name, gap: !covered && !!endsAt && t(endsAt) - t(at) >= 5 * MIN };
  };
  /** Where Add opens: the first dead air still ahead, else right after what's on now. */
  const firstSpace = (): AddSpace => {
    const g = gaps[0];
    if (g) return spaceAt(g.startsAt, g.endsAt);
    const cur = entriesNow.find((e) => t(e.startsAt) <= tNow && tNow < t(e.endsAt));
    const after = entriesNow.filter((e) => t(e.startsAt) > tNow + 20_000).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
    return spaceAt(cur?.endsAt ?? after?.startsAt ?? new Date(Math.ceil(tNow / MIN) * MIN + 5 * MIN).toISOString());
  };

  // `?fill=`: the gap, with Fill ready (the drawer on the web; Fill's sheet on the phone).
  const fillParam = params.get("fill");
  const fromDeadAir = fillParam ? deadAir.data?.gaps.find((g) => g.startsAt === fillParam) : undefined;
  const fillGap: (Gap & { key: string }) | null = fillParam ? (gaps.find((g) => g.key === fillParam || g.startsAt === fillParam) ?? (fromDeadAir ? { ...snapSpan(fromDeadAir), key: fromDeadAir.startsAt } : null)) : null;
  useEffect(() => {
    if (!phone && fillGap && log.data && !adding) setAdding(spaceAt(fillGap.startsAt, fillGap.endsAt));
  }, [fillParam, !!fillGap, !!log.data, phone]); // eslint-disable-line react-hooks/exhaustive-deps
  // `?add=<itemId>` (the library's "Schedule"): edit mode with the drawer open on it.
  const addParam = params.get("add");
  useEffect(() => {
    if (addParam && editing && log.data && !adding) setAdding(firstSpace());
  }, [addParam, editing, !!log.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // Phase 4, `?addBlock=<blockId>` (a block's "Place on the log", on a date): edit mode with Add a
  // block set to it.
  const addBlockParam = params.get("addBlock");
  useEffect(() => {
    if (addBlockParam && editing && log.data) setAddingBlock(true);
  }, [addBlockParam, editing, !!log.data]);
  const fill = useFill({ stationId, base, gap: phone ? fillGap : null, phone });

  if (log.isLoading) return <Quiet />;
  if (log.isError) return head ? <>{head(null)}<p className="cc-log__err" role="alert">{log.error.message}</p></> : <ControlTitle title="Program log" description={log.error.message} />;
  const data = log.data!;

  const startEditing = (patch: Record<string, string | null> = {}) => set({ edit: "1", fill: null, view: null, block: null, break: null, entry: null, ...patch });
  const doneEditing = () => (edit.changes.length ? setLeaving(true) : edit.discard());

  // What's picked: `?break=`, `?entry=`, `?block=` (view); a row or a block's label (edit).
  const breakParam = params.get("break");
  const entryParam = params.get("entry");
  const blockParam = params.get("block");
  const selectedId = editing ? (pickedSpan ? `band:${pickedSpan}` : picked) : breakParam ? `brk:${breakParam}` : entryParam ?? (blockParam ? `band:${blockParam}` : null);
  const onSelect = (row: DayRow) => {
    if (editing) {
      if (row.kind === "band" && row.span) {
        setPicked(null);
        setPickedSpan(row.span.id);
      } else if (row.kind === "entry" && !row.removed) {
        setPickedSpan(null);
        setPicked(row.id);
      }
      return;
    }
    if (row.kind === "break") set({ break: selectedId === row.id ? null : row.at, entry: null, block: null });
    else if (row.kind === "entry") set({ entry: selectedId === row.id ? null : row.id, break: null, block: null });
    else if (row.kind === "band" && row.span) set({ block: selectedId === row.id ? null : row.span.id, break: null, entry: null });
  };
  const onFill = (row: DayRow) => {
    if (phone) return set({ fill: row.id.slice("gap:".length) });
    const g = gaps.find((x) => `gap:${x.key}` === row.id);
    // From the next whole minute, as far as the dead air really goes (past the day's end too).
    setAdding(spaceAt(g?.startsAt ?? row.at, g?.endsAt ?? row.endsAt));
  };
  const closeDrawer = () => {
    setAdding(null);
    if (fillParam || addParam) set({ fill: null, add: null });
  };
  const onAdd = (changes: LogChange[], items: DraftItem[]) => {
    if (editing && edit.draft) {
      edit.add(changes, items);
    } else {
      setPending({ changes, items });
      startEditing();
    }
    closeDrawer();
  };

  const scrollTo = scrollTarget(rows, selectedId ?? (fillGap ? `gap:${fillGap.key}` : null));
  const chips = view === "day" ? healthChips({ rows, now: tNow, onAirToday: onAir && isToday, readiness: isToday ? playout.data?.readiness : null, pausedSpots: (market.data ?? []).filter((s) => s.state === "paused" && s.inRotation && (s.pause?.heldTonightMs ?? 0) > 0).length }) : [];
  const origin = templateChip(data.days, isoDate(day), (d) => templateName({ name: d.templateName, label: d.label ?? "a template" }));
  const originName = origin ? origin.text.replace(/^From "/, "").replace(/", edited$|"$/, "") : null;
  const exception = editing && origin && !origin.edited ? `Publishing makes ${dayLabel(day)} an exception to "${originName}".` : null;
  const goChip = (c: HealthChip) => () => {
    if (!c.rowId) return;
    const row = rows.find((r) => r.id === c.rowId);
    const el = document.querySelector<HTMLElement>(`[data-row="${c.rowId}"]`);
    el?.scrollIntoView?.({ block: "center" });
    if (row && !editing && (row.kind === "break" || row.kind === "entry")) onSelect(row);
  };

  const dayNav = (
    <div className="cc-daynav">
      <IconButton icon="chev" label={view === "week" ? "The week before" : "The day before"} size="sm" className="cc-daynav__arw cc-daynav__arw--l" onClick={() => set({ day: isoDate(addDays(day, view === "week" ? -7 : -1)), break: null, entry: null, block: null })} />
      <b className="cc-daynav__day">{view === "week" ? weekLabel(week) : phone && isToday ? `Today, ${shortDate(isoDate(day))}` : dayLabel(day)}</b>
      <IconButton icon="chev" label={view === "week" ? "The week after" : "The day after"} size="sm" className="cc-daynav__arw" onClick={() => set({ day: isoDate(addDays(day, view === "week" ? 7 : 1)), break: null, entry: null, block: null })} />
      {(view === "week" ? !thisWeek.some((d) => isoDate(d) === isoDate(day)) : !isToday) && (
        <button type="button" className="cc-btn-xs" onClick={() => set({ day: null, break: null, entry: null, block: null })}>
          {view === "week" ? "This week" : "Today"}
        </button>
      )}
      {view === "day" && origin && (
        <span className="cc-tplchip">
          {origin.edited && <i aria-hidden="true" />}
          {origin.text}
        </span>
      )}
      {view === "day" && canEdit && !editing && !phone && (
        <button type="button" className="cc-btn-xs" onClick={() => setRepeating(true)}>
          Make a template from this day
        </button>
      )}
      <span className="cc-daynav__end">
        {editing ? (
          <span className="cc-hchip cc-hchip--signal">{origin && !origin.edited ? `Editing. This date becomes an exception to "${originName}"` : "Editing"}</span>
        ) : (
          // The phone keeps to the day (opencast-schedule 08).
          !setup && !phone && (
            <Segmented
              label="View"
              size="sm"
              value={view}
              onChange={(v) => set({ view: v === "day" ? null : v, break: null, entry: null, block: null })}
              options={[
                { value: "day", label: "Day" },
                { value: "week", label: "Week" }
              ]}
            />
          )
        )}
      </span>
    </div>
  );

  const headEnd = canEdit ? (
    <div className="cc-log__end">
      {editing ? (
        <>
          <Button size="sm" onClick={() => setAddingBlock(true)}>
            Add a block
          </Button>
          <Button size="sm" icon="plus" onClick={() => setAdding(firstSpace())}>
            Add
          </Button>
          <Button size="sm" onClick={doneEditing}>
            Done editing
          </Button>
        </>
      ) : (
        <>
          {view === "day" && (
            <Button size="sm" icon="plus" onClick={() => setAdding(firstSpace())}>
              Add
            </Button>
          )}
          <Button size="sm" variant="ink" onClick={() => startEditing(view === "week" ? { day: null } : {})}>
            Edit
          </Button>
        </>
      )}
    </div>
  ) : null;

  // ---- The week ----
  if (view === "week") {
    const columns = weekColumns(week, data, { now: tNow, stationColour: station.colour, templateName: (d) => templateName({ name: d.templateName, label: d.label ?? "a template" }) });
    const wchips = weekChips(columns, data.blocks ?? [], tNow);
    return (
      <div className="cc-log">
        {head ? head(headEnd) : <ControlTitle title="Program log" end={headEnd} />}
        {dayNav}
        {wchips.length > 0 && (
          <div className="cc-hchips" aria-label="This week">
            {wchips.map((c) => (
              <Chip key={c.key} chip={c} onGo={c.date ? () => set({ view: null, day: c.date, fill: c.rowId?.slice("gap:".length) ?? null }) : undefined} />
            ))}
          </div>
        )}
        <WeekView columns={columns} onOpenDay={(date) => set({ view: null, day: date })} />
      </div>
    );
  }

  // ---- The day ----
  const pickedEntry = editing && picked ? edit.entries.find((e) => e.id === picked) : undefined;
  const editSpan = editing && pickedSpan ? edit.spans.find((x) => x.id === pickedSpan) : undefined;
  const pickedBreak = !editing && breakParam ? rows.find((r) => r.id === `brk:${breakParam}`) : undefined;
  const pickedProgram = !editing && entryParam ? rows.find((r) => r.id === entryParam && r.kind === "entry") : undefined;
  const pickedBlock = !editing && blockParam ? (data.blocks ?? []).find((b) => b.id === blockParam) : undefined;
  const nextBreak = rows.find((r) => r.kind === "break" && r.state === "ahead");
  const glance = glanceOf(day, data.entries, data.breaks);
  const toMarket = rule.data?.openTimeTo === "spot_market";
  const changesBox = canEdit ? <DayChanges stationId={stationId} origin={origin ? `${originName} template` : null} /> : null;

  const pane = editing ? (
    pickedEntry ? (
      <EntrySection edit={edit} entry={pickedEntry} base={base} onAdd={(at) => setAdding(spaceAt(at))} onClose={() => setPicked(null)} />
    ) : editSpan ? (
      <SpanSection edit={edit} span={editSpan} onAir={onAir} onClose={() => setPickedSpan(null)} />
    ) : (
      <section className="cc-epane">
        <h2 className="cc-pane__h">Editing {dayLabel(day)}</h2>
        <p className="cc-pane__sub">Drag a row by its handle to move it, or use the arrow keys. Pick a row to type its time, change what airs or keep it at its time. Nothing changes on air until you publish.</p>
      </section>
    )
  ) : pickedBreak?.slot ? (
    <BreakPane slot={pickedBreak.slot} entries={data.entries} block={pickedBreak.block} rule={rule.data} now={tNow} base={base} heading={`Break, ${clock(pickedBreak.at, { timeZone: STATION_TZ, seconds: true })}`} onClose={() => set({ break: null })} />
  ) : pickedProgram?.entry ? (
    <EntryPane entry={pickedProgram.entry} block={pickedProgram.block} onEdit={canEdit && !lockOf(pickedProgram.entry, tNow, onAir) ? () => (setPicked(pickedProgram.id), startEditing()) : undefined} onClose={() => set({ entry: null })} />
  ) : pickedBlock ? (
    <BlockPane
      span={pickedBlock}
      canEdit={canEdit}
      now={tNow}
      base={base}
      onChangeTimes={() => (setPickedSpan(pickedBlock.id), startEditing())}
      onTakeOff={() => (setPending({ changes: [{ op: "block_remove", spanId: pickedBlock.id }], items: [] }), startEditing())}
      onClose={() => set({ block: null })}
    />
  ) : (
    <GlancePane
      title={isToday ? "Tonight at a glance" : `${dayLabel(day).split(",")[0]} night at a glance`}
      glance={glance}
      toMarket={toMarket}
      changes={changesBox}
      next={
        nextBreak?.slot ? (
          <div className="cc-glance__next">
            <BreakPane brief slot={nextBreak.slot} entries={data.entries} block={nextBreak.block} rule={rule.data} now={tNow} base={base} heading={`Next break, ${clock(nextBreak.at, { timeZone: STATION_TZ, seconds: true })}`} />
          </div>
        ) : null
      }
    />
  );

  const sheetGap = phone && fillGap && !editing;
  // Phase 4, the phone (opencast-schedule 08): the rundown is the whole screen; what's picked opens
  // as a bottom sheet (a break, a program, a block; in edit mode the row being changed).
  const closePicked = () => (editing ? (setPicked(null), setPickedSpan(null)) : set({ break: null, entry: null, block: null }));
  const phoneSheet = !phone
    ? null
    : editing
      ? pickedEntry
        ? { label: pickedEntry.title, body: pane }
        : editSpan
          ? { label: editSpan.name, body: pane }
          : null
      : pickedBreak?.slot || pickedProgram?.entry || pickedBlock
        ? { label: pickedBreak ? `Break, ${clock(pickedBreak.at, { timeZone: STATION_TZ, seconds: true })}` : (pickedProgram?.title ?? pickedBlock?.name ?? ""), body: pane }
        : null;

  return (
    <div className={["cc-log", setup && "cc-log--setup", editing && "cc-log--editing", phone && "cc-log--phone"].filter(Boolean).join(" ")}>
      {head ? head(headEnd) : <ControlTitle title="Program log" description="What airs, in order. Build one day and make a template of it, then adjust." end={headEnd} />}
      {/* On the phone the day and its chips stay on top while the rows scroll under them. */}
      <div className="cc-log__bar">
        {dayNav}
        {chips.length > 0 && (
          <div className="cc-hchips" aria-label="At a glance">
            {chips.map((c) => (
              <Chip key={c.key} chip={c} onGo={c.rowId ? goChip(c) : undefined} />
            ))}
          </div>
        )}
      </div>
      {edit.published && !editing && (
        <Notice
          tone="plain"
          icon={null}
          className="cc-log__record"
          title={`Published: ${edit.published.count === 1 ? "1 change" : `${edit.published.count} changes`}, by ${edit.published.by.name ?? "you"} at ${clock(edit.published.at, { timeZone: STATION_TZ })}`}
          action={
            <Button size="sm" variant="text" onClick={edit.closePublished}>
              Close
            </Button>
          }
        >
          <ul className="cc-log__lines">
            {edit.published.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </Notice>
      )}
      <div className="cc-log__split">
        <div className="cc-log__main">
          {rows.length ? (
            <DayRundown
              rows={rows}
              onAir={onAir && isToday}
              selected={selectedId}
              onSelect={onSelect}
              onFill={onFill}
              scrollTo={scrollTo}
              offAirHref={base && !setup ? `${base}/schedule/templates` : null}
              edit={
                editing && edit.draft
                  ? {
                      locked: (e) => edit.locked(e),
                      troubled: edit.troubled,
                      original: new Map(data.entries.map((e) => [e.id, e])),
                      reflow,
                      spans: edit.spans,
                      onChanges: (c) => edit.add(c),
                      onKeep: (e) => edit.keep(e),
                      onRestore: (id) => {
                        const i = edit.changes.findIndex((c) => c.op === "remove" && c.entryId === id);
                        if (i >= 0) edit.drop(i);
                      },
                      onAddAt: (at) => setAdding(spaceAt(at)),
                      earliest: tNow + (onAir ? 20_000 : 0),
                      // Phase 4: a block's start and end as handles.
                      handles: {
                        original: new Map((data.blocks ?? []).map((b) => [b.id, { startsAt: b.startsAt, endsAt: b.endsAt }])),
                        limits: { earliest: tNow + (onAir ? 20_000 : 0), dayEnd: win.to },
                        intro: (id) => !!edit.blocks.find((b) => b.id === id)?.intro,
                        outro: (id) => !!edit.blocks.find((b) => b.id === id)?.outro,
                        onPick: (spanId) => (setPicked(null), setPickedSpan(spanId))
                      }
                    }
                  : undefined
              }
            />
          ) : (
            <p className="cc-log__quiet">Nothing on the log this day.</p>
          )}
        </div>
        {!phone && (
          <aside className="cc-log__pane" aria-label={editing ? "The row picked" : "The day"}>
            {pane}
          </aside>
        )}
      </div>
      {editing && <EditTray edit={edit} exception={exception} />}
      {setup && (
        <ControlFoot note="Programs are placed in whole minutes; breaks are placed for you.">
          <Button href={setup.back}>Back</Button>
          <Button variant="primary" href={setup.next}>
            Continue to translators
          </Button>
        </ControlFoot>
      )}
      {adding && (
        <AddDrawer
          stationId={stationId}
          space={adding}
          reflow={reflow}
          loaded={data.entries}
          draftEmpty={!editing || !edit.changes.length}
          onAdd={onAdd}
          onFilled={() => (editing ? void edit.rebase() : undefined)}
          nextKey={editing && edit.draft ? edit.nextKey : (() => `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`)}
          highlight={addParam}
          base={base}
          onClose={closeDrawer}
        />
      )}
      {editing && addingBlock && (
        <AddBlockDialog
          edit={edit}
          base={base}
          near={win.from}
          blockId={addBlockParam}
          onClose={() => {
            setAddingBlock(false);
            if (addBlockParam) set({ addBlock: null });
          }}
        />
      )}
      {repeating && <RepeatDialog stationId={stationId} day={day} pattern="weekly" phone={phone} onClose={() => setRepeating(false)} />}
      {leaving && (
        <Modal
          open
          onClose={() => setLeaving(false)}
          width={420}
          title="Leave without publishing?"
          subtitle={`${edit.changes.length === 1 ? "1 change" : `${edit.changes.length} changes`} haven't gone out. Leaving drops them.`}
          footer={
            <>
              <Button onClick={() => setLeaving(false)}>Keep editing</Button>
              <Button variant="primary" onClick={() => (setLeaving(false), edit.discard())}>
                Discard changes
              </Button>
            </>
          }
        />
      )}
      {phoneSheet && (
        <Sheet open onClose={closePicked} label={phoneSheet.label} className="cc-log__sheet">
          {phoneSheet.body}
        </Sheet>
      )}
      {sheetGap && (
        <Sheet
          open
          onClose={() => set({ fill: null })}
          eyebrow={`${[station.callSign, station.channel].filter(Boolean).join(" ")}, ${onAir ? "on air" : "off air"}`}
          title={<span className="cc-log__standby">{t(fillGap.startsAt) > tNow ? `Dead air in ${minutesText(t(fillGap.startsAt) - tNow)}` : "Dead air now"}</span>}
          subtitle={`Nothing is scheduled after ${clock(fillGap.startsAt, { timeZone: STATION_TZ })}.`}
          footer={
            <Button variant="primary" block onClick={() => fill.submit(() => set({ fill: null }))} disabled={fill.pending}>
              Fill the gap
            </Button>
          }
        >
          <FillOptions fill={fill} label="How should the gap be filled?" />
          {fill.error && <p className="cc-log__err">{fill.error}</p>}
        </Sheet>
      )}
    </div>
  );
}

