// A251's Growth tab (the user's addition to Ref. 12d): how the network is growing (accounts, stations
// by kind, the creator pipeline, markets, TVs and the phones paired to them, uploads) and what people
// search for, the searches that found nothing first in line for programming. Accounts and TVs are
// Opencast-wide; stations, the pipeline and uploads follow the market and band.

import { analyticsApi, type AnalyticsGrowth, type AnalyticsQuery } from "@opencast/contracts";
import { useApi } from "../../../api/hooks";
import { ErrorLine, Quiet } from "../../pages/common";
import { Pill, Spark } from "./Overview";
import { csv, download, num, type Span } from "./span";

const KINDS: Record<string, string> = { station: "Independent stations", studio: "Studios", claimable: "Claimable stations", catalog: "Catalog stations", listed: "External stations" };
const STAGES: Record<string, string> = { found: "Found", asked: "Asked", said_yes: "Said yes", setting_up: "Setting up", on_air: "On air", claimed: "Claimed", already_licensed: "Already licensed", declined: "Declined", no_answer: "No answer" };
const PLATFORMS: Record<string, string> = { android_tv: "Android TV", fire_tv: "Fire TV", google_tv: "Google TV", tv_browser: "A TV's browser (and Samsung)", web: "TV mode on the web" };

export function GrowthTab({ query, span, exporter }: { query: AnalyticsQuery; span: Span; exporter: { current: (() => void) | null } }) {
  const q = useApi(analyticsApi.growth, { query });
  if (q.isLoading) return <Quiet />;
  if (q.error || !q.data) return <ErrorLine error={q.error} />;
  const d = q.data;
  exporter.current = () => download(`opencast-growth-${span.from.toISOString().slice(0, 10)}.csv`, growthCsv(d));
  const started = Object.values(d.stations.started).reduce((t, n) => t + n, 0);
  const newTvs = d.tvs.new.reduce((t, x) => t + x.tvs, 0);
  const pipelineMax = Math.max(1, ...d.pipeline.byStage.map((s) => s.creators));
  return (
    <>
      <div className="nd-an__kps nd-an__kps--5">
        <div className="nd-an__kp">
          <span className="nd-an__kp-l">New accounts</span>
          <b className="nd-an__kp-v">{num(d.accounts.new)}</b>
          <span className="nd-an__kp-c">
            <Pill value={d.accounts.new} previous={d.accounts.previous} />
            <span className="nd-an__q">Opencast-wide</span>
          </span>
          {d.accounts.byDay.length > 1 && <Spark values={d.accounts.byDay} />}
        </div>
        <Kpi label="Active accounts" value={num(d.accounts.active)} note="seen in this span" />
        <div className="nd-an__kp">
          <span className="nd-an__kp-l">Stations started</span>
          <b className="nd-an__kp-v">{num(started)}</b>
          <span className="nd-an__kp-c">
            <Pill value={started} previous={d.stations.previousStarted} />
            <span className="nd-an__q">{num(d.stations.signedOn)} signed on</span>
          </span>
        </div>
        <div className="nd-an__kp">
          <span className="nd-an__kp-l">Uploads</span>
          <b className="nd-an__kp-v">{num(d.uploads.items)}</b>
          <span className="nd-an__kp-c">
            <Pill value={d.uploads.items} previous={d.uploads.previousItems} />
            <span className="nd-an__q">{num(d.uploads.hours)} hours</span>
          </span>
        </div>
        <Kpi label="TVs registered" value={num(newTvs)} note={`${num(d.tvs.phonesPaired)} phones paired`} />
      </div>

      <div className="nd-an__three">
        <section className="nd-an__card" aria-labelledby="gr-stations">
          <header className="nd-an__card-head">
            <div>
              <h2 id="gr-stations">Stations started</h2>
              <p>By kind, this span</p>
            </div>
          </header>
          <ul className="nd-an__rows">
            {Object.entries(KINDS).map(([k, label]) => (
              <li key={k}>
                <span>{label}</span>
                <b>{num(d.stations.started[k] ?? 0)}</b>
                <span />
              </li>
            ))}
          </ul>
        </section>
        <section className="nd-an__card" aria-labelledby="gr-pipeline">
          <header className="nd-an__card-head">
            <div>
              <h2 id="gr-pipeline">Creator pipeline</h2>
              <p>
                Where every creator stands now; {num(d.pipeline.added)} added this span. {d.markets.open} {d.markets.open === 1 ? "market" : "markets"} open{d.markets.opened ? `, ${d.markets.opened} opened this span` : ""}.
              </p>
            </div>
          </header>
          <div className="nd-an__t" role="table" aria-label="Creators by stage">
            {d.pipeline.byStage.map((s) => (
              <div key={s.stage} className="nd-an__tr nd-an__stage" role="row">
                <span role="cell">{STAGES[s.stage] ?? s.stage}</span>
                <span role="cell" className="nd-an__shb" aria-hidden="true">
                  <i style={{ width: `${(s.creators / pipelineMax) * 100}%` }} />
                </span>
                <span role="cell" className="n">
                  {num(s.creators)}
                </span>
              </div>
            ))}
            {!d.pipeline.byStage.length && <p className="nd-an__none">No creators in the pipeline.</p>}
          </div>
        </section>
        <section className="nd-an__card" aria-labelledby="gr-tvs">
          <header className="nd-an__card-head">
            <div>
              <h2 id="gr-tvs">TVs and phones</h2>
              <p>Registered this span, Opencast-wide</p>
            </div>
          </header>
          <ul className="nd-an__rows">
            {d.tvs.new.map((t) => (
              <li key={t.platform}>
                <span>{PLATFORMS[t.platform] ?? t.platform}</span>
                <b>{num(t.tvs)}</b>
                <span />
              </li>
            ))}
            {!d.tvs.new.length && <li className="nd-an__none">No TVs registered this span.</li>}
            <li>
              <span>
                TVs on in this span <small className="nd-an__q">Any TV seen</small>
              </span>
              <b>{num(d.tvs.active)}</b>
              <span />
            </li>
            <li>
              <span>Phones paired as remotes</span>
              <b>{num(d.tvs.phonesPaired)}</b>
              <span />
            </li>
          </ul>
        </section>
      </div>

      <section className="nd-an__card nd-an__card--full nd-an__mt" aria-labelledby="gr-search">
        <header className="nd-an__card-head">
          <div>
            <h2 id="gr-search">What people search for</h2>
            <p>
              Searches viewers settled on, kept 90 days with nothing about who searched. {num(d.searches.total)} in this span, {num(d.searches.noResults)} found nothing.
            </p>
          </div>
        </header>
        <div className="nd-an__flows">
          <div>
            <h3 className="nd-an__flowh">Most searched</h3>
            <ul className="nd-an__rows">
              {d.searches.top.map((s) => (
                <li key={s.term}>
                  <span>{s.term}</span>
                  <b>{num(s.searches)}</b>
                  <span className="nd-an__q">{s.results ? `${num(s.results)} found` : "none found"}</span>
                </li>
              ))}
              {!d.searches.top.length && <li className="nd-an__none">No searches in this span.</li>}
            </ul>
          </div>
          <div>
            <h3 className="nd-an__flowh">Found nothing</h3>
            <ul className="nd-an__rows">
              {d.searches.nothingFound.map((s) => (
                <li key={s.term}>
                  <span>{s.term}</span>
                  <b>{num(s.searches)}</b>
                  <span />
                </li>
              ))}
              {!d.searches.nothingFound.length && <li className="nd-an__none">Every search found something.</li>}
            </ul>
          </div>
        </div>
        {d.searches.nothingFound.length > 0 && <p className="nd-an__note">Searches that found nothing are what people want that Opencast doesn&rsquo;t carry: a lead for the pipeline or the catalog.</p>}
      </section>
    </>
  );
}

