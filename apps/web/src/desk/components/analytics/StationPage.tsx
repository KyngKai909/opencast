// Ref. 12d, 03 One station (A251): everything the network view shows, for one station, plus what
// only makes sense for one: its busiest night by the minute with its breaks, that night's airings,
// where its audience came from and went, how its airtime was filled, and what it earned. (Cost to
// run comes with the Money tab, Phase 6.)

import { analyticsApi, type AnalyticsAiring, type AnalyticsFlow, type AnalyticsQuery, type AnalyticsStationPage } from "@opencast/contracts";
import { Button, LineChart, money, Tabs, Tag } from "@opencast/ui";
import { useSearchParams } from "react-router";
import { useApi } from "../../../api/hooks";
import { controlPath } from "../../../areas";
import { ErrorLine, Quiet } from "../../pages/common";
import { Pill, Spark } from "./Overview";
import { MadeBy, PeopleView, ScheduleView, UploadsView } from "./StationFile";
import { PLATFORMS, clockText, csv, dateOf, download, minutesText, num, shortDate, type Span } from "./span";

const TZ = "America/Los_Angeles";
// The station file's views beside its numbers (added 2026-10-07), kept in the address (`?view=`).
const VIEWS = [
  { value: "numbers", label: "Numbers" },
  { value: "people", label: "People" },
  { value: "uploads", label: "Uploads" },
  { value: "schedule", label: "Schedule" }
] as const;
type View = (typeof VIEWS)[number]["value"];

