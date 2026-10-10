// Ref. 12d, 01 Overview (A251): the network over the span against the span before. Five numbers
// with their change and trend (and devices, the user's addition), tuned in at once hour by hour,
// where people watched, the stations that made up the total, where they are, and relays apart.

import type { AnalyticsOverview, AnalyticsStation } from "@opencast/contracts";
import { LineChart, Tag } from "@opencast/ui";
import { PLATFORMS, change, clockText, csv, download, minutesText, num, type Span } from "./span";

export function Overview({ data, span, exporter, onAllStations, stationHref }: { data: AnalyticsOverview; span: Span; exporter: { current: (() => void) | null }; onAllStations: () => void; stationHref: (id: string) => string }) {
  const d = data;
  exporter.current = () => download(`opencast-overview-${span.from.toISOString().slice(0, 10)}.csv`, overviewCsv(d));
  const peakAt = d.peakTunedIn.at ? new Date(d.peakTunedIn.at) : null;
  const totalHours = d.stations.reduce((s, r) => s + r.hours, 0);
  const placesTotal = d.places.reduce((s, p) => s + p.hours, 0);
  const surfaces = d.platforms.filter((p) => p.hours > 0);
  const surfaceTotal = surfaces.reduce((s, p) => s + p.hours, 0);
  const top = d.stations.slice(0, 7);
  const lead = top[0]?.hours ?? 0;
  return (
    <>
      <div className="nd-an__kps">
        <Kpi label="Hours watched" value={num(d.hoursWatched.value)} m={d.hoursWatched} vs={`vs ${num(d.hoursWatched.previous)}`} />
        <Kpi label="Average tuned in" value={num(d.averageTunedIn.value)} m={d.averageTunedIn} vs={`vs ${num(d.averageTunedIn.previous)}`} />
        <Kpi label="Peak tuned in" value={num(d.peakTunedIn.value)} m={d.peakTunedIn} vs={peakAt ? `${peakAt.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/Los_Angeles" })} ${clockText(peakAt)}` : "—"} />
        <Kpi label="Sessions" value={num(d.sessions.value)} m={d.sessions} vs={d.sessions.value || d.sessions.botsFiltered ? `${((d.sessions.botsFiltered / ((d.sessions.value ?? 0) + d.sessions.botsFiltered || 1)) * 100).toFixed(1)}% bots filtered` : ""} />
        <Kpi label="Median session" value={d.medianSessionMinutes.value == null ? "—" : `${num(d.medianSessionMinutes.value)}`} unit={d.medianSessionMinutes.value == null ? undefined : "min"} m={d.medianSessionMinutes} vs={d.medianSessionMinutes.previous == null ? "" : `vs ${minutesText(d.medianSessionMinutes.previous)}`} />
        <Kpi label="Devices" value={num(d.devices.value)} m={d.devices} vs={d.devices.value == null ? "Up to 30 days" : `vs ${num(d.devices.previous)}`} />
      </div>

      <div className="nd-an__grid">
        <section className="nd-an__card nd-an__card--wide" aria-labelledby="an-tuned">
          <header className="nd-an__card-head">
            <div>
              <h2 id="an-tuned">Tuned in at once</h2>
              <p>
                Every station{d.scope.band === "all" ? "" : ` on the ${d.scope.band === "tv" ? "TV" : "radio"} band`}
                {d.scope.market ? ` in ${d.scope.markets.find((x) => x.id === d.scope.market)?.name ?? "this market"}` : d.scope.band === "all" ? " on Opencast" : ""}, hour by hour
              </p>
            </div>
          </header>
          {d.tunedIn.length ? (
            <LineChart
              from={span.from}
              to={new Date(Math.max(span.from.getTime() + 3_600_000, Math.min(span.to.getTime(), Date.now())))}
              series={d.tunedIn.map((p) => ({ at: p.at, value: p.value }))}
              comparison={d.tunedIn.filter((p) => p.previous != null).map((p) => ({ at: p.at, value: p.previous! }))}
              label="Average tuned in, hour by hour, against the span before"
              seriesLabel={span.key === "today" ? "Today" : "This span"}
              comparisonLabel={span.key === "today" ? "Same day last week" : "The span before"}
              valueLabel="tuned in"
              legend
              height={230}
              now={span.key === "today"}
              timeZone="America/Los_Angeles"
            />
          ) : (
            <p className="nd-an__none">Nobody tuned in yet.</p>
          )}
        </section>

        <section className="nd-an__card" aria-labelledby="an-where">
          <header className="nd-an__card-head">
            <div>
              <h2 id="an-where">Where they watch</h2>
              <p>Share of hours watched</p>
            </div>
          </header>
          {surfaceTotal > 0 ? (
            <>
              <div className="nd-an__stack" aria-hidden="true">
                {surfaces.map((p) => (
                  <i key={p.platform} style={{ width: `${(p.hours / surfaceTotal) * 100}%`, background: PLATFORMS[p.platform]?.colour }} />
                ))}
              </div>
              <ul className="nd-an__rows">
                {surfaces.map((p) => (
                  <li key={p.platform}>
                    <span>
                      <i className="nd-an__dot" style={{ background: PLATFORMS[p.platform]?.colour }} />
                      {PLATFORMS[p.platform]?.label ?? p.platform}
                    </span>
                    <b>{num(p.hours)}</b>
                    <span className="nd-an__q">{Math.round((p.hours / surfaceTotal) * 100)}%</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="nd-an__none">No hours watched in this span.</p>
          )}
        </section>

        <section className="nd-an__card nd-an__card--wide" aria-labelledby="an-stations">
          <header className="nd-an__card-head">
            <div>
              <h2 id="an-stations">Stations</h2>
              <p>
                Top {Math.min(7, d.stations.length)} of {d.stations.length}, by hours watched
              </p>
            </div>
            <button type="button" className="nd-an__chip" onClick={onAllStations}>
              All {d.stations.length} stations
            </button>
          </header>
          <div className="nd-an__t" role="table" aria-label="Top stations by hours watched">
            <div className="nd-an__th nd-an__top" role="row">
              <span role="columnheader">#</span>
              <span role="columnheader">Station</span>
              <span role="columnheader" className="n on">
                Hours
              </span>
              <span role="columnheader" className="n">
                Change
              </span>
              <span role="columnheader">Share of the network</span>
              <span role="columnheader" className="n">
                Share
              </span>
            </div>
            {top.map((r, i) => (
              <div key={r.station.id} className="nd-an__tr nd-an__top" role="row">
                <span className="nd-an__q" role="cell">
                  {i + 1}
                </span>
                <StationCell station={r.station} href={stationHref(r.station.id)} />
                <span className="n" role="cell">
                  {num(r.hours)}
                </span>
                <span className="n" role="cell">
                  <Pill value={r.hours} previous={r.previousHours} />
                </span>
                <span className="nd-an__shb" role="cell" aria-hidden="true">
                  <i style={{ width: `${lead ? (r.hours / lead) * 100 : 0}%` }} />
                </span>
                <span className="n nd-an__q" role="cell">
                  {totalHours ? `${((r.hours / totalHours) * 100).toFixed(1)}%` : "—"}
                </span>
              </div>
            ))}
            {!top.length && <p className="nd-an__none">No stations in this view.</p>}
          </div>
        </section>

        <div className="nd-an__side">
          <section className="nd-an__card" aria-labelledby="an-places">
            <header className="nd-an__card-head">
              <div>
                <h2 id="an-places">Where they are</h2>
                <p>Hours, by market</p>
              </div>
            </header>
            <ul className="nd-an__rows">
              {d.places.map((p) => (
                <li key={p.market?.id ?? "none"}>
                  <span>{p.market?.name ?? "Outside any market"}</span>
                  <b>{num(p.hours)}</b>
                  <span className="nd-an__q">{placesTotal ? `${Math.round((p.hours / placesTotal) * 100)}%` : ""}</span>
                </li>
              ))}
              {!d.places.length && <li className="nd-an__none">No hours watched in this span.</li>}
            </ul>
          </section>
          <section className="nd-an__card" aria-labelledby="an-apart">
            <header className="nd-an__card-head">
              <div>
                <h2 id="an-apart">Counted apart</h2>
                <p>Not in any number above</p>
              </div>
            </header>
            <ul className="nd-an__rows">
              {d.relays.map((r) => (
                <li key={`${r.station.id}-${r.platform}`}>
                  <span>
                    {r.station.callSign ?? r.station.name} on {r.platform === "youtube" ? "YouTube" : "Twitch"}
                  </span>
                  <b>{num(r.averageViewers)}</b>
                  <span className="nd-an__q">avg</span>
                </li>
              ))}
              {!d.relays.length && <li className="nd-an__none">No relays in this span.</li>}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}

function Kpi({ label, value, unit, m, vs }: { label: string; value: string; unit?: string; m: { value: number | null; previous: number | null; byDay: number[] }; vs: string }) {
  return (
    <div className="nd-an__kp">
      <span className="nd-an__kp-l">{label}</span>
      <b className="nd-an__kp-v">
        {value}
        {unit && <small> {unit}</small>}
      </b>
      <span className="nd-an__kp-c">
        <Pill value={m.value} previous={m.previous} />
        <span className="nd-an__q">{vs}</span>
      </span>
      <Spark values={m.byDay} />
    </div>
  );
}

/** "↑ 14%" against the span before; "New" with nothing before. `upIsBad` for a cost: up is red. */
export function Pill({ value, previous, upIsBad }: { value: number | null; previous: number | null; upIsBad?: boolean }) {
  const c = change(value, previous);
  if (!c) return previous == null && value ? <span className="nd-an__pill ne">New</span> : <span className="nd-an__pill ne">—</span>;
  const look = upIsBad && c.dir !== "fl" ? (c.dir === "up" ? "dn" : "up") : c.dir;
  return (
    <span className={`nd-an__pill ${look}`} aria-label={c.dir === "fl" ? "No change" : `${c.dir === "up" ? "Up" : "Down"} ${c.text.slice(2)} on the span before`}>
      {c.text}
    </span>
  );
}

/** A day-by-day line (the reference's sparkline), its last point marked. */
export function Spark({ values, width = 120, height = 28 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <span className="nd-an__spark" style={{ height }} />;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const x = (i: number) => 2 + (i * (width - 4)) / (values.length - 1);
  const y = (v: number) => height - 3 - ((v - min) / (max - min || 1)) * (height - 6);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg className="nd-an__spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <polyline points={points} fill="none" stroke="var(--main)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1]!)} r="2.5" fill="var(--main)" />
    </svg>
  );
}

/** The station's channel badge in its colour, call sign and name. */
export function StationCell({ station, tags, href }: { station: AnalyticsStation; tags?: boolean; href?: string }) {
  return (
    <div className="nd-an__stn" role="cell">
      <span className="nd-an__badge" style={station.colour ? { background: station.colour } : undefined}>
        {station.channel ?? "—"}
      </span>
      <div>
        <b>
          {href ? (
            <a href={href} className="nd-an__stlink">
              {station.callSign ?? station.name}
            </a>
          ) : (
            (station.callSign ?? station.name)
          )}
          {tags && station.kind === "external" && (
            <Tag variant="listed" className="nd-an__tag">
              External
            </Tag>
          )}
          {tags && station.kind === "claimable" && <span className="nd-an__pill cl nd-an__tag">Claimable</span>}
          {tags && station.kind === "catalog" && <span className="nd-an__pill ex nd-an__tag">Catalog</span>}
        </b>
        <small>{station.name}</small>
      </div>
    </div>
  );
}

function overviewCsv(d: AnalyticsOverview): string {
  const head = ["Measure", "Value", "Before"];
  const rows: Array<Array<string | number | null>> = [
    ["Hours watched", d.hoursWatched.value, d.hoursWatched.previous],
    ["Average tuned in", d.averageTunedIn.value, d.averageTunedIn.previous],
    ["Peak tuned in", d.peakTunedIn.value, d.peakTunedIn.previous],
    ["Sessions", d.sessions.value, d.sessions.previous],
    ["Bots filtered", d.sessions.botsFiltered, null],
    ["Median session (min)", d.medianSessionMinutes.value, d.medianSessionMinutes.previous],
    ["Devices", d.devices.value, d.devices.previous],
    ...d.platforms.map((p): [string, number, null] => [`Hours on ${PLATFORMS[p.platform]?.label ?? p.platform}`, p.hours, null]),
    ...d.places.map((p): [string, number, null] => [`Hours in ${p.market?.name ?? "no market"}`, p.hours, null]),
    ...d.stations.map((s): [string, number, number | null] => [`Hours on ${s.station.callSign ?? s.station.name} ${s.station.channel ?? ""}`.trim(), s.hours, s.previousHours])
  ];
  return csv(head, rows) + "\n" + csv(["Hour", "Tuned in", "Before"], d.tunedIn.map((p) => [p.at, p.value, p.previous]));
}
