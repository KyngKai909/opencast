// List a source (05.1's button; the form isn't drawn; reworked in follow-up Phase 6): an external
// station on a channel in this market, playing the source's own stream one of two ways. Its
// official embed, where their terms allow embedding (the terms page and the day it was checked), or
// its stream link, with their written permission or as a clearly public source. Without the
// evidence it's saved but waits. What's on comes from their calendar or schedule feed, or guide
// data checked against their published schedule; with neither, the banner says Live. A pipeline
// lead (an IPTV-list channel) comes prefilled.
//
// A215: "Change" in a listing's details opens this form prefilled (`editing`): its name, what it
// shows, the address, how it plays, their terms, what's on, and its channel and call sign. Evidence
// is recorded on its own (Record evidence); the form says plainly, before saving, when the change
// takes the station off the dial until new evidence is recorded.
import { useState, type FormEvent } from "react";
import { networkApi, type ListedSource, type Market } from "@opencast/contracts";
import { Button, Checkbox, Field, Modal, Notice, Segmented, TextAreaField, useToast } from "@opencast/ui";
import { ApiError } from "../../../api/client";
import { useApiMutation } from "../../../api/hooks";
import { errorText } from "../../pages/common";
import { callSignProblem } from "../setup/draft";
import { complete, EmbedEvidenceFields, emptyEvidence, evidenceInput, evidenceProblems, isLink, NoteField, StreamEvidenceFields, type EvidenceDraft } from "./EvidenceFields";
import { changeWarning, onceWords, playsOf, type Plays } from "./external";
import { channelText } from "./SourceStatus";
import "../pipeline/forms.css";

type Schedule = "feed" | "guide" | "none";

export interface ListSourcePrefill {
  name?: string;
  description?: string;
  streamUrl?: string;
  plays?: Plays;
  /** The pipeline lead becoming this external station. */
  creatorId?: string;
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s.trim());

/** The form's fields for a listing as it is (A215's Change). */
function draftOf(s: ListedSource) {
  const source = s.schedule?.source ?? (s.calendarUrl ? "feed" : "none");
  return {
    name: s.name,
    description: s.description ?? "",
    band: (s.station.band ?? "tv") as "tv" | "radio",
    channel: s.station.channel ?? "",
    callSign: s.station.callSign ?? "",
    plays: playsOf(s),
    streamUrl: s.streamUrl,
    schedule: (source === "guide_data" ? "guide" : source) as Schedule,
    calendarUrl: s.calendarUrl ?? "",
    checkedAgainst: s.schedule?.checkedAgainst ?? "",
    checkedOn: s.schedule?.checkedOn ?? "",
    outsideMarket: false
  };
}