export function StationPage({ stationId, query, span, exporter, back }: { stationId: string; query: AnalyticsQuery; span: Span; exporter: { current: (() => void) | null }; back: () => void }) {
  const { market: _m, band: _b, ...q } = query;
  void _m;
  void _b;
  const page = useApi(analyticsApi.station, { params: { stationId }, query: q });
  const file = useApi(analyticsApi.stationFile, { params: { stationId } });
  const [params, setParams] = useSearchParams();
  const asked = params.get("view");
  const view: View = VIEWS.some((v) => v.value === asked) ? (asked as View) : "numbers";
  const setView = (v: View) =>
    setParams(
      (p) => {
        if (v === "numbers") p.delete("view");
        else p.set("view", v);
        return p;
      },
      { replace: true }
    );
  if (page.isLoading) return <Quiet />;
  if (page.error || !page.data) return <ErrorLine error={page.error} />;
  const d = page.data;
  const s = d.station;
  exporter.current = () => download(`opencast-${(s.callSign ?? s.name).toLowerCase().replace(/\W+/g, "-")}-${span.from.toISOString().slice(0, 10)}.csv`, stationCsv(d));
  const kindLabel = { independent: "Independent", claimable: "Claimable", catalog: "Catalog", external: "External" }[s.kind];
  const surfaces = d.platforms.filter((p) => p.hours > 0);
  const surfaceTotal = surfaces.reduce((t, p) => t + p.hours, 0);
  const placesTotal = d.places.reduce((t, p) => t + p.hours, 0);
  const own = d.places.find((p) => p.own);
  const peakAt = d.peakTunedIn.at ? new Date(d.peakTunedIn.at) : null;
  const pts = (a: number | null, b: number | null) => (a == null || b == null ? null : a - b);
  return (
    <div className="nd-an__stp">
      <button type="button" className="nd-an__back" onClick={back}>
        <span aria-hidden="true">‹</span> All stations
      </button>
      <header className="nd-an__sthead">
        <span className="nd-an__bigbadge" style={s.colour ? { background: s.colour } : undefined}>
          {s.channel ?? "—"}
        </span>
        <div className="nd-an__stid">
          <h2>
            {s.callSign ?? s.name} <small>{s.name}</small>
          </h2>
          <div className="nd-an__sttags">
            {s.kind === "external" ? <Tag variant="listed">External</Tag> : <span className="nd-an__pill ne">{kindLabel}</span>}
            {s.market && <span className="nd-an__pill ne">{s.market.name}</span>}
            {d.station.onDialSince && <span className="nd-an__pill ne">On the dial since {shortDate(dateOf(new Date(d.station.onDialSince)))}</span>}
          </div>
        </div>
        {s.kind !== "external" && s.callSign && (
          <Button size="sm" href={controlPath(`/${s.callSign}/audience`)}>
            Open in master control
          </Button>
        )}
      </header>
      {s.kind !== "external" && file.data && <MadeBy file={file.data} />}
      {s.kind !== "external" && <Tabs label="This station" items={VIEWS} value={view} onChange={setView} className="nd-an__views" />}

      {view !== "numbers" && s.kind !== "external" ? (
        file.isLoading ? (
          <Quiet />
        ) : file.error || !file.data ? (
          <ErrorLine error={file.error} />
        ) : view === "people" ? (
          <PeopleView file={file.data} />
        ) : view === "uploads" ? (
          <UploadsView file={file.data} />
        ) : (
          <ScheduleView file={file.data} />
        )
      ) : (
      <>
      <div className="nd-an__kps nd-an__kps--5">
        <Kpi label="Hours watched" value={num(d.hoursWatched.value)} m={d.hoursWatched} vs={d.hoursWatched.shareOfNetwork == null ? "" : `${d.hoursWatched.shareOfNetwork}% of all`} />
        <Kpi label="Average tuned in" value={num(d.averageTunedIn.value)} m={d.averageTunedIn} vs={`vs ${num(d.averageTunedIn.previous)}`} />
        <Kpi label="Peak tuned in" value={num(d.peakTunedIn.value)} m={d.peakTunedIn} vs={peakAt ? `${peakAt.toLocaleDateString("en-US", { weekday: "short", timeZone: TZ })} ${clockText(peakAt)}` : "—"} />
        <Kpi
          label="Stayed to the end"
          m={d.stayedToTheEnd}
          value={d.underMinimum ? "—" : d.stayedToTheEnd.value == null ? "—" : `${d.stayedToTheEnd.value}%`}
          change={ptsPill(pts(d.stayedToTheEnd.value, d.stayedToTheEnd.previous), "pts")}
          vs={d.stayedToTheEnd.network == null ? "" : `Network ${d.stayedToTheEnd.network}%`}
        />
        <Kpi
          label="Not for me"
          m={d.notForMePer1000Hours}
          value={d.underMinimum ? "—" : num(d.notForMePer1000Hours.value, { tenths: true })}
          unit={d.underMinimum || d.notForMePer1000Hours.value == null ? undefined : "per 1,000 h"}
          change={ptsPill(pts(d.notForMePer1000Hours.value, d.notForMePer1000Hours.previous), "", true)}
          vs={d.notForMePer1000Hours.network == null ? "" : `Network ${num(d.notForMePer1000Hours.network, { tenths: true })}`}
        />
      </div>
      {d.underMinimum && <p className="nd-an__note nd-an__note--top">Under the minimum: never 20 tuned in at once in this span. The station sees &ldquo;Not enough viewers yet&rdquo;; here are its hours and presets, not per-airing numbers.</p>}

      <div className="nd-an__grid">
        <section className="nd-an__card" aria-labelledby="st-night">
          <header className="nd-an__card-head">
            <div>
              <h2 id="st-night">{d.night ? `${weekdayOf(d.night.from)} night` : "Its busiest night"}</h2>
              <p>{d.night ? `${shortDate(dateOf(new Date(d.night.from)))}, 6 pm to 2 am, by the minute` : "Minute by minute is kept 30 days; this span is older."}</p>
            </div>
          </header>
          {d.night ? (
            <LineChart
              from={d.night.from}
              to={d.night.to}
              series={d.night.minutes.map((m) => ({ at: m.at, value: m.value }))}
              comparison={d.night.minutes.filter((m) => m.previous != null).map((m) => ({ at: m.at, value: m.previous! }))}
              breaks={d.night.breaks}
              now={false}
              label={`${s.callSign ?? s.name}'s tuned in, minute by minute, against the same night a week before, breaks shaded`}
              seriesLabel={shortDate(dateOf(new Date(d.night.from)))}
              comparisonLabel={shortDate(dateOf(new Date(Date.parse(d.night.from) - 7 * 86_400_000)))}
              breaksLabel="Breaks"
              valueLabel="tuned in"
              legend
              height={230}
              timeZone={TZ}
            />
          ) : (
            <p className="nd-an__none">Nobody tuned in during this span&rsquo;s kept minutes.</p>
          )}
        </section>

        <section className="nd-an__card" aria-labelledby="st-where">
          <header className="nd-an__card-head">
            <div>
              <h2 id="st-where">Where they watch</h2>
              <p>Share of hours watched</p>
            </div>
          </header>
          {surfaceTotal ? (
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

        <section className="nd-an__card" aria-labelledby="st-airings">
          <header className="nd-an__card-head">
            <div>
              <h2 id="st-airings">Airings</h2>
              <p>{d.night ? `${weekdayOf(d.night.from)}, ${shortDate(dateOf(new Date(d.night.from)))}, evening` : "Its busiest night"}</p>
            </div>
            <span className="nd-an__q nd-an__count">{num(d.airingsInSpan)} in this span</span>
          </header>
          <Airings rows={d.night?.airings ?? []} external={s.kind === "external"} />
        </section>

        <section className="nd-an__card" aria-labelledby="st-places">
          <header className="nd-an__card-head">
            <div>
              <h2 id="st-places">Where they are</h2>
              <p>Hours, by market</p>
            </div>
          </header>
          <ul className="nd-an__rows">
            {d.places.map((p) => (
              <li key={p.market?.id ?? "none"}>
                <span>
                  {p.market?.name ?? "Outside any market"}
                  {p.own && <small className="nd-an__q"> Its market</small>}
                </span>
                <b>{num(p.hours)}</b>
                <span className="nd-an__q">{placesTotal ? `${Math.round((p.hours / placesTotal) * 100)}%` : ""}</span>
              </li>
            ))}
            {!d.places.length && <li className="nd-an__none">No hours watched in this span.</li>}
          </ul>
          {own && placesTotal > 0 && s.kind !== "external" && (
            <p className="nd-an__callout">
              Local businesses on {s.callSign ?? s.name} pay only for the <b>{Math.round((own.hours / placesTotal) * 100)}% placed in {own.market?.name}</b>.
            </p>
          )}
        </section>
      </div>

      <div className="nd-an__three">
        <section className="nd-an__card" aria-labelledby="st-flow">
          <header className="nd-an__card-head">
            <div>
              <h2 id="st-flow">Came from, and went to</h2>
              <p>Each tune-in and tune-away</p>
            </div>
          </header>
          <div className="nd-an__flows">
            <Flows title="Came from" rows={d.cameFrom} none="Started here" />
            <Flows title="Went to" rows={d.wentTo} none="Stopped here" />
          </div>
        </section>

        <section className="nd-an__card" aria-labelledby="st-air">
          <header className="nd-an__card-head">
            <div>
              <h2 id="st-air">How its airtime was filled</h2>
              <p>{d.airtime ? "From the as-run log" : "It plays its own stream"}</p>
            </div>
          </header>
          {d.airtime ? <Airtime a={d.airtime} /> : <p className="nd-an__none">Time down while someone was tuned in: {minutesText(d.timeDownMinutes ?? 0)}.</p>}
        </section>

        <section className="nd-an__card" aria-labelledby="st-earned">
          <header className="nd-an__card-head">
            <div>
              <h2 id="st-earned">Earned</h2>
              <p>{d.earned ? (d.earned.held ? "This span, after card fees, held in escrow" : "This span, after card fees") : "Nothing to earn: it's their stream"}</p>
            </div>
          </header>
          {d.earned ? (
            <>
              <ul className="nd-an__rows nd-an__rows--money">
                <li>
                  <span>Spots</span>
                  <b>{money(d.earned.spotsMicros)}</b>
                </li>
                <li>
                  <span>Sponsors</span>
                  <b>{money(d.earned.sponsorsMicros)}</b>
                </li>
                <li>
                  <span>
                    Pledges <small className="nd-an__q">{num(d.earned.pledgeMembers)} {d.earned.pledgeMembers === 1 ? "member" : "members"}</small>
                  </span>
                  <b>{money(d.earned.pledgesMicros)}</b>
                </li>
                <li>
                  <span>Carriage, in</span>
                  <b>{money(d.earned.carriageInMicros)}</b>
                </li>
                <li>
                  <span>Card fees</span>
                  <b className={d.earned.cardFeesMicros < 0 ? "nd-an__neg" : undefined}>{money(d.earned.cardFeesMicros)}</b>
                </li>
                <li className="nd-an__tot">
                  <span>{d.earned.held ? "Held" : "Paid out"}</span>
                  <b>{money(d.earned.totalMicros)}</b>
                </li>
              </ul>
              {d.adMicrosPer1000Hours != null && (
                <p className="nd-an__note">
                  {money(d.adMicrosPer1000Hours)} in spots and sponsors per 1,000 hours.
                  {d.cost?.breaksWithSpots != null ? ` ${d.cost.breaksWithSpots}% of its breaks had spots.` : ""}
                </p>
              )}
            </>
          ) : (
            <p className="nd-an__none">An external station plays its own stream, so there&rsquo;s nothing of Opencast&rsquo;s to earn.</p>
          )}
        </section>
      </div>
      {d.cost && <Cost c={d.cost} name={s.callSign ?? s.name} />}
      </>
      )}
    </div>
  );
}

/** Ref. 12d 03's "Cost to run, estimated": what the station used, priced by the Costs rules, against what it was charged. */
function Cost({ c, name }: { c: NonNullable<AnalyticsStationPage["cost"]>; name: string }) {
  const margin = c.totalMicros == null ? null : c.chargedMicros - c.totalMicros;
  const priced = (m: number | null) => (m == null ? <span className="nd-an__q">Not set yet</span> : money(m));
  return (
    <div className="nd-an__two">
      <section className="nd-an__card" aria-labelledby="st-cost">
        <header className="nd-an__card-head">
          <div>
            <h2 id="st-cost">Cost to run</h2>
            <p>Estimated, this span</p>
          </div>
        </header>
        <p className={`nd-an__big${margin != null && margin < 0 ? " nd-an__neg" : ""}`}>
          {margin == null ? "—" : `${margin < 0 ? "−" : ""}${money(Math.abs(margin))}`} <small>Opencast on {name} this span</small>
        </p>
        <ul className="nd-an__rows nd-an__rows--money">
          <li>
            <span>
              Storage <small className="nd-an__q">{num(c.storageGb)} GB on average</small>
            </span>
            <b>{priced(c.storageMicros)}</b>
          </li>
          <li>
            <span>
              Relays <small className="nd-an__q">{num(c.relayHours)} hours</small>
            </span>
            <b>{priced(c.relayMicros)}</b>
          </li>
          <li>
            <span>
              Live <small className="nd-an__q">{num(c.liveHours)} hours</small>
            </span>
            <b>{priced(c.liveMicros)}</b>
          </li>
          <li className="nd-an__tot">
            <span>Cost, estimated</span>
            <b>{priced(c.totalMicros)}</b>
          </li>
          <li>
            <span>
              Charged to {name} <small className="nd-an__q">Pay-as-you-go, past the free allowance</small>
            </span>
            <b>{money(c.chargedMicros)}</b>
          </li>
        </ul>
        <p className="nd-an__note">Preparing is counted for the network, not per station: one upload can be on several stations.</p>
      </section>
    </div>
  );
}

function Kpi({ label, value, unit, m, change, vs }: { label: string; value: string; unit?: string; m: { value: number | null; previous: number | null; byDay: number[] }; change?: React.ReactNode; vs: string }) {
  return (
    <div className="nd-an__kp">
      <span className="nd-an__kp-l">{label}</span>
      <b className="nd-an__kp-v">
        {value}
        {unit && <small> {unit}</small>}
      </b>
      <span className="nd-an__kp-c">
        {change ?? <Pill value={m.value} previous={m.previous} />}
        <span className="nd-an__q">{vs}</span>
      </span>
      {m.byDay.length > 1 && <Spark values={m.byDay} />}
    </div>
  );
}

/** "↑ 2 pts" (or "↓ 0.4" for a rate where down is good). */
function ptsPill(delta: number | null, unit: string, downIsGood = false) {
  if (delta == null) return <span className="nd-an__pill ne">—</span>;
  if (Math.abs(delta) < 0.05) return <span className="nd-an__pill fl">Flat</span>;
  const good = downIsGood ? delta < 0 : delta > 0;
  const n = Math.abs(delta) >= 10 ? Math.round(Math.abs(delta)) : Math.round(Math.abs(delta) * 10) / 10;
  return <span className={`nd-an__pill ${good ? "up" : "dn"}`}>{`${delta > 0 ? "↑" : "↓"} ${n}${unit ? ` ${unit}` : ""}`}</span>;
}

function weekdayOf(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "long", timeZone: TZ });
}

