// Ref. 12d, 04 Audience (A251): when, how long, on what, and from where. The week as an hour-by-day
// grid, how long sessions last, presets, surfaces and relays day by day, and how people move around
// the dial; with A251's additions, devices and how people tuned in. Pick a station at the top and
// every chart narrows to it.

import { analyticsApi, type AnalyticsAudience, type AnalyticsAudienceQuery } from "@opencast/contracts";
import { useApi } from "../../../api/hooks";
import { ErrorLine, Quiet } from "../../pages/common";
import { Pill, StationCell } from "./Overview";
import { PLATFORMS, csv, download, num, type Span } from "./span";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const BANDS: Record<string, string> = { "1_2": "1–2 min", "2_5": "2–5", "5_15": "5–15", "15_30": "15–30", "30_60": "30–60", "60_120": "1–2 h", "120_plus": "2 h+" };
const VIA: Record<string, string> = {
  swipe: "Swipe",
  channel: "Channel up and down",
  keypad: "A number",
  guide: "The guide",
  search: "Search",
  link: "A link",
  preset: "A preset",
  last: "Last channel",
  remote: "A phone remote or Cast",
  reminder: "A reminder",
  resume: "The app starting",
  dial: "Picked from a list",
  suggestion: "Suggested on screen",
  unknown: "Not said (older players)"
};

const hourText = (h: number) => (h === 0 ? "12 am" : h < 12 ? `${h} am` : h === 12 ? "12 pm" : `${h - 12} pm`);
const dayText = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" });

