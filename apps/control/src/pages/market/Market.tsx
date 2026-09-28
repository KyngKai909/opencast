// B.1 / market 01.1 Syndication market, Browse: facets on the left, the sort that knows the
// schedule, terms in two lines, Carried by. Facets and sort live in the query string.
// `?gap=<startsAt>` opens it for a dead-air gap (the dead-air sheet's "Carry from the market"); on
// the phone that's market 06.1: only what fits, one tap carries it with Undo.

import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { logApi } from "@opencast/contracts";
import { Button, clockRange, ControlTitle, Field, Notice, Segmented, Table, Tag, type Column } from "@opencast/ui";
import type { OfferX } from "../../api/ext/market";
import { useApi } from "../../api/hooks";
import { useBrowse, useRequests } from "../../components/market/api";
import { browse, facetCounts, readFilters, resultWords, writeFilters, type BrowseFilters, type BrowseSort } from "../../components/market/browse";
import { gapPlan, useCarryIntoGap } from "../../components/market/carry";
import { FacetList, type FacetGroup } from "../../components/market/FacetList";
import { FitTag, MakerLine, MarketTabs, ProgramCard, Quietly } from "../../components/market/parts";
import { formatLine, makerName, termNames, termsTwoLines } from "../../components/market/words";
import { useIsPhone, useShellOptions } from "../../layout/shell";
import { STATION_TZ } from "../../lib/clock";
import { useStation } from "../../station/StationContext";
import { Quiet } from "../common";
import "./Market.css";

const SORTS: { value: BrowseSort; label: string }[] = [
  { value: "fits", label: "Fits your schedule" },
  { value: "carried", label: "Carried by most" },
  { value: "newest", label: "Newest" }
];

export default function Market() {
  const s = useStation();
  const phone = useIsPhone();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const gap = params.get("gap");
  const read = readFilters(params);
  // A studio has no schedule to fit, so its market sorts by carriers first.
  const filters = s.studio && read.sort === "fits" ? { ...read, sort: "carried" as const } : read;
  const offers = useBrowse({ forStation: s.id, q: q || undefined });
  const requests = useRequests(s.id, s.can("programming"));
  const deadAir = useApi(logApi.getDeadAir, { params: { stationId: s.id } }, { enabled: !!gap && !s.studio, retry: false });
  const waiting = requests.data?.incoming.filter((r) => r.status === "asked").length ?? 0;

  // The gap's range, from an offer that fits it or from the dead-air check.
  const gapRange = useMemo(() => {
    if (!gap) return null;
    const t = Date.parse(gap);
    const fromOffer = offers.data?.flatMap((o) => o.fit ?? []).find((f) => f.reason === "dead_air" && f.startsAt && Date.parse(f.startsAt) === t);
    const fromLog = deadAir.data?.gaps.find((g) => Date.parse(g.startsAt) === t);
    const r = fromOffer?.startsAt && fromOffer.endsAt ? { startsAt: fromOffer.startsAt, endsAt: fromOffer.endsAt } : fromLog ?? null;
    return r ? { ...r, words: clockRange(r.startsAt, r.endsAt, { timeZone: STATION_TZ }) } : null;
  }, [gap, offers.data, deadAir.data]);

  useShellOptions({ context: gap && gapRange ? `Fits ${gapRange.words}` : "Syndication market" }, [gapRange?.words]);

  const setQ = (v: string) =>
    setParams(
      (p) => {
        if (v) p.set("q", v);
        else p.delete("q");
        return p;
      },
      { replace: true }
    );
  const setFilters = (f: BrowseFilters) => setParams((p) => writeFilters(p, f), { replace: true });
  const clearGap = () =>
    setParams((p) => {
      p.delete("gap");
      return p;
    });

  if (offers.isLoading) return <Quiet />;
  if (offers.error) return <Quietly role="alert">{offers.error.message}</Quietly>;
  const all = offers.data ?? [];
  const inGap = gap ? all.filter((o) => o.fit?.some((f) => f.reason === "dead_air" && f.startsAt && Date.parse(f.startsAt) === Date.parse(gap))) : all;

  if (phone) return <PhoneMarket offers={inGap} gap={gap} gapStartsAt={gapRange?.startsAt ?? gap} />;

  const shown = browse(inGap, filters);
  const counts = facetCounts(all);
  const groups: FacetGroup[] = [
    { key: "kind", label: "Kind", selected: filters.kind, options: [{ value: "series", label: "Series", count: counts.kind.series }, { value: "one_off", label: "One-offs", count: counts.kind.one_off }, { value: "live", label: "Live", count: counts.kind.live }] },
    { key: "band", label: "Band", selected: filters.band, options: [{ value: "tv", label: "TV band", count: counts.band.tv }, { value: "radio", label: "Radio band", count: counts.band.radio }] },
    { key: "category", label: "Category", selected: filters.category, options: counts.category.map(([c, n]) => ({ value: c, label: c, count: n })) },
    { key: "deal", label: "Deal", selected: filters.deal, options: [{ value: "barter", label: "Barter", count: counts.deal.barter }, { value: "cash", label: "Cash", count: counts.deal.cash }] },
    { key: "made", label: "Made by", selected: filters.made, options: [{ value: "station", label: "Stations", count: counts.made.station }, { value: "studio", label: "Studios", count: counts.made.studio }, { value: "catalog", label: "Opencast catalog", count: counts.made.catalog }] }
  ];

  return (
    <div className="cc-mk">
      <ControlTitle
        title="Syndication market"
        end={<Field aria-label="Search programs and makers" placeholder="Search programs and makers" icon="search" size="sm" type="search" value={q} onChange={(e) => setQ(e.target.value)} className="cc-mk__search" />}
      />
      <MarketTabs value="browse" waiting={waiting} />
      {gap && gapRange && (
        <Notice
          className="cc-mk__gap"
          title={`Fits ${gapRange.words}`}
          action={
            <Button size="sm" onClick={clearGap}>
              Show all
            </Button>
          }
        />
      )}
      <div className="cc-mk__grid">
        <FacetList label="Filter programs" groups={groups} onChange={(key, selected) => setFilters({ ...filters, [key]: selected })} />
        <div className="cc-mk__list">
          <div className="cc-mk__sortbar">
            <span aria-live="polite">{resultWords(shown.length, filters)}</span>
            <span className="cc-mk__sort">
              Sort
              <Segmented options={s.studio ? SORTS.filter((o) => o.value !== "fits") : SORTS} value={filters.sort} onChange={(v) => setFilters({ ...filters, sort: v })} label="Sort" />
            </span>
          </div>
          <OfferTable offers={shown} />
          {!shown.length && <Quietly>No programs match these filters.</Quietly>}
        </div>
      </div>
    </div>
  );
}

