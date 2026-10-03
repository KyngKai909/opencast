// The program log (A.4): the day as it will actually be, as a timeline: programs at their start
// times, breaks where they fall, dead air drawn as dead air, planned off air (G9: the off air hours
// and sign-offs) as a calm band with when the station is back, never warned about, and a pane to
// fill a gap, set the break rule, repeat the day (G8: day templates) and set the off air hours.
// The same page is setup step 3 and the station's Program log; on the phone the fill choices open
// as a sheet (P.2, `?fill=<gapStart>`). `?day=` is a weekday of this week ("sat") or a date
// ("2026-10-03", from a template's dates); `?entry=` picks out an entry (from the Monitor).
// Times are on 4-second segment boundaries (prepare once, then assemble): what's drawn, and the
// gaps a fill is sent for, are snapped as the API snaps them, so the times shown are its answer.
// "Edit log" (owners and operators, 2026-09-29) makes the log editable: a draft of changes, checked
// and summed up, published at once (LogEditor.tsx). `?edit=1` keeps edit mode across a visit to
// the market; the draft itself is kept for the tab.
// A246: the Schedule's Log tab (`head`): the Schedule's head instead of the title, Day and Week (Day
// first; Evening went, and `?view=evening` reads as Day), and the pane without the break rule (on
// the Break rules tab) or the off air hours (on the Templates tab, as the "Every day" rule). Setup
// step 3 is as it was.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { stationsApi, type LogChange, type ProgramLog, type StationIdent } from "@opencast/contracts";
import {
  Button,
  ControlFoot,
  ControlTitle,
  KeyValueList,
  LogTimeline,
  Notice,
  Segmented,
  Sheet,
  Tabs,
  clock,
  duration,
  minutesText,
  snapSpan,
  snapTime,
  useToast,
  type TimelineBand,
  type TimelineBlock
} from "@opencast/ui";
import { useApi, useApiMutation } from "../../../api/hooks";
import { useIsPhone } from "../../layout/shell";
import { now, STATION_TZ, useNow } from "../../../lib/clock";
import { Quiet } from "../../pages/common";
import { LOG_READS, useDeadAir, useLog, usePlayout } from "./data";
import { FillOptions, useFill, type Gap } from "./Fill";
import { offAirSource } from "./offAir";
import { cadenceOf, cadenceWords } from "../station/breakRule";
import { OffAirHoursSection } from "./OffAirHours";
import { stationLabel } from "../../station/slug";
import { DayOrigin, RepeatDaySection } from "./RepeatDay";
import { entrySource } from "./rundown";
import { DAY_KEYS, DAY_SHORT, broadcastDay, isoDate, spanText, viewWindow, weekOf, weekdayOf, type LogView, type Ymd } from "./time";
import { AddBlockDialog, ChangesSection, draftGaps, EditTimeline, EntrySection, InsertDialog, LogHistory, SpanSection, useLogEdit } from "./LogEditor";
import { spanSummary } from "../live/blocks";
import "./LogPage.css";

const MIN = 60_000;

export interface LogPageProps {
  stationId: string;
  station: StationIdent;
  /** "/control/beat": the station's routes (the market, for carrying). Null while a station has no call sign. */
  base: string | null;
  /** Setup step 3: the foot with Back and Continue. */
  setup?: { back: string; next: string };
  /** Owners and operators: "Edit log", and the log's history. */
  canEdit?: boolean;
  /** A246: the Schedule's Log tab: its head, given the log's buttons for its end. */
  head?: (end: ReactNode) => ReactNode;
}

/** The marker on an off air block's title: the log's CSS draws the block as the calm off air band. */
export const OFF_AIR_MARK = "cc-log__off";

/**
 * Blocks for the timeline, from the log's entries, breaks, gaps and planned off air inside a
 * window. Off air (the hours, and a sign-off entry) is its own band, "Off air" with when the
 * station is back; it's never dead air.
 */
