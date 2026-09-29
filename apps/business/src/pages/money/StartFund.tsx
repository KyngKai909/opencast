// biz-funding 02.1 Getting started 2 of 3: Fund your balance (/:businessId/start/fund). How to add
// money (bank transfer through Clear, card, or a Clear business account, each with its fee in
// dollars), how much, what that buys in airings, auto top-up, and the four-line promise. Linking a
// source opens the provider's own window (ledger.addFundingSource); then ledger.addMoney, and on to
// the first spot. A bank transfer is pending until it arrives; a card or Clear account is available
// at once. Setup is the owner's (sources and auto top-up are owner-only).

import { useState } from "react";
import { useNavigate } from "react-router";
import { ledgerApi, spotsApi, type FundingSource } from "@opencast/contracts";
import { AmountPicker, Button, ChoiceList, ControlTitle, PromiseList, Toggle, money, useToast, type AmountChoice } from "@opencast/ui";
import { call } from "../../api/client";
import { useApi } from "../../api/hooks";
import { useBusiness } from "../../business/BusinessContext";
import { ClearReadOnly, clearHelper, useClearFunding } from "../../components/money/ClearFunding";
import { SecTop } from "../../components/money/SecTop";
import { SetupBusiness } from "../../components/money/SetupBusiness";
import { useAddMoney, useQuote } from "../../components/money/useAddMoney";
import { estimateLine, methodPhrase, PROMISE } from "../../components/money/fund";
import { parseDollars } from "../../components/money/words";
import { useShellOptions } from "../../layout/shell";
import { Quiet } from "../common";
import "./StartFund.css";

type Kind = FundingSource["kind"];
const $ = (d: number) => d * 1_000_000;
const AMOUNTS = [$(100), $(250), $(500)];

export default function StartFund() {
  useShellOptions({});
  return (
    <SetupBusiness>
      <Fund />
    </SetupBusiness>
  );
}

function Fund() {
  const b = useBusiness();
  const navigate = useNavigate();
  const toast = useToast();
  const owner = b.can("manage");
  const balance = useApi(ledgerApi.getBalance, { params: { businessId: b.id } });
  const sources = balance.data?.fundingSources ?? [];
  const hasClearAccount = sources.some((s) => s.kind === "clear_account");
  const cf = useClearFunding(b.id);
  // "Your Clear business account" is the linked Clear account (Me.clear); an older linked
  // clear_account source still works through addMoney when Clear isn't available here.
  const viaLink = cf.state !== "unavailable";

  const [picked, setPicked] = useState<Kind | null>(null);
  const method: Kind = picked ?? (cf.state === "full" || hasClearAccount ? "clear_account" : "clear_bank");
  const [choice, setChoice] = useState<AmountChoice>($(250));
  const [otherText, setOtherText] = useState("");
  const [autoTopUp, setAutoTopUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [otherError, setOtherError] = useState<string | null>(null);

  const amount = choice === "other" ? parseDollars(otherText) : choice;
  const valid = amount !== null && amount >= $(1);
  const quoteAmount = valid ? amount : $(250);
  const bank = useQuote(b.id, quoteAmount, "clear_bank");
  const card = useQuote(b.id, quoteAmount, "card");
  const clear = useQuote(b.id, quoteAmount, "clear_account");
  const chosen = { clear_bank: bank, card, clear_account: clear }[method];
  const flow = useAddMoney(b.id);

  if (!owner) {
    return (
      <div className="bz-fund">
        <ControlTitle title="Fund your balance" description="Only the owner can change where money comes from or take it out." />
        <Button href={`${b.base}/balance`}>Go to the balance</Button>
      </div>
    );
  }
  if (balance.isLoading) return <Quiet />;

  const fee = (q: typeof bank) => (q.data ? (q.data.feeMicros > 0 ? money(q.data.feeMicros) : "No fee") : undefined);
  const shown = money(valid ? amount : quoteAmount, { trimCents: true });

  async function submit() {
    setFailed(null);
    if (!valid) {
      setOtherError("Add at least $1.00.");
      return;
    }
    setBusy(true);
    try {
      if (method === "clear_account" && viaLink) {
        if (cf.state === "not_linked") {
          await cf.connect();
          return;
        }
        if (cf.state === "full") await cf.confirm(amount);
        // Read-only: the money is added inside Clear; carry on.
      } else {
        const source = await flow.sourceOfKind(method, sources);
        if (!source) return;
        await flow.add(amount, source);
      }
      if (autoTopUp) {
        await call(spotsApi.updateBusiness, { params: { businessId: b.id }, body: { autoTopUp: { on: true, amountMicros: amount, belowDays: 3 } } }).catch(() =>
          toast.show({ message: "Auto top-up didn't turn on. You can turn it on from the balance." })
        );
      }
      navigate(`${b.base}/start/spot`);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bz-fund">
      <ControlTitle title="Fund your balance" description="A spot can be listed once your balance covers at least a day of its budget." />
      <div className="bz-fund__grid">
        <div>
          <ChoiceList<Kind>
            variant="method"
            label="How to add money"
            value={method}
            onChange={setPicked}
            options={[
              { value: "clear_bank", title: "Bank transfer, through Clear", helper: "From any US bank. Arrives in 1 to 2 business days", end: fee(bank) },
              { value: "card", title: "Card", helper: "Arrives right away", end: fee(card), endNote: card.data && card.data.feeMicros > 0 ? "Stripe's fee, at cost" : undefined },
              {
                value: "clear_account",
                title: "Your Clear business account",
                helper: viaLink || !hasClearAccount ? clearHelper(cf.state, cf.clear.account?.address ?? null) : "Instant, connected",
                end: fee(clear),
                disabled: !viaLink && !hasClearAccount
              }
            ]}
          />
          <SecTop title="How much" className="bz-fund__much" />
          <AmountPicker
            variant="mono"
            label="How much"
            className="bz-fund__amounts"
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
          {chosen.data && <p className="bz-fund__est">{estimateLine(chosen.data, valid ? amount : quoteAmount)}</p>}
          <div className="bz-fund__auto">
            <div>
              <b id="bz-fund-auto">Top up automatically</b>
              <small>Add {shown} whenever what's available drops below 3 days of airings</small>
            </div>
            <Toggle checked={autoTopUp} onChange={setAutoTopUp} aria-labelledby="bz-fund-auto" />
          </div>
        </div>
        <div>
          <PromiseList title="What happens to your money" headingLevel={2} lines={PROMISE} />
          <Button variant="primary" block className="bz-fund__go" disabled={busy} onClick={() => void submit()}>
            {method === "clear_account" && viaLink
              ? { not_linked: "Connect Clear", full: "Confirm in Clear", read_only: "Continue" }[cf.state as "not_linked" | "full" | "read_only"]
              : `Add ${shown} ${methodPhrase(method)}`}
          </Button>
          {method === "clear_account" && cf.state === "read_only" && <ClearReadOnly businessId={b.id} />}
          {failed && (
            <p className="bz-fund__err" role="alert">
              {failed}
            </p>
          )}
          <p className="bz-fund__foot">The rate you set is what you pay. Opencast adds nothing on top.</p>
        </div>
      </div>
      {flow.widget}
    </div>
  );
}
