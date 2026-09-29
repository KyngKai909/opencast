// biz-spots 03.1 rate, budget and who it's for, with named stations (/:businessId/spots/:spotId/setup/rate).
//
// A rate per 1,000 tuned in or per airing, turned into dollars an airing from the matched
// stations; a total budget and an optional daily cap, turned into airings a day and days; then
// who it's for: distance (or markets, for an online business), kinds of station and times of day,
// ending in the stations it matches, named, with the ones left out and why. The draft is saved as
// it changes (updateSpot), so the matches (matchStations) price it at the rate on screen. "List"
// sends it to review (submitSpot); after review it's listed.

import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { spotsApi, stationsApi, type Business, type TargetMatch } from "@opencast/contracts";
import { Button, ChipRow, Field, money, Segmented } from "@opencast/ui";
import { call } from "../../api/client";
import { useApi } from "../../api/hooks";
import type { SpotX, TargetingX } from "../../api/ext/spots";
import { useBusiness } from "../../business/BusinessContext";
import { errorText, useBalance, useSpot, useSpotWrite } from "../../components/spots/data";
import { budgetEstimate, parseDollars, plural, scaleCost, summarizeMatches, targetingWords } from "../../components/spots/format";
import { LoadError, Section, SpotHead, ViewerBlocked } from "../../components/spots/parts";
import { DAYPARTS, DistanceSlider, KINDS, MarketPreview, MatchList, RADIO, type Daypart } from "../../components/spots/Targeting";
import { useShellOptions } from "../../layout/shell";
import { Quiet } from "../common";
import "./SpotRate.css";

export default function SpotRate() {
  const b = useBusiness();
  const { spotId } = useParams();
  useShellOptions({ title: "Rate and budget" });
  const allowed = b.can("advertise");
  const spot = useSpot(allowed ? spotId : undefined);
  const business = useApi(spotsApi.getBusiness, { params: { businessId: b.id } }, { enabled: allowed });
  if (!allowed) return <ViewerBlocked />;
  if (spot.isLoading || business.isLoading) return <Quiet />;
  if (spot.error || business.error) return <LoadError message={errorText(spot.error ?? business.error)} />;
  const s = spot.data!;
  if (s.state !== "draft") return <Navigate to={`${b.base}/spots/${s.id}`} replace />;
  if (!s.file) return <Navigate to={`${b.base}/spots/${s.id}/setup`} replace />;
  return <RateForm spot={s} business={business.data!} />;
}

const ALL_DAYPARTS = DAYPARTS.map((d) => d.value);

