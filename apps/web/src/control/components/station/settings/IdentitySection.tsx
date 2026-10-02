// Settings, Identity (station-settings 01.1): what's fixed on the dial, each with its reason; the
// name, description, colour and bug, which change any time; and how viewers will see it. Owners
// change it; operators read it.

import { useEffect, useState } from "react";
import { accountsApi, stationsApi } from "@opencast/contracts";
import { Field, Icon, PicturePlaceholder, PictureFrame, Segmented, StationBand, TextAreaField } from "@opencast/ui";
import { useApi, useApiMutation } from "../../../../api/hooks";
import { ApiError } from "../../../../api/client";
import { STATION_TZ } from "../../../../lib/clock";
import { useMe, type StationState } from "../../../station/StationContext";
import { ColourPicker } from "../ColourPicker";
import { longDate, marketName } from "../format";
import { Quiet } from "../../../pages/common";
import { familyLine } from "../../onair/family";
import "./common.css";
import "./IdentitySection.css";

type BugMode = "off" | "call_sign_and_channel" | "logo";

const BUG_OPTIONS = [
  { value: "off" as const, label: "Off" },
  { value: "call_sign_and_channel" as const, label: "Call sign and channel" },
  { value: "logo" as const, label: "Logo" }
];

export function IdentitySection({ s }: { s: StationState }) {
  const setup = useApi(stationsApi.getSetup, { params: { stationId: s.id } });
  const me = useMe();
  const update = useApiMutation(stationsApi.updateSetup, { invalidates: [stationsApi.getSetup, accountsApi.getMe] });
  const canEdit = s.can("manage");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<{ field: string; message: string } | null>(null);

  useEffect(() => {
    if (!setup.data) return;
    setName(setup.data.station.name);
    setDescription(setup.data.description ?? "");
  }, [setup.data]);

  if (setup.isLoading) return <Quiet />;
  if (!setup.data) return <p className="cc-identity__error" role="alert">{(setup.error as Error | null)?.message ?? "Something went wrong. Try again."}</p>;

  const d = setup.data;
  const st = d.station;
  const cs = st.callSign ?? st.name;
  const colour = st.colour ?? "#8C3B7A";
  const market = marketName(st.marketSlug, me.data?.market ?? undefined);
  const band = st.band === "radio" ? "Radio band" : "TV band";

  const save = (field: string, body: Record<string, unknown>) => {
    setError(null);
    update.mutate({ params: { stationId: s.id }, body }, { onError: (e) => setError({ field, message: e instanceof ApiError ? e.message : "Something went wrong. Try again." }) });
  };

  const saveName = () => {
    const v = name.trim();
    if (!v) return setError({ field: "name", message: "A station needs a name." });
    if (v !== st.name) save("name", { name: v });
  };
  const saveDescription = () => {
    const v = description.trim();
    if (v !== (d.description ?? "")) save("description", { description: v || null });
  };
  const errorFor = (f: string) => (error?.field === f ? error.message : undefined);

  // A call sign shared on one channel's subchannels (A229): who shares it.
  const family = familyLine(d);
  const fixedLine = d.fixed && d.firstSignedOnAt ? `Fixed since first sign-on, ${longDate(d.firstSignedOnAt, STATION_TZ)}` : "Set until the first sign-on, then fixed";

  return (
    <div className="cc-identity">
      <div className="cc-identity__main">
        {!canEdit && <p className="cc-identity__note">Only the owner can change {s.label}'s identity.</p>}
        <div className="cc-sec-top">
          <h4 className="cc-sec-top__h">On the dial</h4>
          <span className="cc-sec-top__sub">{fixedLine}</span>
        </div>
        <dl className="cc-lockrows">
          <div className="cc-lockrow">
            <dt>Call sign</dt>
            <dd className="cc-lockrow__v oc-cs">{st.callSign ?? "Not chosen yet"}</dd>
            <dd className="cc-lockrow__why">
              <Icon name="lock" size={13} />
              {family ? `${family}. The channel tells them apart` : "Viewers and presets use it"}
            </dd>
          </div>
          <div className="cc-lockrow">
            <dt>Channel</dt>
            <dd className="cc-lockrow__v cc-lockrow__v--ch">{st.channel ?? "Not chosen yet"}</dd>
            <dd className="cc-lockrow__why">
              <Icon name="lock" size={13} />
              Its place on the dial
            </dd>
          </div>
          <div className="cc-lockrow">
            <dt>Band and market</dt>
            <dd className="cc-lockrow__v">{market ? `${band}, ${market}` : band}</dd>
            <dd className="cc-lockrow__why">
              <Icon name="lock" size={13} />
              Moving market means a new channel
            </dd>
          </div>
        </dl>

        <div className="cc-sec-top cc-sec-top--gap">
          <h4 className="cc-sec-top__h">Can change any time</h4>
        </div>
        <div className="cc-identity__fields">
          <Field label="Station name" value={name} maxLength={80} disabled={!canEdit} onChange={(e) => setName(e.target.value)} onBlur={saveName} error={errorFor("name")} />
          <TextAreaField
            label="One-line description"
            value={description}
            maxLength={160}
            rows={2}
            disabled={!canEdit}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveDescription}
            error={errorFor("description")}
          />
          <ColourPicker value={colour} disabled={!canEdit} onChange={(hex) => hex !== colour && save("colour", { colour: hex })} />
          {errorFor("colour") && (
            <p className="oc-field__error" role="alert">
              <Icon name="warn" size={15} />
              {errorFor("colour")}
            </p>
          )}
          <div className="cc-identity__bug">
            <div>
              <b id="cc-bug-label">Bug on the picture</b>
              <small>Bottom right, inside the safe area, at {d.bug.opacity}%</small>
            </div>
            <Segmented<BugMode>
              label="Bug on the picture"
              size="sm"
              value={d.bug.mode}
              options={BUG_OPTIONS.map((o) => ({ ...o, disabled: !canEdit }))}
              onChange={(mode) => save("bug", { bug: { mode } })}
            />
          </div>
          {d.bug.mode === "logo" && !d.logoUrl && <p className="cc-identity__hint">Until a logo is added, the bug shows the call sign and channel.</p>}
          {errorFor("bug") && (
            <p className="oc-field__error" role="alert">
              <Icon name="warn" size={15} />
              {errorFor("bug")}
            </p>
          )}
        </div>
      </div>

      <aside className="cc-identity__preview" aria-label="As viewers will see it">
        <h4 className="cc-identity__ph">As viewers will see it</h4>
        <p className="cc-identity__plabel">Station card</p>
        <StationBand channel={st.channel ?? ""} callSign={cs} colour={colour} name={name || st.name} place={market} rounded />
        <p className="cc-identity__plabel">Your bug</p>
        <PictureFrame bug={d.bug.mode === "off" ? undefined : { callSign: cs, channel: st.channel ?? "" }} label={`${cs}'s picture, with ${d.bug.mode === "off" ? "no bug" : "its bug"}`}>
          <PicturePlaceholder scene="reel" />
        </PictureFrame>
        <div className="cc-identity__move">
          <b>Moving to another market</b>
          <small>Starts a new station there with a new channel. Presets and carriage don't move.</small>
        </div>
      </aside>
    </div>
  );
}
