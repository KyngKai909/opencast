// A.1 Your station, setup step 1: name, call sign, band, market, channel and colour, with the
// station as viewers will see it. Each field saves as you go; the first save starts the station
// (`/new` creates it, then carries on at /setup/:stationId/station). A colour that fails 4.5:1
// against white can't be saved, and says why.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { accountsApi, stationsApi, waitlistApi, type StationSetup } from "@opencast/contracts";
import {
  Button,
  ChannelPicker,
  ControlFoot,
  ControlTitle,
  DialRow,
  Field,
  Icon,
  PictureFrame,
  PicturePlaceholder,
  Segmented,
  SelectField,
  StationBand,
  contrastRatio,
  ratioLabel,
  stationColourPasses,
  useToast
} from "@opencast/ui";
import { call } from "../../../api/client";
import { useApi } from "../../../api/hooks";
import { now, STATION_TZ } from "../../../lib/clock";
import "./StationForm.css";
import { controlPath } from "../../../areas";

/** The six colours the frame offers; any #rrggbb that holds 4.5:1 can be typed. */
export const SWATCHES = ["#2E6B5A", "#8C3B7A", "#9A5412", "#1F5E8C", "#7E2F35", "#56508A"];

/** What the call sign field says: free, taken, or not three to five capitals. */
export function callSignState(typed: string, own: string | null, check: { valid: boolean; available: boolean } | undefined): "empty" | "invalid" | "free" | "taken" | "checking" {
  if (!typed) return "empty";
  if (!/^[A-Z]{3,5}$/.test(typed)) return "invalid";
  if (own && typed === own) return "free";
  if (!check) return "checking";
  return check.available ? "free" : "taken";
}