export function AudienceTab({ query, span, exporter, stationHref }: { query: AnalyticsAudienceQuery; span: Span; exporter: { current: (() => void) | null }; stationHref: (id: string) => string }) {
  const q = useApi(analyticsApi.audience, { query });
  if (q.isLoading) return <Quiet />;
  if (q.error || !q.data) return <ErrorLine error={q.error} />;
  const d = q.data;
  exporter.current = () => download(`opencast-audience-${span.from.toISOString().slice(0, 10)}.csv`, audienceCsv(d));
  const who = d.station ? `${d.station.callSign ?? d.station.name} ${d.station.channel ?? ""}`.trim() : "All stations";
  return (
    <>
      <Grid d={d} who={who} span={span} />
      <div className="nd-an__three">
        <Lengths d={d} />
        <section className="nd-an__card" aria-labelledby="au-sessions">
          <header className="nd-an__card-head">
            <div>
              <h2 id="au-sessions">Sessions</h2>
              <p>Counted once a player advances</p>
            </div>
          </header>
          <ul className="nd-an__rows nd-an__rows--kv">
            <li>
              <span>Sessions</span>
              <b>{num(d.sessions.value)}</b>
              <span>
                <Pill value={d.sessions.value} previous={d.sessions.previous} />
              </span>
            </li>
            <li>
              <span>Median length</span>
              <b>{d.medianMinutes == null ? "—" : `${num(d.medianMinutes)} min`}</b>
              <span />
            </li>
            <li>
              <span>Average length</span>
              <b>{d.averageMinutes == null ? "—" : `${num(d.averageMinutes)} min`}</b>
              <span />
            </li>
            <li>
              <span>
                Stations per visit <small className="nd-an__q">A tab or TV app, each change counted</small>
              </span>
              <b>{d.stationsPerVisit == null ? "—" : num(d.stationsPerVisit, { tenths: true })}</b>
              <span />
            </li>
            <li>
              <span>
                Came from another station <small className="nd-an__q">Of every tune-in</small>
              </span>
              <b>{d.cameFromAnotherStation == null ? "—" : `${d.cameFromAnotherStation}%`}</b>
              <span />
            </li>
            <li>
              <span>Filtered as bots</span>
              <b>{num(d.bots.sessions)}</b>
              <span className="nd-an__q">{d.bots.share == null ? "" : `${d.bots.share}%`}</span>
            </li>
          </ul>
        </section>
        <section className="nd-an__card" aria-labelledby="au-presets">
          <header className="nd-an__card-head">
            <div>
              <h2 id="au-presets">Presets</h2>
              <p>Stations saved to a phone or TV</p>
            </div>
          </header>
          <p className="nd-an__big">
            {num(d.presets.total)} <small>saved, +{num(d.presets.added)} in this span</small>
          </p>
          <div className="nd-an__t" role="table" aria-label="Presets by station">
            {d.presets.stations.map((p) => (
              <div key={p.station.id} className="nd-an__tr nd-an__pre" role="row">
                <StationCell station={p.station} href={stationHref(p.station.id)} />
                <span className="n" role="cell">
                  {num(p.total)}
                </span>
                <span className="n nd-an__q" role="cell">
                  +{num(p.added)}
                </span>
              </div>
            ))}
            {!d.presets.stations.length && <p className="nd-an__none">No presets saved.</p>}
          </div>
        </section>
      </div>

      <div className="nd-an__two">
        <section className="nd-an__card" aria-labelledby="au-days">
          <header className="nd-an__card-head">
            <div>
              <h2 id="au-days">Where they watch, day by day</h2>
              <p>Hours</p>
            </div>
          </header>
          <Bars
            label="Hours watched each day, by surface"
            rows={d.platformsByDay.map((r) => ({ day: r.day, parts: (["phone", "web", "tv_app", "cast", "mirror"] as const).map((k) => ({ key: k, value: r[k], colour: PLATFORMS[k]!.colour, label: PLATFORMS[k]!.label })) }))}
          />
          <Legend items={(["phone", "web", "tv_app", "cast", "mirror"] as const).map((k) => ({ label: PLATFORMS[k]!.label, colour: PLATFORMS[k]!.colour }))} />
        </section>
        <section className="nd-an__card" aria-labelledby="au-relays">
          <header className="nd-an__card-head">
            <div>
              <h2 id="au-relays">Relays</h2>
              <p>Average tuned in on each platform, by day</p>
            </div>
            <span className="nd-an__pill ex">Never billed</span>
          </header>
          {d.relays.hours > 0 ? (
            <>
              <Bars
                label="Relays' average viewers each day"
                rows={d.relays.byDay.map((r) => ({
                  day: r.day,
                  parts: [
                    { key: "youtube", value: r.youtube, colour: "var(--c2)", label: "YouTube" },
                    { key: "twitch", value: r.twitch, colour: "var(--c1)", label: "Twitch" }
                  ]
                }))}
              />
              <Legend
                items={[
                  { label: `YouTube, ${d.relays.youtubeStations} ${d.relays.youtubeStations === 1 ? "station" : "stations"}`, colour: "var(--c2)" },
                  { label: `Twitch, ${d.relays.twitchStations} ${d.relays.twitchStations === 1 ? "station" : "stations"}`, colour: "var(--c1)" }
                ]}
              />
              <p className="nd-an__note">
                {num(d.relays.hours)} relay hours{d.relays.shareOfOwn == null ? "" : `, ${num(d.relays.shareOfOwn)}% of Opencast's own`}.
              </p>
            </>
          ) : (
            <p className="nd-an__none">No relays counted in this span.</p>
          )}
        </section>
      </div>

      <div className="nd-an__two">
        <section className="nd-an__card" aria-labelledby="au-devices">
          <header className="nd-an__card-head">
            <div>
              <h2 id="au-devices">Devices</h2>
              <p>Each phone, browser or TV counted once, never a person</p>
            </div>
          </header>
          <p className="nd-an__big">
            {d.devices.value == null ? "—" : num(d.devices.value)} <small>{d.devices.value == null ? "Counted for spans of 30 days or less" : "in this span"}</small> {d.devices.value != null && <Pill value={d.devices.value} previous={d.devices.previous} />}
          </p>
          <ul className="nd-an__rows nd-an__rows--kv">
            <li>
              <span>
                Returning <small className="nd-an__q">Seen in the 30 days before</small>
              </span>
              <b>{d.devices.returningShare == null ? "—" : `${d.devices.returningShare}%`}</b>
              <span />
            </li>
            <li>
              <span>A day, on average</span>
              <b>{d.devices.byDay.length ? num(Math.round(d.devices.byDay.reduce((t, n) => t + n, 0) / d.devices.byDay.length)) : "—"}</b>
              <span />
            </li>
          </ul>
        </section>
        <section className="nd-an__card" aria-labelledby="au-via">
          <header className="nd-an__card-head">
            <div>
              <h2 id="au-via">How people tuned in</h2>
              <p>Of every session, counted since players say</p>
            </div>
          </header>
          <ul className="nd-an__rows">
            {d.via.map((v) => (
              <li key={v.via}>
                <span>{VIA[v.via] ?? v.via}</span>
                <b>{num(v.sessions)}</b>
                <span className="nd-an__q">{v.share}%</span>
              </li>
            ))}
            {!d.via.length && <li className="nd-an__none">No sessions in this span.</li>}
          </ul>
        </section>
      </div>

      <section className="nd-an__card nd-an__card--full nd-an__mt" aria-labelledby="au-moves">
        <header className="nd-an__card-head">
          <div>
            <h2 id="au-moves">Moving around the dial</h2>
            <p>The most common changes from one station to another</p>
          </div>
          {d.cameFromAnotherStation != null && <span className="nd-an__q nd-an__count">{d.cameFromAnotherStation}% of tune-ins came from another station</span>}
        </header>
        <div className="nd-an__t" role="table" aria-label="Changes between stations">
          <div className="nd-an__th nd-an__mv" role="row">
            <span role="columnheader">From</span>
            <span role="columnheader" aria-hidden="true" />
            <span role="columnheader">To</span>
            <span role="columnheader" className="n on">
              Changes
            </span>
            <span role="columnheader">Share of From&rsquo;s changes</span>
          </div>
          {d.moves.map((m) => (
            <div key={`${m.from.id}>${m.to.id}`} className="nd-an__tr nd-an__mv" role="row">
              <StationCell station={m.from} href={stationHref(m.from.id)} />
              <span role="cell" aria-label="to" className="nd-an__q">
                →
              </span>
              <StationCell station={m.to} href={stationHref(m.to.id)} />
              <span className="n" role="cell">
                {num(m.changes)}
              </span>
              <span className="nd-an__shbw" role="cell">
                <span className="nd-an__shb" aria-hidden="true">
                  <i style={{ width: `${Math.min(100, m.shareOfFrom)}%` }} />
                </span>
                <span className="nd-an__q">{Math.round(m.shareOfFrom)}%</span>
              </span>
            </div>
          ))}
          {!d.moves.length && <p className="nd-an__none">No changes between stations in this span.</p>}
        </div>
      </section>
    </>
  );
}

