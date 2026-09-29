// Answering a claim (rights 03.1), a modal over the claim (/rights/:claimId/answer): which of the
// library's three rights statements is true, what backs it up, and the statement that the answer
// goes out with the station's legal name. Send stays off until the statement is ticked. On the
// phone it's a sheet, and a file is easier at a computer, so it says so (rights 06 note).

import { useRef, useState } from "react";
import { API_PREFIX, buildPath, trustApi } from "@opencast/contracts";
import { Button, Checkbox, ChoiceList, Icon, Modal, Sheet, TextAreaField, useToast } from "@opencast/ui";
import { useApiMutation } from "../../../api/hooks";
import { ApiError } from "../../../api/client";
import { stationExtApi, type ClaimX } from "../../api/ext/station";
import { useAuth } from "../../../auth/AuthProvider";
import { config } from "../../../config";
import type { StationState } from "../../station/StationContext";
import { attestation, BASIS_WORDS, nounOf, type Basis } from "./claimWords";
import { shortName } from "./format";
import "./AnswerClaim.css";

/** B6: sends the file that backs the answer; returns the address answerClaim takes. */
async function attach(claimId: string, file: File, token: string | null): Promise<string> {
  const form = new FormData();
  form.set("file", file);
  const res = await fetch(`${config.apiBase}${API_PREFIX}${buildPath(stationExtApi.attachToClaim.path, { claimId })}`, {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: form
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? "error", json?.error?.message ?? "The file didn't upload. Try again.");
  const parsed = stationExtApi.attachToClaim.response.safeParse(json);
  if (!parsed.success) throw new ApiError(500, "bad_response", "The file didn't upload. Try again.");
  return parsed.data.attachmentUrl;
}

/** What's still missing before the answer can go. Null when it can be sent. */
export function answerBlocker(a: { basis: Basis | null; file: boolean; note: string; attested: boolean }): string | null {
  if (!a.basis) return "Choose which is true.";
  if (a.basis === "owner_permission" && !a.file) return "Attach the permission or licence.";
  if (a.basis === "public_domain" && !a.note.trim()) return "Say where it came from.";
  if (!a.attested) return "Tick the statement to send it.";
  return null;
}

export function AnswerClaim({ s, claim, phone, onClose }: { s: StationState; claim: ClaimX; phone: boolean; onClose: () => void }) {
  const cs = s.station.callSign ?? s.station.name;
  const auth = useAuth();
  const toast = useToast();
  const answer = useApiMutation(trustApi.answerClaim, { invalidates: [trustApi.listClaims] });
  const [basis, setBasis] = useState<Basis | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const noun = nounOf(claim);
  const statement = attestation(claim, cs);
  const blocker = answerBlocker({ basis, file: !!file, note, attested });

  const send = async () => {
    if (blocker || !basis) return setError(blocker);
    setBusy(true);
    setError(null);
    try {
      const attachmentUrl = basis === "owner_permission" && file ? await attach(claim.id, file, await auth.getToken()) : undefined;
      await answer.mutateAsync({ params: { claimId: claim.id }, body: { basis, note: note.trim() || undefined, attachmentUrl, attest: true } });
      toast.show({ message: `Answer sent to ${shortName(claim.claimantName)}. ${claim.item.title} is back on air.` });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <div className="cc-answer">
      <ChoiceList<Basis>
        label="Which is true?"
        value={basis}
        onChange={(b) => (setBasis(b), setError(null))}
        options={(Object.keys(BASIS_WORDS) as Basis[]).map((b) => ({ value: b, title: BASIS_WORDS[b].title, helper: BASIS_WORDS[b].helper(cs, noun) }))}
      />
      {basis === "owner_permission" &&
        (phone ? (
          <p className="cc-answer__desk">
            <Icon name="info" size={15} />
            Attaching a licence is easier at a computer. Finish this answer on master control on the web.
          </p>
        ) : (
          <div className="cc-answer__file">
            <span className="cc-answer__label" id="cc-answer-file">
              Attach the permission
            </span>
            <button type="button" className="cc-answer__pick" aria-labelledby="cc-answer-file" aria-describedby="cc-answer-file-name" onClick={() => fileInput.current?.click()}>
              <Icon name="link" size={15} />
              <span id="cc-answer-file-name">{file ? file.name : "Choose a file"}</span>
            </button>
            <input ref={fileInput} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.txt,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
        ))}
      <TextAreaField label="Anything to add" value={note} maxLength={2000} rows={2} onChange={(e) => setNote(e.target.value)} />
      <Checkbox checked={attested} onChange={setAttested} label={statement.bold}>
        {statement.rest}
      </Checkbox>
      {error && (
        <p className="cc-answer__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
  const footer = (
    <Button variant="primary" block onClick={send} disabled={!!blocker || busy || (phone && basis === "owner_permission")} aria-describedby={blocker ? "cc-answer-why" : undefined}>
      Send answer
    </Button>
  );
  const props = { open: true, onClose, eyebrow: `To ${claim.claimantName}`, title: "Answer the claim", footer, width: 560 };
  return (
    <>
      {phone ? <Sheet {...props}>{body}</Sheet> : <Modal {...props}>{body}</Modal>}
      <span className="oc-sr-only" id="cc-answer-why">
        {blocker}
      </span>
    </>
  );
}
