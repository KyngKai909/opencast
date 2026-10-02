// First visit (viewer/opencast-home.html 08.1): "Where are you tuning in from?" Full screen on the
// phone, a modal over the dial on the web. It opens on the first visit (no market on this device
// or the account) and from the market button (?modal=market). Choosing keeps the market on this
// device, and on the account when signed in. The location is used once, to ask the API for the
// market around it (S10, markets.by-location), and isn't stored.

import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { accountsApi, stationsApi, type Market } from "@opencast/contracts";
import { Button, ChoiceList, Field, Lockup, Modal } from "@opencast/ui";
import { ApiError, call } from "../../../api/client";
import { keyFor } from "../../../api/hooks";
import { useAuth } from "../../../auth/AuthProvider";
import { useMarkets, useMarketSlug, useMe } from "../../data/viewer";
import { setDevice } from "../../device/store";
import { useIsPhone } from "../../layout/shell";
import { stationsText } from "../home/logic";
import "./MarketPicker.css";

function locate(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("unavailable"));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 });
  });
}

export default function MarketPicker() {
  const phone = useIsPhone();
  const auth = useAuth();
  const me = useMe();
  const qc = useQueryClient();
  const slug = useMarketSlug();
  const [params, setParams] = useSearchParams();
  const markets = useMarkets();
  const [zip, setZip] = useState("");
  const [zipError, setZipError] = useState<string | null>(null);
  const [locError, setLocError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"zip" | "location" | "save" | null>(null);

  const asked = params.get("modal") === "market";
  // First visit: nothing on this device, and (signed in) nothing on the account either.
  const firstVisit = !slug && (!auth.signedIn || (!!me.data && !me.data.market));
  const open = asked || firstVisit;

  useEffect(() => {
    if (!open) {
      setZip("");
      setZipError(null);
      setLocError(null);
      setError(null);
      setBusy(null);
    }
  }, [open]);

  if (!open) return null;

  const close = () => {
    if (!slug) return; // The dial needs a market: first visit ends by choosing one.
    setParams((p) => {
      p.delete("modal");
      return p;
    });
  };

  const choose = async (m: Pick<Market, "id" | "slug" | "open">) => {
    if (!m.open) return;
    setError(null);
    setDevice({ marketSlug: m.slug });
    if (auth.signedIn) {
      setBusy("save");
      try {
        await call(accountsApi.updateMe, { body: { marketId: m.id } });
        await qc.invalidateQueries({ queryKey: keyFor(accountsApi.getMe).slice(0, 2) });
      } catch (e) {
        setBusy(null);
        setError((e as Error).message);
        return;
      }
      setBusy(null);
    }
    setParams((p) => {
      p.delete("modal");
      return p;
    });
  };

  const lookUp = async (code: string) => {
    setZipError(null);
    if (!/^\d{5}$/.test(code)) return setZipError("Enter a five-digit ZIP code.");
    setBusy("zip");
    try {
      const r = await call(stationsApi.marketForZip, { params: { zip: code } });
      setBusy(null);
      if (r.market) return void choose(r.market);
      const near = r.nearby[0];
      setZipError(near ? `${code} isn't in a market yet. The nearest is ${near.market.name}, ${Math.round(near.miles)} miles away. Pick it below, or any other.` : `${code} isn't in a market yet. Pick the nearest one below.`);
    } catch (err) {
      setBusy(null);
      setZipError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    }
  };

  const onLocation = async () => {
    setLocError(null);
    setBusy("location");
    let pos: GeolocationPosition;
    try {
      pos = await locate();
    } catch (err) {
      setBusy(null);
      const denied = (err as GeolocationPositionError)?.code === 1;
      setLocError(denied ? "Location is off for this site. Enter a ZIP code or pick a market instead." : "Your location couldn't be found. Enter a ZIP code or pick a market instead.");
      return;
    }
    try {
      const r = await call(stationsApi.marketForLocation, { query: { lat: pos.coords.latitude, lng: pos.coords.longitude } });
      setBusy(null);
      if (r.market?.open) return void choose(r.market);
      setLocError("There's no market near you yet. Pick the nearest one below, or enter a ZIP code.");
    } catch (err) {
      setBusy(null);
      setLocError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    }
  };

  const list = markets.data ?? [];
  const body = (
    <div className="vw-market">
      {phone && <Lockup size="phone" className="vw-market__logo" />}
      {phone && <h2 className="vw-market__title">Where are you tuning in from?</h2>}
      <p className="vw-market__lede">Your market decides which stations come first on your dial. You can still tune in to any station, anywhere.</p>
      <Button variant="primary" block icon="pin" onClick={onLocation} disabled={busy !== null} aria-busy={busy === "location" || undefined}>
        Use my location
      </Button>
      {locError && (
        <p className="vw-market__err" role="alert">
          {locError}
        </p>
      )}
      <form
        noValidate
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void lookUp(zip);
        }}
      >
        <label className="vw-market__or" htmlFor="vw-market-zip">
          Or enter a ZIP code
        </label>
        <Field
          id="vw-market-zip"
          value={zip}
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={5}
          mono
          error={zipError ?? undefined}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 5);
            setZip(v);
            setZipError(null);
            // Five digits is a whole ZIP: look it up without a button.
            if (v.length === 5 && v !== zip) void lookUp(v);
          }}
          aria-busy={busy === "zip" || undefined}
        />
      </form>
      <p className="vw-market__or" id="vw-market-pick">
        Or pick one
      </p>
      {markets.error ? (
        <p className="vw-market__err" role="alert">
          {(markets.error as Error).message}
        </p>
      ) : !markets.data ? (
        <div className="vw-market__wait" aria-busy="true" aria-labelledby="vw-market-pick" />
      ) : (
        <ChoiceList
          label="Pick a market"
          className="vw-market__list"
          value={list.find((m) => m.slug === slug)?.id ?? null}
          onChange={(id) => {
            const m = list.find((x) => x.id === id);
            if (m) void choose(m);
          }}
          options={list.map((m) => ({ value: m.id, title: m.name, end: m.open ? (m.stationCount !== undefined ? stationsText(m.stationCount) : undefined) : "Not open yet", disabled: !m.open || busy !== null }))}
        />
      )}
      {error && (
        <p className="vw-market__err" role="alert">
          {error}
        </p>
      )}
      <p className="vw-market__skip">Your location is only used to pick a market and isn't stored.</p>
    </div>
  );

  return (
    <Modal open onClose={close} showClose={!!slug} title={phone ? undefined : "Where are you tuning in from?"} label="Where are you tuning in from?" className={phone ? "vw-market-full" : undefined}>
      {body}
    </Modal>
  );
}
