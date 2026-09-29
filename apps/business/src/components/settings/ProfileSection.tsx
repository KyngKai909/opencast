// Settings, Business (biz-settings 01.1): the logo, name, category, where customers are, about and
// website, each marked with who sees it; more than one location; and how stations see the
// business. Changes save as each field is left. The owner and managers change it; viewers read it.

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { accountsApi, spotsApi, type BusinessLocation, type CustomersWhere } from "@opencast/contracts";
import { Button, Field, Notice, Segmented, SelectField, TitleCard } from "@opencast/ui";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, call, type CallArgs } from "../../api/client";
import { useApi } from "../../api/hooks";
import { BusinessSettingsX, settingsExtApi } from "../../api/ext/settings";
import { logoOf } from "../../business/logo";
import type { BusinessState } from "../../business/BusinessContext";
import { Quiet } from "../../pages/common";
import { addressLine, websiteShown, websiteToSave, whereLine } from "./format";
import { addressPlace, cityPlace } from "./place";
import { READ_ONLY, accessFor } from "./rules";
import "./common.css";
import "./ProfileSection.css";

/** The categories a business picks from, until the API lists them (P9). The saved one is kept if it isn't here. */
export const CATEGORIES = [
  "Coffee and food",
  "Restaurants",
  "Shops",
  "Health",
  "Beauty",
  "Fitness",
  "Home services",
  "Auto",
  "Professional services",
  "Education",
  "Events",
  "Nonprofit"
];

const MILES = [5, 10, 20, 30, 50];
const WHERE: { value: CustomersWhere; label: string }[] = [
  { value: "location", label: "A location" },
  { value: "service_area", label: "A service area" },
  { value: "online", label: "Online" }
];

const MARKET_NAME = "Inland Empire";

type FieldName = "name" | "category" | "where" | "about" | "website" | "logo" | "locations";

function oops(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong. Try again.";
}

