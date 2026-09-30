// List a source (05.1's button; the form isn't drawn; reworked in follow-up Phase 6): an external
// station on a channel in this market, playing the source's own stream one of two ways. Its
// official embed, where their terms allow embedding (the terms page and the day it was checked), or
// its stream link, with their written permission or as a clearly public source. Without the
// evidence it's saved but waits. What's on comes from their calendar or schedule feed, or guide
// data checked against their published schedule; with neither, the banner says Live. A pipeline
// lead (an IPTV-list channel) comes prefilled.
import { useState, type FormEvent } from "react";
import { networkApi, type Market } from "@opencast/contracts";
import { Button, Checkbox, Field, Modal, Segmented, TextAreaField, useToast } from "@opencast/ui";
import { ApiError } from "../../../api/client";
import { useApiMutation } from "../../../api/hooks";
import { errorText } from "../../pages/common";
import { callSignProblem } from "../setup/draft";
import { complete, EmbedEvidenceFields, emptyEvidence, evidenceInput, evidenceProblems, isLink, NoteField, StreamEvidenceFields, type EvidenceDraft } from "./EvidenceFields";
import { onceWords, type Plays } from "./external";
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

export function ListSource({ market, onClose, prefill = {} }: { market: Market; onClose: () => void; prefill?: ListSourcePrefill }) {
  const toast = useToast();
  const add = useApiMutation(networkApi.addListedSource, { invalidates: [networkApi.listListedSources, networkApi.getBoard, networkApi.listCreators] });
  const [f, setF] = useState({
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
  });
  // A lead's stream has no permission yet: "Not yet" until someone records it.
  const [d, setD] = useState<EvidenceDraft>(() => emptyEvidence("allowed", prefill.creatorId ? "not_yet" : "permission"));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const setE = <K extends keyof EvidenceDraft>(k: K) => (v: EvidenceDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const dash = f.plays === "stream_link" && /\.mpd($|[?#])/i.test(f.streamUrl.trim());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = { ...evidenceProblems(f.plays, d) };
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

  return (
    <Modal
      open
      onClose={onClose}
      width={560}
      title="List a source"
      subtitle={`A station on the ${market.name} dial that plays the source's own stream. No playout, no spots.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="nd-list-source" disabled={add.isPending}>
            List it
          </Button>
        </>
      }
    >
      <form id="nd-list-source" className="nd-form" onSubmit={submit} noValidate>
        <Field label="Whose stream" help="“City of Redlands”, “San Bernardino County”." value={f.name} onChange={(e) => set("name")(e.target.value)} error={errors.name} autoFocus />
        <TextAreaField label="What it shows" labelAside="Optional" rows={2} value={f.description} onChange={(e) => set("description")(e.target.value)} error={errors.description} />
        <div>
          <span className="nd-form__label">Band</span>
          <Segmented label="Band" value={f.band} onChange={(v) => set("band")(v)} options={[{ value: "tv", label: "TV band" }, { value: "radio", label: "Radio band" }]} />
        </div>
        <div className="nd-form__pair">
          <Field label="Channel" mono value={f.channel} placeholder={f.band === "tv" ? "9.4" : "89.2"} onChange={(e) => set("channel")(e.target.value)} error={errors.channel} />
          <Field label="Call sign" mono maxLength={5} value={f.callSign} onChange={(e) => set("callSign")(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))} error={errors.callSign} />
        </div>
        <div>
          <span className="nd-form__label">How it plays</span>
          <Segmented label="How it plays" value={f.plays} onChange={(v) => set("plays")(v)} options={[{ value: "embed", label: "Official embed" }, { value: "stream_link", label: "Stream link" }]} />
        </div>
        {f.plays === "embed" ? (
          <>
            <Field label="Their player's address" type="url" placeholder="https://" value={f.streamUrl} onChange={(e) => set("streamUrl")(e.target.value)} error={errors.streamUrl} />
            <EmbedEvidenceFields d={d} set={setE} errors={errors} waitNote="Without the terms page and the day it was checked, it's saved but not on the dial." />
          </>
        ) : (
          <>
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
            <StreamEvidenceFields d={d} set={setE} errors={errors} streamUrl={f.streamUrl} />
          </>
        )}
        {!complete(f.plays, d) && <NoteField d={d} set={setE} errors={errors} />}
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
        <Checkbox
          checked={f.outsideMarket}
          onChange={(v) => set("outsideMarket")(v)}
          label={`The source is outside the ${market.name}`}
          helper="It waits unless Settings allows other markets' streams."
          ruled={false}
        />
        {add.error && !(add.error instanceof ApiError && add.error.fields) ? <p className="nd-form__error">{errorText(add.error)}</p> : null}
      </form>
    </Modal>
  );
}
