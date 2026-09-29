// Managing a pledge (you 04.1): /you/pledges/:pledgeId, a Modal over You (a Sheet on the phone).
// The amount, the on-air credit, the card, the next charge, receipts with the running total; Save
// changes, and "Stop pledging", which confirms once and says exactly when it ends. A one-time
// pledge shows its receipt instead, with what the station said about taxes.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ledgerApi, stationsApi, type Pledge } from "@opencast/contracts";
import { AmountPicker, Button, Modal, Segmented, Sheet, StationBand, Toggle, money, useToast, type AmountChoice } from "@opencast/ui";
import { call } from "../../../api/client";
import { keyFor, useApi } from "../../../api/hooks";
import { useMe } from "../../data/viewer";
import { useIsPhone } from "../../layout/shell";
import { MARKET_TZ, now } from "../../../lib/clock";
import { usePledges } from "./useYouData";
import { dateLabel, monthLabel } from "./youRules";
import "./PledgeModal.css";

const AMOUNTS = [5_000_000, 10_000_000, 20_000_000];

/** "$12.50" or "12.50" typed in Other, to micros; null when it isn't an amount. */
export function parseAmount(text: string): number | null {
  const t = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100) * 10_000;
}

/** The month a stopped pledge ends after: this month, in the market's zone. */
export function endsAfterMonth(p: Pick<Pledge, "endsAfter">, at: Date): string {
  return p.endsAfter ? monthLabel(`${p.endsAfter}T12:00:00Z`, MARKET_TZ) : monthLabel(at, MARKET_TZ);
}

export function PledgeModal({ pledgeId }: { pledgeId: string }) {
  const pledges = usePledges();
  const navigate = useNavigate();
  const close = () => navigate("/you", { replace: true });
  const p = pledges.data?.find((x) => x.id === pledgeId);
  useEffect(() => {
    if (pledges.data && !p) navigate("/you", { replace: true });
  }, [pledges.data, p, navigate]);
  if (!p) return null;
  return p.cadence === "once" ? <ReceiptView p={p} onClose={close} /> : <ManageView key={p.id} p={p} onClose={close} />;
}

function Frame({ p, lede, onClose, footer, children }: { p: Pledge; lede: [string, string]; onClose: () => void; footer?: React.ReactNode; children: React.ReactNode }) {
  const phone = useIsPhone();
  const band = <StationBand channel={p.station.channel ?? ""} callSign={p.station.callSign ?? p.station.name} colour={p.station.colour ?? "#33507A"} name={lede[0]} place={lede[1]} onClose={phone ? undefined : onClose} />;
  if (phone)
    return (
      <Sheet open onClose={onClose} stationBand={band} label={`Your pledge to ${p.station.name}`} footer={footer}>
        {children}
      </Sheet>
    );
  return (
    <Modal open onClose={onClose} stationBand={band} label={`Your pledge to ${p.station.name}`} footer={footer} width={500} showClose={false}>
      {children}
    </Modal>
  );
}

