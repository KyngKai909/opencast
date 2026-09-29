// earnings 01.1 Audience (/audience?period=tonight): tuned in now, tonight's line against the same
// night last week with the breaks shaded, each program's average, peak and how many stayed to the
// end, and what people watch on, with the translators' counts apart (never added in, never
// billed). 04.1 on the phone: the live count, a small line and tonight's programs.
// A station's own numbers only. Owners and operators see them; hosts never get here.

import { useSearchParams } from "react-router";
import { audienceApi } from "@opencast/contracts";
import { ControlTitle, KeyValueList, LineChart, Lines, Segmented, SplitBar, StatRow, Table, clock, splitShares, type Column, type KeyValueRow } from "@opencast/ui";
import type { AudienceReport } from "@opencast/contracts";
import type { AudienceProgram } from "../../api/types";
import { useApi } from "../../../api/hooks";
import { audiencePeriodLabel, audienceWindow, hoursCaption, isAudiencePeriod, lastWeekLabel, peakCaption, phoneNowLine, type AudiencePeriod } from "../../components/earnings/periods";
import { airedTimes, sourceLine } from "../../components/earnings/audience";
import { plural } from "../../components/earnings/lines";
import { Section } from "../../components/earnings/Section";
import { useIsPhone, useShellOptions } from "../../layout/shell";
import { STATION_TZ, useNow } from "../../../lib/clock";
import { useStation } from "../../station/StationContext";
import { Quiet } from "../common";
import "./Audience.css";

const PERIODS: AudiencePeriod[] = ["tonight", "week", "month"];
const PLATFORMS = [
  { key: "phone", label: "Phones" },
  { key: "cast", label: "Casting to a TV" },
  { key: "web", label: "Web" },
  { key: "tv_app", label: "TV app" }
] as const;

/** Tonight's breaks as shaded spans: the report's own list, or runs of break minutes in its line. */
function breakSpans(a: AudienceReport): Array<{ start: string; end: string }> {
  if (a.breaks) return a.breaks.map((b) => ({ start: b.startsAt, end: b.endsAt }));
  const out: Array<{ start: string; end: string }> = [];
  a.series.forEach((p, i) => {
    if (!p.inBreak) return;
    const end = new Date(Date.parse(p.minute) + 60_000).toISOString();
    if (i > 0 && a.series[i - 1].inBreak) out[out.length - 1].end = end;
    else out.push({ start: p.minute, end });
  });
  return out;
}

const pct = (n: number) => `${Math.round(n)}%`;