function Kpi({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="nd-an__kp">
      <span className="nd-an__kp-l">{label}</span>
      <b className="nd-an__kp-v">{value}</b>
      <span className="nd-an__kp-c">
        <span className="nd-an__q">{note}</span>
      </span>
    </div>
  );
}

function growthCsv(d: AnalyticsGrowth): string {
  const top = csv(
    ["Measure", "This span", "Before"],
    [
      ["New accounts", d.accounts.new, d.accounts.previous],
      ["Active accounts", d.accounts.active, null],
      ["Stations signed on", d.stations.signedOn, null],
      ...Object.entries(d.stations.started).map(([k, n]): [string, number, null] => [`Started: ${KINDS[k] ?? k}`, n, null]),
      ["Creators added to the pipeline", d.pipeline.added, null],
      ["Markets open", d.markets.open, null],
      ["Uploads", d.uploads.items, d.uploads.previousItems],
      ["Hours uploaded", d.uploads.hours, null],
      ["Phones paired", d.tvs.phonesPaired, null],
      ...d.tvs.new.map((t): [string, number, null] => [`TVs: ${PLATFORMS[t.platform] ?? t.platform}`, t.tvs, null])
    ]
  );
  const searches = csv(["Search", "Searches", "Results"], d.searches.top.map((s) => [s.term, s.searches, s.results]));
  const none = csv(["Found nothing", "Searches"], d.searches.nothingFound.map((s) => [s.term, s.searches]));
  return [top, searches, none].join("\n");
}
