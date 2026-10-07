// Ref. 12d, 06 Money (A251): what stations earned, what Opencast took, and what it cost. Every
// dollar is a sum of ledger entries; carriage moves money between stations, so it's shown as volume
// and never added to the network's earnings. Opencast's share says "Not set yet" while the shares
// rule is open, never a guessed $0; the cost to run is labelled estimated.

import { analyticsApi, type AnalyticsMoney, type AnalyticsQuery } from "@opencast/contracts";
import { money } from "@opencast/ui";
import { useApi } from "../../../api/hooks";
import { deskPath } from "../../../areas";
import { ErrorLine, Quiet } from "../../pages/common";
import { Pill, Spark, StationCell } from "./Overview";
import { csv, dateOf, download, num, shortDate, type Span } from "./span";

const KINDS = [
  { key: "spots", label: "Spots", colour: "var(--c1)" },
  { key: "sponsors", label: "Sponsors", colour: "var(--c2)" },
  { key: "pledges", label: "Pledges", colour: "var(--c3)" },
  { key: "catalogSponsors", label: "Catalog sponsors", colour: "var(--c4)" }
] as const;

const notSet = <span className="nd-an__q">Not set yet</span>;
const amount = (m: number | null) => (m == null ? notSet : money(m));

export function MoneyTab({ query, span, exporter, stationHref }: { query: AnalyticsQuery; span: Span; exporter: { current: (() => void) | null }; stationHref: (id: string) => string }) {
  const q = useApi(analyticsApi.money, { query });
  if (q.isLoading) return <Quiet />;
  if (q.error || !q.data) return <ErrorLine error={q.error} />;
  const d = q.data;
  exporter.current = () => download(`opencast-money-${span.from.toISOString().slice(0, 10)}.csv`, moneyCsv(d));
  const sm = d.spotMarket;
  const weekMax = Math.max(1, ...d.weeks.map((w) => w.spots + w.sponsors + w.pledges + w.catalogSponsors));
  const perMax = Math.max(1, ...d.per1000Hours.map((p) => p.micros));
  const heldTotal = d.held.reduce((t, h) => t + h.balanceMicros, 0);
  const heldAdded = d.held.reduce((t, h) => t + h.addedMicros, 0);
  const o = d.opencast;
  return (
    <>
      {!d.shareSet && (
        <p className="nd-an__banner" role="note">
          <b>Opencast&rsquo;s share: not set yet.</b> The shares rule is still open in <a href={deskPath("/settings/rules")}>Settings</a>, so nothing is taken from stations&rsquo; earnings. The share fills in from the date the rule takes effect.
        </p>
      )}
      <div className="nd-an__kps nd-an__kps--5">
        <Kpi label="Earned by stations" m={d.earnedByStations} note="after card fees" />
        <Kpi label="Held for claimable" m={d.heldForClaimable} note={`${d.heldForClaimable.stations} ${d.heldForClaimable.stations === 1 ? "station" : "stations"}`} />
        <Kpi label="Catalog sponsors" m={d.catalogSponsors} note="catalog credit" />
        <Kpi label="Pay-as-you-go" m={d.payAsYouGo} note="storage, relays, live" />
        <Kpi label="Cost to run" m={d.costToRun} note={d.costToRun.complete ? "estimated" : "estimated, some prices not set"} upIsBad />
      </div>

      <div className="nd-an__grid">
        <section className="nd-an__card" aria-labelledby="mo-weeks">
          <header className="nd-an__card-head">
            <div>
              <h2 id="mo-weeks">Earnings, week by week</h2>
              <p>All stations, before card fees, the last 8 weeks</p>
            </div>
          </header>
          <div className="nd-an__sbars nd-an__sbars--weeks" role="list" aria-label="Earnings each week, by kind">
            {d.weeks.map((w) => {
              const total = w.spots + w.sponsors + w.pledges + w.catalogSponsors;
              return (
                <div key={w.from} role="listitem" aria-label={`Week of ${shortDate(dateOf(new Date(w.from)))}: ${money(total)}`}>
                  <span className="nd-an__vb-n">{total ? money(total, { trimCents: true }) : ""}</span>
                  <span className="nd-an__sb-bar">
                    <span style={{ height: `${(total / weekMax) * 100}%` }}>
                      {KINDS.map((k) => (w[k.key] > 0 ? <i key={k.key} style={{ flexGrow: w[k.key], background: k.colour }} /> : null))}
                    </span>
                  </span>
                  <span className="nd-an__vb-l">{shortDate(dateOf(new Date(w.from)))}</span>
                </div>
              );
            })}
          </div>
          <p className="nd-an__legend">
            {KINDS.map((k) => (
              <span key={k.key}>
                <i className="nd-an__dot" style={{ background: k.colour }} />
                {k.label}
              </span>
            ))}
          </p>
        </section>

        <section className="nd-an__card" aria-labelledby="mo-spots">
          <header className="nd-an__card-head">
            <div>
              <h2 id="mo-spots">Spot market</h2>
              <p>This span</p>
            </div>
          </header>
          <ul className="nd-an__rows nd-an__rows--kv">
            <li>
              <span>Breaks aired</span>
              <b>{num(sm.breaksAired)}</b>
              <span />
            </li>
            <li>
              <span>
                With spots <small className="nd-an__q">The rest went to station IDs and bumpers</small>
              </span>
              <b>{num(sm.breaksWithSpots)}</b>
              <span className="nd-an__q">{sm.breaksAired ? `${Math.round((sm.breaksWithSpots / sm.breaksAired) * 100)}%` : ""}</span>
            </li>
            <li>
              <span>Spots aired</span>
              <b>{num(sm.spotsAired)}</b>
              <span>
                <Pill value={sm.spotsAired} previous={sm.spotsAiredBefore} />
              </span>
            </li>
            <li>
              <span>
                Average rate <small className="nd-an__q">Per 1,000 tuned in</small>
              </span>
              <b>{sm.perThousandMicros == null ? "—" : money(sm.perThousandMicros)}</b>
              <span />
            </li>
            <li>
              <span>Businesses buying</span>
              <b>{num(sm.businesses)}</b>
              <span>{sm.businessesBefore != null && <span className={`nd-an__pill ${sm.businesses >= sm.businessesBefore ? "up" : "dn"}`}>{`${sm.businesses >= sm.businessesBefore ? "+" : "−"}${Math.abs(sm.businesses - sm.businessesBefore)}`}</span>}</span>
            </li>
            <li>
              <span>
                Held for the next week <small className="nd-an__q">Money set aside for placed spots</small>
              </span>
              <b>{money(sm.heldNextWeekMicros)}</b>
              <span />
            </li>
          </ul>
        </section>

        <section className="nd-an__card" aria-labelledby="mo-per">
          <header className="nd-an__card-head">
            <div>
              <h2 id="mo-per">Earned per 1,000 hours watched</h2>
              <p>Spots and sponsors, by station</p>
            </div>
          </header>
          <div className="nd-an__t" role="table" aria-label="Spots and sponsors per 1,000 hours, by station">
            {d.per1000Hours.map((p) => (
              <div key={p.station.id} className="nd-an__tr nd-an__per" role="row">
                <StationCell station={p.station} href={stationHref(p.station.id)} />
                <span className="nd-an__shb" role="cell" aria-hidden="true">
                  <i style={{ width: `${(p.micros / perMax) * 100}%` }} />
                </span>
                <span className="n" role="cell">
                  {money(p.micros)}
                  {p.held && <small>Held</small>}
                </span>
              </div>
            ))}
            {!d.per1000Hours.length && <p className="nd-an__none">No hours watched in this view.</p>}
          </div>
        </section>

        <section className="nd-an__card" aria-labelledby="mo-week">
          <header className="nd-an__card-head">
            <div>
              <h2 id="mo-week">Opencast&rsquo;s span</h2>
              <p>Charges in, estimated costs out</p>
            </div>
          </header>
          <p className={`nd-an__big${o.net < 0 ? " nd-an__neg" : ""}`}>
            {o.net < 0 ? "−" : ""}
            {money(Math.abs(o.net))} <small>the span, estimated</small>
          </p>
          <h3 className="nd-an__flowh">In</h3>
          <ul className="nd-an__rows nd-an__rows--money">
            <li>
              <span>Storage charges</span>
              <b>{money(o.in.storage)}</b>
            </li>
            <li>
              <span>Relay hours</span>
              <b>{money(o.in.relays)}</b>
            </li>
            <li>
              <span>Live hours</span>
              <b>{money(o.in.live)}</b>
            </li>
            <li>
              <span>Share of earnings</span>
              <b>{amount(o.in.share)}</b>
            </li>
          </ul>
          <h3 className="nd-an__flowh nd-an__mt">Out, estimated</h3>
          <ul className="nd-an__rows nd-an__rows--money">
            <li>
              <span>
                Storage <small className="nd-an__q">{num(o.measured.storageGb)} GB on average</small>
              </span>
              <b>{amount(o.out.storage)}</b>
            </li>
            <li>
              <span>
                Preparing <small className="nd-an__q">{num(o.measured.prepareMinutes)} minutes</small>
              </span>
              <b>{amount(o.out.preparing)}</b>
            </li>
            <li>
              <span>
                Relays <small className="nd-an__q">{num(o.measured.relayHours)} hours</small>
              </span>
              <b>{amount(o.out.relays)}</b>
            </li>
            <li>
              <span>
                Live (Livepeer) <small className="nd-an__q">{num(o.measured.liveHours)} hours</small>
              </span>
              <b>{amount(o.out.live)}</b>
            </li>
            <li>
              <span>API, database, worker</span>
              <b>{amount(o.out.platform)}</b>
            </li>
          </ul>
          {!d.costToRun.complete && (
            <p className="nd-an__note">
              Prices &ldquo;Not set yet&rdquo; are left out. Set them in <a href={deskPath("/settings/rules")}>Settings, Costs</a>.
            </p>
          )}
        </section>
      </div>

      <div className="nd-an__two">
        <section className="nd-an__card" aria-labelledby="mo-held">
          <header className="nd-an__card-head">
            <div>
              <h2 id="mo-held">Held for claimable stations</h2>
              <p>In escrow until each creator claims</p>
            </div>
          </header>
          <div className="nd-an__t" role="table" aria-label="Held for claimable stations">
            {d.held.map((h) => (
              <div key={h.station.id} className="nd-an__tr nd-an__heldrow" role="row">
                <StationCell station={h.station} href={stationHref(h.station.id)} />
                <span role="cell" className="nd-an__q">
                  {h.since ? `Held since ${shortDate(dateOf(new Date(h.since)))}` : ""}
                </span>
                <span className="n" role="cell">
                  {money(h.balanceMicros)}
                </span>
                <span className="n nd-an__q" role="cell">
                  +{money(h.addedMicros)}
                </span>
              </div>
            ))}
            {!d.held.length && <p className="nd-an__none">Nothing held in this view.</p>}
            {d.held.length > 0 && (
              <div className="nd-an__tr nd-an__heldrow nd-an__tot" role="row">
                <span role="cell">In escrow</span>
                <span role="cell" />
                <span className="n" role="cell">
                  {money(heldTotal)}
                </span>
                <span className="n" role="cell">
                  +{money(heldAdded)}
                </span>
              </div>
            )}
          </div>
        </section>
        <section className="nd-an__card" aria-labelledby="mo-carriage">
          <header className="nd-an__card-head">
            <div>
              <h2 id="mo-carriage">Carriage</h2>
              <p>Between stations, so not in the totals</p>
            </div>
          </header>
          <ul className="nd-an__rows nd-an__rows--kv">
            <li>
              <span>Agreements paying this span</span>
              <b>{num(d.carriage.agreements)}</b>
              <span />
            </li>
            <li>
              <span>
                Paid in cash <small className="nd-an__q">Carriers to makers</small>
              </span>
              <b>{money(d.carriage.cashMicros)}</b>
              <span />
            </li>
            <li>
              <span>
                Barter <small className="nd-an__q">Makers&rsquo; share of break time inside their programs</small>
              </span>
              <b>{money(d.carriage.barterMicros)}</b>
              <span className="nd-an__q">{d.carriage.barterMinutes ? `${num(d.carriage.barterMinutes)} min` : ""}</span>
            </li>
            <li>
              <span>
                Programs carried <small className="nd-an__q">On a station other than the maker&rsquo;s</small>
              </span>
              <b>{num(d.carriage.programsCarried)}</b>
              <span />
            </li>
          </ul>
        </section>
      </div>
    </>
  );
}