export function timelineBlocks(log: Pick<ProgramLog, "entries" | "breaks" | "gaps" | "offAir">, from: string, to: string, now = Date.now()): TimelineBlock[] {
  const a = Date.parse(from);
  const z = Date.parse(to);
  // On segment boundaries, as the API answers them; then clipped to the window.
  const clip = (s: string, e: string) => ({ start: new Date(Math.max(a, Date.parse(snapTime(s)))).toISOString(), end: new Date(Math.min(z, Date.parse(snapTime(e)))).toISOString() });
  const inside = (s: string, e: string) => Date.parse(e) > a && Date.parse(s) < z;
  const offAir = log.offAir ?? [];
  const offTitle = <span className={OFF_AIR_MARK}>Off air</span>;
  return [
    ...log.entries
      // A sign-off entry is drawn from its off air span, with when the station is back.
      .filter((e) => inside(e.startsAt, e.endsAt) && !(e.kind === "off_air" && offAir.some((o) => o.logEntryId === e.id)))
      .map<TimelineBlock>((e) =>
        e.kind === "off_air"
          ? { id: e.id, kind: "pgm", ...clip(e.startsAt, e.endsAt), title: offTitle, source: "Viewers see \"Off air\" and when you're back", code: "OPEN" }
          : { id: e.id, kind: e.carriedFrom ? "car" : "pgm", ...clip(e.startsAt, e.endsAt), title: e.title, source: entrySource(e), code: e.code }
      ),
    ...offAir
      .filter((o) => inside(o.startsAt, o.endsAt))
      .map<TimelineBlock>((o) => ({ id: o.logEntryId ?? `off:${o.startsAt}`, kind: "pgm", ...clip(o.startsAt, o.endsAt), title: offTitle, source: offAirSource(o), code: "OPEN" })),
    // Breaks between programs; one inside a program (a carried program's, a live block's cue) is part of its block.
    ...log.breaks
      .map((b) => ({ b, end: new Date(Date.parse(b.startsAt) + b.lengthMs).toISOString() }))
      .filter(({ b, end }) => inside(b.startsAt, end) && !log.entries.some((e) => e.startsAt < b.startsAt && b.startsAt < e.endsAt))
      .map<TimelineBlock>(({ b, end }) => ({ id: b.id ?? `brk:${b.startsAt}`, kind: "brk", ...clip(b.startsAt, end) })),
    // Dead air is what's still ahead: a gap that has passed was filled from the library as it came.
    ...log.gaps
      .filter((g) => inside(g.startsAt, g.endsAt) && Date.parse(g.endsAt) > now)
      .map<TimelineBlock>((g) => ({ id: `gap:${g.startsAt}`, kind: "dead", ...clip(new Date(Math.max(Date.parse(g.startsAt), Math.floor(now / MIN) * MIN)).toISOString(), g.endsAt) }))
  ].sort((x, y) => Date.parse(String(x.start)) - Date.parse(String(y.start)));
}

/**
 * The gaps still ahead in the window: from now at the earliest (in whole minutes), and, where a
 * gap runs to the window's edge, as far as it really goes (the next 24 hours' dead air). On
 * segment boundaries (whole minutes are), so a fill is sent, and shown, as the API will place it.
 */
export function openGaps(windowGaps: Gap[], deadAir: Gap[], windowTo: string, t: number): Array<Gap & { key: string }> {
  const nowMin = Math.ceil(t / MIN) * MIN;
  return windowGaps
    .filter((g) => Date.parse(g.endsAt) - Math.max(nowMin, Date.parse(g.startsAt)) >= 5 * MIN)
    .map((g) => {
      const startsAt = new Date(Math.max(nowMin, Date.parse(snapTime(g.startsAt)))).toISOString();
      const longer = g.endsAt === windowTo ? deadAir.find((d) => Date.parse(d.startsAt) <= Date.parse(startsAt) && Date.parse(d.endsAt) > Date.parse(g.endsAt)) : undefined;
      return { key: g.startsAt, startsAt, endsAt: snapTime(longer?.endsAt ?? g.endsAt) };
    });
}

