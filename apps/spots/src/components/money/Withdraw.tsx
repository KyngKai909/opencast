// biz-funding 04.1 Take money out (?modal=withdraw over Balance; a sheet on the phone): anything
// not held, to a linked source. It says what stays held and why, what's left in days of airings,
// when it arrives, and what happens to the spots if it runs down to a day. Owners only: managers
// and viewers who reach it see why they can't.

import { useState, type ReactNode } from "react";
import { ledgerApi, type Balance } from "@opencast/contracts";
import { Button, Field, KeyValueList, Modal, SelectField, Sheet, money, useToast } from "@opencast/ui";
import { call } from "../../api/client";
import { shortAddress, useClear } from "../../auth/clear";
import { useBusiness } from "../../business/BusinessContext";
import { useIsPhone } from "../../layout/shell";
import { useRefreshMoney } from "./useAddMoney";
import { aboutDays, daysCovered, parseDollars, pickSource } from "./words";
import "./Withdraw.css";

/** What the modal says about an amount: what's left, in days, and whether the spots would pause. */
export function afterWithdrawal(balance: Pick<Balance, "availableMicros" | "pacePerDayMicros">, amountMicros: number | null) {
  const left = balance.availableMicros - Math.max(0, amountMicros ?? 0);
  const days = daysCovered(left, balance.pacePerDayMicros);
  const over = amountMicros !== null && amountMicros > balance.availableMicros;
  const underADay = balance.pacePerDayMicros > 0 && left < balance.pacePerDayMicros;
  return { left, days, over, underADay };
}

export function Withdraw({ balance, onClose }: { balance: Balance; onClose: () => void }) {
  const b = useBusiness();
  const phone = useIsPhone();
  const toast = useToast();
  const refresh = useRefreshMoney();
  const clear = useClear();
  const [text, setText] = useState("");
  const [sourceId, setSourceId] = useState(() => pickSource(balance.fundingSources)?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // Called as a function, not a component, so typing doesn't remount the form.
  const dialog = ({ children, ...rest }: { title: string; subtitle?: string; footer: ReactNode; children: ReactNode }) =>
    phone ? (
      <Sheet open onClose={onClose} {...rest}>
        {children}
      </Sheet>
    ) : (
      <Modal open onClose={onClose} width={500} {...rest}>
        {children}
      </Modal>
    );
  if (!b.can("manage")) {
    return dialog({
      title: "Take money out",
      footer: <Button onClick={onClose}>Close</Button>,
      children: <p className="bz-out__note">Only the owner can change where money comes from or take it out.</p>
    });
  }

  const amount = text.trim() ? parseDollars(text) : null;
  const after = afterWithdrawal(balance, amount);
  // The owner's linked Clear account can be a destination before it's a funding source: it becomes
  // one (addFundingSource, token "linked") when money is first taken out to it.
  const linkedToAdd = clear.account && !balance.fundingSources.some((f) => f.kind === "clear_account") ? clear.account : null;
  const toClear = sourceId === "clear" && !!linkedToAdd;
  const source = toClear ? { id: "clear", label: `Clear, ${shortAddress(linkedToAdd!.address)}` } : (balance.fundingSources.find((f) => f.id === sourceId) ?? null);
  const error = text.trim() && amount === null ? "Type an amount, like $300.00." : after.over ? "That's more than is available." : failed;
  const ready = amount !== null && amount > 0 && !after.over && !!source;

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setFailed(null);
    try {
      let to = source!.id;
      if (toClear) {
        const list = await call(ledgerApi.addFundingSource, { params: { businessId: b.id }, body: { kind: "clear_account", token: "linked", makeDefault: false } });
        to = list.find((f) => f.kind === "clear_account")!.id;
      }
      await call(ledgerApi.withdraw, { params: { businessId: b.id }, body: { amountMicros: amount!, fundingSourceId: to } });
      await refresh();
      toast.show({ message: `${money(amount!)} is on its way to ${source!.label}` });
      onClose();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  const held = balance.heldAirings > 0 ? `${money(balance.heldMicros)} for ${balance.heldAirings} scheduled ${balance.heldAirings === 1 ? "airing" : "airings"}` : `${money(balance.heldMicros)}, nothing scheduled`;
  const left = `${money(Math.max(0, after.left))}${after.days !== null ? `, ${aboutDays(after.days)} of airings` : ""}`;

  return dialog({
    title: "Take money out",
    subtitle: `Up to ${money(balance.availableMicros)} is available.`,
    footer: (
      <Button variant="primary" disabled={!ready || busy} onClick={() => void submit()}>
        {ready ? `Take out ${money(amount!)}` : "Take money out"}
      </Button>
    ),
    children: (
      <form
        className="bz-out"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field
          label="Amount"
          mono
          inputMode="decimal"
          placeholder={money(0)}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setFailed(null);
          }}
          onBlur={() => amount !== null && setText(money(amount))}
          error={error}
        />
        <SelectField label="To" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
          {balance.fundingSources.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
          {linkedToAdd && <option value="clear">{`Clear, ${shortAddress(linkedToAdd.address)}`}</option>}
        </SelectField>
        <KeyValueList
          className="bz-out__kv"
          items={[
            { label: "Stays held", value: held },
            { label: "Left available", value: left },
            { label: "Arrives", value: "1 to 2 business days, no fee" }
          ]}
        />
        <p className="bz-out__note">
          {after.underADay && amount
            ? "What's left is under a day of airings, so your spots pause and stations are told. They resume when you add money."
            : "Your spots keep running. If what's available drops below a day of budget, they pause and stations are told, and they resume when you add money."}
        </p>
      </form>
    )
  });
}