function Kpi({ label, m, note, upIsBad }: { label: string; m: { value: number | null; previous: number | null; byDay: number[] }; note: string; upIsBad?: boolean }) {
  return (
    <div className="nd-an__kp">
      <span className="nd-an__kp-l">{label}</span>
      <b className="nd-an__kp-v">{m.value == null ? "—" : money(m.value)}</b>
      <span className="nd-an__kp-c">
        <Pill value={m.value} previous={m.previous} upIsBad={upIsBad} />
        <span className="nd-an__q">{note}</span>
      </span>
      {m.byDay.length > 1 && <Spark values={m.byDay} />}
    </div>
  );
}

function moneyCsv(d: AnalyticsMoney): string {
  const usd = (m: number | null | undefined) => (m == null ? null : (m / 1_000_000).toFixed(2));
  const top = csv(
    ["Measure", "This span (USD)", "Before (USD)"],
    [
      ["Earned by stations, after card fees", usd(d.earnedByStations.value), usd(d.earnedByStations.previous)],
      ["Held for claimable stations", usd(d.heldForClaimable.value), usd(d.heldForClaimable.previous)],
      ["Catalog sponsors", usd(d.catalogSponsors.value), usd(d.catalogSponsors.previous)],
      ["Pay-as-you-go", usd(d.payAsYouGo.value), usd(d.payAsYouGo.previous)],
      ["Cost to run, estimated", usd(d.costToRun.value), usd(d.costToRun.previous)],
      ["Opencast's share", d.opencast.in.share == null ? "Not set yet" : usd(d.opencast.in.share), null]
    ]
  );
  const weeks = csv(["Week from", "Spots", "Sponsors", "Pledges", "Catalog sponsors"], d.weeks.map((w) => [w.from.slice(0, 10), usd(w.spots), usd(w.sponsors), usd(w.pledges), usd(w.catalogSponsors)]));
  const per = csv(["Station", "Spots and sponsors per 1,000 hours (USD)"], d.per1000Hours.map((p) => [`${p.station.callSign ?? p.station.name} ${p.station.channel ?? ""}`.trim(), usd(p.micros)]));
  const held = csv(["Station", "Held since", "In escrow (USD)", "Added this span (USD)"], d.held.map((h) => [`${h.station.callSign ?? h.station.name} ${h.station.channel ?? ""}`.trim(), h.since?.slice(0, 10) ?? "", usd(h.balanceMicros), usd(h.addedMicros)]));
  return [top, weeks, per, held].join("\n");
}