/** The week as a grid: a square per hour per weekday, darker for more tuned in. */
function Grid({ d, who, span }: { d: AnalyticsAudience; who: string; span: Span }) {
  const startDay = (new Date(span.from).getUTCDay() + 6) % 7; // the span's first weekday, Monday 0
  const rows = Array.from({ length: 7 }, (_, i) => (startDay + i) % 7);
  const max = Math.max(1, ...d.grid.map((c) => c.value));
  const shade = (v: number) => (v <= 0 ? 0 : Math.min(7, 1 + Math.floor((v / max) * 6.999)));
  return (
    <section className="nd-an__card nd-an__card--full nd-an__mb" aria-labelledby="au-grid">
      <header className="nd-an__card-head">
        <div>
          <h2 id="au-grid">Average tuned in, by hour and day</h2>
          <p>{who}, in the market&rsquo;s time</p>
        </div>
        <span className="nd-an__scale" aria-hidden="true">
          Fewer
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <i key={n} className={`nd-an__q${n}`} />
          ))}
          {num(Math.round(max))}
        </span>
      </header>
      <table className="nd-an__heat" aria-label="Average tuned in by weekday and hour">
        <thead>
          <tr>
            <th scope="col" />
            {Array.from({ length: 24 }, (_, h) => (
              <th scope="col" key={h}>
                {h % 3 === 0 ? hourText(h) : <span className="nd-an__sr">{hourText(h)}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((wd) => (
            <tr key={wd}>
              <th scope="row">{WEEKDAYS[wd]}</th>
              {Array.from({ length: 24 }, (_, h) => {
                const c = d.grid.find((x) => x.weekday === wd && x.hour === h)!;
                const tip = `${WEEKDAYS[wd]} ${hourText(h)}: ${num(c.value)} tuned in${c.previous == null ? "" : `, ${num(c.previous)} the span before`}`;
                return (
                  <td key={h} className={`nd-an__q${shade(c.value)}`} title={tip}>
                    <span className="nd-an__sr">{tip}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Lengths({ d }: { d: AnalyticsAudience }) {
  const max = Math.max(1, ...d.lengths.map((l) => l.sessions));
  return (
    <section className="nd-an__card" aria-labelledby="au-len">
      <header className="nd-an__card-head">
        <div>
          <h2 id="au-len">How long sessions last</h2>
          <p>{num(d.sessions.value)} sessions in this span</p>
        </div>
      </header>
      <div className="nd-an__vbars" role="list" aria-label="Sessions by length">
        {d.lengths.map((l) => (
          <div key={l.band} role="listitem" aria-label={`${BANDS[l.band] ?? l.band}: ${num(l.sessions)} sessions, ${Math.round(l.share)}%`}>
            <span className="nd-an__vb-n">{Math.round(l.share)}%</span>
            <span className="nd-an__vb-bar">
              <i style={{ height: `${(l.sessions / max) * 100}%` }} />
            </span>
            <span className="nd-an__vb-l">{BANDS[l.band] ?? l.band}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Stacked bars, one per day. */
function Bars({ rows, label }: { rows: Array<{ day: string; parts: Array<{ key: string; value: number; colour: string; label: string }> }>; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.parts.reduce((t, p) => t + p.value, 0)));
  const many = rows.length > 14;
  return (
    <div className={`nd-an__sbars${many ? " nd-an__sbars--many" : ""}`} role="list" aria-label={label}>
      {rows.map((r) => {
        const total = r.parts.reduce((t, p) => t + p.value, 0);
        return (
          <div key={r.day} role="listitem" aria-label={`${dayText(r.day)}: ${r.parts.map((p) => `${p.label} ${num(p.value)}`).join(", ")}`}>
            <span className="nd-an__sb-bar">
              <span style={{ height: `${(total / max) * 100}%` }}>
                {r.parts.map((p) => (p.value > 0 ? <i key={p.key} style={{ flexGrow: p.value, background: p.colour }} /> : null))}
              </span>
            </span>
            {!many && <span className="nd-an__vb-l">{dayText(r.day)}</span>}
          </div>
        );
      })}
    </div>
  );
}

function Legend({ items }: { items: Array<{ label: string; colour: string }> }) {
  return (
    <p className="nd-an__legend">
      {items.map((i) => (
        <span key={i.label}>
          <i className="nd-an__dot" style={{ background: i.colour }} />
          {i.label}
        </span>
      ))}
    </p>
  );
}

function audienceCsv(d: AnalyticsAudience): string {
  const grid = csv(["Weekday", "Hour", "Average tuned in", "Span before"], d.grid.map((c) => [WEEKDAYS[c.weekday], hourText(c.hour), c.value, c.previous]));
  const lengths = csv(["Session length", "Sessions", "Share %"], d.lengths.map((l) => [BANDS[l.band] ?? l.band, l.sessions, l.share]));
  const sessions = csv(
    ["Measure", "Value"],
    [
      ["Sessions", d.sessions.value],
      ["Median length (min)", d.medianMinutes],
      ["Average length (min)", d.averageMinutes],
      ["Stations per visit", d.stationsPerVisit],
      ["Came from another station %", d.cameFromAnotherStation],
      ["Filtered as bots", d.bots.sessions],
      ["Devices", d.devices.value],
      ["Returning devices %", d.devices.returningShare],
      ["Presets saved", d.presets.total],
      ["Presets added", d.presets.added],
      ["Relay hours", d.relays.hours]
    ]
  );
  const days = csv(["Day", "Phone", "Web", "TV app", "Cast", "iPhone mirror"], d.platformsByDay.map((r) => [r.day, r.phone, r.web, r.tv_app, r.cast, r.mirror]));
  const moves = csv(["From", "To", "Changes", "Share of From's changes %"], d.moves.map((m) => [`${m.from.callSign ?? m.from.name} ${m.from.channel ?? ""}`.trim(), `${m.to.callSign ?? m.to.name} ${m.to.channel ?? ""}`.trim(), m.changes, m.shareOfFrom]));
  const via = csv(["Tuned in by", "Sessions", "Share %"], d.via.map((v) => [VIA[v.via] ?? v.via, v.sessions, v.share]));
  return [grid, lengths, sessions, days, moves, via].join("\n");
}
