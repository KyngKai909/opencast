// The program log (A.4): the day as it will actually be, as a timeline: programs at their start
// times, breaks where they fall, dead air drawn as dead air, planned off air (G9: the off air hours
// and sign-offs) as a calm band with when the station is back, never warned about, and a pane to
// fill a gap, set the break rule, repeat the day (G8: day templates) and set the off air hours.
// The same page is setup step 3 and the station's Program log; on the phone the fill choices open
// as a sheet (P.2, `?fill=<gapStart>`). `?day=` is a weekday of this week ("sat") or a date
// ("2026-10-03", from a template's dates).

import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { stationsApi, type ProgramLog, type StationIdent } from "@opencast/contracts";
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
  useToast,
  type TimelineBlock
} from "@opencast/ui";
import { useApi, useApiMutation } from "../../../api/hooks";
import { useIsPhone } from "../../layout/shell";
import { now, STATION_TZ, useNow } from "../../../lib/clock";
import { Quiet } from "../../pages/common";
import { LOG_READS, useDeadAir, useLog, usePlayout } from "./data";
import { FillOptions, useFill, type Gap } from "./Fill";
import { offAirSource } from "./offAir";
import { OffAirHoursSection } from "./OffAirHours";
import { DayOrigin, RepeatDaySection } from "./RepeatDay";
import { entrySource } from "./rundown";
import { DAY_KEYS, DAY_SHORT, broadcastDay, isoDate, spanText, viewWindow, weekOf, weekdayOf, type LogView, type Ymd } from "./time";
import "./LogPage.css";

const MIN = 60_000;

export interface LogPageProps {
  stationId: string;
  station: StationIdent;
  /** "/control/beat": the station's routes (the market, for carrying). Null while a station has no call sign. */
  base: string | null;
  /** Setup step 3: the foot with Back and Continue. */
  setup?: { back: string; next: string };
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
  const clip = (s: string, e: string) => ({ start: new Date(Math.max(a, Date.parse(s))).toISOString(), end: new Date(Math.min(z, Date.parse(e))).toISOString() });
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
 * gap runs to the window's edge, as far as it really goes (the next 24 hours' dead air).
 */
export function openGaps(windowGaps: Gap[], deadAir: Gap[], windowTo: string, t: number): Array<Gap & { key: string }> {
  const nowMin = Math.ceil(t / MIN) * MIN;
  return windowGaps
    .filter((g) => Date.parse(g.endsAt) - Math.max(nowMin, Date.parse(g.startsAt)) >= 5 * MIN)
    .map((g) => {
      const startsAt = new Date(Math.max(nowMin, Date.parse(g.startsAt))).toISOString();
      const longer = g.endsAt === windowTo ? deadAir.find((d) => Date.parse(d.startsAt) <= Date.parse(startsAt) && Date.parse(d.endsAt) > Date.parse(g.endsAt)) : undefined;
      return { key: g.startsAt, startsAt, endsAt: longer?.endsAt ?? g.endsAt };
    });
}

export function LogPage({ stationId, station, base, setup }: LogPageProps) {
  const phone = useIsPhone();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const t = useNow(30_000).getTime();
  const today = broadcastDay(now());
  const thisWeek = weekOf(today);
  const view = (["day", "evening", "week"].includes(params.get("view") ?? "") ? params.get("view") : "evening") as LogView;
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
  const fromDeadAir = fillParam ? deadAir.data?.gaps.find((g) => g.startsAt === fillParam) : undefined;
  const selected: (Gap & { key: string }) | null =
    gaps.find((g) => g.key === fillParam || g.startsAt === fillParam) ?? (fromDeadAir ? { ...fromDeadAir, key: fromDeadAir.startsAt } : null) ?? (phone ? null : (gaps[0] ?? null));
  const fill = useFill({ stationId, base, gap: selected, phone });

  if (log.isLoading) return <Quiet />;
  if (log.isError) return <ControlTitle title="Program log" description={log.error.message} />;

  const first = gaps[0];
  // A day of this week by its key; another week's by its date.
  const dayValue = (d: Ymd) => (thisWeek.some((x) => isoDate(x) === isoDate(d)) ? DAY_KEYS[weekdayOf(d)] : isoDate(d));

  const onRule = (mode: "after_every_program" | "every_n_minutes" | "none") => {
    if (!rule.data) return;
    setRule.mutate({ params: { stationId }, body: { ...rule.data, mode, everyMinutes: mode === "every_n_minutes" ? 30 : null } }, { onError: (e) => toast.show({ message: e.message }) });
  };

  const blocks = log.data ? timelineBlocks(log.data, win.from, win.to, t) : [];
  const timeline =
    view === "week" ? (
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
        pxPerMinute={view === "day" ? 0.5 : 1.12}
        timeZone={STATION_TZ}
        maxHeight={phone ? undefined : setup ? 430 : 540}
        selectedId={selected ? `gap:${selected.key}` : undefined}
        selectable={(b) => b.kind === "dead"}
        onSelect={(b) => set("fill", b.id.slice("gap:".length))}
        className="cc-log__tl"
      />
    );

  const fillSection = selected && !phone && (
    <section className="cc-log__sec">
      <h2 className="cc-log__h">Fill {spanText(selected.startsAt, selected.endsAt)}</h2>
      <FillOptions fill={fill} label={`How should ${spanText(selected.startsAt, selected.endsAt)} be filled?`} />
      {fill.error && <p className="cc-log__err">{fill.error}</p>}
      <Button variant="primary" size="sm" className="cc-log__go" onClick={() => fill.submit(() => set("fill", null))} disabled={fill.pending}>
        Fill the gap
      </Button>
    </section>
  );

  const breaksSection = (
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
              { label: "Station ID", value: "In every break" },
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

  const offAirSection = view !== "week" && <OffAirHoursSection stationId={stationId} callSign={station.callSign ?? station.name} phone={phone} />;

  // Fill it: the gap's pane (from the week, on the evening of the gap's day).
  const fillFrom = (g: Gap & { key: string }) =>
    setParams(
      (p) => {
        if (view === "week") {
          p.set("view", "evening");
          p.set("day", dayValue(broadcastDay(g.startsAt)));
        }
        p.set("fill", g.key);
        return p;
      },
      { replace: true }
    );

  const sheetGap = phone && selected;
  const onAirNow = !!playout.data?.onAir;

  return (
    <div className={setup ? "cc-log cc-log--setup" : "cc-log"}>
      <ControlTitle
        title="Program log"
        description="What airs, in order. Build one day and repeat it, then adjust."
        end={
          <Segmented
            label="View"
            value={view}
            onChange={(v) => set("view", v)}
            options={[
              { value: "day", label: "Day" },
              { value: "evening", label: "Evening" },
              { value: "week", label: "Week" }
            ]}
          />
        }
      />
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
          {first && (
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
          <aside className="cc-log__pane" aria-label="Filling, breaks, repeats and off air hours">
            {fillSection}
            {breaksSection}
            {repeatSection}
            {offAirSection}
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