/** "#8C3B7A" from what's typed, or null when it isn't a colour yet. */
export function readColour(typed: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(typed.trim());
  return m ? `#${m[1].toUpperCase()}` : null;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function StationForm({ setup }: { setup: StationSetup | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const st = setup?.station ?? null;
  const [id, setId] = useState<string | null>(st?.id ?? null);
  const [name, setName] = useState(st?.name ?? "");
  const [callSign, setCallSign] = useState(st?.callSign ?? "");
  const [band, setBand] = useState<"tv" | "radio">(st?.band ?? "tv");
  const [channel, setChannel] = useState<string | null>(st?.channel ?? null);
  const [colourText, setColourText] = useState(st?.colour ?? SWATCHES[1]);
  const [changingMarket, setChangingMarket] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const markets = useApi(stationsApi.listMarkets, {});
  const me = useApi(accountsApi.getMe, {});
  const market = markets.data?.find((m) => m.slug === (st?.marketSlug ?? me.data?.market?.slug)) ?? markets.data?.[0] ?? null;
  const channels = useApi(stationsApi.availableChannels, { params: { marketSlug: market?.slug ?? "" }, query: { band } }, { enabled: !!market });
  const typedSign = useDebounced(callSign, 250);
  const check = useApi(waitlistApi.checkCallSign, { params: { callSign: typedSign } }, { enabled: /^[A-Z]{3,5}$/.test(typedSign) && typedSign !== st?.callSign });
  const signState = callSignState(callSign, st?.callSign ?? null, typedSign === callSign ? check.data : undefined);

  const colour = readColour(colourText);
  const ratio = colour ? contrastRatio(colour, "#FFFFFF") : null;
  const passes = !!colour && stationColourPasses(colour);
  const fixed = !!setup?.fixed;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: [accountsApi.getMe.method, accountsApi.getMe.path] });
    void qc.invalidateQueries({ queryKey: [stationsApi.getSetup.method, stationsApi.getSetup.path] });
    void qc.invalidateQueries({ queryKey: [stationsApi.availableChannels.method, stationsApi.availableChannels.path] });
  };

  /** Starts the station on the first save; after that, returns its id. */
  const ensure = async (): Promise<string | null> => {
    if (id) return id;
    if (!name.trim()) return null;
    const made = await call(stationsApi.createStation, { body: { kind: "station", name: name.trim(), ...(passes && colour ? { colour } : {}) } });
    setId(made.station.id);
    return made.station.id;
  };

  const save = async (what: () => Promise<unknown>) => {
    setError(null);
    try {
      await what();
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveAll = async (sid: string) => {
    if (name.trim() && name.trim() !== st?.name) await call(stationsApi.updateSetup, { params: { stationId: sid }, body: { name: name.trim() } });
    if (signState === "free" && callSign !== st?.callSign && !fixed) await call(stationsApi.updateSetup, { params: { stationId: sid }, body: { callSign } });
    if (passes && colour && colour !== st?.colour) await call(stationsApi.updateSetup, { params: { stationId: sid }, body: { colour } });
    if (channel && market && !fixed && (channel !== st?.channel || band !== st?.band)) await call(stationsApi.chooseChannel, { params: { stationId: sid }, body: { marketId: market.id, band, channel } });
  };

  // The first save on /new starts the station, then setup carries on under its id.
  const saveField = (fn: (sid: string) => Promise<unknown>) =>
    save(async () => {
      const had = id;
      const sid = await ensure();
      if (!sid) return;
      if (!had) {
        await saveAll(sid);
        navigate(controlPath(`/setup/${sid}/station`), { replace: true });
        return;
      }
      await fn(sid);
    });

  const pickChannel = (v: string) => {
    const full = band === "tv" ? `${v}.1` : v;
    setChannel(full);
    if (market && !fixed) void saveField((sid) => call(stationsApi.chooseChannel, { params: { stationId: sid }, body: { marketId: market.id, band, channel: full } }));
  };

  const pickColour = (c: string) => {
    setColourText(c);
    if (stationColourPasses(c)) void saveField((sid) => call(stationsApi.updateSetup, { params: { stationId: sid }, body: { colour: c } }));
  };

  const ready = !!name.trim() && signState === "free" && !!channel && passes;
  const onContinue = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const sid = await ensure();
      if (!sid) return;
      await saveAll(sid);
      refresh();
      navigate(controlPath(`/setup/${sid}/library`));
    } catch (e) {
      setError((e as Error).message);
      toast.show({ message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  // The dial's options: taken ones struck through, this station's own choice open.
  const options = (channels.data?.channels ?? []).map((c) => {
    const mine = c.channel === channel || c.channel === st?.channel;
    return { value: band === "tv" ? c.channel.split(".")[0] : c.channel, taken: c.state !== "open" && !mine };
  });
  const pickerValue = channel ? (band === "tv" ? channel.split(".")[0] : channel) : undefined;
  const channelText = channel ?? "";
  const shown = { channel: channelText, callSign: callSign || "", colour: passes && colour ? colour : (st?.colour ?? SWATCHES[1]), name: name || undefined };
  const firstUntil = (() => {
    const t = new Date(now());
    t.setMinutes(60, 0, 0);
    return t.toISOString();
  })();
  const marketName = market?.name ?? "your market";

  const signField = (
    <Field
      label="Call sign"
      className="cc-sf__sign"
      value={callSign}
      onChange={(e) => setCallSign(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5))}
      onBlur={() => signState === "free" && callSign !== st?.callSign && void saveField((sid) => call(stationsApi.updateSetup, { params: { stationId: sid }, body: { callSign } }))}
      disabled={fixed}
      autoComplete="off"
      spellCheck={false}
      ok={signState === "free" ? `${callSign} is free` : undefined}
      error={signState === "invalid" ? "Three to five capital letters" : signState === "taken" ? `${callSign} is taken` : undefined}
      help={fixed ? "Fixed since the first sign-on" : undefined}
    />
  );

  return (
    <div className="cc-sf">
      <ControlTitle title="Your station" description="Where you sit on the dial and how viewers will know you. You can change the name and colour later; the call sign and channel stay." />
      <div className="cc-sf__split">
        <div className="cc-sf__form">
          <div className="cc-sf__row">
            <Field label="Station name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name.trim() !== st?.name && void saveField((sid) => call(stationsApi.updateSetup, { params: { stationId: sid }, body: { name: name.trim() } }))} />
            {signField}
          </div>
          <div className="cc-sf__row">
            <div className="cc-sf__fld">
              <span className="cc-sf__lb" id="cc-sf-band">
                Band
              </span>
              <Segmented
                label="Band"
                value={band}
                onChange={(b) => {
                  if (fixed) return;
                  setBand(b);
                  setChannel(null);
                }}
                options={[
                  { value: "tv", label: "TV band", disabled: fixed && band !== "tv" },
                  { value: "radio", label: "Radio band", disabled: fixed && band !== "radio" }
                ]}
              />
              <div className="cc-sf__help">{band === "tv" ? "Video, with or without sound." : "Sound only."}</div>
            </div>
            {changingMarket ? (
              <SelectField label="Market" value={market?.id ?? ""} onChange={() => setChangingMarket(false)} onBlur={() => setChangingMarket(false)}>
                {(markets.data ?? []).map((m) => (
                  <option key={m.id} value={m.id} disabled={!m.open}>
                    {m.name}
                  </option>
                ))}
              </SelectField>
            ) : (
              <Field
                label="Market"
                value={marketName}
                readOnly
                end={
                  !fixed && (
                    <Button variant="text" size="sm" onClick={() => setChangingMarket(true)}>
                      Change
                    </Button>
                  )
                }
              />
            )}
          </div>
          <div className="cc-sf__fld">
            <span className="cc-sf__lb">Channel</span>
            {channels.isError ? (
              <p className="cc-sf__help">{channels.error.message}</p>
            ) : (
              <ChannelPicker options={options} value={pickerValue} onChange={fixed ? undefined : pickChannel} columns={10} label={band === "tv" ? "Channel" : "Frequency"} />
            )}
            <div className="cc-sf__help">
              {band === "tv"
                ? `Open channels in the ${marketName}. Taken ones are struck through.${channel ? ` You'll be ${channel}; subchannels ${channel.split(".")[0]}.2 and up are for stations you carry around the clock.` : ""}`
                : `Open frequencies in the ${marketName}. Taken ones are struck through.`}
            </div>
          </div>
          <div className="cc-sf__fld">
            <span className="cc-sf__lb">Station colour</span>
            <div className="cc-sf__swatches">
              {SWATCHES.map((c) => (
                <button key={c} type="button" className="cc-sf__sw" style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={colour === c} onClick={() => pickColour(c)} />
              ))}
              <Field
                aria-label="Station colour"
                size="sm"
                mono
                className="cc-sf__hex"
                value={colourText}
                onChange={(e) => setColourText(e.target.value)}
                onBlur={() => colour && pickColour(colour)}
                spellCheck={false}
              />
            </div>
            {colour && ratio !== null ? (
              passes ? (
                <div className="cc-sf__ok">
                  <Icon name="check" size={15} />
                  White text on it reads at {ratioLabel(ratio)}
                </div>
              ) : (
                <div className="cc-sf__bad" role="alert">
                  White text on it reads at {ratioLabel(ratio)}. A station colour needs 4.5:1, so this one can't be saved.
                </div>
              )
            ) : (
              <div className="cc-sf__bad">Write it as # and six characters, like #8C3B7A.</div>
            )}
          </div>
        </div>
        <div className="cc-sf__pane">
          <h2 className="cc-sf__h">How viewers will see you</h2>
          <div>
            <div className="cc-sf__lbl">On the dial</div>
            <DialRow variant="preview" station={shown} now={{ title: "Your first program", until: firstUntil }} timeZone={STATION_TZ} />
          </div>
          <div>
            <div className="cc-sf__lbl">Your bug, on your picture</div>
            <PictureFrame bug={band === "tv" && callSign ? { callSign, channel: channelText } : undefined}>
              <PicturePlaceholder scene="reel" />
            </PictureFrame>
          </div>
          <div>
            <div className="cc-sf__lbl">Station card</div>
            <StationBand channel={channelText} callSign={callSign} colour={shown.colour} name={name} place={marketName} rounded />
          </div>
        </div>
      </div>
      {error && <p className="cc-sf__bad" role="alert">{error}</p>}
      <ControlFoot note="Saved as you go">
        <Button variant="primary" onClick={() => void onContinue()} disabled={!ready || busy}>
          Continue to library
        </Button>
      </ControlFoot>
    </div>
  );
}
