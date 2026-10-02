// Settings, Station account: pay-as-you-go (follow-up Phase 2). Being on air is free; a station
// pays for storage, relays of everything it airs and live hours, from its earnings first, then its
// funding source. Built from the settings frame's parts (station-settings: .sec-top, .row2, the
// options list) and the contract (billingApi); no frame draws it, and its words are listed in
// docs/apps/new-copy.md. Top to bottom:
//
// - the standing, when there's something to say: in grace (the date relays and live shows pause)
//   or paused (what's paused, the channel still on air), with Pay now;
// - This month: usage so far per type, with units, prices and the free allowance, and the month's
//   estimate;
// - Caps: per type, set, changed or removed, with what reaching one pauses (never the channel);
// - What pays: earnings first, then Clear (full access only) or a card saved through Stripe;
// - Bills: each month's usage and where its money came from.
//
// Owners change it and pay (`canManage`, the API's rule); operators see it read-only.

import { useId, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { billingApi, ledgerApi, type StationAccount, type UsageLine, type UsageType } from "@opencast/contracts";
import { Button, ChoiceList, Field, KeyValueList, Notice, Tag, money, useToast, type KeyValueRow } from "@opencast/ui";
import { ApiError, call } from "../../../api/client";
import { keyFor, useApi } from "../../../api/hooks";
import { shortAddress, useClear } from "../../../auth/clear";
import { useStation } from "../../station/StationContext";
import { parseAmount } from "../earnings/lines";
import { CardForm } from "./CardForm";
import { billDetail, capDetail, cardExpiry, monthOf, monthSoFar, standingWords, usageDetail } from "./usage";
import "../station/settings/common.css";
import "./UsageAccount.css";

type Where = "standing" | "caps" | "funding";

const message = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : "") || "Something went wrong. Try again.";

/** The Station account, read by the pane and the banners (one cache entry). */
export function useStationAccount(stationId: string, enabled = true) {
  return useApi(billingApi.getStationAccount, { params: { stationId } }, { enabled, retry: false });
}

function Top({ title, sub, end, id }: { title: string; sub?: ReactNode; end?: ReactNode; id: string }) {
  return (
    <div className="cc-sec-top">
      <h4 className="cc-sec-top__h" id={id}>
        {title}
      </h4>
      {sub && <span className="cc-sec-top__sub">{sub}</span>}
      {end && <span className="cc-sec-top__end">{end}</span>}
    </div>
  );
}

