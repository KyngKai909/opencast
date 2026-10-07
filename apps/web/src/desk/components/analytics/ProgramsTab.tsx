// Ref. 12d, 05 Programs and breaks (A251): what holds people, and what loses them. Programs across
// every station that aired them, carried airings added in; selecting one shows how many of those
// there at the start were still watching at each minute, its breaks marked. Beside it, breaks across
// the network: how many sessions stay through one, by length, by where it sits and by what opens it.

import { useState } from "react";
import { analyticsApi, type AnalyticsBreakHold, type AnalyticsProgram, type AnalyticsPrograms, type AnalyticsQuery } from "@opencast/contracts";
import { useApi } from "../../../api/hooks";
import { ErrorLine, Quiet } from "../../pages/common";
import { csv, download, num, type Span } from "./span";

type Sort = "hours" | "stayed" | "nfm";
const SORTS: ReadonlyArray<{ key: Sort; label: string; value: (p: AnalyticsProgram) => number }> = [
  { key: "hours", label: "Hours", value: (p) => p.hours },
  { key: "stayed", label: "Stayed", value: (p) => p.stayedToTheEnd ?? -1 },
  { key: "nfm", label: "Not for me", value: (p) => p.notForMePer1000Hours ?? -1 }
];
const LENGTHS: Record<string, string> = { "30": "0:30", "60": "1:00", "90": "1:30", "120": "2:00", "150_plus": "2:30+" };
const POSITIONS: Record<string, string> = { opening: "Opening a program’s slot", inside: "Inside a program", between: "Between programs" };
const FIRSTS: Record<string, string> = { bumper: "Opens with a bumper", spot: "Opens with a spot", sponsor: "Opens with a sponsor", station_id: "Opens with the station ID", other: "Opens with something else" };

/** "Also on SAZN and HALL", "Live, also on CRAT", "On OCAT, CIVC and PREP", "Claimable station". */
export function programLine(p: AnalyticsProgram): string {
  const names = (list: AnalyticsProgram["stations"]) => {
    const n = list.map((s) => s.callSign ?? s.name);
    return n.length <= 1 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
  };
  const others = p.stations.filter((s) => s.id !== p.maker?.id);
  if (p.catalog) return p.stations.length ? `On ${names(p.stations)}` : "Opencast catalog";
  if (p.live) return others.length ? `Live, also on ${names(others)}` : "Live";
  if (others.length) return `Also on ${names(others)}`;
  if (p.maker?.kind === "claimable") return "Claimable station";
  return "";
}

