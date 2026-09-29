// Translators (master-control A.5, and station-settings: "drawn in the sign-on flow and live here
// too, unchanged"): relays to YouTube, Twitch or any RTMP address, each with its break handling.
// Used by setup step 4, the Translators page and Settings, Translators. Owners and operators.
//
// The frame's Connect is an account connection; the contract takes an RTMP address and a stream
// key (request S16), so Connect asks for the key, with the service's address filled in.

import { useState, type CSSProperties } from "react";
import { stationsApi, type Translator } from "@opencast/contracts";
import { Button, Field, Menu, Modal, Segmented, Sheet, Toggle, useToast } from "@opencast/ui";
import { useApi, useApiMutation } from "../../../api/hooks";
import { ApiError } from "../../../api/client";
import "./TranslatorList.css";

type Service = Translator["service"];
type Breaks = Translator["breakHandling"];

/** Each service's mark and colour (the frame's YT, TW, RT squares), and where its ingest is. */
export const SERVICES: Record<Service, { name: string; mark: string; colour: string; rtmpUrl: string | null }> = {
  youtube: { name: "YouTube", mark: "YT", colour: "#B8261A", rtmpUrl: "rtmps://a.rtmp.youtube.com/live2" },
  twitch: { name: "Twitch", mark: "TW", colour: "#6441A5", rtmpUrl: "rtmp://live.twitch.tv/app" },
  rtmp: { name: "Any RTMP address", mark: "RT", colour: "#525C73", rtmpUrl: null }
};

const BREAK_OPTIONS: { value: Breaks; label: string }[] = [
  { value: "air_spots", label: "Air spots" },
  { value: "station_id_slate", label: "Station ID slate" }
];

/** What a service does with breaks until it's connected: Twitch restricts burned-in ads, so the slate. */
export function defaultBreaks(service: Service): Breaks {
  return service === "twitch" ? "station_id_slate" : "air_spots";
}

/** The line under a translator's name. */
export function statusLine(t: Translator): string {
  if (t.status === "not_connected") return `${t.name}, not connected`;
  if (!t.enabled) return `${t.name}, turned off`;
  return t.status === "relaying" ? `${t.name}, relaying` : `${t.name}, connected`;
}

export const TRANSLATOR_NOTE = "Each service has its own rules on breaks and 24/7 streams. Check them before turning spots on.";

export interface TranslatorListProps {
  stationId: string;
  /** "BEAT", for the Twitch line. */
  callSign: string;
  /** Owners and operators change translators; anyone else reads them. */
  canEdit: boolean;
  /** Offer Remove on connected relays (the Translators page and Settings; setup keeps the frame's toggle only). */
  removable?: boolean;
  phone?: boolean;
}

export function TranslatorList({ stationId, callSign, canEdit, removable, phone }: TranslatorListProps) {
  const params = { stationId };
  const list = useApi(stationsApi.listTranslators, { params });
  const invalidates = [stationsApi.listTranslators];
  const update = useApiMutation(stationsApi.updateTranslator, { invalidates });
  const remove = useApiMutation(stationsApi.removeTranslator, { invalidates });
  const toast = useToast();
  const [pending, setPending] = useState<Record<string, Breaks>>({});
  const [connecting, setConnecting] = useState<Service | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (list.isLoading) return <div className="cc-tr cc-tr--loading" aria-busy="true" />;
  if (!list.data) return <p className="cc-tr__error" role="alert">{(list.error as Error | null)?.message ?? "Something went wrong. Try again."}</p>;

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
  const all = list.data;
  const byService = (s: Service) => all.filter((t) => t.service === s);

  const change = (t: Translator, body: Partial<Pick<Translator, "breakHandling" | "enabled">>) => {
    setError(null);
    update.mutate({ params: { stationId, translatorId: t.id }, body }, { onError: fail });
  };

  const logo = (s: Service) => (
    <span className="cc-tr__lg" style={{ "--cc-tr-colour": SERVICES[s].colour } as CSSProperties} aria-hidden="true">
      {SERVICES[s].mark}
    </span>
  );

  const breaksFor = (label: string, value: Breaks, onChange: (v: Breaks) => void) => (
    <div className="cc-tr__breaks">
      <div className="cc-tr__lb" aria-hidden="true">
        Breaks on this translator
      </div>
      <Segmented<Breaks> label={`Breaks on ${label}`} size="compact" value={value} options={BREAK_OPTIONS.map((o) => ({ ...o, disabled: !canEdit }))} onChange={onChange} />
    </div>
  );

  const connectedRow = (t: Translator) => (
    <li key={t.id} className="cc-tr__row">
      {logo(t.service)}
      <div className="cc-tr__what">
        <b>{t.service === "rtmp" ? t.name : SERVICES[t.service].name}</b>
        <small>{t.service === "rtmp" ? statusLine(t).replace(`${t.name}, `, `${t.rtmpUrl.replace(/^rtmps?:\/\//, "")}, `) : statusLine(t)}</small>
      </div>
      {breaksFor(t.service === "rtmp" ? t.name : SERVICES[t.service].name, t.breakHandling, (breakHandling) => change(t, { breakHandling }))}
      <div className="cc-tr__end">
        <Toggle checked={t.enabled} label={`Relay to ${t.service === "rtmp" ? t.name : SERVICES[t.service].name}`} disabled={!canEdit} onChange={(enabled) => change(t, { enabled })} />
        {removable && canEdit && (
          <Menu
            label={`More for ${t.service === "rtmp" ? t.name : SERVICES[t.service].name}`}
            items={[
              {
                label: "Remove",
                danger: true,
                onSelect: () =>
                  remove.mutate({ params: { stationId, translatorId: t.id } }, { onSuccess: () => toast.show({ message: `${t.service === "rtmp" ? t.name : SERVICES[t.service].name} removed. ${callSign} no longer relays there.` }), onError: fail })
              }
            ]}
          />
        )}
      </div>
    </li>
  );

  const offerRow = (s: Service) => {
    const value = pending[s] ?? defaultBreaks(s);
    const line =
      s === "twitch"
        ? `Not connected. Twitch expects prerecorded programs to be labelled, which ${callSign} will do.`
        : s === "rtmp"
          ? "For another service or your own server"
          : "Not connected";
    return (
      <li key={`add-${s}`} className="cc-tr__row">
        {logo(s)}
        <div className="cc-tr__what">
          <b>{SERVICES[s].name}</b>
          <small>{line}</small>
        </div>
        {s === "rtmp" ? <span /> : breaksFor(SERVICES[s].name, value, (v) => setPending((p) => ({ ...p, [s]: v })))}
        <div className="cc-tr__end">
          {canEdit && (
            <Button size="sm" onClick={() => setConnecting(s)}>
              {s === "rtmp" ? "Add" : "Connect"}
            </Button>
          )}
        </div>
      </li>
    );
  };

  const rows = [
    ...(byService("youtube").length ? byService("youtube").map(connectedRow) : [offerRow("youtube")]),
    ...(byService("twitch").length ? byService("twitch").map(connectedRow) : [offerRow("twitch")]),
    ...byService("rtmp").map(connectedRow),
    offerRow("rtmp")
  ];

  return (
    <>
      <ul className={phone ? "cc-tr cc-tr--phone" : "cc-tr"} aria-label="Translators">
        {rows}
      </ul>
      {error && (
        <p className="cc-tr__error" role="alert">
          {error}
        </p>
      )}
      {connecting && (
        <ConnectTranslator
          stationId={stationId}
          service={connecting}
          breakHandling={pending[connecting] ?? defaultBreaks(connecting)}
          phone={phone}
          onClose={() => setConnecting(null)}
          onDone={(t) => {
            setConnecting(null);
            toast.show({ message: `${t.service === "rtmp" ? t.name : SERVICES[t.service].name} connected. ${callSign} relays there while it's on air.` });
          }}
        />
      )}
    </>
  );
}

