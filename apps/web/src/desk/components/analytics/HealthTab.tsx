// Ref. 12d, 07 Health (A251): how airtime was filled, and what went wrong. The as-run log for every
// station: programs, breaks, live, planned off air, and the fills that cover a mistake (dead-air fill
// and the slate). Beside it, the span's incidents with how many were tuned in, relays, sessions
// filtered as bots, and (A251's addition) how fast channels start. Planned off air isn't a problem.

import { analyticsApi, type AnalyticsHealth, type AnalyticsQuery } from "@opencast/contracts";
import { useApi } from "../../../api/hooks";
import { ErrorLine, Quiet } from "../../pages/common";
import { Pill, StationCell } from "./Overview";
import { clockText, csv, dateOf, download, minutesText, num, shortDate, type Span } from "./span";

const PARTS = [
  { key: "programs", label: "Programs", colour: "var(--c1)" },
  { key: "breaks", label: "Breaks", colour: "var(--c2)" },
  { key: "live", label: "Live", colour: "var(--c3)" },
  { key: "offAir", label: "Planned off air", colour: "var(--card-2)" },
  { key: "deadAirFill", label: "Dead-air fill", colour: "var(--bad)" },
  { key: "slate", label: "Slate", colour: "var(--warnc)" }
] as const;
const KIND: Record<string, string> = { dead_air: "Dead air", slate: "Slate", relay: "Relay", external: "External" };
const REASONS: Record<string, string> = { "beats too close together": "Beats too close together", "media time moving faster than the clock": "Media faster than the clock" };
const seconds = (ms: number | null) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)} s`);

export function HealthTab({ query, span, exporter, stationHref }: { query: AnalyticsQuery; span: Span; exporter: { current: (() => void) | null }; stationHref: (id: string) => string }) {
  const q = useApi(analyticsApi.health, { query });
  if (q.isLoading) return <Quiet />;
  if (q.error || !q.data) return <ErrorLine error={q.error} />;
  const d = q.data;
  exporter.current = () => download(`opencast-health-${span.from.toISOString().slice(0, 10)}.csv`, healthCsv(d));
  const deadAll = d.airtime.reduce((t, a) => t + a.deadAirFill + a.slate, 0);
  return (
    <>
      <div className="nd-an__kps nd-an__kps--5">
        <Kpi label="Dead-air fill" value={minutesText(d.deadAirFill.minutes)} pill={<Pill value={d.deadAirFill.minutes} previous={d.deadAirFill.previous} upIsBad />} note={`${d.deadAirFill.stations} ${d.deadAirFill.stations === 1 ? "station" : "stations"}`} />
        <Kpi label="On the slate" value={minutesText(d.slate.minutes)} pill={<Pill value={d.slate.minutes} previous={d.slate.previous} upIsBad />} note={`${d.slate.stations} ${d.slate.stations === 1 ? "station" : "stations"}`} />
        <Kpi label="Relay drops" value={num(d.relayDrops.drops)} pill={<Pill value={d.relayDrops.drops} previous={d.relayDrops.previous} upIsBad />} note="sessions that ended with an error" />
        <Kpi label="Filtered as bots" value={d.bots.share == null ? "—" : `${d.bots.share}%`} pill={<Pill value={d.bots.share} previous={d.bots.previousShare} upIsBad />} note={`${num(d.bots.sessions)} sessions`} />
        <Kpi label="Press to picture" value={seconds(d.pressToPicture.medianMs)} pill={<Pill value={d.pressToPicture.medianMs} previous={d.pressToPicture.previousMedianMs} upIsBad />} note={d.pressToPicture.p90Ms == null ? "median, since players said" : `median; 90% under ${seconds(d.pressToPicture.p90Ms)}`} />
      </div>

      <section className="nd-an__card nd-an__card--full" aria-labelledby="he-air">
        <header className="nd-an__card-head">
          <div>
            <h2 id="he-air">How each station&rsquo;s airtime was filled</h2>
            <p>Share of the span&rsquo;s minutes, from the as-run log. Right: dead-air fill and slate</p>
          </div>
        </header>
        <div className="nd-an__t" role="table" aria-label="Each station's airtime by kind">
          {d.airtime.map((a) => {
            const total = PARTS.reduce((t, p) => t + a[p.key], 0) || 1;
            const bad = a.deadAirFill + a.slate;
            return (
              <div key={a.station.id} className="nd-an__tr nd-an__airrow" role="row">
                <StationCell station={a.station} href={stationHref(a.station.id)} />
                <span role="cell" className="nd-an__stack nd-an__stack--row" aria-label={PARTS.filter((p) => a[p.key]).map((p) => `${p.label} ${Math.round((a[p.key] / total) * 100)}%`).join(", ")}>
                  {PARTS.map((p) => (a[p.key] ? <i key={p.key} style={{ width: `${(a[p.key] / total) * 100}%`, background: p.colour }} /> : null))}
                </span>
                <span role="cell" className={`n${bad ? " nd-an__neg" : " nd-an__q"}`}>
                  {bad ? minutesText(bad) : "None"}
                </span>
              </div>
            );
          })}
          {!d.airtime.length && <p className="nd-an__none">Nothing in the as-run log for this view.</p>}
          {d.airtime.length > 0 && (
            <div className="nd-an__tr nd-an__airrow nd-an__tot" role="row">
              <span role="cell">All stations</span>
              <span role="cell" />
              <span role="cell" className={`n${deadAll ? " nd-an__neg" : ""}`}>
                {deadAll ? minutesText(deadAll) : "None"}
              </span>
            </div>
          )}
        </div>
        <p className="nd-an__legend">
          {PARTS.map((p) => (
            <span key={p.key}>
              <i className="nd-an__dot" style={{ background: p.colour }} />
              {p.label}
            </span>
          ))}
        </p>
        {d.externalDown.length > 0 && (
          <p className="nd-an__note">
            {d.externalDown.map((x) => `${x.station.callSign ?? x.station.name}`).join(", ")} {d.externalDown.length === 1 ? "plays its own stream" : "play their own streams"}, so {d.externalDown.length === 1 ? "it isn't" : "they aren't"} in the as-run log. Time down is under Incidents.
          </p>
        )}
      </section>

      <div className="nd-an__two">
        <section className="nd-an__card" aria-labelledby="he-inc">
          <header className="nd-an__card-head">
            <div>
              <h2 id="he-inc">Incidents</h2>
              <p>This span, newest last</p>
            </div>
          </header>
          <ol className="nd-an__incidents">
            {d.incidents.map((i, n) => (
              <li key={`${i.at}-${n}`}>
                <span className="nd-an__q nd-an__when">
                  {shortDate(dateOf(new Date(i.at)))}
                  <br />
                  {clockText(new Date(i.at))}
                </span>
                <span>
                  <b>
                    {i.station.callSign ?? i.station.name} {i.station.channel}: {incidentTitle(i)}
                  </b>
                  <small>{incidentLine(i)}</small>
                </span>
                <span className={`nd-an__pill ${i.kind === "relay" || i.kind === "external" ? "ex" : "warn"}`}>{KIND[i.kind]}</span>
              </li>
            ))}
            {!d.incidents.length && <li className="nd-an__none">Nothing went wrong in this span.</li>}
          </ol>
        </section>
        <div className="nd-an__side">
          <section className="nd-an__card" aria-labelledby="he-relays">
            <header className="nd-an__card-head">
              <div>
                <h2 id="he-relays">Relays</h2>
                <p>
                  {d.relays.stations} {d.relays.stations === 1 ? "station" : "stations"} relaying
                </p>
              </div>
            </header>
            <ul className="nd-an__rows nd-an__rows--kv">
              <li>
                <span>Relay sessions</span>
                <b>{num(d.relays.sessions)}</b>
                <span />
              </li>
              <li>
                <span>
                  Dropped <small className="nd-an__q">Ended with an error</small>
                </span>
                <b className={d.relays.drops ? "nd-an__neg" : undefined}>{num(d.relays.drops)}</b>
                <span />
              </li>
              <li>
                <span>
                  Relay hours <small className="nd-an__q">All platforms, never billed</small>
                </span>
                <b>{num(d.relays.hours)}</b>
                <span />
              </li>
            </ul>
          </section>
          <section className="nd-an__card" aria-labelledby="he-bots">
            <header className="nd-an__card-head">
              <div>
                <h2 id="he-bots">Filtered as bots</h2>
                <p>
                  {num(d.bots.sessions)} sessions{d.bots.share == null ? "" : `, ${d.bots.share}% of all`}
                </p>
              </div>
            </header>
            <ul className="nd-an__rows">
              {d.botReasons.map((r) => (
                <li key={r.reason}>
                  <span>{REASONS[r.reason] ?? r.reason}</span>
                  <b>{num(r.sessions)}</b>
                  <span className="nd-an__q">{Math.round(r.share)}%</span>
                </li>
              ))}
              {!d.botReasons.length && <li className="nd-an__none">None filtered in this span.</li>}
            </ul>
          </section>
          <section className="nd-an__card" aria-labelledby="he-slow">
            <header className="nd-an__card-head">
              <div>
                <h2 id="he-slow">Slowest to start</h2>
                <p>Press to picture, the median</p>
              </div>
            </header>
            <ul className="nd-an__rows">
              {d.slowest.map((s) => (
                <li key={s.station.id}>
                  <span>
                    {s.station.callSign ?? s.station.name} <span className="nd-an__q">{s.station.channel}</span>
                  </span>
                  <b>{seconds(s.medianMs)}</b>
                  <span className="nd-an__q">{s.p90Ms == null ? "" : seconds(s.p90Ms)}</span>
                </li>
              ))}
              {!d.slowest.length && <li className="nd-an__none">Not enough sessions that say yet.</li>}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}

function incidentTitle(i: AnalyticsHealth["incidents"][number]): string {
  if (i.kind === "dead_air") return `dead air, ${minutesText(i.minutes)}`;
  if (i.kind === "slate") return `on the slate, ${minutesText(i.minutes)}`;
  if (i.kind === "relay") return "relay dropped";
  return `source unreachable${i.minutes ? `, ${minutesText(i.minutes)}` : ""}`;
}

function incidentLine(i: AnalyticsHealth["incidents"][number]): string {
  const tuned = i.tunedIn == null ? "" : ` ${num(i.tunedIn)} tuned in.`;
  if (i.kind === "dead_air") return `Nothing was scheduled, so playout filled it from the library.${tuned}`;
  if (i.kind === "slate") return `Something wasn't ready, so the slate showed.${tuned}`;
  if (i.kind === "relay") return i.detail ?? "The relay session ended with an error.";
  return `${i.detail ? `${i.detail}. ` : ""}Hidden from the dial after 5 minutes.${tuned}`;
}