function sourceLine(a: AnalyticsAiring): string {
  switch (a.source) {
    case "carried":
      return a.from ? `Carried from ${a.from.callSign ?? a.from.name} ${a.from.channel ?? ""}`.trim() : "Carried";
    case "live":
      return "Live";
    case "guide":
      return "From their guide";
    case "nothing_listed":
      return "Nothing listed";
    default:
      return "Library";
  }
}

function Airings({ rows, external }: { rows: AnalyticsAiring[]; external: boolean }) {
  if (!rows.length) return <p className="nd-an__none">{external ? "No airings worked out for this night yet." : "No airings worked out for this night yet."}</p>;
  return (
    <div className="nd-an__t" role="table" aria-label="That night's airings">
      <div className="nd-an__th nd-an__air" role="row">
        <span role="columnheader">Program</span>
        <span role="columnheader" className="n">
          Aired
        </span>
        <span role="columnheader" className="n">
          Avg
        </span>
        <span role="columnheader" className="n">
          Peak
        </span>
        <span role="columnheader" className="n">
          Stayed
        </span>
        <span role="columnheader" className="n">
          Not for me
        </span>
        <span role="columnheader" className="n">
          Hours
        </span>
      </div>
      {rows.map((a) => (
        <div key={a.key} className="nd-an__tr nd-an__air" role="row">
          <span role="cell" className="nd-an__prog">
            <b>{a.title}</b>
            <small>{sourceLine(a)}</small>
          </span>
          <span role="cell" className="n">
            {clockText(new Date(a.startedAt))}
          </span>
          <span role="cell" className="n">
            {num(a.averageTunedIn)}
          </span>
          <span role="cell" className="n">
            {num(a.peakTunedIn)}
          </span>
          <span role="cell" className="n">
            {a.stayedToTheEnd == null ? "—" : `${a.stayedToTheEnd}%`}
          </span>
          <span role="cell" className="n">
            {num(a.notForMePer1000Hours, { tenths: true })}
          </span>
          <span role="cell" className="n">
            {num(a.hours)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The top four, and the rest as "Other stations". */
function Flows({ title, rows, none }: { title: string; rows: AnalyticsFlow[]; none: string }) {
  const here = rows.find((r) => !r.station);
  const stations = rows.filter((r) => r.station);
  const top = stations.slice(0, 4);
  const rest = stations.slice(4).reduce((s, r) => s + r.share, 0);
  return (
    <div>
      <h3 className="nd-an__flowh">{title}</h3>
      <ul className="nd-an__rows">
        {here && (
          <li>
            <span>{none}</span>
            <b>{Math.round(here.share)}%</b>
            <span />
          </li>
        )}
        {top.map((r) => (
          <li key={r.station!.id}>
            <span>
              {r.station!.callSign ?? r.station!.name} <span className="nd-an__q">{r.station!.channel}</span>
            </span>
            <b>{Math.round(r.share)}%</b>
            <span />
          </li>
        ))}
        {rest > 0 && (
          <li>
            <span>Other stations</span>
            <b>{Math.round(rest)}%</b>
            <span />
          </li>
        )}
        {!rows.length && <li className="nd-an__none">Nothing in this span.</li>}
      </ul>
    </div>
  );
}

function Airtime({ a }: { a: NonNullable<AnalyticsStationPage["airtime"]> }) {
  const parts = [
    { label: "Programs", m: a.programs, colour: "var(--c1)" },
    { label: "Breaks", m: a.breaks, colour: "var(--c2)" },
    { label: "Live", m: a.live, colour: "var(--c3)" }
  ];
  const total = parts.reduce((s, p) => s + p.m, 0) + a.deadAir;
  if (!total) return <p className="nd-an__none">Nothing aired in this span.</p>;
  return (
    <>
      <div className="nd-an__stack" aria-hidden="true">
        {parts.map((p) => (p.m ? <i key={p.label} style={{ width: `${(p.m / total) * 100}%`, background: p.colour }} /> : null))}
        {a.deadAir > 0 && <i style={{ width: `${(a.deadAir / total) * 100}%`, background: "var(--bad)" }} />}
      </div>
      <ul className="nd-an__rows">
        {parts.map((p) => (
          <li key={p.label}>
            <span>
              <i className="nd-an__dot" style={{ background: p.colour }} />
              {p.label}
            </span>
            <b>{num(p.m)} min</b>
            <span className="nd-an__q">{((p.m / total) * 100).toFixed(1)}%</span>
          </li>
        ))}
        <li>
          <span>Dead air, slate, not ready</span>
          <b className={a.deadAir ? "nd-an__neg" : "nd-an__q"}>{a.deadAir ? minutesText(a.deadAir) : "None"}</b>
          <span />
        </li>
      </ul>
    </>
  );
}

function stationCsv(d: AnalyticsStationPage): string {
  const s = d.station;
  const head = csv(
    ["Measure", "Value", "Before", "Network"],
    [
      ["Hours watched", d.hoursWatched.value, d.hoursWatched.previous, null],
      ["Share of the network (%)", d.hoursWatched.shareOfNetwork, null, null],
      ["Average tuned in", d.averageTunedIn.value, d.averageTunedIn.previous, null],
      ["Peak tuned in", d.peakTunedIn.value, d.peakTunedIn.previous, null],
      ["Stayed to the end (%)", d.stayedToTheEnd.value, d.stayedToTheEnd.previous, d.stayedToTheEnd.network],
      ["Not for me per 1,000 hours", d.notForMePer1000Hours.value, d.notForMePer1000Hours.previous, d.notForMePer1000Hours.network],
      ...d.platforms.map((p): [string, number, null, null] => [`Hours on ${PLATFORMS[p.platform]?.label ?? p.platform}`, p.hours, null, null]),
      ...d.places.map((p): [string, number, null, null] => [`Hours in ${p.market?.name ?? "no market"}`, p.hours, null, null])
    ]
  );
  const airings = csv(
    ["Program", "Source", "Aired", "Average tuned in", "Peak", "Stayed %", "Not for me per 1,000 h", "Hours"],
    (d.night?.airings ?? []).map((a) => [a.title, sourceLine(a), a.startedAt, a.averageTunedIn, a.peakTunedIn, a.stayedToTheEnd, a.notForMePer1000Hours, a.hours])
  );
  const flows = csv(
    ["Direction", "Station", "Changes", "Share %"],
    [...d.cameFrom.map((f) => ["Came from", f.station ? `${f.station.callSign ?? f.station.name} ${f.station.channel ?? ""}`.trim() : "Started here", f.changes, f.share]), ...d.wentTo.map((f) => ["Went to", f.station ? `${f.station.callSign ?? f.station.name} ${f.station.channel ?? ""}`.trim() : "Stopped here", f.changes, f.share])]
  );
  return `${s.callSign ?? s.name} ${s.channel ?? ""}\n${head}\n${airings}\n${flows}`;
}
