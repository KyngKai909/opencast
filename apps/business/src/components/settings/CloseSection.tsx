// Settings, Close account (the rail's last item; no frame draws it). The owner's alone: what
// closing does to spots, money and the team, then typing the name to close it. P21 proposes the
// endpoint; the mock takes the spots out, returns the available balance and empties the team.

import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { accountsApi, ledgerApi } from "@opencast/contracts";
import { Button, Field, money, useToast } from "@opencast/ui";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, call } from "../../api/client";
import { useApi } from "../../api/hooks";
import { settingsExtApi } from "../../api/ext/settings";
import type { BusinessState } from "../../business/BusinessContext";
import { Quiet } from "../../pages/common";
import "./common.css";
import "./CloseSection.css";

export function CloseSection({ b }: { b: BusinessState }) {
  const balance = useApi(ledgerApi.getBalance, { params: { businessId: b.id } });
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = b.business.name;

  if (balance.isLoading) return <Quiet />;
  const bal = balance.data;
  const source = bal?.fundingSources.find((f) => f.isDefault)?.label.replace(/^Clear,\s*/, "") ?? "your default funding source";
  const matches = typed.trim().toLowerCase() === name.toLowerCase();

  const close = async (e: FormEvent) => {
    e.preventDefault();
    if (!matches) return setError(`Type ${name} to close it.`);
    setError(null);
    setBusy(true);
    try {
      const r = await call(settingsExtApi.closeBusiness, { params: { businessId: b.id }, body: { confirmName: typed.trim() } });
      toast.show({ message: r.returnedMicros > 0 ? `${name} is closed. ${money(r.returnedMicros)} is on its way to ${source}` : `${name} is closed` });
      await qc.invalidateQueries({ queryKey: [accountsApi.getMe.method, accountsApi.getMe.path] });
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  };

  return (
    <div className="bz-close">
      <div className="bz-sec-top">
        <h4 className="bz-sec-top__h">What closing does</h4>
      </div>
      <div className="bz-row">
        <div>
          <b>Your spots stop</b>
          <small>They come out of every station's rotation today. Stations fill the time from their backup rotations.</small>
        </div>
      </div>
      <div className="bz-row">
        <div>
          <b>Your money comes back</b>
          <small>
            {bal
              ? `${money(bal.availableMicros)} goes back to ${source}.${bal.heldMicros > 0 ? ` ${money(bal.heldMicros)} held for airings stations have scheduled pays for those airings, and anything left follows.` : ""}`
              : `What's available goes back to ${source}.`}
          </small>
        </div>
      </div>
      <div className="bz-row">
        <div>
          <b>The team loses access</b>
          <small>Everyone on {name}'s account, you included. Download the receipts and statements you need first.</small>
        </div>
      </div>
      <form className="bz-close__form" onSubmit={close} noValidate>
        <Field label={`Type ${name} to close it`} value={typed} autoComplete="off" onChange={(e) => (setTyped(e.target.value), setError(null))} error={error ?? undefined} />
        <Button variant="ink" type="submit" disabled={busy || !matches}>
          Close the account
        </Button>
      </form>
    </div>
  );
}
