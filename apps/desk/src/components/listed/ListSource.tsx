// List a source (05.1's button; the form isn't drawn): a city or county's public stream on a channel
// in this market. Listed, not restreamed: viewers get the source's own player. Its agenda calendar
// becomes its listings; embedding has to be allowed before it goes on the dial.
import { useState, type FormEvent } from "react";
import { networkApi, type Market } from "@opencast/contracts";
import { Button, Field, Modal, Segmented, TextAreaField, useToast } from "@opencast/ui";
import { ApiError } from "../../api/client";
import { useApiMutation } from "../../api/hooks";
import { errorText } from "../../pages/common";
import { callSignProblem } from "../setup/draft";
import "../pipeline/forms.css";

export function ListSource({ market, onClose }: { market: Market; onClose: () => void }) {
  const toast = useToast();
  const add = useApiMutation(networkApi.addListedSource, { invalidates: [networkApi.listListedSources, networkApi.getBoard] });
  const [f, setF] = useState({ name: "", description: "", band: "tv" as "tv" | "radio", channel: "", callSign: "", streamUrl: "", calendarUrl: "", embedTerms: "allowed" as "allowed" | "unclear" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!f.name.trim()) errs.name = "Say whose stream it is.";
    if (!/^\d{1,3}\.\d$/.test(f.channel.trim())) errs.channel = f.band === "tv" ? "A channel like 9.4." : "A frequency like 89.1.";
    const cs = callSignProblem(f.callSign);
    if (cs) errs.callSign = cs;
    if (!/^https?:\/\/\S+\.\S+/.test(f.streamUrl.trim())) errs.streamUrl = "Paste the link to their stream.";
    if (f.calendarUrl.trim() && !/^https?:\/\/\S+\.\S+/.test(f.calendarUrl.trim())) errs.calendarUrl = "That doesn't look like a link.";
    if (f.description.length > 160) errs.description = "Keep it under 160 characters.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      await add.mutateAsync({
        body: {
          marketId: market.id,
          band: f.band,
          channel: f.channel.trim(),
          callSign: f.callSign,
          name: f.name.trim(),
          description: f.description.trim() || undefined,
          streamUrl: f.streamUrl.trim(),
          embedTerms: f.embedTerms,
          calendarUrl: f.calendarUrl.trim() || undefined
        }
      });
      toast.show({ message: f.embedTerms === "allowed" ? `${f.name.trim()} is listed on ${f.channel.trim()}.` : `${f.name.trim()} is saved. It goes on the dial once their terms allow embedding.` });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(Object.fromEntries(Object.entries(err.fields).map(([k]) => [k, err.message])));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      width={540}
      title="List a source"
      subtitle={`A public stream on the ${market.name} dial. Viewers get the source's own player.`}
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
          <Field label="Channel" mono value={f.channel} placeholder={f.band === "tv" ? "9.4" : "89.1"} onChange={(e) => set("channel")(e.target.value)} error={errors.channel} />
          <Field label="Call sign" mono maxLength={5} value={f.callSign} onChange={(e) => set("callSign")(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))} error={errors.callSign} />
        </div>
        <Field label="Stream" type="url" placeholder="https://" value={f.streamUrl} onChange={(e) => set("streamUrl")(e.target.value)} error={errors.streamUrl} />
        <Field label="Agenda calendar" labelAside="Optional" type="url" placeholder="https://" help="Where they publish meetings. They become listings with their real titles and times." value={f.calendarUrl} onChange={(e) => set("calendarUrl")(e.target.value)} error={errors.calendarUrl} />
        <div>
          <span className="nd-form__label">Their terms</span>
          <Segmented label="Their terms" value={f.embedTerms} onChange={(v) => set("embedTerms")(v)} options={[{ value: "allowed", label: "Allow embedding" }, { value: "unclear", label: "Unclear" }]} />
          {f.embedTerms === "unclear" && <p className="nd-form__note">It's saved but not listed. Someone asks them first.</p>}
        </div>
        {add.error && !(add.error instanceof ApiError && add.error.fields) ? <p className="nd-form__error">{errorText(add.error)}</p> : null}
      </form>
    </Modal>
  );
}