export default function Audience() {
  const s = useStation();
  const phone = useIsPhone();
  const t = useNow(60_000);
  const [params, setParams] = useSearchParams();
  const raw = params.get("period");
  const period: AudiencePeriod = isAudiencePeriod(raw) ? raw : "tonight";
  const radio = s.station.band === "radio";
  const name = s.station.callSign ?? s.station.name;
  useShellOptions({ context: "Audience" });

  // The window moves with the clock a minute at a time; the query key with it.
  const win = audienceWindow(period, t, STATION_TZ);
  const from = win.from.toISOString();
  const to = new Date(Math.floor(win.to.getTime() / 60_000) * 60_000).toISOString();
  const q = useApi(audienceApi.getAudience, { params: { stationId: s.id }, query: { from, to } }, { refetchInterval: 60_000, placeholderData: (prev) => prev });
  const a = q.data;

  const tonight = period === "tonight";
  const programs = a?.byProgram ?? null;
  const times = programs ? airedTimes(programs.map((p) => p.airedAt ?? from), STATION_TZ) : [];

  if (!a) {
    return (
      <div className={phone ? "cc-aud-phone" : "cc-aud"}>
        {!phone && <ControlTitle title="Audience" description="Counted from Opencast's players, the same numbers per-thousand spots are billed on." />}
        {q.isLoading ? (
          <Quiet />
        ) : (
          <p className="cc-aud__error" role="alert">
            {q.error?.message ?? "Something went wrong. Try again."}
          </p>
        )}
      </div>
    );
  }

  const comparison = a.comparison ?? (a.series.some((p) => p.lastWeek !== null) ? a.series.filter((p) => p.lastWeek !== null).map((p) => ({ minute: p.minute, tunedIn: p.lastWeek! })) : undefined);
  const chart = tonight && a.series.length > 0 && (
    <LineChart
      from={from}
      to={to}
      series={a.series.map((p) => ({ at: p.minute, value: p.tunedIn }))}
      comparison={comparison?.map((p) => ({ at: p.minute, value: p.tunedIn }))}
      breaks={breakSpans(a)}
      label={`Tuned in from ${clock(from, { timeZone: STATION_TZ }).replace(":00", "")} to now, tonight${comparison ? ` and ${lastWeekLabel(win.from, STATION_TZ).toLowerCase()}` : ""}`}
      comparisonLabel={lastWeekLabel(win.from, STATION_TZ)}
      timeZone={STATION_TZ}
      compact={phone}
    />
  );

  if (phone) {
    return (
      <div className="cc-aud-phone">
        <h1 className="oc-sr-only">Audience</h1>
        <div className="cc-aud-phone__now">
          <span className="cc-aud-phone__v">
            {a.tunedInNow > 0 && <span className="cc-aud__live" aria-hidden="true" />}
            {a.tunedInNow.toLocaleString("en-US")}
          </span>
          <small className="cc-aud-phone__cap">{phoneNowLine(period, a.peak, STATION_TZ)}</small>
        </div>
        {chart && <div className="cc-aud-phone__chart">{chart}</div>}
        <div className="cc-aud-phone__rows">
          {programs && programs.length > 0 ? (
            <KeyValueList
              variant="rows"
              items={programs.map((p) => ({
                title: p.title,
                detail: p.onNow ? "On now" : p.airedAt ? clock(p.airedAt, { timeZone: STATION_TZ }) : plural(p.airings, "airing"),
                value: `${p.averageTunedIn.toLocaleString("en-US")} avg`
              })) satisfies KeyValueRow[]}
            />
          ) : (
            programs && <p className="cc-aud__empty">Nothing has aired yet tonight.</p>
          )}
        </div>
      </div>
    );
  }

  const columns: Column<AudienceProgram & { time: string }>[] = [
    tonight
      ? { key: "aired", header: "Aired", width: "80px", kind: "time", cell: (r) => r.time }
      : { key: "airings", header: "Airings", width: "80px", kind: "time", cell: (r) => r.airings.toLocaleString("en-US") },
    { key: "program", header: "Program", cell: (r) => <Lines title={r.title} detail={sourceLine(r)} /> },
    { key: "average", header: "Average", width: "110px", kind: "amount", cell: (r) => r.averageTunedIn.toLocaleString("en-US") },
    { key: "peak", header: "Peak", width: "110px", kind: "amount", cell: (r) => r.peakTunedIn.toLocaleString("en-US") },
    { key: "stayed", header: "Stayed to the end", width: "130px", kind: "amount", cell: (r) => (r.onNow ? <span className="cc-aud__quiet">On now</span> : r.stayedToTheEnd === null ? <span className="cc-aud__quiet">–</span> : pct(r.stayedToTheEnd)) }
  ];

  const shares = splitShares(PLATFORMS.map((p) => ({ amount: a.byPlatform[p.key] })));
  const watchingOn: KeyValueRow[] = [
    ...PLATFORMS.map((p, i) => ({ title: p.label, value: `${shares[i]}%` })),
    ...a.translators.map((x) => ({
      title: `On ${x.name}, through your translator`,
      detail: `Counted by ${x.name}. Not part of tuned in, and not billed`,
      value: x.viewers.toLocaleString("en-US"),
      quiet: true
    }))
  ];
  const periodWord = audiencePeriodLabel(period, t, STATION_TZ);

  return (
    <div className="cc-aud">
      <ControlTitle
        title="Audience"
        description="Counted from Opencast's players, the same numbers per-thousand spots are billed on."
        end={
          <Segmented
            label="Period"
            value={period}
            options={PERIODS.map((p) => ({ value: p, label: audiencePeriodLabel(p, t, STATION_TZ) }))}
            onChange={(p) =>
              setParams(
                (x) => {
                  x.set("period", p);
                  return x;
                },
                { replace: true }
              )
            }
          />
        }
      />
      <StatRow
        size="lg"
        className="cc-aud__stats"
        stats={[
          { value: a.tunedInNow.toLocaleString("en-US"), caption: "Tuned in now", live: a.tunedInNow > 0 },
          { value: a.peak ? a.peak.tunedIn.toLocaleString("en-US") : "0", caption: peakCaption(period, a.peak?.at ?? null, t, STATION_TZ) },
          { value: Math.round(a.hoursWatched).toLocaleString("en-US"), caption: hoursCaption(period, radio, t, STATION_TZ) },
          { value: a.presetCount.toLocaleString("en-US"), caption: `${radio ? "Listeners" : "Viewers"} with ${name} as a preset` }
        ]}
      />
      {chart}
      <div className="cc-aud__split">
        <Section title="By program" sub={periodWord}>
          {programs ? (
            programs.length > 0 ? (
              <Table
                label={`By program, ${periodWord.toLowerCase()}`}
                columns={columns}
                rows={programs.map((p, i) => ({ ...p, time: times[i] }))}
                rowKey={(r) => r.key}
                rowMark={(r) => (r.onNow ? "now" : undefined)}
                inlineDetail
              />
            ) : (
              <p className="cc-aud__empty">Nothing has aired yet {tonight ? "tonight" : period === "week" ? "this week" : "this month"}.</p>
            )
          ) : (
            <KeyValueList variant="rows" items={a.stayedToTheEnd.map((x) => ({ title: x.title, detail: "Stayed to the end", value: pct(x.percent) }))} />
          )}
        </Section>
        <Section title="Watching on">
          <SplitBar variant="stacked" className="cc-aud__bar" label={PLATFORMS.map((p, i) => `${p.label} ${shares[i]}%`).join(", ")} parts={PLATFORMS.map((p) => ({ label: p.label, amount: a.byPlatform[p.key] }))} />
          <KeyValueList variant="rows" items={watchingOn} />
        </Section>
      </div>
    </div>
  );
}
