// "Connect Clear" in Settings, Station account: the owner's Clear wallet, linked through Privy's
// cross-app linking (they approve on Clear's page), and paying the station out to it. Read-only
// access is enough for payouts. Nothing about a Clear account shows until the owner links it.
// No frame draws this; the words are listed in docs/apps/new-copy.md.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ledgerApi } from "@opencast/contracts";
import { Button, KeyValueList, useToast } from "@opencast/ui";
import { call } from "../../api/client";
import { keyFor, useApi } from "../../api/hooks";
import { shortAddress, useClear } from "../../auth/clear";
import { useStation } from "../../station/StationContext";
import "./ClearWallet.css";

export function accessWords(access: "read_only" | "full"): string {
  return access === "full" ? "Full access: payouts can go here, and you confirm any transfer in Clear" : "Read only: payouts can go here. Money moves inside Clear";
}

export function ClearWallet() {
  const s = useStation();
  const clear = useClear();
  const toast = useToast();
  const qc = useQueryClient();
  const owner = s.can("moveMoney");
  const name = s.station.callSign ?? s.station.name;
  const payout = useApi(ledgerApi.getPayoutAccount, { params: { stationId: s.id } }, { enabled: owner, retry: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dest = payout.data?.destination ?? null;
  const toWallet = dest?.kind === "clear_wallet";

  const run = async (f: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError(null);
    try {
      await f();
      await qc.invalidateQueries({ queryKey: keyFor(ledgerApi.getPayoutAccount).slice(0, 2) });
      if (done) toast.show({ message: done });
    } catch (e) {
      setError((e as Error).message || "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const payTo = (kind: "clear_wallet" | "clear_account") => run(() => call(ledgerApi.setPayoutDestination, { params: { stationId: s.id }, body: { kind } }), kind === "clear_wallet" ? `${name} is paid out to your Clear wallet.` : `${name} is paid into its Clear account.`);

  return (
    <section className="cc-clearwallet" aria-labelledby="cc-clearwallet-h">
      <h4 className="cc-clearwallet__h" id="cc-clearwallet-h">
        Your Clear wallet
      </h4>
      {!clear.available ? (
        <p className="cc-clearwallet__note">Connect Clear isn't set up here.</p>
      ) : clear.loading ? (
        <div className="cc-clearwallet__quiet" aria-busy="true" />
      ) : clear.account ? (
        <>
          <KeyValueList
            variant="rows"
            items={[
              { title: `Clear wallet, ${shortAddress(clear.account.address)}`, detail: accessWords(clear.account.access) },
              { title: "Payouts", detail: toWallet ? `${name} is paid out to this wallet` : `${name} is paid into its Clear account` }
            ]}
          />
          {owner && (
            <div className="cc-clearwallet__acts">
              {toWallet ? (
                <Button size="sm" onClick={() => void payTo("clear_account")} disabled={busy}>
                  Pay into {name}'s Clear account instead
                </Button>
              ) : (
                <Button size="sm" variant="primary" onClick={() => void payTo("clear_wallet")} disabled={busy}>
                  Pay {name} out here
                </Button>
              )}
              <Button size="sm" onClick={() => void run(() => clear.unlink(), "Clear is disconnected.")} disabled={busy}>
                Disconnect
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="cc-clearwallet__note">Link your Clear wallet to pay {name} out to it. You approve it on Clear's page, and Clear decides what it shares.</p>
          {owner && (
            <div className="cc-clearwallet__acts">
              <Button size="sm" variant="primary" onClick={() => void run(() => clear.link(), "Clear is connected.")} disabled={busy}>
                Connect Clear
              </Button>
            </div>
          )}
        </>
      )}
      {error && (
        <p className="cc-clearwallet__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