export function ProgramsTab({ query, span, exporter }: { query: AnalyticsQuery; span: Span; exporter: { current: (() => void) | null } }) {
  const q = useApi(analyticsApi.programs, { query });
  const [sort, setSort] = useState<Sort>("hours");
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  if (q.isLoading) return <Quiet />;
  if (q.error || !q.data) return <ErrorLine error={q.error} />;
  const d = q.data;
  const by = SORTS.find((s) => s.key === sort)!;
  const sorted = [...d.programs].sort((a, b) => by.value(b) - by.value(a) || b.hours - a.hours);
  const shown = all ? sorted : sorted.slice(0, 10);
  const selected = d.programs.find((p) => p.programId === picked) ?? sorted[0] ?? null;
  exporter.current = () => download(`opencast-programs-${span.from.toISOString().slice(0, 10)}.csv`, programsCsv(d));
  return (
    <>
      <section className="nd-an__card nd-an__card--full" aria-labelledby="pr-programs">
        <header className="nd-an__card-head">
          <div>
            <h2 id="pr-programs">Programs</h2>
            <p>
              Every airing added up, carried ones included. {all ? `All ${d.programs.length}` : `Top ${Math.min(10, d.programs.length)}`} by {by.label.toLowerCase()}.
            </p>
          </div>
          <div className="nd-an__seg nd-an__seg--sm" role="group" aria-label="Sort programs by">
            {SORTS.map((s) => (
              <button key={s.key} type="button" aria-pressed={sort === s.key} onClick={() => setSort(s.key)}>
                {s.label}
              </button>
            ))}
          </div>
        </header>
        <div className="nd-an__t" role="table" aria-label="Programs across stations">
          <div className="nd-an__th nd-an__pg" role="row">
            <span role="columnheader">#</span>
            <span role="columnheader">Program</span>
            <span role="columnheader">From</span>
            <span role="columnheader" className="n">
              Stations
            </span>
            <span role="columnheader" className="n">
              Airings
            </span>
            <span role="columnheader" className={`n${sort === "hours" ? " on" : ""}`}>
              Hours
            </span>
            <span role="columnheader" className="n">
              Avg
            </span>
            <span role="columnheader" className={sort === "stayed" ? "on" : undefined}>
              Stayed to the end
            </span>
            <span role="columnheader" className={`n${sort === "nfm" ? " on" : ""}`}>
              Not for me
            </span>
          </div>
          {shown.map((p, i) => (
            <div key={p.programId} className={`nd-an__tr nd-an__pg${selected?.programId === p.programId ? " nd-an__sel" : ""}`} role="row">
              <span className="nd-an__q" role="cell">
                {i + 1}
              </span>
              <span className="nd-an__prog" role="cell">
                <button type="button" className="nd-an__pick-row" aria-pressed={selected?.programId === p.programId} onClick={() => setPicked(p.programId)}>
                  {p.title}
                </button>
                <small>{programLine(p)}</small>
              </span>
              <span role="cell" className="nd-an__from">
                {p.catalog ? "Opencast catalog" : p.maker ? `${p.maker.callSign ?? p.maker.name} ${p.maker.channel ?? ""}`.trim() : "—"}
              </span>
              <span className="n" role="cell">
                {p.stations.length}
              </span>
              <span className="n" role="cell">
                {num(p.airings)}
              </span>
              <span className="n" role="cell">
                {num(p.hours)}
              </span>
              <span className="n" role="cell">
                {num(p.averageTunedIn)}
              </span>
              <span role="cell" className="nd-an__shbw">
                {p.stayedToTheEnd == null ? (
                  <span className="nd-an__q">{p.underMinimum ? "Under the minimum" : "—"}</span>
                ) : (
                  <>
                    <span className="nd-an__shb" aria-hidden="true">
                      <i style={{ width: `${p.stayedToTheEnd}%` }} />
                    </span>
                    <span>{p.stayedToTheEnd}%</span>
                  </>
                )}
              </span>
              <span className="n" role="cell">
                {num(p.notForMePer1000Hours, { tenths: true })}
              </span>
            </div>
          ))}
          {!d.programs.length && <p className="nd-an__none">No programs aired in this view.</p>}
        </div>
        {d.programs.length > 10 && (
          <button type="button" className="nd-an__chip nd-an__more" onClick={() => setAll(!all)}>
            {all ? "Top 10" : `All ${d.programs.length} programs`}
          </button>
        )}
      </section>

      <div className="nd-an__grid nd-an__mt">
        {selected ? <StillWatching program={selected} query={query} /> : <section className="nd-an__card" />}
        <Breaks b={d.breaks} />
      </div>
    </>
  );
}

