// Ref. 12d, 02 Stations (A251): every station in one table, sortable by any column, filtered by
// kind, with the network's row. External stations show what Opencast can count: time down for dead
// air, "Their stream" for earnings. Under the minimum audience, no per-airing numbers.

import { useState } from "react";
import { analyticsApi, type AnalyticsQuery, type AnalyticsStationKind, type AnalyticsStationRow } from "@opencast/contracts";
import { money } from "@opencast/ui";
import { useApi } from "../../../api/hooks";
import { ErrorLine, Quiet } from "../../pages/common";
import { Pill, Spark, StationCell } from "./Overview";
import { csv, download, minutesText, num, type Span } from "./span";

type SortKey = "hours" | "change" | "avg" | "peak" | "stayed" | "nfm" | "presets" | "dead" | "earned";
type Kind = "all" | AnalyticsStationKind;

const KINDS: ReadonlyArray<{ key: Kind; label: string }> = [
  { key: "all", label: "All" },
  { key: "independent", label: "Independent" },
  { key: "claimable", label: "Claimable" },
  { key: "catalog", label: "Catalog" },
  { key: "external", label: "External" }
];

const COLUMNS: ReadonlyArray<{ key: SortKey; label: string; value: (r: AnalyticsStationRow) => number | null }> = [
  { key: "hours", label: "Hours", value: (r) => r.hours },
  { key: "change", label: "Change", value: (r) => (r.previousHours ? (r.hours - r.previousHours) / r.previousHours : null) },
  { key: "avg", label: "Avg", value: (r) => r.averageTunedIn },
  { key: "peak", label: "Peak", value: (r) => r.peakTunedIn },
  { key: "stayed", label: "Stayed", value: (r) => r.stayedToTheEnd },
  { key: "nfm", label: "Not for me", value: (r) => r.notForMePer1000Hours },
  { key: "presets", label: "Presets", value: (r) => r.presets },
  { key: "dead", label: "Dead air", value: (r) => r.deadAirMinutes ?? r.timeDownMinutes },
  { key: "earned", label: "Earned", value: (r) => r.earnedMicros }
];