export function ListSource({
  market,
  onClose,
  prefill = {},
  editing,
  onSaved
}: {
  market: Market;
  onClose: () => void;
  prefill?: ListSourcePrefill;
  /** A215: the listing to change (the form opens filled in). */
  editing?: ListedSource;
  /** After a change is saved, with the listing as it is now. */
  onSaved?: (saved: ListedSource) => void;
}) {
  const toast = useToast();
  const invalidates = [networkApi.listListedSources, networkApi.getBoard, networkApi.listCreators, networkApi.listListedChanges, networkApi.listExternalOutages];
  const add = useApiMutation(networkApi.addListedSource, { invalidates });
  const update = useApiMutation(networkApi.updateListedSource, { invalidates });
  const [f, setF] = useState(() =>
    editing
      ? draftOf(editing)
      : {
          name: prefill.name ?? "",
          description: prefill.description ?? "",
          band: "tv" as "tv" | "radio",
          channel: "",
          callSign: "",
          plays: prefill.plays ?? ("embed" as Plays),
          streamUrl: prefill.streamUrl ?? "",
          schedule: "feed" as Schedule,
          calendarUrl: "",
          checkedAgainst: "",
          checkedOn: "",
          outsideMarket: false
        }
  );
  // A lead's stream has no permission yet: "Not yet" until someone records it.
  const [d, setD] = useState<EvidenceDraft>(() => emptyEvidence(editing?.embedTerms ?? "allowed", prefill.creatorId ? "not_yet" : "permission"));
  const [nothing, setNothing] = useState(false);
  const warning = editing ? changeWarning(editing, { plays: f.plays, streamUrl: f.streamUrl, embedTerms: d.embedTerms }) : null;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const setE = <K extends keyof EvidenceDraft>(k: K) => (v: EvidenceDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const dash = f.plays === "stream_link" && /\.mpd($|[?#])/i.test(f.streamUrl.trim());

  /** A215: only what changed goes to the API; nothing changed says so. */
  const saveChange = async (s: ListedSource) => {
    const was = draftOf(s);
    const scheduleChanged = f.schedule !== was.schedule || (f.schedule !== "none" && f.calendarUrl.trim() !== was.calendarUrl) || (f.schedule === "guide" && (f.checkedAgainst.trim() !== was.checkedAgainst || f.checkedOn.trim() !== was.checkedOn));
    const body = {
      ...(f.name.trim() !== was.name ? { name: f.name.trim() } : {}),
      ...(f.description.trim() !== was.description ? { description: f.description.trim() || null } : {}),
      ...(f.streamUrl.trim() !== was.streamUrl ? { streamUrl: f.streamUrl.trim() } : {}),
      ...(f.plays !== was.plays ? { plays: f.plays } : {}),
      ...(f.plays === "embed" && (d.embedTerms !== s.embedTerms || f.plays !== was.plays) ? { embedTerms: d.embedTerms } : {}),
      ...(scheduleChanged
        ? {
            schedule:
              f.schedule === "none"
                ? { source: "none" as const }
                : f.schedule === "feed"
                  ? { source: "feed" as const, calendarUrl: f.calendarUrl.trim() }
                  : { source: "guide_data" as const, calendarUrl: f.calendarUrl.trim(), guideData: { checkedAgainst: f.checkedAgainst.trim(), checkedOn: f.checkedOn.trim() } }
          }
        : {}),
      ...(f.channel.trim() !== was.channel ? { channel: f.channel.trim() } : {}),
      ...(f.callSign !== was.callSign ? { callSign: f.callSign } : {})
    };
    setNothing(!Object.keys(body).length);
    if (!Object.keys(body).length) return;
    try {
      const saved = await update.mutateAsync({ params: { sourceId: s.id }, body });
      const ch = channelText(saved);
      toast.show({ message: saved.onDial ? `${saved.name} is saved${ch ? `. It's on the dial at ${saved.station.channel}` : ""}.` : `Saved. ${saved.name} goes on the dial once ${onceWords(saved)}.` });
      onSaved?.(saved);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(Object.fromEntries(Object.keys(err.fields).map((k) => [k, err.message])));
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = editing ? {} : { ...evidenceProblems(f.plays, d) };
    if (!f.name.trim()) errs.name = "Say whose stream it is.";
    if (!/^\d{1,3}\.\d$/.test(f.channel.trim())) errs.channel = f.band === "tv" ? "A channel like 9.4." : "A frequency like 89.2.";
    const cs = callSignProblem(f.callSign);
    if (cs) errs.callSign = cs;
    if (!isLink(f.streamUrl)) errs.streamUrl = f.plays === "embed" ? "Paste the address of their player." : "Paste the stream's address.";
    if (f.schedule !== "none" && !isLink(f.calendarUrl)) errs.calendarUrl = f.schedule === "feed" ? "Paste the link to their calendar or feed." : "Paste the guide data's address.";
    if (f.schedule === "guide") {
      if (!isLink(f.checkedAgainst)) errs.checkedAgainst = "Paste the link to their published schedule.";
      if (!isDate(f.checkedOn)) errs.checkedOn = "The day you checked it.";
    }
    if (f.description.length > 160) errs.description = "Keep it under 160 characters.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (editing) return saveChange(editing);
    const name = f.name.trim();
    try {
      const saved = await add.mutateAsync({
        body: {
          marketId: market.id,
          band: f.band,
          channel: f.channel.trim(),
          callSign: f.callSign,
          name,
          description: f.description.trim() || undefined,
          streamUrl: f.streamUrl.trim(),
          plays: f.plays,
          embedTerms: f.plays === "embed" ? d.embedTerms : undefined,
          calendarUrl: f.schedule === "none" ? undefined : f.calendarUrl.trim(),
          guideData: f.schedule === "guide" ? { checkedAgainst: f.checkedAgainst.trim(), checkedOn: f.checkedOn.trim() } : undefined,
          evidence: evidenceInput(f.plays, d),
          creatorId: prefill.creatorId,
          outsideMarket: f.outsideMarket || undefined
        }
      });
      toast.show({ message: saved.onDial ? `${name} is on the dial at ${f.channel.trim()}.` : `${name} is saved. It goes on the dial once ${onceWords(saved)}.` });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(Object.fromEntries(Object.keys(err.fields).map((k) => [k, err.message])));
    }
  };

  const pending = add.isPending || update.isPending;
  const failed = editing ? update.error : add.error;
  return (
    <Modal
      open
      onClose={onClose}
      width={560}
      title={editing ? "Change the listing" : "List a source"}
      subtitle={
        editing
          ? `${[editing.name, channelText(editing)].filter(Boolean).join(", ")}. Its evidence is recorded on its own, and every change is kept in its history.`
          : `A station on the ${market.name} dial that plays the source's own stream. No playout, no spots.`
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="nd-list-source" disabled={pending}>
            {editing ? (warning?.waits ? "Save, and wait for evidence" : "Save changes") : "List it"}
          </Button>
        </>
      }
    >
      <form id="nd-list-source" className="nd-form" onSubmit={submit} noValidate>
        <Field label="Whose stream" help="“City of Redlands”, “San Bernardino County”." value={f.name} onChange={(e) => set("name")(e.target.value)} error={errors.name} autoFocus />
        <TextAreaField label="What it shows" labelAside="Optional" rows={2} value={f.description} onChange={(e) => set("description")(e.target.value)} error={errors.description} />
        {!editing && (
          <div>
            <span className="nd-form__label">Band</span>
            <Segmented label="Band" value={f.band} onChange={(v) => set("band")(v)} options={[{ value: "tv", label: "TV band" }, { value: "radio", label: "Radio band" }]} />
          </div>
        )}
        <div className="nd-form__pair">
          <Field label="Channel" mono value={f.channel} placeholder={f.band === "tv" ? "9.4" : "89.2"} onChange={(e) => set("channel")(e.target.value)} error={errors.channel} />
          <Field label="Call sign" mono maxLength={5} value={f.callSign} onChange={(e) => set("callSign")(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))} error={errors.callSign} />
        </div>
        <div>
          <span className="nd-form__label">How it plays</span>
          <Segmented label="How it plays" value={f.plays} onChange={(v) => set("plays")(v)} options={[{ value: "embed", label: "Official embed" }, { value: "stream_link", label: "Stream link" }]} />
        </div>
        {f.plays === "embed" && editing ? (
          <>
            <Field label="Their player's address" type="url" placeholder="https://" value={f.streamUrl} onChange={(e) => set("streamUrl")(e.target.value)} error={errors.streamUrl} />
            <div>
              <span className="nd-form__label">Their terms</span>
              <Segmented label="Their terms" value={d.embedTerms} onChange={(v) => setE("embedTerms")(v)} options={[{ value: "allowed", label: "Allow embedding" }, { value: "unclear", label: "Unclear" }]} />
            </div>
          </>
        ) : f.plays === "embed" ? (
          <>
            <Field label="Their player's address" type="url" placeholder="https://" value={f.streamUrl} onChange={(e) => set("streamUrl")(e.target.value)} error={errors.streamUrl} />
            <EmbedEvidenceFields d={d} set={setE} errors={errors} waitNote="Without the terms page and the day it was checked, it's saved but not on the dial." />
          </>
        ) : editing ? (
          <Field
            label="Stream address"
            type="url"
            mono
            placeholder="https://…/index.m3u8"
            help={dash ? "A DASH address (.mpd). It's saved, but waits until Settings allows DASH stream links." : "An HLS address (.m3u8). Viewers' players fetch it from the source directly."}
            value={f.streamUrl}
            onChange={(e) => set("streamUrl")(e.target.value)}
            error={errors.streamUrl}
          />
        ) : (
          <>
            <Field
              label="Stream address"
              type="url"
              mono
              placeholder="https://…/index.m3u8"
              help={dash ? "A DASH address (.mpd). Viewers' players fetch it from the source directly, while Settings allows DASH stream links." : "An HLS address (.m3u8). Viewers' players fetch it from the source directly."}
              value={f.streamUrl}
              onChange={(e) => set("streamUrl")(e.target.value)}
              error={errors.streamUrl}
            />
            <StreamEvidenceFields d={d} set={setE} errors={errors} streamUrl={f.streamUrl} />
          </>
        )}
        {!editing && !complete(f.plays, d) && <NoteField d={d} set={setE} errors={errors} />}
        <div>
          <span className="nd-form__label">What's on</span>
          <Segmented
            label="What's on"
            value={f.schedule}
            onChange={(v) => set("schedule")(v)}
            options={[
              { value: "feed", label: "Their calendar or schedule feed" },
              { value: "guide", label: "Guide data" },
              { value: "none", label: "None" }
            ]}
          />
          {f.schedule === "none" && <p className="nd-form__note">The banner shows the station's name, External, Live and the source. Nothing is made up.</p>}
        </div>
        {f.schedule === "feed" && (
          <Field label="Calendar or feed" type="url" placeholder="https://" help="iCal, RSS, JSON or XMLTV. Their real titles and times become the listings." value={f.calendarUrl} onChange={(e) => set("calendarUrl")(e.target.value)} error={errors.calendarUrl} />
        )}
        {f.schedule === "guide" && (
          <>
            <Field label="Guide data address" type="url" placeholder="https://" value={f.calendarUrl} onChange={(e) => set("calendarUrl")(e.target.value)} error={errors.calendarUrl} />
            <div className="nd-form__pair">
              <Field label="Checked against" type="url" placeholder="https://" help="Their published schedule." value={f.checkedAgainst} onChange={(e) => set("checkedAgainst")(e.target.value)} error={errors.checkedAgainst} />
              <Field label="Date checked" type="date" value={f.checkedOn} onChange={(e) => set("checkedOn")(e.target.value)} error={errors.checkedOn} />
            </div>
          </>
        )}
        {!editing && (
          <Checkbox
            checked={f.outsideMarket}
            onChange={(v) => set("outsideMarket")(v)}
            label={`The source is outside the ${market.name}`}
            helper="It waits unless Settings allows other markets' streams."
            ruled={false}
          />
        )}
        {warning && (
          <Notice tone={warning.waits ? "standby" : "plain"} icon={warning.waits ? "warn" : null}>
            {warning.text}
          </Notice>
        )}
        {nothing && <p className="nd-form__error">Nothing to change yet.</p>}
        {failed && !(failed instanceof ApiError && failed.fields) ? <p className="nd-form__error">{errorText(failed)}</p> : null}
      </form>
    </Modal>
  );
}
