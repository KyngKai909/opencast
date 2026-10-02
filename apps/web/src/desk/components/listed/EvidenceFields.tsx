// The evidence an external station plays on (follow-up Phase 6), as form fields for List a source
// and Record evidence. An official embed: their terms allow embedding, the terms page and the day
// it was checked. A stream link: their written permission (who said yes, when, where it's kept;
// recorded once, never edited), or a clearly public source with the basis, or not yet. Without it
// the listing is saved but waits.
import { Field, Segmented } from "@opencast/ui";
import type { ListedSource } from "@opencast/contracts";

export type Why = "permission" | "public" | "not_yet";

export interface EvidenceDraft {
  embedTerms: "allowed" | "unclear";
  termsUrl: string;
  termsCheckedOn: string;
  why: Why;
  grantedBy: string;
  grantedOn: string;
  keptAt: string;
  documentUrl: string;
  publicBasis: string;
  note: string;
}

export const emptyEvidence = (embedTerms: "allowed" | "unclear" = "allowed", why: Why = "permission"): EvidenceDraft => ({
  embedTerms,
  termsUrl: "",
  termsCheckedOn: "",
  why,
  grantedBy: "",
  grantedOn: "",
  keptAt: "",
  documentUrl: "",
  publicBasis: "",
  note: ""
});

type Plays = NonNullable<ListedSource["plays"]>;
type Set = <K extends keyof EvidenceDraft>(k: K) => (v: EvidenceDraft[K]) => void;

export const isLink = (s: string) => /^https?:\/\/\S+\.\S+/.test(s.trim());
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s.trim());

/** Whether it goes on the dial with this evidence (the API's rule, before the Open rules and its stream). */
export function complete(plays: Plays, d: EvidenceDraft): boolean {
  if (plays === "embed") return d.embedTerms === "allowed" && isLink(d.termsUrl) && isDate(d.termsCheckedOn);
  return d.why === "permission" || d.why === "public";
}

/** The fields that don't read, by name. */
export function evidenceProblems(plays: Plays, d: EvidenceDraft): Record<string, string> {
  const errs: Record<string, string> = {};
  if (plays === "embed") {
    if (d.embedTerms !== "allowed") return errs;
    if (d.termsUrl.trim() && !isLink(d.termsUrl)) errs.termsUrl = "Paste the link to their terms page.";
    if (d.termsCheckedOn.trim() && !isDate(d.termsCheckedOn)) errs.termsCheckedOn = "The day you read them.";
    return errs;
  }
  if (d.why === "permission") {
    if (d.grantedBy.trim().length < 3) errs.grantedBy = "Say who said yes, and for whom.";
    if (!isDate(d.grantedOn)) errs.grantedOn = "The day they said yes.";
    if (d.keptAt.trim().length < 3) errs.evidence = "Say where the written yes is kept.";
    if (d.documentUrl.trim() && !isLink(d.documentUrl)) errs.documentUrl = "That doesn't look like a link.";
  }
  if (d.why === "public") {
    const n = d.publicBasis.trim().length;
    if (n < 3 || n > 120) errs.publicBasis = n > 120 ? "Keep it under 120 characters." : "Say why it's clearly public.";
  }
  if (d.note.length > 160) errs.note = "Keep it under 160 characters.";
  return errs;
}

/** The evidence as the API takes it; undefined when there's nothing to record. */
export function evidenceInput(plays: Plays, d: EvidenceDraft) {
  const e: {
    termsUrl?: string;
    termsCheckedOn?: string;
    publicBasis?: string;
    permission?: { grantedBy: string; grantedOn: string; evidence: string; documentUrl?: string };
    note?: string;
  } = {};
  if (plays === "embed" && d.embedTerms === "allowed") {
    if (d.termsUrl.trim()) e.termsUrl = d.termsUrl.trim();
    if (d.termsCheckedOn.trim()) e.termsCheckedOn = d.termsCheckedOn.trim();
  }
  if (plays === "stream_link" && d.why === "permission") e.permission = { grantedBy: d.grantedBy.trim(), grantedOn: d.grantedOn.trim(), evidence: d.keptAt.trim(), documentUrl: d.documentUrl.trim() || undefined };
  if (plays === "stream_link" && d.why === "public") e.publicBasis = d.publicBasis.trim();
  if (d.note.trim()) e.note = d.note.trim();
  return Object.keys(e).length ? e : undefined;
}