export function StationsTab({ query, span, exporter }: { query: AnalyticsQuery; span: Span; exporter: { current: (() => void) | null } }) {
  const q = useApi(analyticsApi.stations, { query });
  const [sort, setSort] = useState<SortKey>("hours");
  const [kind, setKind] = useState<Kind>("all");
  if (q.isLoading) return <Quiet />;
  if (q.error || !q.data) return <ErrorLine error={q.error} />;
  const all = q.data.rows;
  const col = COLUMNS.find((c) => c.key === sort)!;
  const rows = all.filter((r) => kind === "all" || r.station.kind === kind).sort((a, b) => (col.value(b) ?? -Infinity) - (col.value(a) ?? -Infinity));
  const t = q.data.total;
  exporter.current = () => download(`opencast-stations-${span.from.toISOString().slice(0, 10)}.csv`, stationsCsv(rows, t));
  const count = (k: Kind) => (k === "all" ? all.length : all.filter((r) => r.station.kind === k).length);
  return (
    <section className="nd-an__card nd-an__card--full" aria-labelledby="an-all">
      <header className="nd-an__card-head">
        <div>
          <h2 id="an-all">
            {all.length} {all.length === 1 ? "station" : "stations"}
          </h2>
          <p>Sorted by {col.label.toLowerCase()}. Select a column to sort by it.</p>
        </div>
        <div className="nd-an__seg nd-an__seg--sm" role="group" aria-label="Kind of station">
          {KINDS.filter((k) => k.key === "all" || count(k.key) > 0).map((k) => (
            <button key={k.key} type="button" aria-pressed={kind === k.key} onClick={() => setKind(k.key)}>
              {k.label} <span className="nd-an__q">{count(k.key)}</span>
            </button>
          ))}
        </div>
      </header>
      <div className="nd-an__t" role="table" aria-label="Every station's span">
        <div className="nd-an__th nd-an__all" role="row">
          <span role="columnheader">Station</span>
          {COLUMNS.map((c) => (
            <span role="columnheader" key={c.key} className="n" aria-sort={sort === c.key ? "descending" : "none"}>
              <button type="button" className={sort === c.key ? "on" : undefined} onClick={() => setSort(c.key)}>
                {c.label}
              </button>
            </span>
          ))}
          <span role="columnheader" className="n">
            By day
          </span>
        </div>
        {rows.map((r) => (
          <div key={r.station.id} className="nd-an__tr nd-an__all" role="row">
            <StationCell station={r.station} tags />
            <span className="n" role="cell">
              {num(r.hours)}
            </span>
            <span className="n" role="cell">
              <Pill value={r.hours} previous={r.previousHours} />
            </span>
            <span className="n" role="cell">
              {num(r.averageTunedIn)}
            </span>
            <span className="n" role="cell">
              {num(r.peakTunedIn)}
            </span>
            {r.underMinimum ? (
              <span className="n nd-an__under" role="cell" style={{ gridColumn: "span 2" }}>
                <span className="nd-an__pill warn">Under the minimum</span>
              </span>
            ) : (
              <>
                <span className="n" role="cell">
                  {r.stayedToTheEnd == null ? "—" : `${r.stayedToTheEnd}%`}
                </span>
                <span className="n" role="cell">
                  {num(r.notForMePer1000Hours, { tenths: true })}
                </span>
              </>
            )}
            <span className="n" role="cell">
              {num(r.presets)}
            </span>
            <span className={`n${(r.deadAirMinutes ?? r.timeDownMinutes ?? 0) > 0 ? " nd-an__neg" : " nd-an__q"}`} role="cell">
              {r.timeDownMinutes != null ? (
                <>
                  {r.timeDownMinutes ? minutesText(r.timeDownMinutes) : "0"}
                  <small>Down</small>
                </>
              ) : r.deadAirMinutes ? (
                minutesText(r.deadAirMinutes)
              ) : (
                "0"
              )}
            </span>
            <span className="n" role="cell">
              {r.earnedMicros == null ? (
                <>
                  None<small>Their stream</small>
                </>
              ) : (
                <>
                  {money(r.earnedMicros)}
                  {r.held && <small>Held</small>}
                </>
              )}
            </span>
            <span role="cell">
              <Spark values={r.byDay} width={80} height={24} />
            </span>
          </div>
        ))}
        {!rows.length && <p className="nd-an__none">No stations of this kind in this view.</p>}
        <div className="nd-an__tr nd-an__all nd-an__tot" role="row">
          <span role="cell">
            All {all.length} {all.length === 1 ? "station" : "stations"}
          </span>
          <span className="n" role="cell">
            {num(t.hours)}
          </span>
          <span className="n" role="cell">
            <Pill value={t.hours} previous={t.previousHours} />
          </span>
          <span className="n" role="cell">
            {num(t.averageTunedIn)}
          </span>
          <span className="n" role="cell">
            {num(t.peakTunedIn)}
          </span>
          <span className="n" role="cell">
            {t.stayedToTheEnd == null ? "—" : `${Math.round(t.stayedToTheEnd)}%`}
          </span>
          <span className="n" role="cell">
            {num(t.notForMePer1000Hours, { tenths: true })}
          </span>
          <span className="n" role="cell">
            {num(t.presets)}
          </span>
          <span className="n" role="cell">
            {t.deadAirMinutes ? minutesText(t.deadAirMinutes) : "0"}
          </span>
          <span className="n" role="cell">
            {money(t.earnedMicros ?? 0)}
          </span>
          <span role="cell">
            <Spark values={t.byDay} width={80} height={24} />
          </span>
        </div>
      </div>
      <p className="nd-an__note">
        Avg and Peak are tuned in at once. Stayed is the share at a program&rsquo;s first minute still there at its last. Not for me is votes per 1,000 hours. The network row&rsquo;s Stayed and Not for me
        are weighted by hours. Earned is after card fees; claimable stations&rsquo; earnings are held in escrow.
      </p>
    </section>
  );
}

function stationsCsv(rows: AnalyticsStationRow[], t: { hours: number; previousHours: number | null; averageTunedIn: number; peakTunedIn: number; sessions: number; presets: number }): string {
  return csv(
    ["Channel", "Call sign", "Name", "Kind", "Market", "Hours", "Hours before", "Average tuned in", "Peak tuned in", "Sessions", "Stayed to the end %", "Not for me per 1,000 hours", "Presets", "Dead air (min)", "Time down (min)", "Earned (USD)", "Under the minimum"],
    [
      ...rows.map((r) => [
        r.station.channel,
        r.station.callSign,
        r.station.name,
        r.station.kind,
        r.station.market?.name ?? "",
        r.hours,
        r.previousHours,
        r.averageTunedIn,
        r.peakTunedIn,
        r.sessions,
        r.stayedToTheEnd,
        r.notForMePer1000Hours,
        r.presets,
        r.deadAirMinutes,
        r.timeDownMinutes,
        r.earnedMicros == null ? null : (r.earnedMicros / 1_000_000).toFixed(2),
        r.underMinimum ? "yes" : "no"
      ]),
      ["", "", "All stations", "", "", t.hours, t.previousHours, t.averageTunedIn, t.peakTunedIn, t.sessions, null, null, t.presets, null, null, null, ""]
    ]
  );
}
