// Ref. 12d, the Network desk's Analytics (A251): every station, added up and taken apart. One set of
// filters (the span, market, band) runs through every tab; the tabs are routes (/desk/analytics/:tab)
// and the filters are in the address, so a view can be shared. A market lead's market is fixed.
// Phase 2 builds Overview and Stations; the other tabs say what they'll hold (docs/analytics-map.md).

import { useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { analyticsApi, type AnalyticsBand, type AnalyticsQuery } from "@opencast/contracts";
import { Button, ControlTitle, Tabs } from "@opencast/ui";
import { useApi } from "../../api/hooks";
import { deskPath } from "../../areas";
import { now } from "../../lib/clock";
import { SPANS, clockText, dateOf, spanFor, type Span, type SpanKey } from "../components/analytics/span";
import { Overview } from "../components/analytics/Overview";
import { StationsTab } from "../components/analytics/StationsTab";
import { ErrorLine, Quiet } from "./common";
import "../components/analytics/Analytics.css";

export type AnalyticsTab = "overview" | "stations" | "programs" | "audience" | "money" | "health" | "growth";

const TABS: ReadonlyArray<{ value: AnalyticsTab; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "stations", label: "Stations" },
  { value: "programs", label: "Programs" },
  { value: "audience", label: "Audience" },
  { value: "money", label: "Money" },
  { value: "health", label: "Health" },
  { value: "growth", label: "Growth" }
];

/** What a tab not built yet will hold (docs/analytics-map.md, Phases 3 to 7). */
const COMING: Partial<Record<AnalyticsTab, string>> = {
  programs: "Programs across every station that aired them, with how many were still watching at each minute, and how many stay through a break.",
  audience: "The week as an hour-by-day grid, how long sessions last, surfaces day by day, devices, moving around the dial, how people tuned in, and relays beside it all.",
  money: "Stations' earnings by kind, earnings held for claimable stations, the spot market, per 1,000 hours, and Opencast's week against the estimated cost to run.",
  health: "How each station's airtime was filled, the week's incidents, relays, sessions filtered as bots, and how fast channels start.",
  growth: "New and active accounts, new stations by kind, creators in the pipeline, markets opened, TV devices and paired phones, uploads, and what people search for."
};

