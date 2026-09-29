// Settings, Close account (the rail's last item; no frame draws it). The owner's alone: what
// closing does to spots, money and the team, then typing the name to close it (P21,
// spots.closeBusiness). The available balance goes back to the default bank or Clear account, never
// a card. It's refused while an order is being made or reviewed (409 order_in_progress), and when
// there's money to send back and nowhere to send it (409 no_source): each says what to do first.

import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { accountsApi, ledgerApi, spotsApi } from "@opencast/contracts";
import { Button, Field, money, useToast } from "@opencast/ui";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, call } from "../../api/client";
import { useApi } from "../../api/hooks";
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
  // What has to happen first, when the API refused (409): finish the order, or add a bank.
  const [first, setFirst] = useState<"order_in_progress" | "no_source" | null>(null);
  const name = b.business.name;

  if (balance.isLoading) return <Quiet />;
  const bal = balance.data;
  // Money goes back to the default bank or Clear account (never a card), else the first other one.
  const back = [...(bal?.fundingSources ?? [])].sort((x, y) => Number(y.isDefault) - Number(x.isDefault)).find((f) => f.kind !== "card");
  const source = back?.label.replace(/^Clear,\s*/, "") ?? null;
  const matches = typed.trim().toLowerCase() === name.toLowerCase();

  const close = async (e: FormEvent) => {
    e.preventDefault();
    if (!matches) return setError(`Type ${name} to close it.`);
    setError(null);
    setFirst(null);
    setBusy(true);
    try {
      const r = await call(spotsApi.closeBusiness, { params: { businessId: b.id }, body: { confirmName: typed.trim() } });
      toast.show({ message: r.returnedMicros > 0 ? `${name} is closed. ${money(r.returnedMicros)} is on its way to ${source}` : `${name} is closed` });
      await qc.invalidateQueries({ queryKey: [accountsApi.getMe.method, accountsApi.getMe.path] });
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && (err.code === "order_in_progress" || err.code === "no_source")) setFirst(err.code);
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
            {bal && source
              ? `${money(bal.availableMicros)} goes back to ${source}.${bal.heldMicros > 0 ? ` ${money(bal.heldMicros)} held for airings stations have scheduled pays for those airings, and anything left follows.` : ""}`
              : bal && bal.availableMicros > 0
                ? `${money(bal.availableMicros)} can't go back to a card. Add a bank or Clear account in Money and receipts first.`
                : `What's available goes back to ${source ?? "your bank or Clear account"}.`}
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
        <Field label={`Type ${name} to close it`} value={typed} autoComplete="off" onChange={(e) => (setTyped(e.target.value), setError(null), setFirst(null))} error={error ?? undefined} />
        <Button variant="ink" type="submit" disabled={busy || !matches}>
          Close the account
        </Button>
      </form>
      {first && (
        <Button size="sm" className="bz-close__first" href={first === "order_in_progress" ? `${b.base}/orders` : `${b.base}/settings/money`}>
          {first === "order_in_progress" ? "Made for you" : "Money and receipts"}
        </Button>
      )}
    </div>
  );
}
