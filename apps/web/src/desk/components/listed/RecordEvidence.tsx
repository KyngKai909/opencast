// Record evidence (follow-up Phase 6; from an external station's details): what a waiting listing
// needs to go on the dial. An embed: their terms allow embedding, the terms page and the day it was
// checked. A stream link: their written permission (recorded once, never edited) or a clearly
// public basis. A note says what's being waited on.
import { useState, type FormEvent } from "react";
import { networkApi, type ListedSource } from "@opencast/contracts";
import { Button, Modal, useToast } from "@opencast/ui";
import { ApiError } from "../../../api/client";
import { useApiMutation } from "../../../api/hooks";
import { errorText } from "../../pages/common";
import { EmbedEvidenceFields, emptyEvidence, evidenceInput, evidenceProblems, NoteField, StreamEvidenceFields, type EvidenceDraft } from "./EvidenceFields";
import { onceWords, playsOf } from "./external";
import { channelText } from "./SourceStatus";
import "../pipeline/forms.css";

export function RecordEvidence({ source: s, onClose }: { source: ListedSource; onClose: () => void }) {
  const toast = useToast();
  const plays = playsOf(s);
  const record = useApiMutation(networkApi.recordListedEvidence, { invalidates: [networkApi.listListedSources, networkApi.getBoard, networkApi.listCreators] });
  const [d, setD] = useState<EvidenceDraft>(() => ({
    ...emptyEvidence(s.embedTerms, "permission"),
    termsUrl: s.evidence?.termsUrl ?? "",
    termsCheckedOn: s.evidence?.termsCheckedOn ?? "",
    note: s.evidence?.note ?? ""
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [nothing, setNothing] = useState(false);
  const set = <K extends keyof EvidenceDraft>(k: K) => (v: EvidenceDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs = evidenceProblems(plays, d);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const evidence = evidenceInput(plays, d) ?? {};
    const note = d.note.trim();
    const body = { ...evidence, note, ...(plays === "embed" ? { embedTerms: d.embedTerms } : {}) };
    const changed = Object.keys(evidence).some((k) => k !== "note") || note !== (s.evidence?.note ?? "") || (plays === "embed" && d.embedTerms !== s.embedTerms);
    setNothing(!changed);
    if (!changed) return;
    try {
      const saved = await record.mutateAsync({ params: { sourceId: s.id }, body });
      const ch = channelText(saved);
      toast.show({ message: saved.onDial ? `${s.name} is on the dial${ch ? ` at ${saved.station.channel}` : ""}.` : `Saved. It goes on the dial once ${onceWords(saved)}.` });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(Object.fromEntries(Object.keys(err.fields).map((k) => [k, err.message])));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      width={540}
      title="Record evidence"
      subtitle={`${s.name}. It goes on the dial once the evidence is complete.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="nd-record-evidence" disabled={record.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="nd-record-evidence" className="nd-form" onSubmit={submit} noValidate>
        {plays === "embed" ? (
          <EmbedEvidenceFields d={d} set={set} errors={errors} waitNote="Both are needed before it goes on the dial." />
        ) : (
          <StreamEvidenceFields d={d} set={set} errors={errors} streamUrl={s.streamUrl} />
        )}
        <NoteField d={d} set={set} errors={errors} />
        {nothing && <p className="nd-form__error">Nothing new to record yet.</p>}
        {record.error && !(record.error instanceof ApiError && record.error.fields) ? <p className="nd-form__error">{errorText(record.error)}</p> : null}
      </form>
    </Modal>
  );
}
