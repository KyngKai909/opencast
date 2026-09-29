// Add money (biz-funding 06.1 on the phone; the Balance page's "Add money" on the web, as a modal
// with the same content and button): the usual amount and source already chosen, the fee in
// dollars, and one button. Owners and managers add money; choosing among the business's sources is
// fine for both (adding or removing a source is the owner's, in Settings). "From Clear" is the
// person's linked Clear account: Connect Clear when it isn't linked, Confirm in Clear with full
// access, and with read-only access where to send money from inside Clear (no button).

import { useState } from "react";
import type { Balance, FundingSource } from "@opencast/contracts";
import { AmountPicker, Button, ChoiceList, Modal, money, type AmountChoice } from "@opencast/ui";
import { shortAddress } from "../../auth/clear";
import { useBusiness } from "../../business/BusinessContext";
import { ClearReadOnly, useClearFunding } from "./ClearFunding";
import { SecTop } from "./SecTop";
import { useAddMoney, useQuote } from "./useAddMoney";
import { feeText, parseDollars, pickSource, sourceParts } from "./words";
import "./AddMoney.css";

const $ = (d: number) => d * 1_000_000;
const AMOUNTS = [$(100), $(250), $(500)];
/** The source list's value for the linked Clear account (not a funding source id). */
const CLEAR = "clear";

export interface AddMoneyProps {
  balance: Balance;
  /** The amount to start on (the notice's `amount`, else the usual amount), in micros. */
  amount: number;
  /** The source to start on (the notice's `source`). */
  sourceId?: string | null;
  /** Auto top-up is off: offer turning it on. */
  autoTopUpOff: boolean;
  layout: "inline" | "modal";
  onClose: () => void;
}

export function AddMoney({ balance, amount: start, sourceId, autoTopUpOff, layout, onClose }: AddMoneyProps) {
  const b = useBusiness();
  const flow = useAddMoney(b.id);
  const cf = useClearFunding(b.id);
  const [choice, setChoice] = useState<AmountChoice>(AMOUNTS.includes(start) ? start : "other");
  const [otherText, setOtherText] = useState(AMOUNTS.includes(start) ? "" : money(start).slice(1));
  const [otherError, setOtherError] = useState<string | null>(null);
  const [sourceChoice, setSourceChoice] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // With Clear linkable here, the linked account stands for Clear; an older clear_account source would repeat it.
  const withClear = cf.state !== "unavailable";
  const sources = withClear ? balance.fundingSources.filter((f) => f.kind !== "clear_account") : balance.fundingSources;
  const wanted = sourceChoice ?? sourceId ?? null;
  const fromClear = withClear && (wanted === CLEAR || (!wanted && (sources.length === 0 || cf.state === "full") && !sources.some((f) => f.isDefault)));
  const source: FundingSource | null = fromClear ? null : pickSource(sources, wanted);
  const amount = choice === "other" ? parseDollars(otherText) : choice;
  const valid = amount !== null && amount >= $(1);
  const quote = useQuote(b.id, valid ? amount : null, fromClear ? "clear_account" : (source?.kind ?? null));
  const shown = valid ? money(amount, { trimCents: true }) : null;

  async function submit() {
    setFailed(null);
    if (fromClear && cf.state === "not_linked") {
      setBusy(true);
      await cf
        .connect()
        .catch((e: Error) => setFailed(e.message))
        .finally(() => setBusy(false));
      return;
    }
    if (!valid) {
      setOtherError("Add at least $1.00.");
      return;
    }
    setBusy(true);
    try {
      if (fromClear) await cf.confirm(amount);
      else if (source) await flow.add(amount, source);
      else return;
      onClose();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const fee = feeText(quote.data?.feeMicros);
  let from: { title: string; detail: string } | null = null;
  if (fromClear) {
    const a = cf.clear.account;
    from = {
      title: "From Clear",
      detail: cf.state === "full" && a ? `${shortAddress(a.address)}, no fee` : cf.state === "read_only" ? "Shared read-only" : "Not connected yet"
    };
  } else if (source) {
    const s = sourceParts(source);
    const detail = [s.account, fee].filter(Boolean).join(", ");
    from = { title: `From ${s.name}`, detail: detail.charAt(0).toUpperCase() + detail.slice(1) };
  }
  const options = [...sources.map((f) => ({ value: f.id, title: f.label })), ...(withClear ? [{ value: CLEAR, title: "Clear", helper: cf.clear.account ? shortAddress(cf.clear.account.address) : "Not connected yet" }] : [])];

  const readOnly = fromClear && cf.state === "read_only";
  const body = (
    <>
      {!readOnly && (
        <AmountPicker
          variant="mono"
          label="How much"
          className="bz-add__amounts"
          amounts={AMOUNTS}
          value={choice}
          onChange={(c) => {
            setChoice(c);
            setOtherError(null);
          }}
          otherValue={otherText}
          onOtherChange={(t) => {
            setOtherText(t);
            setOtherError(null);
          }}
          otherError={otherError}
        />
      )}
      {!from ? (
        <p className="bz-add__none">{b.can("manage") ? "Add a way to pay first, in Settings." : "The owner hasn't added a way to pay yet."}</p>
      ) : picking ? (
        <ChoiceList
          className="bz-add__pick"
          label="Add money from"
          value={fromClear ? CLEAR : (source?.id ?? null)}
          onChange={(id) => {
            setSourceChoice(id);
            setPicking(false);
          }}
          options={options}
        />
      ) : (
        <div className="bz-add__from">
          <div>
            <b>{from.title}</b>
            {from.detail && <small>{from.detail}</small>}
          </div>
          {options.length > 1 && (
            <Button size="sm" onClick={() => setPicking(true)}>
              Change
            </Button>
          )}
        </div>
      )}
      {readOnly && <ClearReadOnly businessId={b.id} />}
      {failed && (
        <p className="bz-add__err" role="alert">
          {failed}
        </p>
      )}
    </>
  );
  const label = fromClear ? (cf.state === "not_linked" ? "Connect Clear" : "Confirm in Clear") : shown ? `Add ${shown}` : "Add money";
  const button = readOnly ? null : (
      <Button variant="primary" block={layout === "inline"} disabled={busy || !from} onClick={() => void submit()}>
        {label}
      </Button>
    );
  const foot =
    autoTopUpOff && b.can("manage") && layout === "inline" ? (
      <p className="bz-add__foot">
        Or <a href={`${b.base}/settings/money`}>turn on auto top-up</a> so this doesn't happen again.
      </p>
    ) : null;

  if (layout === "modal") {
    return (
      <Modal open onClose={onClose} title="Add money" footer={button ?? undefined} width={500}>
        {body}
        {flow.widget}
      </Modal>
    );
  }
  return (
    <section className="bz-add" aria-labelledby="bz-add-h">
      <SecTop title="Add money" id="bz-add-h" />
      {body}
      {button && <div className="bz-add__go">{button}</div>}
      {foot}
      {flow.widget}
    </section>
  );
}
