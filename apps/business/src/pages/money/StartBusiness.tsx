// biz-funding 01.1 Getting started 1 of 3: Your business (/start, before a business exists, in the
// setup shell). The business, its category, and where its customers are (a location with its
// private street address, a service area around a town, or online in chosen markets); how
// stations will see it and how many can carry its category; Clear offered once. Continue creates
// the business (spots.createBusiness; the creator is its owner) and goes on to funding.

import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { accountsApi, spotsApi, stationsApi, type Business } from "@opencast/contracts";
import { Button, ChipRow, ControlTitle, Field, Reach, Segmented, SelectField, Tag } from "@opencast/ui";
import { ApiError, call } from "../../api/client";
import { useApi } from "../../api/hooks";
import { useClear } from "../../auth/clear";
import { useMe } from "../../business/BusinessContext";
import { CATEGORIES } from "../../components/money/categories";
import { reachWords, townOf, websiteUrl } from "../../components/money/start";
import { useShellOptions } from "../../layout/shell";
import "./StartBusiness.css";

type Where = Business["customersWhere"];

const WHERE: { value: Where; label: string }[] = [
  { value: "location", label: "A location" },
  { value: "service_area", label: "A service area" },
  { value: "online", label: "Online" }
];

export default function StartBusiness() {
  useShellOptions({});
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const markets = useApi(stationsApi.listMarkets, {}, { staleTime: 300_000 });

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [website, setWebsite] = useState("");
  const [where, setWhere] = useState<Where>("location");
  const [address, setAddress] = useState("");
  const [town, setTown] = useState("");
  const [miles, setMiles] = useState("10");
  const [marketIds, setMarketIds] = useState<string[]>([]);
  const clear = useClear();
  const [linking, setLinking] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openMarkets = (markets.data ?? []).filter((m) => m.open);
  const marketId = where === "online" ? (marketIds[0] ?? null) : (me.data?.market?.id ?? openMarkets[0]?.id ?? null);
  const reach = useApi(spotsApi.getCategoryReach, { params: { marketId: marketId ?? "" }, query: { category } }, { enabled: !!category && !!marketId, retry: false, staleTime: 300_000 });
  const reachText = reach.data ? reachWords(reach.data) : null;

  const place = where === "online" ? "Online" : where === "location" ? townOf(address) : town.trim();
  const who = me.data ? `${me.data.displayName ?? me.data.email}, owner` : "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Say what the business is called.";
    if (!category) errs.category = "Choose a category.";
    const url = websiteUrl(website);
    if (url && !/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(url)) errs.website = "That doesn't look like a web address.";
    if (where === "location" && !address.trim()) errs.address = "Give the address customers come to.";
    const radius = Number(miles);
    if (where === "service_area") {
      if (!town.trim()) errs.town = "Give the town you work from.";
      if (!(radius > 0 && radius <= 200)) errs.miles = "Between 1 and 200 miles.";
    }
    if (where === "online" && marketIds.length === 0) errs.markets = "Choose at least one market.";
    setErrors(errs);
    setFailed(null);
    if (Object.keys(errs).length) return;

    setBusy(true);
    try {
      const locations = [];
      if (where !== "online") {
        const q = where === "location" ? address.trim() : town.trim();
        const found = await call(spotsApi.lookupPlace, { query: { q } }).catch((err: unknown) => {
          // 503 not_available: this server has no place lookup (PLACES_URL). Say what still works.
          if (err instanceof ApiError && err.code === "not_available") err = new Error("Addresses can't be looked up here yet. Choose Online to go on.");
          throw Object.assign(err instanceof Error ? err : new Error(String(err)), { field: where === "location" ? "address" : "town" });
        });
        locations.push(
          where === "location"
            ? { kind: "location" as const, streetAddress: found.streetAddress ?? undefined, city: found.city, latitude: found.latitude, longitude: found.longitude }
            : { kind: "service_area" as const, city: found.city, latitude: found.latitude, longitude: found.longitude, radiusMiles: radius }
        );
      }
      const business = await call(spotsApi.createBusiness, {
        body: { name: name.trim(), category, website: url, customersWhere: where, locations, marketIds: where === "online" ? marketIds : [] }
      });
      await qc.invalidateQueries({ queryKey: [accountsApi.getMe.method, accountsApi.getMe.path] });
      navigate(`/${business.id}/start/fund`);
    } catch (err) {
      const field = (err as { field?: string }).field;
      const message = err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong. Try again.";
      if (field) setErrors({ [field]: message });
      else if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else setFailed(message);
      setBusy(false);
    }
  }

  return (
    <form className="bz-start" onSubmit={submit} noValidate>
      <ControlTitle title="Your business" description="Stations see this next to every spot you list." />
      <div className="bz-start__grid">
        <div className="bz-start__form">
          <Field label="Business name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} autoComplete="organization" />
          <div className="bz-start__two">
            <SelectField label="Category" value={category} onChange={(e) => setCategory(e.target.value)} error={errors.category}>
              <option value="" disabled>
                Choose one
              </option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectField>
            <Field label="Website" value={website} onChange={(e) => setWebsite(e.target.value)} error={errors.website} inputMode="url" autoComplete="url" />
          </div>
          <div className="bz-start__where" role="group" aria-labelledby="bz-start-where">
            <span className="bz-start__lb" id="bz-start-where">
              Where your customers are
            </span>
            <Segmented label="Where your customers are" options={WHERE} value={where} onChange={setWhere} className="bz-start__seg" />
            {where === "location" && (
              <Field
                aria-label="Address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                error={errors.address}
                autoComplete="street-address"
                help="Used to target by distance. Stations see the city, not the street. Online businesses choose markets instead."
              />
            )}
            {where === "service_area" && (
              <>
                <div className="bz-start__two bz-start__two--area">
                  <Field aria-label="Town" placeholder="Town" value={town} onChange={(e) => setTown(e.target.value)} error={errors.town} autoComplete="address-level2" />
                  <Field aria-label="Miles around it" mono inputMode="numeric" value={miles} onChange={(e) => setMiles(e.target.value.replace(/[^\d]/g, ""))} error={errors.miles} end={<span className="bz-start__unit">mi</span>} />
                </div>
                <p className="bz-start__help">Used to target by distance. Stations see the town you work from.</p>
              </>
            )}
            {where === "online" && (
              <>
                <ChipRow multiple layout="wrap" label="Markets" options={openMarkets.map((m) => ({ value: m.id, label: m.name }))} value={marketIds} onChange={setMarketIds} />
                {errors.markets ? (
                  <p className="bz-start__err" role="alert">
                    {errors.markets}
                  </p>
                ) : (
                  <p className="bz-start__help">Stations see "Online". Your spots can air across the markets you choose.</p>
                )}
              </>
            )}
          </div>
          <Field label="Your name" value={who} readOnly />
          {(clear.available || clear.account) && (
            <div className="bz-start__clear">
              <div>
                <b>A Clear business account?</b>
                <small>If you have one, connect it now and your balance can be funded from it instantly</small>
              </div>
              {clear.account ? (
                <Tag variant="solid">Connected</Tag>
              ) : (
                <Button
                  size="sm"
                  type="button"
                  disabled={linking}
                  onClick={() => {
                    setLinking(true);
                    setClearError(null);
                    clear
                      .link()
                      .catch((err: Error) => setClearError(err.message))
                      .finally(() => setLinking(false));
                  }}
                >
                  Connect Clear
                </Button>
              )}
            </div>
          )}
          {clearError && (
            <p className="bz-start__err" role="alert">
              {clearError}
            </p>
          )}
        </div>

        <div className="bz-start__side">
          <div className="bz-start__card" aria-live="polite">
            <span className="bz-start__quiet">How stations see you</span>
            <div className="bz-start__nm">{name.trim() || "Your business"}</div>
            <small>{[category, place].filter(Boolean).join(". ") || "Category and town"}</small>
          </div>
          {reachText && reach.data && <Reach className="bz-start__reach" title={reachText.title} reached={reach.data.reached} total={reach.data.total} detail={reachText.detail} />}
          <Button variant="primary" block type="submit" disabled={busy} className="bz-start__go">
            Continue
          </Button>
          {failed && (
            <p className="bz-start__err" role="alert">
              {failed}
            </p>
          )}
        </div>
      </div>
    </form>
  );
}