export function LogPage({ stationId, station, base, setup, canEdit = false, head }: LogPageProps) {
  const phone = useIsPhone();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  // The Schedule's Log has Day and Week; setup keeps the Evening, its first view.
  const views: LogView[] = head ? ["day", "week"] : ["day", "evening", "week"];
  const dayView: LogView = head ? "day" : "evening";
  const view = (views.includes(params.get("view") as LogView) ? params.get("view") : dayView) as LogView;
  const editing = canEdit && params.get("edit") === "1" && view !== "week";
  // Edit mode counts down to what's locked, to the second.
  const t = useNow(editing ? 1_000 : 30_000).getTime();
  const today = broadcastDay(now());
  const thisWeek = weekOf(today);
  const dayParam = params.get("day") ?? DAY_KEYS[weekdayOf(today)];
  const dated = /^\d{4}-\d{2}-\d{2}$/.exec(dayParam) ? ymdOf(dayParam) : null;
  const week = dated ? weekOf(dated) : thisWeek;
  const day: Ymd = dated ?? thisWeek.find((d) => DAY_KEYS[weekdayOf(d)] === dayParam) ?? today;
  const win = viewWindow(view, day);

  const log = useLog(stationId, win.from, win.to, { refetchInterval: 30_000 });
  const deadAir = useDeadAir(stationId);
  const playout = usePlayout(stationId);
  const rule = useApi(stationsApi.getBreakRule, { params: { stationId } }, { retry: false });
  const setRule = useApiMutation(stationsApi.setBreakRule, { invalidates: [stationsApi.getBreakRule, ...LOG_READS] });

  const set = (k: string, v: string | null) =>
    setParams(
      (p) => {
        if (v === null) p.delete(k);
        else p.set(k, v);
        return p;
      },
      { replace: true }
    );

  const gaps = useMemo(() => (log.data ? openGaps(log.data.gaps, deadAir.data?.gaps ?? [], win.to, t) : []), [log.data, deadAir.data, win.to, t]);
  const fillParam = params.get("fill");
  // An airing picked out from elsewhere (the Monitor's "Prepared for air", G13), until a gap is picked.
  const entryParam = params.get("entry");
  const fromDeadAir = fillParam ? deadAir.data?.gaps.find((g) => g.startsAt === fillParam) : undefined;
  const selected: (Gap & { key: string }) | null =
    gaps.find((g) => g.key === fillParam || g.startsAt === fillParam) ?? (fromDeadAir ? { ...snapSpan(fromDeadAir), key: fromDeadAir.startsAt } : null) ?? (phone ? null : (gaps[0] ?? null));
  const fill = useFill({ stationId, base, gap: selected, phone });
  const edit = useLogEdit({ stationId, log: log.data, win, active: editing, onAir: !!playout.data?.onAir, now: t, onDone: () => set("edit", null) });
  const [picked, setPicked] = useState<string | null>(null);
  const [inserting, setInserting] = useState<"before" | "after" | null>(null);
  // A244: a programming block's span picked in edit mode, and "Add a block".
  const [pickedSpan, setPickedSpan] = useState<string | null>(null);
  const [addingBlock, setAddingBlock] = useState(false);
  // A change asked for from outside edit mode, made once its draft exists.
  const [pending, setPending] = useState<LogChange | null>(null);
  useEffect(() => {
    if (pending && edit.draft) {
      edit.add(pending);
      setPending(null);
    }
  }, [pending, edit.draft]); // eslint-disable-line react-hooks/exhaustive-deps


  if (log.isLoading) return <Quiet />;
  if (log.isError) return head ? <>{head(null)}<p className="cc-log__err" role="alert">{log.error.message}</p></> : <ControlTitle title="Program log" description={log.error.message} />;

  const first = gaps[0];
  // A day of this week by its key; another week's by its date.
  const dayValue = (d: Ymd) => (thisWeek.some((x) => isoDate(x) === isoDate(d)) ? DAY_KEYS[weekdayOf(d)] : isoDate(d));

  const onRule = (mode: "after_every_program" | "every_n_minutes" | "none") => {
    if (!rule.data) return;
    setRule.mutate({ params: { stationId }, body: { ...rule.data, mode, everyMinutes: mode === "every_n_minutes" ? 30 : null } }, { onError: (e) => toast.show({ message: e.message }) });
  };

  const blocks = log.data ? timelineBlocks(log.data, win.from, win.to, t) : [];
  // A244: programming blocks, as rails beside the timeline; `?block=` opens one's pane.
  const spans = log.data?.blocks ?? [];
  const bands: TimelineBand[] = spans.map((b) => ({ id: b.id, label: b.name, start: b.startsAt, end: b.endsAt, pieces: b.pieces.map((p) => ({ start: p.startsAt, end: p.endsAt })), colour: b.colour, problems: b.problems.length }));
  const blockParam = params.get("block");
  const pickedBlock = !editing && blockParam ? spans.find((b) => b.id === blockParam) : undefined;
  const editSpan = editing && pickedSpan ? edit.spans.find((x) => x.id === pickedSpan) : undefined;
  const drafted = new Map(edit.entries.map((e) => [e.id, e]));
  const pickedEntry = editing && picked ? drafted.get(picked) : undefined;
  const pxPerMinute = view === "day" ? 0.5 : 1.12;
  const timeline =
    editing && log.data ? (
      <EditTimeline
        blocks={timelineBlocks({ entries: edit.entries, breaks: edit.breaks, gaps: draftGaps(edit.entries, log.data.offAir ?? [], win.from, win.to), offAir: log.data.offAir }, win.from, win.to, t)}
        from={win.from}
        to={win.to}
        pxPerMinute={pxPerMinute}
        maxHeight={phone ? undefined : setup ? 430 : 540}
        entries={drafted}
        locked={edit.locked}
        troubled={edit.troubled}
        selectedId={pickedSpan ?? picked}
        onSelect={(id) => {
          setPickedSpan(null);
          setPicked(id);
        }}
        onMove={(id, startsAt) => {
          edit.add({ op: "move", entryId: id, startsAt });
          setPicked(id);
        }}
        spans={edit.spans}
        troubledSpans={edit.troubled}
        onSelectSpan={(id) => {
          setPicked(null);
          setPickedSpan(id);
        }}
        onResizeSpan={(id, edge, at) => {
          edit.add({ op: "block_resize", spanId: id, ...(edge === "start" ? { startsAt: at } : { endsAt: at }) });
          setPickedSpan(id);
        }}
      />
    ) : view === "week" ? (
      // On the phone the week scrolls sideways: focusable, so the keyboard can scroll it too.
      <div className="cc-week" role="region" aria-label="The week" tabIndex={0}>
        {week.map((d) => {
          const w = viewWindow("day", d);
          return (
            <div key={isoDate(d)} className="cc-week__day">
              <h3 className="cc-week__h">
                {DAY_SHORT[weekdayOf(d)]} {d.day}
              </h3>
              <LogTimeline blocks={log.data ? timelineBlocks(log.data, w.from, w.to, t) : []} from={w.from} to={w.to} pxPerMinute={0.3} timeZone={STATION_TZ} />
            </div>
          );
        })}
      </div>
    ) : (
      <LogTimeline
        blocks={blocks}
        from={win.from}
        to={win.to}
        pxPerMinute={pxPerMinute}
        timeZone={STATION_TZ}
        maxHeight={phone ? undefined : setup ? 430 : 540}
        selectedId={entryParam && !fillParam ? entryParam : selected && !pickedBlock ? `gap:${selected.key}` : undefined}
        selectable={(b) => b.kind === "dead"}
        onSelect={(b) => {
          set("block", null);
          set("fill", b.id.slice("gap:".length));
        }}
        className="cc-log__tl"
        bands={bands}
        selectedBandId={pickedBlock?.id ?? null}
        onSelectBand={(b) => set("block", b.id)}
      />
    );

  // A244: a block's pane: where it airs, what to look at, and changing it.
  const blockSection = pickedBlock && (
    <section className="cc-log__sec cc-log__block" aria-label={pickedBlock.name}>
      <div className="cc-log__hrow">
        <h2 className="cc-log__h">
          <span className="cc-log__swatch" style={{ background: pickedBlock.colour ?? "var(--ink-70)" }} aria-hidden="true" />
          {pickedBlock.name}
        </h2>
        <Button variant="text" size="sm" onClick={() => set("block", null)}>
          Close
        </Button>
      </div>
      <p className="cc-log__quiet">{spanSummary(pickedBlock)}</p>
      {pickedBlock.problems.length > 0 && (
        <ul className="cc-edit__warnings" aria-label="To look at">
          {pickedBlock.problems.map((p) => (
            <li key={p.code + p.message}>{p.message}</li>
          ))}
        </ul>
      )}
      <div className="cc-edit__actions">
        {canEdit && (
          <Button
            size="sm"
            onClick={() => {
              setPickedSpan(pickedBlock.id);
              startEditing();
            }}
          >
            Change times
          </Button>
        )}
        {canEdit && Date.parse(pickedBlock.startsAt) > t && (
          <Button
            size="sm"
            variant="text"
            onClick={() => {
              setPending({ op: "block_remove", spanId: pickedBlock.id });
              startEditing();
            }}
          >
            Take the block off this day
          </Button>
        )}
        {base && (
          <Button size="sm" variant="text" href={`${base}/schedule/blocks/${pickedBlock.blockId}`}>
            Edit {pickedBlock.name}
          </Button>
        )}
      </div>
    </section>
  );

  const fillSection = selected && !phone && !pickedBlock && (
    <section className="cc-log__sec">
      <h2 className="cc-log__h">Fill {spanText(selected.startsAt, selected.endsAt)}</h2>
      <FillOptions fill={fill} label={`How should ${spanText(selected.startsAt, selected.endsAt)} be filled?`} />
      {fill.error && <p className="cc-log__err">{fill.error}</p>}
      <Button variant="primary" size="sm" className="cc-log__go" onClick={() => fill.submit(() => set("fill", null))} disabled={fill.pending}>
        Fill the gap
      </Button>
    </section>
  );

  const breaksSection = !head && (
    <section className="cc-log__sec">
      <h2 className="cc-log__h">Breaks</h2>
      {rule.data ? (
        <>
          <Segmented
            label="Breaks"
            value={rule.data.mode}
            onChange={onRule}
            options={[
              { value: "after_every_program", label: "After every program" },
              { value: "every_n_minutes", label: `Every ${rule.data.everyMinutes ?? 30} min` },
              { value: "none", label: "None" }
            ]}
            className="cc-log__seg"
          />
          <KeyValueList
            items={[
              { label: "Length", value: duration(rule.data.lengthMs) },
              // Spots when they don't air in every break (added 2026-09-29; no frame draws it).
              ...(cadenceOf(rule.data).spots.every !== "break" ? [{ label: "Spots", value: cadenceWords(cadenceOf(rule.data).spots) }] : []),
              { label: "Station ID", value: cadenceWords(cadenceOf(rule.data).stationId) },
              { label: "Open time goes to", value: rule.data.openTimeTo === "spot_market" ? "The spot market" : "Your station ID and bumpers" }
            ]}
          />
        </>
      ) : (
        <p className="cc-log__quiet">{rule.isError ? rule.error.message : null}</p>
      )}
    </section>
  );

  const repeatSection = view !== "week" && (
    <RepeatDaySection
      stationId={stationId}
      day={day}
      repeats={log.data?.repeats}
      phone={phone}
      dateHref={(date) => {
        const p = new URLSearchParams(params);
        p.set("day", date);
        p.delete("fill");
        return `?${p}`;
      }}
    />
  );

  const offAirSection = view !== "week" && !head && <OffAirHoursSection stationId={stationId} callSign={stationLabel(station)} phone={phone} />;

  // Fill it: the gap's pane (from the week, on the evening of the gap's day).
  const fillFrom = (g: Gap & { key: string }) =>
    setParams(
      (p) => {
        if (view === "week") {
          p.set("view", dayView);
          p.set("day", dayValue(broadcastDay(g.startsAt)));
        }
        p.set("fill", g.key);
        return p;
      },
      { replace: true }
    );

  const sheetGap = phone && selected && !editing;
  const startEditing = () =>
    setParams(
      (p) => {
        p.set("edit", "1");
        p.delete("fill");
        if (view === "week") p.set("view", dayView);
        p.delete("block");
        return p;
      },
      { replace: true }
    );
  const onAirNow = !!playout.data?.onAir;

  const VIEW_LABELS: Record<LogView, string> = { day: "Day", evening: "Evening", week: "Week" };
  const titleEnd = (
    <div className="cc-log__end">
      {canEdit && !editing && (
        <Button size="sm" onClick={startEditing}>
          Edit log
        </Button>
      )}
      <Segmented
        label="View"
        value={view}
        onChange={(v) => set("view", v)}
        options={views.filter((v) => !(editing && v === "week")).map((v) => ({ value: v, label: VIEW_LABELS[v] }))}
      />
    </div>
  );

  return (
    <div className={setup ? "cc-log cc-log--setup" : "cc-log"}>
      {head ? head(titleEnd) : <ControlTitle title="Program log" description="What airs, in order. Build one day and repeat it, then adjust." end={titleEnd} />}
      {view !== "week" && (
        <Tabs
          variant="days"
          label="Day"
          value={dayValue(day)}
          onChange={(v) => set("day", v)}
          items={week.map((d) => ({ value: dayValue(d), label: DAY_SHORT[weekdayOf(d)] }))}
          className="cc-log__days"
        />
      )}
      <div className={view === "week" ? "cc-log__split cc-log__split--week" : "cc-log__split"}>
        <div className="cc-log__main">
          {editing && (
            <Notice
              tone="plain"
              icon={null}
              title="Editing the log."
              className="cc-edit__bar"
              action={
                <Button size="sm" onClick={() => setAddingBlock(true)}>
                  Add a block
                </Button>
              }
            >
              {onAirNow ? "Nothing changes on air until you publish. What's on now, and anything starting in the next 20 seconds, stays as it is." : "Nothing changes until you publish."}
            </Notice>
          )}
          {first && !editing && (
            <Notice tone="standby" title={`Dead air from ${spanText(first.startsAt, first.endsAt)}.`} action={
                <Button size="sm" onClick={() => fillFrom(first)}>
                  Fill it
                </Button>
              }>
              {minutesText(Date.parse(first.endsAt) - Date.parse(first.startsAt))} with nothing scheduled.
            </Notice>
          )}
          {view !== "week" && <DayOrigin stationId={stationId} day={day} days={log.data?.days} />}
          {timeline}
        </div>
        {view !== "week" && (
          <aside className="cc-log__pane" aria-label={editing ? "Your changes" : "Filling, breaks, repeats and off air hours"}>
            {editing ? (
              <>
                <ChangesSection edit={edit} />
                {pickedEntry && <EntrySection edit={edit} entry={pickedEntry} base={base} onInsert={setInserting} onClose={() => setPicked(null)} />}
                {editSpan && <SpanSection edit={edit} span={editSpan} onAir={onAirNow} onClose={() => setPickedSpan(null)} />}
              </>
            ) : (
              <>
                {blockSection}
                {fillSection}
                {canEdit && <LogHistory stationId={stationId} />}
                {breaksSection}
                {repeatSection}
                {offAirSection}
              </>
            )}
          </aside>
        )}
      </div>
      {setup && (
        <ControlFoot note="Programs are placed in whole minutes; breaks are placed for you.">
          <Button href={setup.back}>Back</Button>
          <Button variant="primary" href={setup.next}>
            Continue to translators
          </Button>
        </ControlFoot>
      )}
      {editing && addingBlock && <AddBlockDialog edit={edit} base={base} near={win.from} onClose={() => setAddingBlock(false)} />}
      {editing && pickedEntry && inserting && <InsertDialog edit={edit} stationId={stationId} anchor={pickedEntry} where={inserting} base={base} onClose={() => setInserting(null)} />}
      {sheetGap && (
        <Sheet
          open
          onClose={() => set("fill", null)}
          eyebrow={`${[station.callSign, station.channel].filter(Boolean).join(" ")}, ${onAirNow ? "on air" : "off air"}`}
          title={<span className="cc-log__standby">{Date.parse(selected.startsAt) > t ? `Dead air in ${minutesText(Date.parse(selected.startsAt) - t)}` : "Dead air now"}</span>}
          subtitle={`Nothing is scheduled after ${clock(selected.startsAt, { timeZone: STATION_TZ })}.`}
          footer={
            <Button variant="primary" block onClick={() => fill.submit(() => set("fill", null))} disabled={fill.pending}>
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

function ymdOf(date: string): Ymd {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}