function StillWatching({ program, query }: { program: AnalyticsProgram; query: AnalyticsQuery }) {
  const q = useApi(analyticsApi.program, { params: { programId: program.programId }, query });
  const d = q.data;
  return (
    <section className="nd-an__card" aria-labelledby="pr-still">
      <header className="nd-an__card-head">
        <div>
          <h2 id="pr-still">{program.title}, still watching</h2>
          <p>
            {num(program.airings)} {program.airings === 1 ? "airing" : "airings"} on {program.stations.length} {program.stations.length === 1 ? "station" : "stations"}
          </p>
        </div>
        <span className="nd-an__legend nd-an__legend--top">
          <span>
            <i className="nd-an__dot nd-an__brk" />
            Breaks
          </span>
        </span>
      </header>
      {q.isLoading ? (
        <Quiet />
      ) : q.error || !d ? (
        <ErrorLine error={q.error} />
      ) : (
        <>
          <Curve values={d.stillWatching} breaks={d.breaks} label={`${program.title}: the share of the first minute's sessions still watching, minute by minute`} />
          <h3 className="nd-an__flowh nd-an__mt">Tuned away, by minute</h3>
          <div className="nd-an__away" aria-label="Sessions that tuned away at each minute" role="img">
            {d.tuneAways.map((n, i) => (
              <i key={i} style={{ height: `${(n / Math.max(1, ...d.tuneAways)) * 100}%` }} title={`Minute ${i}: ${n}`} />
            ))}
          </div>
          <p className="nd-an__note">The line is the share of each airing&rsquo;s first-minute audience still there.</p>
          <ul className="nd-an__rows nd-an__rows--kv">
            <li>
              <span>
                At the first minute <small className="nd-an__q">All airings added up</small>
              </span>
              <b>{num(d.atStart)}</b>
              <span className="nd-an__q">sessions</span>
            </li>
            <li>
              <span>Still there at the last</span>
              <b>{d.atStart ? `${Math.round((d.stillAtEnd / d.atStart) * 100)}%` : "—"}</b>
              <span className="nd-an__q">{num(d.stillAtEnd)}</span>
            </li>
            <li>
              <span>
                Biggest drop <small className="nd-an__q">{d.biggestDrop ? (d.biggestDrop.inBreak ? `The break at minute ${d.biggestDrop.minute}` : `Minute ${d.biggestDrop.minute}`) : "None"}</small>
              </span>
              <b className={d.biggestDrop ? "nd-an__neg" : undefined}>{d.biggestDrop ? `−${num(d.biggestDrop.points, { tenths: true })} pts` : "—"}</b>
              <span />
            </li>
          </ul>
        </>
      )}
    </section>
  );
}

/** The still-watching line: 0 to 100% up the side, minutes along, breaks as bands. */
function Curve({ values, breaks, label }: { values: number[]; breaks: Array<{ from: number; to: number }>; label: string }) {
  const W = 560;
  const H = 200;
  const L = 36;
  const B = 22;
  const n = Math.max(1, values.length - 1);
  const x = (m: number) => L + (m / n) * (W - L - 8);
  const y = (v: number) => 8 + (1 - v / 100) * (H - B - 8);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const step = n > 120 ? 30 : n > 60 ? 15 : 10;
  const last = values[values.length - 1] ?? 0;
  return (
    <figure className="nd-an__curve">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {breaks.map((b, i) => (
          <rect key={i} x={x(b.from)} y={8} width={Math.max(2, x(b.to) - x(b.from))} height={H - B - 8} className="nd-an__brk" />
        ))}
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - 8} y1={y(v)} y2={y(v)} className="oc-chart__grid" />
            <text x={0} y={y(v) + 4} className="oc-chart__axis">
              {v}%
            </text>
          </g>
        ))}
        {Array.from({ length: Math.floor(n / step) + 1 }, (_, i) => i * step).map((m) => (
          <text key={m} x={x(m)} y={H - 4} className="oc-chart__axis" textAnchor="middle">
            {m}
          </text>
        ))}
        <polyline points={points} fill="none" stroke="var(--main)" strokeWidth="2" strokeLinejoin="round" />
        <circle cx={x(values.length - 1)} cy={y(last)} r="3" fill="var(--main)" />
        <text x={x(values.length - 1) - 6} y={y(last) - 8} className="oc-chart__label" textAnchor="end">
          {Math.round(last)}% at the end
        </text>
      </svg>
    </figure>
  );
}