function RateForm({ spot, business }: { spot: SpotX; business: Business }) {
  const b = useBusiness();
  const navigate = useNavigate();
  const balance = useBalance(b.id);
  const online = business.customersWhere === "online";
  const markets = useApi(stationsApi.listMarkets, {}, { enabled: online, staleTime: 300_000 });

  const t = spot.targeting;
  const [kind, setKind] = useState(spot.rate.kind);
  const [rateText, setRateText] = useState(money(spot.rate.micros));
  const [totalText, setTotalText] = useState(money(spot.budget.totalMicros));
  const [capText, setCapText] = useState(spot.budget.dailyCapMicros !== null ? money(spot.budget.dailyCapMicros) : "");
  const [within, setWithin] = useState(t.withinMiles ?? 10);
  const [marketIds, setMarketIds] = useState<string[]>(t.marketIds.length ? t.marketIds : business.marketIds);
  const [kinds, setKinds] = useState<string[]>(t.stationCategories.length ? t.stationCategories : [...KINDS]);
  const [radio, setRadio] = useState((t.bands ?? []).includes("radio"));
  const [dayparts, setDayparts] = useState<Daypart[]>(t.dayparts.length ? t.dayparts : [...ALL_DAYPARTS]);

  const rate = parseDollars(rateText);
  const total = parseDollars(totalText);
  const cap = capText.trim() ? parseDollars(capText) : null;
  const rateError = rate === null || rate <= 0 ? "Enter a rate, like $8.00" : undefined;
  const totalError = total === null || total <= 0 ? "Enter a budget, like $300.00" : undefined;
  const capError = capText.trim() && (cap === null || cap <= 0) ? "Enter an amount, or leave it empty for no cap" : cap !== null && total !== null && cap > total ? "The most per day can't be more than the total" : undefined;

  const targeting: Partial<TargetingX> = useMemo(
    () => ({
      withinMiles: online ? null : within,
      marketIds: online ? marketIds : [],
      stationCategories: kinds,
      dayparts,
      bands: radio ? ["tv", "radio"] : ["tv"]
    }),
    [online, within, marketIds, kinds, dayparts, radio]
  );
  const typedRate = { kind, micros: rate ?? spot.rate.micros, perAiringMaxMicros: null };

  // Save the draft as it changes, so the matches price it at the rate on screen.
  const save = useSpotWrite(spotsApi.updateSpot);
  const draftBody = useMemo(
    () => ({
      ...(rate && rate > 0 ? { rate: { kind, micros: rate, perAiringMaxMicros: null } } : {}),
      ...(total && total > 0 && !capError ? { budget: { totalMicros: total, dailyCapMicros: cap } } : {}),
      targeting
    }),
    [kind, rate, total, cap, capError, targeting]
  );
  const draftKey = JSON.stringify(draftBody);
  const firstKey = useRef(draftKey);
  useEffect(() => {
    if (draftKey === firstKey.current) return;
    const id = setTimeout(() => save.mutate({ params: { spotId: spot.id }, body: draftBody }), 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  const matches = useQuery({
    queryKey: ["bz-spot-matches", spot.id, JSON.stringify(targeting), JSON.stringify(spot.rate)],
    queryFn: () => call(spotsApi.matchStations, { params: { spotId: spot.id }, body: targeting }),
    placeholderData: keepPreviousData
  });
  const stations: TargetMatch[] = (matches.data?.stations ?? []).map((m) =>
    m.estimatedCostPerAiringMicros
      ? { ...m, estimatedCostPerAiringMicros: { low: scaleCost(m.estimatedCostPerAiringMicros.low, spot.rate, typedRate), high: scaleCost(m.estimatedCostPerAiringMicros.high, spot.rate, typedRate) } }
      : m
  );
  const sum = summarizeMatches(stations);
  const est = budgetEstimate(total ?? 0, cap, sum.mid);
  const n = sum.included.length;

  const available = balance.data?.availableMicros ?? null;
  const dayOfBudget = cap ?? est.perDay ?? null;
  const short = available !== null && cap !== null && available < cap;
  const place = business.locations.find((l) => t.locationIds.includes(l.id))?.city ?? business.locations[0]?.city ?? "you";

  const submit = useSpotWrite(spotsApi.submitSpot);
  const [listError, setListError] = useState<string | null>(null);
  const invalid = !!(rateError || totalError || capError) || kinds.length === 0 || dayparts.length === 0;
  const list = async () => {
    setListError(null);
    try {
      await save.mutateAsync({ params: { spotId: spot.id }, body: draftBody });
      const s = await submit.mutateAsync({ params: { spotId: spot.id } });
      navigate(`${b.base}/spots/${s.id}`);
    } catch (e) {
      setListError(errorText(e));
    }
  };
  const busy = submit.isPending;

  // Stations see the city of the location it's targeted from (never the street address).
  const cityLine = online ? "Online" : place;

  return (
    <div className="bz-rate">
      <SpotHead crumb="New spot" title={`${spot.title}: rate and budget`} />
      <div className="bz-rate__grid">
        <div>
          <Section title="Rate">
            <div className="bz-rate__pay">
              <b id="bz-pay">Pay</b>
              <Segmented
                label="Pay"
                value={kind}
                onChange={setKind}
                options={[
                  { value: "per_thousand", label: "Per 1,000 tuned in" },
                  { value: "per_airing", label: "Per airing" }
                ]}
              />
            </div>
            <Field
              label="Rate"
              mono
              className="bz-rate__rate"
              inputMode="decimal"
              value={rateText}
              onChange={(e) => setRateText(e.target.value)}
              onBlur={() => rate && setRateText(money(rate))}
              error={rateError}
            />
            <p className="bz-rate__est">
              {kind === "per_thousand" && sum.low !== null && sum.high !== null ? (
                <>
                  On these stations that's usually <b>{sum.low === sum.high ? `${money(sum.low)} an airing` : `${money(sum.low)} to ${money(sum.high)} an airing`}</b>.{" "}
                </>
              ) : null}
              Stations see your rate before they add the spot.
            </p>
          </Section>
          <Section title="Budget">
            <div className="bz-rate__two">
              <Field label="In total" mono inputMode="decimal" value={totalText} onChange={(e) => setTotalText(e.target.value)} onBlur={() => total && setTotalText(money(total))} error={totalError} />
              <Field label="Most per day" mono inputMode="decimal" value={capText} placeholder="No cap" onChange={(e) => setCapText(e.target.value)} onBlur={() => cap && setCapText(money(cap))} error={capError} />
            </div>
            <p className="bz-rate__est">
              {est.perDay !== null && est.days !== null ? (
                <>
                  About <b>{plural(est.perDay, "airing", "airings")} a day</b>, for about <b>{plural(est.days, "day", "days")}</b>.{" "}
                </>
              ) : est.inAll !== null ? (
                <>
                  About <b>{plural(est.inAll, "airing", "airings")}</b> in all.{" "}
                </>
              ) : null}
              {available !== null && `You have ${money(available)} available.`}
            </p>
            {short && dayOfBudget !== null && (
              <p className="bz-rate__warn">
                Listing needs a day of budget available, {money(dayOfBudget)}. <a href={`${b.base}/balance`}>Add money</a> first.
              </p>
            )}
          </Section>
          <Section title="Who it's for">
            {online ? (
              <div className="bz-rate__fld">
                <span className="bz-rate__lb">Markets</span>
                <ChipRow
                  multiple
                  label="Markets"
                  value={marketIds}
                  onChange={setMarketIds}
                  options={(markets.data ?? []).map((m) => ({ value: m.id, label: m.name }))}
                />
              </div>
            ) : (
              <DistanceSlider value={within} onChange={setWithin} place={place} />
            )}
            <div className="bz-rate__fld bz-rate__fld--kinds">
              <span className="bz-rate__lb">Kinds of station</span>
              <ChipRow
                multiple
                size="md"
                label="Kinds of station"
                value={[...kinds, ...(radio ? [RADIO] : [])]}
                onChange={(v) => {
                  setKinds(v.filter((x) => x !== RADIO));
                  setRadio(v.includes(RADIO));
                }}
                options={[...KINDS, RADIO].map((k) => ({ value: k, label: k }))}
              />
              {kinds.length === 0 && <p className="bz-rate__warn">Choose at least one kind of station.</p>}
            </div>
            <div className="bz-rate__fld">
              <span className="bz-rate__lb">Times of day</span>
              <ChipRow multiple size="md" label="Times of day" value={dayparts} onChange={(v) => setDayparts(v as Daypart[])} options={DAYPARTS} />
              {dayparts.length === 0 && <p className="bz-rate__warn">Choose at least one time of day.</p>}
            </div>
          </Section>
        </div>
        <div className="bz-rate__side">
          {matches.error ? (
            <LoadError message={errorText(matches.error)} />
          ) : (
            <MatchList stations={stations} loading={matches.isFetching} summary={targetingWords({ withinMiles: online ? null : within, stationCategories: kinds, dayparts }, KINDS.length, ALL_DAYPARTS.length)} />
          )}
          <Section title="How stations will see it" className="bz-rate__preview">
            <MarketPreview spot={spot} business={{ name: business.name, line: `${business.category}. ${cityLine}` }} days={est.days} rate={typedRate} />
          </Section>
          <Button variant="primary" block className="bz-rate__list" disabled={invalid || busy || n === 0} onClick={() => void list()}>
            {`List ${spot.title}`}
          </Button>
          {listError && (
            <p className="bz-sperror" role="alert">
              {listError}
            </p>
          )}
          <p className="bz-rate__after">
            It goes to review first, usually within a few hours. Then {n === 1 ? "this station" : `these ${n} stations`} can add it.
          </p>
        </div>
      </div>
    </div>
  );
}