export function EmbedEvidenceFields({ d, set, errors, waitNote }: { d: EvidenceDraft; set: Set; errors: Record<string, string>; waitNote: string }) {
  return (
    <>
      <div>
        <span className="nd-form__label">Their terms</span>
        <Segmented label="Their terms" value={d.embedTerms} onChange={(v) => set("embedTerms")(v)} options={[{ value: "allowed", label: "Allow embedding" }, { value: "unclear", label: "Unclear" }]} />
        {d.embedTerms === "unclear" && <p className="nd-form__note">It's saved but not on the dial. Someone asks them first.</p>}
      </div>
      {d.embedTerms === "allowed" && (
        <>
          <div className="nd-form__pair">
            <Field label="Terms page" type="url" placeholder="https://" value={d.termsUrl} onChange={(e) => set("termsUrl")(e.target.value)} error={errors.termsUrl} />
            <Field label="Checked on" type="date" value={d.termsCheckedOn} onChange={(e) => set("termsCheckedOn")(e.target.value)} error={errors.termsCheckedOn} />
          </div>
          {!complete("embed", d) && <p className="nd-form__note">{waitNote}</p>}
        </>
      )}
    </>
  );
}

export function StreamEvidenceFields({ d, set, errors, streamUrl }: { d: EvidenceDraft; set: Set; errors: Record<string, string>; streamUrl: string }) {
  return (
    <>
      <div>
        <span className="nd-form__label">Why it can play</span>
        <Segmented
          label="Why it can play"
          value={d.why}
          onChange={(v) => set("why")(v)}
          options={[
            { value: "permission", label: "Their written permission" },
            { value: "public", label: "Clearly public" },
            { value: "not_yet", label: "Not yet" }
          ]}
        />
        {d.why === "not_yet" && <p className="nd-form__note">It's saved but not on the dial until they say yes in writing, or it's confirmed public.</p>}
      </div>
      {d.why === "permission" && (
        <>
          <div className="nd-form__pair">
            <Field label="Who said yes" help="“Maria Lopez, City Clerk, City of Colton”." value={d.grantedBy} onChange={(e) => set("grantedBy")(e.target.value)} error={errors.grantedBy} />
            <Field label="Said yes on" type="date" value={d.grantedOn} onChange={(e) => set("grantedOn")(e.target.value)} error={errors.grantedOn} />
          </div>
          <Field label="Where it's kept" help="“Email to network@opencast.tv, Sept 18”." value={d.keptAt} onChange={(e) => set("keptAt")(e.target.value)} error={errors.evidence} />
          <Field label="Document" labelAside="Optional" type="url" placeholder="https://" value={d.documentUrl} onChange={(e) => set("documentUrl")(e.target.value)} error={errors.documentUrl} />
          <p className="nd-form__note">
            Recorded once and never edited. It covers {streamUrl.trim() ? <span className="nd-mono">{streamUrl.trim()}</span> : "the stream address above"} only.
          </p>
        </>
      )}
      {d.why === "public" && (
        <Field label="The basis" help="“US government, public”, “Public body, stream published for the public”." value={d.publicBasis} onChange={(e) => set("publicBasis")(e.target.value)} error={errors.publicBasis} />
      )}
    </>
  );
}

export function NoteField({ d, set, errors }: { d: EvidenceDraft; set: Set; errors: Record<string, string> }) {
  return <Field label="Note" labelAside="Optional" help="What's being waited on: “Asked Sept 22”." value={d.note} onChange={(e) => set("note")(e.target.value)} error={errors.note} />;
}