/** Connect (or Add): the relay's address and its stream key. The key is kept and never shown again. */
function ConnectTranslator({
  stationId,
  service,
  breakHandling,
  phone,
  onClose,
  onDone
}: {
  stationId: string;
  service: Service;
  breakHandling: Breaks;
  phone?: boolean;
  onClose: () => void;
  onDone: (t: Translator) => void;
}) {
  const svc = SERVICES[service];
  const add = useApiMutation(stationsApi.addTranslator, { invalidates: [stationsApi.listTranslators] });
  const [name, setName] = useState("");
  const [url, setUrl] = useState(svc.rtmpUrl ?? "");
  const [key, setKey] = useState("");
  const [error, setError] = useState<{ field: "name" | "url" | "key" | "form"; message: string } | null>(null);

  const submit = () => {
    setError(null);
    const n = name.trim() || (service === "rtmp" ? "" : `${svc.name} channel`);
    if (!n) return setError({ field: "name", message: "Give it a name." });
    if (!/^rtmps?:\/\/\S+/.test(url.trim())) return setError({ field: "url", message: "The address starts with rtmp:// or rtmps://." });
    if (!key.trim()) return setError({ field: "key", message: "Paste the stream key." });
    add.mutate(
      { params: { stationId }, body: { service, name: n, rtmpUrl: url.trim(), streamKey: key.trim(), breakHandling, prerecordedLabel: service === "twitch" } },
      { onSuccess: (t) => onDone(t as Translator), onError: (e) => setError({ field: "form", message: e instanceof ApiError ? e.message : "Something went wrong. Try again." }) }
    );
  };
  const err = (f: string) => (error?.field === f ? error.message : undefined);
  const body = (
    <form
      id="cc-connect"
      className="cc-connect"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field label={service === "rtmp" ? "Name" : "Channel name"} placeholder={service === "rtmp" ? "My server" : `${svc.name} channel`} value={name} onChange={(e) => setName(e.target.value)} error={err("name")} autoFocus />
      {service === "rtmp" && <Field label="RTMP address" mono value={url} placeholder="rtmp://" onChange={(e) => setUrl(e.target.value)} error={err("url")} />}
      <Field label="Stream key" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} error={err("key")} help={service === "rtmp" ? undefined : `From your ${svc.name} dashboard. It's kept, and never shown again.`} />
      {error?.field === "form" && (
        <p className="cc-tr__error" role="alert">
          {error.message}
        </p>
      )}
    </form>
  );
  const footer = (
    <Button variant="primary" type="submit" form="cc-connect" block disabled={add.isPending}>
      {service === "rtmp" ? "Add" : "Connect"}
    </Button>
  );
  const props = { open: true, onClose, title: service === "rtmp" ? "Add an RTMP address" : `Connect ${svc.name}`, subtitle: service === "rtmp" ? "For another service or your own server" : undefined, footer };
  return phone ? <Sheet {...props}>{body}</Sheet> : <Modal {...props}>{body}</Modal>;
}