function Receipts({ p }: { p: Pledge }) {
  const [open, setOpen] = useState(false);
  const items = p.receipts.items ?? [];
  return (
    <>
      <div className="vw-y-prow vw-y-prow--last">
        <div>
          <b>Receipts</b>
          <small>
            {p.receipts.count} so far, {money(p.receipts.totalMicros)} in total
          </small>
        </div>
        {items.length > 0 && (
          <Button size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "Hide" : "View"}
          </Button>
        )}
      </div>
      {open && (
        <ul className="vw-y-receipts" aria-label="Receipts">
          {items.map((r) => (
            <li key={r.id}>
              <span>{dateLabel(`${r.on}T12:00:00Z`, MARKET_TZ)}</span>
              {r.url ? (
                <a href={r.url} className="oc-mono">
                  {money(r.amountMicros)}
                </a>
              ) : (
                <span className="oc-mono">{money(r.amountMicros)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function CardRow({ p }: { p: Pledge }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  if (!p.card) return null;
  const change = async () => {
    setError(null);
    try {
      const { url } = await call(ledgerApi.pledgeCardSession, { params: { pledgeId: p.id } });
      if (url.startsWith("/")) navigate(url);
      else window.location.assign(url);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="vw-y-prow">
      <div>
        <b>Card</b>
        <small className={p.card.expired ? "vw-y-prow__warn" : undefined}>{p.card.expired ? `${p.card.label}, expired` : p.card.label}</small>
        {error && <small className="vw-y-prow__warn">{error}</small>}
      </div>
      <Button size="sm" onClick={() => void change()}>
        Change
      </Button>
    </div>
  );
}

function ManageView({ p, onClose }: { p: Pledge; onClose: () => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const name = me.data?.displayName ?? null;
  const preset = AMOUNTS.includes(p.amountMicros);
  const [cadence, setCadence] = useState<"monthly" | "once">("monthly");
  const [amount, setAmount] = useState<AmountChoice>(preset ? p.amountMicros : "other");
  const [other, setOther] = useState(preset ? "" : (p.amountMicros / 1e6).toFixed(2));
  const [credit, setCredit] = useState(p.creditOnAir);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopped = !!p.endsAfter;
  const endMonth = endsAfterMonth(p, now());

  const micros = amount === "other" ? parseAmount(other) : amount;
  const otherError = amount === "other" && other !== "" && (micros === null || micros < 1_000_000) ? "Pledges start at $1.00." : undefined;
  const refresh = () => void qc.invalidateQueries({ queryKey: keyFor(ledgerApi.listMyPledges).slice(0, 2) });

  const save = async () => {
    if (micros === null || micros < 1_000_000) {
      setError("Pledges start at $1.00.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await call(ledgerApi.updatePledge, { params: { pledgeId: p.id }, body: { amountMicros: micros, creditOnAir: credit, ...(cadence === "once" ? { cadence } : {}) } });
      refresh();
      onClose();
      toast.show({ message: `Your pledge to ${p.station.name} is saved` });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    setError(null);
    try {
      await call(ledgerApi.updatePledge, { params: { pledgeId: p.id }, body: { stop: true } });
      refresh();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const lede: [string, string] = ["Your pledge", `since ${monthLabel(p.startedAt, MARKET_TZ)}`];

  if (confirming)
    return (
      <Frame
        p={p}
        lede={lede}
        onClose={onClose}
        footer={
          <>
            <Button onClick={() => setConfirming(false)} disabled={busy}>
              Keep pledging
            </Button>
            <Button onClick={() => void stop()} disabled={busy}>
              Stop pledging
            </Button>
          </>
        }
      >
        <p className="vw-pledge__confirm">
          Your pledge to {p.station.name} ends after {endMonth}. You won't be charged again.
        </p>
        {error && (
          <p className="vw-pledge__err" role="alert">
            {error}
          </p>
        )}
      </Frame>
    );

  return (
    <Frame
      p={p}
      lede={lede}
      onClose={onClose}
      footer={
        <>
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            Save changes
          </Button>
          {!stopped && (
            <Button onClick={() => setConfirming(true)} disabled={busy}>
              Stop pledging
            </Button>
          )}
        </>
      }
    >
      {!stopped && (
        <>
          <Segmented
            block
            label="How often"
            value={cadence}
            onChange={setCadence}
            options={[
              { value: "monthly", label: "Monthly" },
              { value: "once", label: "Once" }
            ]}
          />
          {cadence === "once" && <p className="vw-pledge__note">It won't be charged again after {endMonth}.</p>}
          <AmountPicker className="vw-pledge__amts" label="How much a month" amounts={AMOUNTS} value={amount} onChange={setAmount} otherValue={other} onOtherChange={setOther} otherLabel="Amount" otherError={otherError} />
        </>
      )}
      <div className="vw-y-prow">
        <div id="vw-credit-l">
          <b>Credit me on air</b>
          <small>{name ? `As "${name}" in ${p.station.callSign ?? p.station.name}'s monthly thank-you` : "Add the name stations call you in Settings, Account, first"}</small>
        </div>
        <Toggle checked={credit && !!name} onChange={setCredit} disabled={!name} aria-labelledby="vw-credit-l" />
      </div>
      <CardRow p={p} />
      {stopped ? (
        <div className="vw-y-prow">
          <div>
            <b>Ends</b>
            <small>After {endMonth}. You won't be charged again.</small>
          </div>
        </div>
      ) : (
        p.nextChargeOn && (
          <div className="vw-y-prow">
            <div>
              <b>Next charge</b>
              <small>{dateLabel(`${p.nextChargeOn}T12:00:00Z`, MARKET_TZ)}</small>
            </div>
            <span className="oc-mono vw-y-prow__amt">{money(micros ?? p.amountMicros)}</span>
          </div>
        )
      )}
      <Receipts p={p} />
      {error && (
        <p className="vw-pledge__err" role="alert">
          {error}
        </p>
      )}
    </Frame>
  );
}

function ReceiptView({ p, onClose }: { p: Pledge; onClose: () => void }) {
  const page = useApi(stationsApi.getStation, { params: { stationRef: p.station.id } });
  const deductible = page.data?.pledgesTaxDeductible;
  const taxes =
    deductible === true
      ? `${p.station.name} says pledges to it are tax-deductible.`
      : deductible === false
        ? `${p.station.name} says pledges to it aren't tax-deductible.`
        : deductible === null
          ? `${p.station.name} hasn't said whether pledges to it are tax-deductible.`
          : null;
  return (
    <Frame p={p} lede={["Your pledge", `on ${dateLabel(p.startedAt, MARKET_TZ)}`]} onClose={onClose}>
      <div className="vw-y-prow">
        <div>
          <b>Amount</b>
          <small>Once</small>
        </div>
        <span className="oc-mono vw-y-prow__amt">{money(p.amountMicros)}</span>
      </div>
      <CardRow p={p} />
      <Receipts p={p} />
      {taxes && <p className="vw-pledge__tax">{taxes}</p>}
    </Frame>
  );
}
