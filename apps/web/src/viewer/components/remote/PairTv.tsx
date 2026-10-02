// "Use a code from the TV" (from Watch on): a guest's phone, or one not signed in to the TV's
// account, pairs with the Opencast app on a TV by the 4-digit code the TV shows in Settings, Remote
// and phones (B2's pairPhone). The pairing stays on this device, so the TV is in Watch on next time.

import { useState, type FormEvent } from "react";
import { tvApi } from "@opencast/contracts";
import { Button, Field, Sheet } from "@opencast/ui";
import { call } from "../../../api/client";
import { normalisePairCode, pairWithCode, type Pairing } from "../../cast/pairings";

export function PairTvSheet({ phoneName, onBack, onClose, onPaired }: { phoneName: string; onBack: () => void; onClose: () => void; onPaired: (p: Pairing) => Promise<void> | void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await pairWithCode(code, phoneName, (body) => call(tvApi.pairPhone, { body }));
    if (!r.ok) {
      setBusy(false);
      return setError(r.error);
    }
    await onPaired(r.pairing);
    setBusy(false);
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Use a code from the TV"
      className="vw-wo vw-pair"
      footer={
        <Button variant="primary" block type="submit" form="vw-pair-form" disabled={busy}>
          {busy ? "Pairing" : "Pair this phone"}
        </Button>
      }
    >
      <form id="vw-pair-form" onSubmit={(e) => void submit(e)} noValidate>
        <p className="vw-pair__lede">On the TV, open Settings, then Remote and phones. Enter the 4-digit code it shows.</p>
        <Field
          label="Code on the TV"
          mono
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={4}
          value={code}
          onChange={(e) => setCode(normalisePairCode(e.target.value))}
          error={error ?? undefined}
          autoFocus
        />
      </form>
      <Button variant="text" size="sm" className="vw-wo__how" onClick={onBack}>
        Back to Watch on
      </Button>
    </Sheet>
  );
}
