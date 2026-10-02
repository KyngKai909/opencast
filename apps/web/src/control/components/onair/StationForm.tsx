// A.1 Your station, setup step 1: name, call sign, band, market, channel and colour, with the
// station as viewers will see it. Each field saves as you go; the first save starts the station
// (`/new` creates it, then carries on at /setup/:stationId/station). A colour that fails 4.5:1
// against white can't be saved, and says why. From a waitlist invite (added 2026-09-29), the call
// sign held is filled in and locked, and the channel held is chosen in its market; choosing another
// lets the held one go when it saves. Beside the owner's own station on X.1 (added 2026-09-30, A229),
// a subchannel is offered too, sharing X.1's call sign unless they untick it (components/onair/family.ts).

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { accountsApi, stationsApi, waitlistApi, type ReservationInvite, type StationSetup } from "@opencast/contracts";
import {
  Button,
  ChannelPicker,
  Checkbox,
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
import { besideFor, chooseChannelBody, channelChanged, familyChannelNote, familyHelp, headWords, ownSubchannelOptions, ownSubchannelWords, shareHelper, shareLabel, shownCallSign } from "./family";
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

export function StationForm({ setup, reservation = null }: { setup: StationSetup | null; reservation?: ReservationInvite | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const st = setup?.station ?? null;
  // A waitlist invite only starts a station (on /new).
  const held = st ? null : reservation;
  const [id, setId] = useState<string | null>(st?.id ?? null);
  const [name, setName] = useState(st?.name ?? "");
  const [callSign, setCallSign] = useState(st?.callSign ?? held?.callSign ?? "");
  const [band, setBand] = useState<"tv" | "radio">(st?.band ?? held?.band ?? "tv");
  const [channel, setChannel] = useState<string | null>(st?.channel ?? held?.channel ?? null);
  const [colourText, setColourText] = useState(st?.colour ?? SWATCHES[1]);
  const [changingMarket, setChangingMarket] = useState(false);
  // The market picked here, before the station has one saved (an invite's: the one its channel is held in).
  const [pickedMarketId, setPickedMarketId] = useState<string | null>(held?.market?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // On a subchannel beside their own X.1: share its call sign (on by default when it's picked).
  const sharesWith = setup?.sharesCallSignWith ?? null;
  const [share, setShare] = useState(!!sharesWith);

  const markets = useApi(stationsApi.listMarkets, {});
  const me = useApi(accountsApi.getMe, {});
  const market =
    (pickedMarketId ? markets.data?.find((m) => m.id === pickedMarketId) : undefined) ??
    markets.data?.find((m) => m.slug === (st?.marketSlug ?? me.data?.market?.slug)) ??
    markets.data?.[0] ??
    null;
  const channels = useApi(stationsApi.availableChannels, { params: { marketSlug: market?.slug ?? "" }, query: { band } }, { enabled: !!market });
  // Subchannels beside the owner's own stations on X.1, and the one chosen, if it's one of those.
  const ownSubs = ownSubchannelOptions(channels.data?.ownSubchannels, { self: id, band, channel, sharesWith });
  const beside = besideFor(channel, ownSubs);
  const sharing = !!beside && share;
  const typedSign = useDebounced(callSign, 250);
  const check = useApi(waitlistApi.checkCallSign, { params: { callSign: typedSign } }, { enabled: !held && !sharing && /^[A-Z]{3,5}$/.test(typedSign) && typedSign !== st?.callSign });
  // The call sign held for them is theirs: no need to ask. Sharing X.1's is theirs too.
  const signState = held || sharing ? "free" : callSignState(callSign, sharesWith ? null : (st?.callSign ?? null), typedSign === callSign ? check.data : undefined);
  // The channel held with it, in this market and band.
  const heldChannel = held?.channel && held.band === band && held.market?.id === market?.id ? held.channel : null;

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
    const made = await call(stationsApi.createStation, { body: { kind: "station", name: name.trim(), ...(passes && colour ? { colour } : {}), ...(held ? { reservationId: held.id } : {}) } });
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
    if (passes && colour && colour !== st?.colour) await call(stationsApi.updateSetup, { params: { stationId: sid }, body: { colour } });
    // The channel first: sharing X.1's call sign sets it, and not sharing lets it go.
    if (channel && market && !fixed && channelChanged({ channel: st?.channel ?? null, band: st?.band ?? null, sharing: !!sharesWith }, { channel, band, beside, share })) await call(stationsApi.chooseChannel, { params: { stationId: sid }, body: chooseChannelBody(market.id, band, channel, beside, share) });
    if (!held && !sharing && signState === "free" && callSign && (callSign !== st?.callSign || !!sharesWith) && !fixed) await call(stationsApi.updateSetup, { params: { stationId: sid }, body: { callSign } });
  };

  // The first save on /new starts the station, then setup carries on under its id.
  const saveField = (fn: (sid: string) => Promise<unknown>) =>
    save(async () => {
      const had = id;
      const sid = await ensure();
      if (!sid) return;
      if (!had) {
        await saveAll(sid);
        // Then what was just changed: saveAll reads what's rendered, from before this change.
        await fn(sid);
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

  // A subchannel beside their own X.1: sharing its call sign to start with.
  const pickOwnSubchannel = (full: string) => {
    const next = besideFor(full, ownSubs);
    setChannel(full);
    setShare(true);
    if (market && !fixed) void saveField((sid) => call(stationsApi.chooseChannel, { params: { stationId: sid }, body: chooseChannelBody(market.id, band, full, next, true) }));
  };

  const changeShare = (on: boolean) => {
    setShare(on);
    // Not sharing: the station picks its own (the shared one isn't its to keep).
    if (!on && beside && callSign === beside.callSign) setCallSign("");
    if (channel && market && !fixed) void saveField((sid) => call(stationsApi.chooseChannel, { params: { stationId: sid }, body: chooseChannelBody(market.id, band, channel, beside, on) }));
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
    const mine = c.channel === channel || c.channel === st?.channel || c.channel === heldChannel;
    return { value: band === "tv" ? c.channel.split(".")[0] : c.channel, taken: c.state !== "open" && !mine };
  });
  // An own subchannel shows below the picker, chosen there, not on the picker's taken X.1.
  const pickerValue = channel && !beside ? (band === "tv" ? channel.split(".")[0] : channel) : undefined;
  const channelText = channel ?? "";
  const sign = shownCallSign(callSign, beside, share);
  // X.1 with stations sharing its call sign stays where it is (the API says `family_channel`).
  const familyStays = setup && !fixed ? familyChannelNote(setup) : null;
  // A call sign of its own, let go when it shares X.1's.
  const letGo = !sharesWith ? (held?.callSign ?? st?.callSign ?? null) : null;
  const shown = { channel: channelText, callSign: sign, colour: passes && colour ? colour : (st?.colour ?? SWATCHES[1]), name: name || undefined };
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
      value={sign}
      onChange={(e) => setCallSign(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5))}
      onBlur={() => !held && !sharing && signState === "free" && callSign && (callSign !== st?.callSign || !!sharesWith) && void saveField((sid) => call(stationsApi.updateSetup, { params: { stationId: sid }, body: { callSign } }))}
      disabled={fixed || !!held || sharing}
      autoComplete="off"
      spellCheck={false}
      ok={signState === "free" && !held && !sharing ? `${callSign} is free` : undefined}
      error={
        signState === "invalid"
          ? "Three to five capital letters"
          : signState === "taken"
            ? // A name Opencast won't allow says why, with names to try (2026-09-29).
              check.data?.refusal && check.data.callSign === callSign
              ? `${check.data.refusal.reason}${check.data.suggestions.length ? ` Try ${check.data.suggestions.slice(0, 2).join(" or ")}.` : ""}`
              : `${callSign} is taken`
            : undefined
      }
      help={
        (setup && (sharesWith ? sharing : !beside) ? familyHelp(setup) : null) ??
        (fixed ? "Fixed since the first sign-on" : sharing && beside ? `Shared with ${headWords(beside)}. The channel tells them apart.` : held ? "Held for you on the waitlist" : undefined)
      }
    />
  );

  return (
    <div className="cc-sf">
      <ControlTitle title="Your station" description="Where you sit on the dial and how viewers will know you. You can change the name and colour later. The call sign and channel are fixed once you sign on." />
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
                  if (fixed || familyStays) return;
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
              <SelectField
                label="Market"
                value={market?.id ?? ""}
                autoFocus
                onChange={(e) => {
                  // Another market has its own channels: the one chosen here no longer applies.
                  if (e.target.value !== market?.id) setChannel(null);
                  setPickedMarketId(e.target.value);
                  setChangingMarket(false);
                }}
                onBlur={() => setChangingMarket(false)}
              >
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
                  !fixed &&
                  !familyStays && (
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
              <ChannelPicker options={options} value={pickerValue} onChange={fixed || familyStays ? undefined : pickChannel} columns={10} label={band === "tv" ? "Channel" : "Frequency"} />
            )}
            <div className="cc-sf__help">
              {band === "tv"
                ? `Open channels in the ${marketName}. Taken ones are struck through.${channel ? (beside ? ` You'll be ${channel}, beside ${headWords(beside)}.` : ` You'll be ${channel}; subchannels ${channel.split(".")[0]}.2 and up are for stations you carry around the clock, or your own.`) : ""}`
                : `Open frequencies in the ${marketName}. Taken ones are struck through.`}
            </div>
            {familyStays && <div className="cc-sf__help">{familyStays}</div>}
            {heldChannel && !fixed && <div className="cc-sf__help">{`${heldChannel} is held for you. If you choose another, ${heldChannel} is let go.`}</div>}
            {ownSubs.length > 0 && !fixed && !familyStays && (
              <div className="cc-sf__own" role="group" aria-labelledby="cc-sf-own">
                <span className="cc-sf__lb" id="cc-sf-own">
                  Beside your own station
                </span>
                <div className="cc-sf__own-list">
                  {ownSubs.map((o) => (
                    <Button key={o.channel} size="sm" variant={channel === o.channel ? "primary" : undefined} aria-pressed={channel === o.channel} onClick={() => pickOwnSubchannel(o.channel)}>
                      {ownSubchannelWords(o)}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {beside && channel && !fixed && <Checkbox checked={share} onChange={changeShare} label={shareLabel(beside)} helper={shareHelper(beside, channel, share, share ? letGo : null)} ruled={false} className="cc-sf__share" />}
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
            <PictureFrame bug={band === "tv" && sign ? { callSign: sign, channel: channelText } : undefined}>
              <PicturePlaceholder scene="reel" />
            </PictureFrame>
          </div>
          <div>
            <div className="cc-sf__lbl">Station card</div>
            <StationBand channel={channelText} callSign={sign} colour={shown.colour} name={name} place={marketName} rounded />
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