function Kpi({ label, value, pill, note }: { label: string; value: string; pill: React.ReactNode; note: string }) {
  return (
    <div className="nd-an__kp">
      <span className="nd-an__kp-l">{label}</span>
      <b className="nd-an__kp-v">{value}</b>
      <span className="nd-an__kp-c">
        {pill}
        <span className="nd-an__q">{note}</span>
      </span>
    </div>
  );
}

function healthCsv(d: AnalyticsHealth): string {
  const air = csv(["Station", "Programs (min)", "Breaks", "Live", "Planned off air", "Dead-air fill", "Slate"], d.airtime.map((a) => [`${a.station.callSign ?? a.station.name} ${a.station.channel ?? ""}`.trim(), a.programs, a.breaks, a.live, a.offAir, a.deadAirFill, a.slate]));
  const inc = csv(["When", "Station", "Kind", "Minutes", "Tuned in", "Detail"], d.incidents.map((i) => [i.at, `${i.station.callSign ?? i.station.name} ${i.station.channel ?? ""}`.trim(), KIND[i.kind] ?? i.kind, i.minutes, i.tunedIn, i.detail]));
  const bots = csv(["Bot reason", "Sessions", "Share %"], d.botReasons.map((r) => [r.reason, r.sessions, r.share]));
  return [air, inc, bots].join("\n");
}