/** The filters, from the address: ?span=7d (today, 7d, 30d, 90d, custom with from and to dates), ?market=<id>, ?band=tv|radio. */
export function useAnalyticsFilters() {
  const [params, setParams] = useSearchParams();
  const key = (SPANS.some((s) => s.key === params.get("span")) ? params.get("span") : "7d") as SpanKey;
  const first = params.get("from");
  const last = params.get("to");
  const at = now();
  const span: Span = useMemo(() => spanFor(key, at, first && last ? { first, last } : undefined), [key, first, last, key === "today" ? Math.floor(at.getTime() / 60_000) : 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const market = params.get("market") ?? undefined;
  const band = (["tv", "radio"].includes(params.get("band") ?? "") ? params.get("band") : "all") as AnalyticsBand;
  const query: AnalyticsQuery = {
    from: span.from.toISOString(),
    to: span.to.toISOString(),
    previousFrom: span.previousFrom.toISOString(),
    ...(market ? { market } : {}),
    ...(band !== "all" ? { band } : {})
  };
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v == null ? next.delete(k) : next.set(k, v);
    setParams(next, { replace: true });
  };
  return { span, query, market, band, set, params };
}

export default function Analytics() {
  const { tab: raw } = useParams();
  const tab = (TABS.some((t) => t.value === raw) ? raw : "overview") as AnalyticsTab;
  const navigate = useNavigate();
  const filters = useAnalyticsFilters();
  // The scope (markets to pick, a lead's fixed market, when the totals were worked out) comes with every answer; the overview's is asked for on any tab.
  const scopeQ = useApi(analyticsApi.overview, { query: filters.query });
  const scope = scopeQ.data?.scope;
  const updated = scope?.updatedAt ? new Date(scope.updatedAt) : null;
  const exporters: { current: (() => void) | null } = useMemo(() => ({ current: null }), []);
  const go = (t: AnalyticsTab) => navigate({ pathname: deskPath(`/analytics/${t}`), search: filters.params.toString() ? `?${filters.params.toString()}` : "" });

  return (
    <div className="nd-an">
      <ControlTitle
        title="Analytics"
        description={scope?.market ? `Every station in ${scope.markets.find((m) => m.id === scope.market)?.name ?? "this market"}` : "Every station on Opencast, in every market"}
        end={
          <div className="nd-an__head-end">
            {updated && (
              <span className="nd-an__upd">
                <i aria-hidden="true" />
                Updated {dateOf(updated) === dateOf(now()) ? "today" : updated.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, {clockText(updated)}
              </span>
            )}
            <Button size="sm" onClick={() => exporters.current?.()} disabled={!COMING[tab] ? false : true}>
              Export CSV
            </Button>
          </div>
        }
      />
      <Tabs label="Analytics" items={TABS} value={tab} onChange={go} className="nd-an__tabs" />
      <Filters filters={filters} scope={scope} />
      {COMING[tab] ? (
        <section className="nd-an__card nd-an__coming" aria-labelledby="an-coming">
          <h2 id="an-coming">{TABS.find((t) => t.value === tab)!.label}</h2>
          <p>{COMING[tab]}</p>
          <p className="nd-an__q">Coming next, a tab at a time. Overview and Stations are here now.</p>
        </section>
      ) : scopeQ.isLoading ? (
        <Quiet />
      ) : scopeQ.error ? (
        <ErrorLine error={scopeQ.error} />
      ) : tab === "stations" ? (
        <StationsTab query={filters.query} span={filters.span} exporter={exporters} />
      ) : (
        <Overview data={scopeQ.data!} span={filters.span} exporter={exporters} onAllStations={() => go("stations")} />
      )}
    </div>
  );
}

function Filters({ filters, scope }: { filters: ReturnType<typeof useAnalyticsFilters>; scope: { markets: Array<{ id: string; name: string }>; fixedMarket: string | null } | undefined }) {
  const { span, market, band, set } = filters;
  const today = dateOf(now());
  return (
    <div className="nd-an__filters">
      <div className="nd-an__seg" role="group" aria-label="Span">
        {SPANS.map((s) => (
          <button key={s.key} type="button" aria-pressed={span.key === s.key} onClick={() => set(s.key === "custom" ? { span: "custom", from: filters.params.get("from") ?? dateOf(span.from), to: filters.params.get("to") ?? dateOf(new Date(span.to.getTime() - 1)) } : { span: s.key, from: null, to: null })}>
            {s.label}
          </button>
        ))}
      </div>
      {span.key === "custom" && (
        <span className="nd-an__dates">
          <input type="date" aria-label="From" value={filters.params.get("from") ?? dateOf(span.from)} max={today} onChange={(e) => e.target.value && set({ from: e.target.value })} />
          <span aria-hidden="true">to</span>
          <input type="date" aria-label="To" value={filters.params.get("to") ?? dateOf(new Date(span.to.getTime() - 1))} max={today} onChange={(e) => e.target.value && set({ to: e.target.value })} />
        </span>
      )}
      <span className="nd-an__span">{span.label}</span>
      <label className="nd-an__pick">
        <span>Market</span>
        <select value={scope?.fixedMarket ?? market ?? ""} disabled={!!scope?.fixedMarket} onChange={(e) => set({ market: e.target.value || null })}>
          {!scope?.fixedMarket && <option value="">All markets</option>}
          {(scope?.markets ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label className="nd-an__pick">
        <span>Band</span>
        <select value={band} onChange={(e) => set({ band: e.target.value === "all" ? null : e.target.value })}>
          <option value="all">TV and radio</option>
          <option value="tv">TV</option>
          <option value="radio">Radio</option>
        </select>
      </label>
    </div>
  );
}