export function ProfileSection({ b, onAddLocation }: { b: BusinessState; onAddLocation: () => void }) {
  const q = useApi(spotsApi.getBusiness, { params: { businessId: b.id } }, { schema: BusinessSettingsX });
  const qc = useQueryClient();
  const edit = accessFor(b.role).profile === "edit";
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [website, setWebsite] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [mode, setMode] = useState<CustomersWhere>("location");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: FieldName; message: string } | null>(null);
  const [recategorised, setRecategorised] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const data = q.data;
  const first = data?.locations[0];
  useEffect(() => {
    if (!data) return;
    setName(data.name);
    setAbout(data.about ?? "");
    setWebsite(websiteShown(data.website));
    setMode(data.customersWhere);
    const l = data.locations[0];
    setAddress(l ? addressLine(l) : "");
    setCity(l?.city ?? "");
  }, [data]);

  if (q.isLoading) return <Quiet />;
  if (!data) return <p className="bz-error" role="alert">{(q.error as Error | null)?.message ?? "Something went wrong. Try again."}</p>;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: [spotsApi.getBusiness.method, spotsApi.getBusiness.path] });
    void qc.invalidateQueries({ queryKey: [accountsApi.getMe.method, accountsApi.getMe.path] });
  };
  const params = { businessId: b.id };
  /** Runs calls in order, then refreshes; the first failure is shown by the field. */
  const run = async (field: FieldName, steps: (() => Promise<unknown>)[]) => {
    setError(null);
    setBusy(true);
    try {
      for (const s of steps) await s();
      return true;
    } catch (e) {
      setError({ field, message: oops(e) });
      return false;
    } finally {
      setBusy(false);
      refresh();
    }
  };
  const update = (body: CallArgs["body"]) => () => call(spotsApi.updateBusiness, { params, body });
  const updateLocation = (l: BusinessLocation, body: CallArgs["body"]) => () => call(settingsExtApi.updateLocation, { params: { ...params, locationId: l.id }, body });
  const errorFor = (f: FieldName) => (error?.field === f ? error.message : undefined);

  const saveName = () => {
    const v = name.trim();
    if (!v) return setError({ field: "name", message: "A business needs a name." });
    if (v !== data.name) void run("name", [update({ name: v })]);
  };
  const saveAbout = () => {
    const v = about.trim();
    if (v !== (data.about ?? "")) void run("about", [update({ about: v || null })]);
  };
  const saveWebsite = () => {
    const v = websiteToSave(website);
    if (v !== data.website && websiteShown(v) !== websiteShown(data.website)) void run("website", [update({ website: v })]);
  };
  const saveCategory = async (v: string) => {
    if (v === data.category) return;
    if (await run("category", [update({ category: v })])) setRecategorised(v);
  };

  const saveAddress = () => {
    if (first && first.kind === "location" && address.trim() === addressLine(first)) return;
    const place = addressPlace(address);
    if (!place) return setError({ field: "where", message: "Enter a street and a city, like 204 Orange St, Redlands." });
    const body = { kind: "location", ...place, radiusMiles: null };
    void run("where", [
      first ? updateLocation(first, body) : () => call(spotsApi.addLocation, { params, body: { kind: "location", ...place, streetAddress: place.streetAddress ?? undefined } }),
      ...(data.customersWhere !== "location" ? [update({ customersWhere: "location" })] : [])
    ]);
  };
  const saveServiceArea = (miles: number, cityText = city) => {
    const place = cityPlace(cityText);
    if (!place) return setError({ field: "where", message: `Enter a city in the ${MARKET_NAME}, like Riverside.` });
    if (first && first.kind === "service_area" && first.city === place.city && first.radiusMiles === miles && data.customersWhere === "service_area") return;
    void run("where", [
      first
        ? updateLocation(first, { kind: "service_area", ...place, radiusMiles: miles })
        : () => call(spotsApi.addLocation, { params, body: { kind: "service_area", city: place.city, latitude: place.latitude, longitude: place.longitude, radiusMiles: miles } }),
      ...(data.customersWhere !== "service_area" ? [update({ customersWhere: "service_area" })] : [])
    ]);
  };
  const chooseMode = (v: CustomersWhere) => {
    setError(null);
    setMode(v);
    if (v === "online") void run("where", [update({ customersWhere: "online" })]);
    else if (v === "service_area" && first) saveServiceArea(first.radiusMiles ?? 10, first.city);
    else if (v === "location" && first?.kind === "location") void run("where", [update({ customersWhere: "location" })]);
    // A location from a service area needs its street first: saved when the address is entered.
  };

  const replaceLogo = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const bmp = await createImageBitmap(f);
      if (bmp.width !== bmp.height || bmp.width < 256) return setError({ field: "logo", message: "The logo has to be square, at least 256 pixels." });
    } catch {
      return setError({ field: "logo", message: "That image couldn't be read. Try a PNG or JPEG." });
    }
    void run("logo", [() => call(settingsExtApi.uploadLogo, { params, body: { file: f } })]);
  };

  const removeLocation = (l: BusinessLocation) => void run("locations", [() => call(spotsApi.removeLocation, { params: { ...params, locationId: l.id } })]);

  const logo = logoOf(data, data.name);
  const categories = CATEGORIES.includes(data.category) ? CATEGORIES : [data.category, ...CATEGORIES];
  const extra = data.locations.slice(1);
  const currentMiles = first?.kind === "service_area" ? (first.radiusMiles ?? 10) : 10;
  const whereHelp =
    mode === "online"
      ? `Stations see "Online". Spots reach the whole ${MARKET_NAME}. A location or a service area targets a distance instead.`
      : mode === "service_area"
        ? `Stations see ${first?.city ?? "your city"}, ${currentMiles} miles. A location targets a distance from your door; online businesses choose markets instead.`
        : `Private. Stations see ${first?.city ?? "your city"}. A service area targets a radius from a city; online businesses choose markets instead.`;

  return (
    <div className="bz-profile">
      <div className="bz-profile__form">
        {!edit && <p className="bz-readonly">{READ_ONLY.profile}</p>}
        <div className="bz-logo">
          {data.logoUrl ? (
            <img className="bz-logo__sq" src={data.logoUrl} alt={`${data.name}'s logo`} />
          ) : (
            <span className="bz-logo__sq" style={{ background: logo.colour }} aria-hidden="true">
              {logo.initials}
            </span>
          )}
          <div>
            <b className="bz-logo__h">Logo</b>
            <small className="bz-logo__s">Shown on saved offers. Square, at least 256 pixels</small>
          </div>
          {edit && (
            <>
              <Button size="sm" className="bz-logo__btn" onClick={() => file.current?.click()} disabled={busy}>
                Replace
              </Button>
              <input ref={file} type="file" accept="image/png,image/jpeg" hidden onChange={replaceLogo} aria-label="Choose a logo" />
            </>
          )}
        </div>
        {errorFor("logo") && (
          <p className="bz-error bz-profile__logo-error" role="alert">
            {errorFor("logo")}
          </p>
        )}
        <div className="bz-fld">
          <Field label="Name" labelAside="Everyone sees this" value={name} maxLength={120} disabled={!edit} onChange={(e) => setName(e.target.value)} onBlur={saveName} error={errorFor("name")} />
        </div>
        <div className="bz-fld">
          <SelectField label="Category" labelAside="Stations see this" value={data.category} disabled={!edit || busy} onChange={(e) => void saveCategory(e.target.value)} error={errorFor("category")}>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="bz-fld" role="group" aria-labelledby="bz-where">
          <span className="bz-fld__lb" id="bz-where">
            Where your customers are
          </span>
          <Segmented<CustomersWhere>
            label="Where your customers are"
            className="bz-profile__seg"
            value={mode}
            onChange={chooseMode}
            options={WHERE.map((o) => ({ ...o, disabled: !edit }))}
          />
          {mode === "location" && (
            <Field
              aria-label="Street address"
              value={address}
              placeholder="Street and city"
              disabled={!edit}
              autoComplete="street-address"
              onChange={(e) => setAddress(e.target.value)}
              onBlur={saveAddress}
              onKeyDown={(e) => e.key === "Enter" && saveAddress()}
            />
          )}
          {mode === "service_area" && (
            <div className="bz-profile__area">
              <Field aria-label="City" value={city} placeholder="City" disabled={!edit} onChange={(e) => setCity(e.target.value)} onBlur={() => saveServiceArea(currentMiles)} onKeyDown={(e) => e.key === "Enter" && saveServiceArea(currentMiles)} />
              <SelectField aria-label="Miles around it" value={String(currentMiles)} disabled={!edit || busy || !first} onChange={(e) => saveServiceArea(Number(e.target.value))}>
                {MILES.map((m) => (
                  <option key={m} value={m}>
                    {m} miles
                  </option>
                ))}
              </SelectField>
            </div>
          )}
          {mode === "online" && <Field aria-label="Market" value={MARKET_NAME} readOnly disabled />}
          {errorFor("where") ? (
            <p className="bz-error" role="alert">
              {errorFor("where")}
            </p>
          ) : (
            <p className="bz-fld__help">{whereHelp}</p>
          )}
        </div>
        <div className="bz-fld">
          <Field label="About" labelAside="Stations see this" value={about} maxLength={300} disabled={!edit} onChange={(e) => setAbout(e.target.value)} onBlur={saveAbout} error={errorFor("about")} />
        </div>
        <div className="bz-fld">
          <Field
            label="Website"
            labelAside="Viewers see this on saved offers"
            value={website}
            inputMode="url"
            disabled={!edit}
            onChange={(e) => setWebsite(e.target.value)}
            onBlur={saveWebsite}
            error={errorFor("website")}
          />
        </div>
        {mode !== "online" && (
          <div className="bz-profile__locs">
            {extra.map((l) => (
              <div key={l.id} className="bz-row">
                <div>
                  <b>{l.label ?? l.city}</b>
                  <small>
                    {addressLine(l)}
                    {l.kind === "service_area" && l.radiusMiles ? `, ${l.radiusMiles} miles` : ""}. Spots can target it
                  </small>
                </div>
                {edit && (
                  <Button size="sm" onClick={() => removeLocation(l)} disabled={busy}>
                    Remove
                  </Button>
                )}
              </div>
            ))}
            {edit && (
              <div className="bz-row">
                <div>
                  <b>{extra.length ? "Another location?" : "More than one location?"}</b>
                  <small>{extra.length ? "Spots can target any of your locations" : "Add a second location. Spots can target either or both"}</small>
                </div>
                <Button size="sm" onClick={onAddLocation}>
                  Add a location
                </Button>
              </div>
            )}
            {errorFor("locations") && (
              <p className="bz-error" role="alert">
                {errorFor("locations")}
              </p>
            )}
          </div>
        )}
      </div>
      <aside className="bz-profile__seen" aria-labelledby="bz-seen">
        <div className="bz-sec-top">
          <h4 className="bz-sec-top__h" id="bz-seen">
            As stations see you
          </h4>
        </div>
        <div className="bz-seen">
          <TitleCard colour={logo.colour} title={data.shortName ?? data.name} className="bz-seen__tc" decorative />
          <div>
            <b className="bz-seen__name">{data.name}</b>
            <small className="bz-seen__where">{whereLine(data)}</small>
            {data.about && <small className="bz-seen__about">{data.about}</small>}
          </div>
        </div>
        {recategorised ? (
          <Notice tone="plain" icon={null} className="bz-seen__notice" title={`Category changed to ${recategorised}.`}>
            {" "}Re-checked against the stations that block categories. Spots already in rotation stay until a station decides otherwise.
          </Notice>
        ) : (
          <p className="bz-note">Changing your category re-checks which stations can carry you. Spots already in rotation stay until a station decides otherwise.</p>
        )}
      </aside>
    </div>
  );
}