function Breaks({ b }: { b: AnalyticsPrograms["breaks"] }) {
  const bumper = b.byFirst.find((f) => f.first === "bumper");
  const spot = b.byFirst.find((f) => f.first === "spot");
  const diff = bumper?.held != null && spot?.held != null ? Math.round((bumper.held - spot.held) * 10) / 10 : null;
  return (
    <section className="nd-an__card" aria-labelledby="pr-breaks">
      <header className="nd-an__card-head">
        <div>
          <h2 id="pr-breaks">Breaks: how many stay</h2>
          <p>Share still there when the break ended</p>
        </div>
      </header>
      {b.all.breaks ? (
        <>
          <div className="nd-an__vbars" role="list" aria-label="Break hold by length">
            {b.byLength.map((l) => (
              <div key={l.band} role="listitem" aria-label={`${LENGTHS[l.band]}: ${l.held == null ? "no breaks" : `${l.held}% stayed`} (${l.breaks} breaks)`}>
                <span className="nd-an__vb-n">{l.held == null ? "—" : `${l.held}%`}</span>
                <span className="nd-an__vb-bar">
                  <i style={{ height: `${l.held ?? 0}%` }} />
                </span>
                <span className="nd-an__vb-l">{LENGTHS[l.band]}</span>
              </div>
            ))}
          </div>
          <h3 className="nd-an__flowh nd-an__mt">By position and first element</h3>
          <ul className="nd-an__rows nd-an__rows--kv">
            {[...b.byPosition.filter((p) => p.breaks).map((p) => ({ key: p.position, label: POSITIONS[p.position]!, h: p as AnalyticsBreakHold })), ...b.byFirst.map((f) => ({ key: f.first, label: FIRSTS[f.first]!, h: f as AnalyticsBreakHold }))].map((row) => (
              <li key={row.key}>
                <span>
                  {row.label} <small className="nd-an__q">{num(row.h.breaks)} breaks</small>
                </span>
                <b>{row.h.held == null ? "—" : `${row.h.held}%`}</b>
                <span>{row.key === "bumper" && diff != null ? <span className={`nd-an__pill ${diff >= 0 ? "up" : "dn"}`}>{`${diff >= 0 ? "+" : "−"}${Math.abs(diff)}`}</span> : null}</span>
              </li>
            ))}
          </ul>
          {diff != null && (
            <p className="nd-an__callout">
              Breaks that open with a bumper keep <b>{Math.abs(diff)} points {diff >= 0 ? "more" : "fewer"}</b> than breaks that open straight into a spot.{b.bumperShare != null ? ` ${b.bumperShare}% of breaks in this span opened with a bumper.` : ""}
            </p>
          )}
        </>
      ) : (
        <p className="nd-an__none">No breaks aired in this view, or none counted yet.</p>
      )}
    </section>
  );
}

function programsCsv(d: AnalyticsPrograms): string {
  const programs = csv(
    ["Program", "From", "Stations", "Airings", "Hours", "Average tuned in", "Stayed to the end %", "Not for me per 1,000 hours"],
    d.programs.map((p) => [p.title, p.catalog ? "Opencast catalog" : p.maker ? `${p.maker.callSign ?? p.maker.name} ${p.maker.channel ?? ""}`.trim() : "", p.stations.map((s) => s.callSign ?? s.name).join(" "), p.airings, p.hours, p.averageTunedIn, p.stayedToTheEnd, p.notForMePer1000Hours])
  );
  const breaks = csv(
    ["Breaks", "Count", "Tuned in at the start", "Still there at the end %"],
    [
      ["All", d.breaks.all.breaks, d.breaks.all.tunedAtStart, d.breaks.all.held],
      ...d.breaks.byLength.map((l): [string, number, number, number | null] => [`Up to ${LENGTHS[l.band]}`, l.breaks, l.tunedAtStart, l.held]),
      ...d.breaks.byPosition.map((p): [string, number, number, number | null] => [POSITIONS[p.position]!, p.breaks, p.tunedAtStart, p.held]),
      ...d.breaks.byFirst.map((f): [string, number, number, number | null] => [FIRSTS[f.first]!, f.breaks, f.tunedAtStart, f.held])
    ]
  );
  return `${programs}\n${breaks}`;
}
