// Pledge (home 07.1): `?modal=pledge&station=<CALLSIGN>`. Monthly is the default, like a member
// station. The on-air credit is opt-in and uses the name you choose. Pledging needs sign-in: the
// sign-in names the pledge and finishes it afterwards. With a checkout link it goes there;
// otherwise it's done, and says so.

import { useState } from "react";
import { accountsApi, ledgerApi, stationsApi } from "@opencast/contracts";
import { AmountPicker, Button, Checkbox, Field, Segmented, money, useToast, type AmountChoice } from "@opencast/ui";
import { call } from "../../../api/client";
import { StationPageX } from "../../api/ext";
import { keyFor } from "../../../api/hooks";
import { useAuth } from "../../../auth/AuthProvider";
import { useMe } from "../../data/viewer";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, useApiAs } from "./overlay";
import { callSignOf, identText } from "./logic";

export const PLEDGE_AMOUNTS = [5_000_000, 10_000_000, 20_000_000] as const;
export const PLEDGE_MIN = 1_000_000;
/**
 * Opencast's share of a pledge, in basis points (open question 2): 0, so the whole pledge goes to
 * the station less card fees. The summary line is written for 0; any other value needs new copy.
 */
export const PLEDGE_SHARE_BPS = 0;

/** A typed amount ("12.50", "$12") as micros, or null when it isn't one. */
export function parseAmount(text: string): number | null {
  const t = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100) * 10_000;
}

/** The chosen amount, or why it can't be used. */
export function pledgeAmount(choice: AmountChoice | null, other: string): { micros: number | null; error: string | null } {
  if (choice === null) return { micros: null, error: null };
  if (choice !== "other") return { micros: choice, error: null };
  if (!other.trim()) return { micros: null, error: null };
  const m = parseAmount(other);
  if (m === null) return { micros: null, error: "Enter an amount in dollars, like 12.50." };
  if (m < PLEDGE_MIN) return { micros: null, error: `Pledges start at ${money(PLEDGE_MIN)}.` };
  return { micros: m, error: null };
}

/** "$10.00 a month goes to Inland Beat. Cancel any time from You." */
export function pledgeSummary(micros: number, cadence: "monthly" | "once", stationName: string): string {
  return cadence === "monthly" ? `${money(micros)} a month goes to ${stationName}. Cancel any time from You.` : `${money(micros)} goes to ${stationName}, once.`;
}

export function PledgeModal({ stationRef, onClose }: { stationRef: string; onClose: () => void }) {
  const page = useApiAs("watch", stationsApi.getStation, { params: { stationRef } }, StationPageX);
  const auth = useAuth();
  const me = useMe();
  const toast = useToast();
  const qc = useQueryClient();
  const [cadence, setCadence] = useState<"monthly" | "once">("monthly");
  const [choice, setChoice] = useState<AmountChoice | null>(10_000_000);
  const [other, setOther] = useState("");
  const [credit, setCredit] = useState(true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const st = page.data?.station;
  const displayName = me.data?.displayName ?? null;
  const { micros, error: amountError } = pledgeAmount(choice, other);
  const cs = st ? callSignOf(st) : "";
  // Signed in with no name yet: the credit asks for one here.
  const askName = auth.signedIn && credit && !displayName;

  const submit = () => {
    if (!st || micros === null) return;
    const amount = micros;
    const pledge = async () => {
      setBusy(true);
      setError(null);
      try {
        if (credit && !displayName && name.trim()) await call(accountsApi.updateMe, { body: { displayName: name.trim() } });
        const r = await call(ledgerApi.pledge, { params: { stationId: st.id }, body: { cadence, amountMicros: amount, creditOnAir: credit } });
        void qc.invalidateQueries({ queryKey: keyFor(ledgerApi.listMyPledges).slice(0, 2) });
        if (r.checkoutUrl) {
          window.location.assign(r.checkoutUrl);
          return;
        }
        onClose();
        toast.show({ message: cadence === "monthly" ? `Pledged ${money(amount)} a month to ${st.name}` : `Pledged ${money(amount)} to ${st.name}` });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    };
    auth.requireSignIn({ kind: "pledge", label: `pledge to ${st.name}`, finish: `Pledge ${money(amount)} and go back` }, pledge);
  };

  // Sign-in takes the screen while it's open; the pledge comes back if it's closed.
  if (auth.signIn.open) return null;

  return (
    <Dialog
      open
      onClose={onClose}
      width={440}
      title={st ? `Pledge to ${st.name}` : undefined}
      label="Pledge"
      subtitle={st ? `${identText(st)} is run by listeners and local underwriters.` : undefined}
      footer={
        <Button variant="primary" block onClick={submit} disabled={!st || micros === null || busy || (askName && !name.trim())}>
          Continue to payment
        </Button>
      }
    >
      {page.isError ? (
        <p className="vw-pm-msg">{page.error.message}</p>
      ) : (
        <div className="vw-pledge">
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
          <AmountPicker
            className="vw-pledge__amts"
            label={cadence === "monthly" ? "How much a month" : "How much"}
            amounts={PLEDGE_AMOUNTS}
            value={choice}
            onChange={setChoice}
            otherValue={other}
            onOtherChange={setOther}
            otherError={amountError}
          />
          <Checkbox checked={credit} onChange={setCredit} label="Credit me on air">
            {displayName ? `as "${displayName}" in ${cs}'s monthly thank-you to members` : `in ${cs}'s monthly thank-you to members`}
          </Checkbox>
          {askName && <Field label="Your name on air" value={name} onChange={(e) => setName(e.target.value)} help="Stations read it as you write it." />}
          {micros !== null && st && <p className="vw-pledge__sum">{pledgeSummary(micros, cadence, st.name)}</p>}
          {error && (
            <p className="vw-pm-msg" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
