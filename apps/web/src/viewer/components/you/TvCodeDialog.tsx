// "Add a TV: Enter a code" (you 02.1; the TV side is tv 05.3): the code the Opencast app shows on
// the TV signs that TV in to this account (B2). ?modal=tv-code over You.

import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Field, Modal, Sheet, useToast } from "@opencast/ui";
import { call } from "../../../api/client";
import { keyFor } from "../../../api/hooks";
import { tvApi } from "@opencast/contracts";
import { useIsPhone } from "../../layout/shell";

export function TvCodeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const phone = useIsPhone();
  const qc = useQueryClient();
  const toast = useToast();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const c = code.replace(/\s/g, "").toUpperCase();
    if (c.length !== 6) {
      setError("The code on the TV has six letters and numbers.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await call(tvApi.approveTvCode, { params: { code: c } });
      void qc.invalidateQueries({ queryKey: keyFor(tvApi.listTvs).slice(0, 2) });
      setCode("");
      onClose();
      toast.show({ message: "The TV is signed in" });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <form id="vw-tv-code" onSubmit={submit} noValidate>
      <p className="vw-tvcode__lede">Open Opencast on the TV. It shows a code; enter it here.</p>
      <Field label="Code on the TV" mono autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} error={error ?? undefined} autoFocus />
    </form>
  );
  const footer = (
    <Button variant="primary" type="submit" form="vw-tv-code" disabled={busy}>
      Sign in the TV
    </Button>
  );
  if (phone)
    return (
      <Sheet open={open} onClose={onClose} title="Add a TV" footer={footer}>
        {body}
      </Sheet>
    );
  return (
    <Modal open={open} onClose={onClose} title="Add a TV" footer={footer} width={440}>
      {body}
    </Modal>
  );
}
