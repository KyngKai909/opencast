// "Add a card" for a station's usage (owners): a SetupIntent from the API (billingApi.startCardSetup),
// confirmed in Stripe's own card form (Stripe.js from js.stripe.com, the Payment Element), then
// saved by it (saveCard). Opencast never sees the card number. With no publishable key (dev, the
// mocks, the API's fake payments) there's no Stripe form: a clear stand-in saves the fake's test
// card instead, so the flow still works end to end. A modal on the web, a sheet on the phone.

import { useEffect, useRef, useState } from "react";
import { billingApi, type StationAccount } from "@opencast/contracts";
import { Button, Modal, Sheet } from "@opencast/ui";
import { ApiError, call } from "../../../api/client";
import { useIsPhone } from "../../layout/shell";
import { loadStripe, type StripeElements, type StripeJs } from "./stripe";

export interface CardFormProps {
  open: boolean;
  onClose: () => void;
  stationId: string;
  /** "BEAT" */
  name: string;
  /** A card is saved already: this one replaces it. */
  replacing: boolean;
  /** The card is saved; the account as it is now (anything due may have been paid with it). */
  onSaved: (account: StationAccount) => void;
}

type Setup = { setupIntentId: string; clientSecret: string; publishableKey: string | null };

const message = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : "") || "Something went wrong. Try again.";

export function CardForm({ open, onClose, stationId, name, replacing, onSaved }: CardFormProps) {
  const phone = useIsPhone();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [stripe, setStripe] = useState<{ js: StripeJs; elements: StripeElements } | null>(null);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const slot = useRef<HTMLDivElement | null>(null);

  // Each opening starts a fresh SetupIntent.
  useEffect(() => {
    setSetup(null);
    setStripe(null);
    setComplete(false);
    setError(null);
    if (!open) return;
    let gone = false;
    (async () => {
      try {
        const r = await call(billingApi.startCardSetup, { params: { stationId } });
        if (gone) return;
        setSetup(r);
        if (r.publishableKey) {
          const js = await loadStripe(r.publishableKey);
          if (!gone) setStripe({ js, elements: js.elements({ clientSecret: r.clientSecret }) });
        }
      } catch (e) {
        if (!gone) setError(message(e));
      }
    })();
    return () => {
      gone = true;
    };
  }, [open, stationId]);

  // Stripe's Payment Element, in Stripe's own frame.
  useEffect(() => {
    if (!stripe || !slot.current) return;
    const el = stripe.elements.create("payment", { layout: "tabs" });
    el.on("change", (e) => setComplete(!!e.complete));
    el.mount(slot.current);
    return () => el.destroy();
  }, [stripe]);

  const standIn = !!setup && !setup.publishableKey;

  const save = async () => {
    if (!setup) return;
    setBusy(true);
    setError(null);
    try {
      let setupIntentId = setup.setupIntentId;
      if (stripe) {
        const r = await stripe.js.confirmSetup({ elements: stripe.elements, redirect: "if_required", confirmParams: { return_url: window.location.href } });
        if (r.error) throw new Error(r.error.message || "That card wasn't saved. Try again.");
        if (r.setupIntent?.status !== "succeeded") throw new Error("Stripe is still checking the card. Try again in a moment.");
        setupIntentId = r.setupIntent.id;
      }
      onSaved(await call(billingApi.saveCard, { params: { stationId }, body: { setupIntentId } }));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <div className="cc-card">
      {!setup && !error && <div className="cc-card__quiet" aria-busy="true" />}
      {setup && !standIn && (
        <div className="cc-card__stripe" aria-busy={stripe ? undefined : "true"}>
          <div ref={slot} />
        </div>
      )}
      {standIn && (
        <div className="cc-card__standin" role="group" aria-labelledby="cc-card-standin">
          <b id="cc-card-standin">Stripe's card form goes here</b>
          <p>This server has no Stripe publishable key, so no card number is asked for. Saving adds the test card, Visa ending 4242.</p>
        </div>
      )}
      {error && (
        <p className="cc-card__error" role="alert">
          {error}
        </p>
      )}
      <p className="cc-card__note">Stripe keeps the card; Opencast never sees its number. Usage comes out of {name}'s earnings first, and the card pays only what they don't cover. Charges show OPENCAST on the card's statement.</p>
    </div>
  );
  const footer = (
    <Button variant="primary" block onClick={() => void save()} disabled={busy || !setup || (!standIn && (!stripe || !complete))}>
      {standIn ? "Save test card" : "Save card"}
    </Button>
  );
  const common = { open, onClose, title: replacing ? "Replace the card" : "Add a card", subtitle: `For ${name}'s usage.`, footer };
  return phone ? <Sheet {...common}>{body}</Sheet> : <Modal {...common} width={480}>{body}</Modal>;
}