function OfferTable({ offers }: { offers: OfferX[] }) {
  const s = useStation();
  const columns: Column<OfferX>[] = [
    { key: "card", width: "112px", cell: (o) => <ProgramCard offer={o} className="cc-mk__tc" /> },
    {
      key: "program",
      header: "Program",
      cell: (o) => {
        const fit = o.fit?.[0];
        return (
          <div className="cc-mk__prog">
            <b>
              {o.program.title}
              {o.maker.id === s.id && <Tag className="cc-mk__yours">Yours</Tag>}
            </b>
            <small>
              <MakerLine offer={o} base={s.base} />
            </small>
            <small className="cc-mk__fmt">{formatLine(o.program)}</small>
            {fit && <FitTag>Fits {fit.label}</FitTag>}
          </div>
        );
      }
    },
    {
      key: "terms",
      header: "Terms",
      width: "210px",
      cell: (o) => {
        const t = termsTwoLines(o, s.id);
        return (
          <div className="cc-mk__terms">
            <em>{t.names}</em>
            {t.detail}
          </div>
        );
      }
    },
    { key: "by", header: "Carried by", width: "92px", cell: (o) => <span className="cc-mk__by">{o.carriers} {o.carriers === 1 ? "station" : "stations"}</span> },
    {
      key: "acts",
      width: "110px",
      align: "end",
      cell: (o) =>
        o.maker.id === s.id ? (
          s.can("programming") ? (
            <Button size="sm" href={`${s.base}/market/offers/${o.id}/terms`}>
              Edit terms
            </Button>
          ) : null
        ) : (
          <Button size="sm" href={`${s.base}/market/offers/${o.id}`} aria-label={`Open ${o.program.title}`}>
            Open
          </Button>
        )
    }
  ];
  return <Table label="Programs offered for carriage" columns={columns} rows={offers} rowKey={(o) => o.id} gap={14} rowPadding={10} className="cc-mk__table" />;
}

/** Market 06.1: on the phone, what fits the gap, and one tap carries it on its default deal. */
function PhoneMarket({ offers, gap, gapStartsAt }: { offers: OfferX[]; gap: string | null; gapStartsAt: string | null }) {
  const s = useStation();
  const carryIntoGap = useCarryIntoGap();
  const now = gap ? offers.filter((o) => o.approval === "any_station") : offers;
  const later = gap ? offers.length - now.length : 0;
  const carriable = gap && s.can("programming") && !s.studio;
  return (
    <div className="cc-mk-phone">
      {now.map((o) => (
        <div key={o.id} className="cc-mk-phone__row">
          <ProgramCard offer={o} size="row" />
          <div className="cc-mk-phone__words">
            <b>{o.program.title}</b>
            <small>
              {makerName(o.maker)}. {termNames(o.termsOffered)}
            </small>
          </div>
          {carriable && gapStartsAt ? (
            <Button size="sm" onClick={() => carryIntoGap(o.program.title, gapPlan(o.id, s.id, o.defaultTerm ?? o.termsOffered[0]!, gapStartsAt), gapStartsAt)} aria-label={`Carry ${o.program.title}`}>
              Carry
            </Button>
          ) : (
            <Button size="sm" href={`${s.base}/market/offers/${o.id}`} aria-label={`Open ${o.program.title}`}>
              Open
            </Button>
          )}
        </div>
      ))}
      {gap ? (
        <p className="cc-mk-phone__foot">
          {now.length ? `${now.length} ${now.length === 1 ? "program fits" : "programs fit"} and can be carried right away.` : "No programs in the market fit this gap."}
          {later > 0 && ` ${later} more ${later === 1 ? "needs" : "need"} the maker’s approval.`}
        </p>
      ) : (
        !offers.length && <Quietly>No programs are offered yet.</Quietly>
      )}
    </div>
  );
}