export function UsageAccount() {
  const s = useStation();
  const name = s.label;
  const params = { stationId: s.id };
  const q = useStationAccount(s.id);
  const qc = useQueryClient();
  const toast = useToast();
  const clear = useClear();
  const ids = { month: useId(), caps: useId(), funding: useId(), bills: useId() };
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ where: Where; text: string } | null>(null);
  const [editing, setEditing] = useState<UsageType | null>(null);
  const [capText, setCapText] = useState("");
  const [cardOpen, setCardOpen] = useState(false);

  if (q.isLoading) return <div className="cc-usage" aria-busy="true" />;
  const a = q.data;
  if (!a)
    return (
      <div className="cc-usage">
        <p className="cc-error" role="alert">
          {q.error?.message ?? "Something went wrong. Try again."}
        </p>
      </div>
    );

  const owner = a.canManage;
  const put = (next: StationAccount) => {
    qc.setQueryData([...keyFor(billingApi.getStationAccount, { params }), 0], next);
    // Paying takes from earnings first: the Earnings page's figures move too.
    void qc.invalidateQueries({ queryKey: keyFor(ledgerApi.getStationEarnings).slice(0, 2) });
  };
  const run = async (key: string, where: Where, f: () => Promise<StationAccount>, done?: (next: StationAccount) => string | null) => {
    setBusy(key);
    setError(null);
    try {
      const next = await f();
      put(next);
      const text = done?.(next);
      if (text) toast.show({ message: text });
      return true;
    } catch (e) {
      const text = message(e);
      setError({ where, text: e instanceof ApiError && e.code === "card_declined" ? `${text} Replace the card to pay it${a.funding.clear.available ? ", or choose Clear" : ""}.` : text });
      return false;
    } finally {
      setBusy(null);
    }
  };

  // ---- standing and Pay now ----
  const words = standingWords(a, owner);
  const due = a.dueMicros;
  const wasPaused = a.standing === "paused";
  const paidWords = () => `${money(due)} is paid. ${wasPaused ? "Relays and live shows are back." : "Nothing is due."}`;
  const payNow = () =>
    run(
      "pay",
      "standing",
      async () => {
        if (a.funding.source === "clear") {
          const quote = await call(billingApi.quoteClearUsagePayment, { params });
          const txHash = await clear.transfer({ to: quote.to, tokenAddress: quote.token.address, chainId: quote.chainId, amountUnits: quote.amountUnits });
          return call(billingApi.confirmClearUsagePayment, { params, body: { amountMicros: quote.amountMicros, txHash } });
        }
        return call(billingApi.payUsageNow, { params });
      },
      (next) => (next.dueMicros === 0 ? paidWords() : null)
    );
  const payAction =
    owner && due > 0 ? (
      a.funding.source ? (
        <Button size="sm" variant="primary" onClick={() => void payNow()} disabled={busy !== null}>
          {a.funding.source === "clear" ? "Pay from Clear" : "Pay now"}
        </Button>
      ) : a.funding.cardsAvailable ? (
        <Button size="sm" variant="primary" onClick={() => setCardOpen(true)} disabled={busy !== null}>
          Add a card
        </Button>
      ) : undefined
    ) : undefined;

  // ---- caps ----
  const cappable = a.usage.filter((l) => l.cap.cappable);
  const startEdit = (l: UsageLine) => {
    setEditing(l.type);
    setCapText(l.cap.micros !== null ? money(l.cap.micros) : "");
    setError(null);
  };
  const saveCap = (l: UsageLine) => {
    const micros = parseAmount(capText);
    if (micros === null) return setError({ where: "caps", text: "Enter a dollar amount, like 25.00." });
    void run("cap", "caps", () => call(billingApi.setUsageCaps, { params, body: { caps: { [l.type]: micros } } }), () => `${l.label} is capped at ${money(micros)} a month.`).then((ok) => ok && setEditing(null));
  };
  const removeCap = (l: UsageLine) => void run("cap", "caps", () => call(billingApi.setUsageCaps, { params, body: { caps: { [l.type]: null } } }), () => `${l.label} has no cap.`);
  const capEnd = (l: UsageLine) => {
    if (editing === l.type)
      return (
        <form
          className="cc-usage__capform"
          onSubmit={(e) => {
            e.preventDefault();
            saveCap(l);
          }}
        >
          <Field size="sm" mono inputMode="decimal" autoComplete="off" aria-label={`Monthly cap for ${l.label}`} value={capText} onChange={(e) => setCapText(e.target.value)} autoFocus />
          <Button size="sm" variant="primary" type="submit" disabled={busy !== null}>
            Save
          </Button>
          <Button size="sm" variant="text" type="button" onClick={() => setEditing(null)}>
            Cancel
          </Button>
        </form>
      );
    return (
      <span className="cc-usage__capend">
        <span className="cc-row__val">{l.cap.micros !== null ? `${money(l.cap.micros)} a month` : "No cap"}</span>
        {owner && (
          <>
            <Button size="sm" onClick={() => startEdit(l)} disabled={busy !== null} aria-label={`${l.cap.micros !== null ? "Change" : "Set a cap"}: ${l.label}`}>
              {l.cap.micros !== null ? "Change" : "Set a cap"}
            </Button>
            {l.cap.micros !== null && (
              <Button size="sm" variant="text" onClick={() => removeCap(l)} disabled={busy !== null} aria-label={`Remove cap: ${l.label}`}>
                Remove
              </Button>
            )}
          </>
        )}
      </span>
    );
  };

  // ---- what pays ----
  const f = a.funding;
  const setSource = (source: "clear" | "card") =>
    void run("funding", "funding", () => call(billingApi.setFundingSource, { params, body: { source } }), () => (source === "clear" ? "Clear pays what earnings don't cover." : `${f.card?.label ?? "The card"} pays what earnings don't cover.`));
  const removeCard = () => void run("card", "funding", () => call(billingApi.removeCard, { params }), () => `${f.card?.label ?? "The card"} is removed.`);
  const clearHelper = f.clear.available && f.clear.address ? `${shortAddress(f.clear.address)}. You approve each payment in Clear` : (f.clear.why ?? "Clear can't pay here");
  const sourceName = f.source === "clear" ? "Your Clear wallet" : f.source === "card" ? (f.card?.label ?? "The card") : null;
  const cardRow: KeyValueRow = f.card
    ? {
        title: f.card.label,
        detail: [cardExpiry(f.card), "Saved with Stripe"].filter(Boolean).join(". "),
        actions: owner ? (
          <>
            <Button size="sm" onClick={() => setCardOpen(true)} disabled={busy !== null}>
              Replace
            </Button>
            <Button size="sm" variant="text" onClick={removeCard} disabled={busy !== null} aria-label={`Remove ${f.card.label}`}>
              Remove
            </Button>
          </>
        ) : undefined
      }
    : {
        title: "No card",
        detail: f.cardsAvailable ? "A card saved with Stripe pays what earnings don't cover" : "Cards can't be saved on this server",
        actions:
          owner && f.cardsAvailable ? (
            <Button size="sm" onClick={() => setCardOpen(true)} disabled={busy !== null}>
              Add a card
            </Button>
          ) : undefined
      };

  const onCardSaved = (next: StationAccount) => {
    setCardOpen(false);
    put(next);
    const label = next.funding.card?.label ?? "The card";
    toast.show({ message: due > 0 && next.dueMicros === 0 ? `${label} is saved, and ${paidWords()}` : `${label} is saved.` });
  };

  const errorFor = (where: Where) =>
    error?.where === where ? (
      <p className="cc-error" role="alert">
        {error.text}
      </p>
    ) : null;

  return (
    <div className="cc-usage">
      {words && <Notice className="cc-usage__standing" tone={words.tone} title={words.title} detail={words.detail} action={payAction} />}
      {errorFor("standing")}
      {!owner && <p className="cc-readonly">Only owners change caps and what pays, or pay what's due.</p>}

      <section aria-labelledby={ids.month}>
        <Top id={ids.month} title="This month" sub={monthSoFar(a)} />
        <table className="cc-usage__table" aria-labelledby={ids.month}>
          <thead>
            <tr>
              <th scope="col">
                <span className="oc-sr-only">Usage</span>
              </th>
              <th scope="col">So far</th>
              <th scope="col">Month, estimated</th>
            </tr>
          </thead>
          <tbody>
            {a.usage.map((l) => (
              <tr key={l.type}>
                <th scope="row">
                  <b>
                    {l.label}
                    {l.paused === "cap" && <Tag variant="standby">Cap reached</Tag>}
                    {l.paused === "unpaid" && <Tag variant="standby">Paused</Tag>}
                  </b>
                  <small>{usageDetail(l)}</small>
                </th>
                <td>{l.free ? "Free" : money(l.soFarMicros)}</td>
                <td>{l.free ? "Free" : money(l.estimate.micros)}</td>
              </tr>
            ))}
            <tr className="cc-usage__total">
              <th scope="row">Total</th>
              <td>{money(a.totals.soFarMicros)}</td>
              <td>{money(a.totals.estimateMicros)}</td>
            </tr>
          </tbody>
        </table>
        <p className="cc-usage__note">
          Free each month: {a.allowance.storageGb.toLocaleString("en-US")} GB of storage and {a.allowance.liveHours.toLocaleString("en-US")} live hours. Left in {monthOf(a.month)}: {Number(a.allowance.storageGbLeft.toFixed(2)).toLocaleString("en-US")} GB and{" "}
          {Number(a.allowance.liveHoursLeft.toFixed(2)).toLocaleString("en-US")} live hours. The estimate is storage as it stands today and hours at this month's pace.
        </p>
      </section>

      <section aria-labelledby={ids.caps}>
        <Top id={ids.caps} title="Caps" sub="A month never costs more than its caps" />
        <ul className="cc-usage__rows" aria-labelledby={ids.caps}>
          {cappable.map((l) => (
            <li className="cc-row" key={l.type}>
              <div>
                <b>{l.label}</b>
                <small>{capDetail(l)}</small>
              </div>
              {capEnd(l)}
            </li>
          ))}
        </ul>
        {errorFor("caps")}
      </section>

      <section aria-labelledby={ids.funding}>
        <Top id={ids.funding} title="What pays" sub="Earnings first, always" />
        <KeyValueList
          variant="rows"
          items={[
            { title: `${name}'s earnings`, detail: "Usage is taken from earnings first, before each payout and when the month closes. Available now", amount: f.earningsAvailableMicros },
            ...(owner ? [] : [{ title: "Then, what earnings don't cover", value: sourceName ?? "Nothing yet" } satisfies KeyValueRow])
          ]}
        />
        {owner && (
          <div className="cc-usage__choice">
            <p className="cc-usage__label" aria-hidden="true">
              Then, what earnings don't cover
            </p>
            <ChoiceList
              label="What pays what earnings don't cover"
              value={f.source}
              onChange={(v) => v !== f.source && setSource(v)}
              options={[
                { value: "clear", title: "Your Clear wallet", helper: clearHelper, disabled: !f.clear.available || busy !== null },
                { value: "card", title: f.card ? f.card.label : "A card", helper: f.card ? (f.card.expired ? "Expired. Replace it to pay with a card" : "Charged at the month's end, off session") : "Add a card to choose it", disabled: !f.card || busy !== null }
              ]}
            />
            <p className="cc-usage__note">
              {f.source === null
                ? "Nothing can pay what earnings don't cover yet. Add a card, or connect Clear with full access below."
                : f.chosen === null
                  ? `You haven't chosen, so ${f.source === "clear" ? "your Clear wallet" : "the card"} pays: a Clear wallet with full access first, otherwise the card.`
                  : "Your choice. Choose the other any time."}
            </p>
          </div>
        )}
        <KeyValueList variant="rows" items={[cardRow]} />
        {errorFor("funding")}
      </section>

      <section aria-labelledby={ids.bills}>
        <Top id={ids.bills} title="Bills" sub="Each month's usage, newest first" />
        {a.bills.length ? (
          <KeyValueList
            variant="rows"
            items={a.bills.map((b) => ({
              title: (
                <>
                  {monthOf(b.month)}
                  {b.status === "due" && (
                    <>
                      {" "}
                      <Tag variant="standby" className="cc-usage__tag">
                        Due
                      </Tag>
                    </>
                  )}
                </>
              ),
              detail: billDetail(b, f.card?.label ?? null),
              amount: b.amountMicros
            }))}
          />
        ) : (
          <p className="cc-usage__note">No bills yet. The first comes when this month closes.</p>
        )}
      </section>

      {owner && <CardForm open={cardOpen} onClose={() => setCardOpen(false)} stationId={s.id} name={name} replacing={!!f.card} onSaved={onCardSaved} />}
    </div>
  );
}
