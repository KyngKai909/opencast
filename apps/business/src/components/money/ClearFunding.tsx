// Adding money from Clear (the person's Clear wallet, linked through Privy's cross-app linking; see
// auth/clear.tsx). Three states: not linked (Connect Clear links it), linked with full access (the
// amount, then Confirm in Clear: quote, Clear sends it once the person confirms on Clear's page,
// then the API checks it and credits the balance), and linked read-only (money is added inside
// Clear, to the business's balance account, which this shows; there's no transfer button).

import { ledgerApi } from "@opencast/contracts";
import { money, useToast } from "@opencast/ui";
import { call } from "../../api/client";
import { useApi } from "../../api/hooks";
import { BalanceX } from "../../api/ext/money";
import { shortAddress, useClear } from "../../auth/clear";
import { useRefreshMoney } from "./useAddMoney";
import "./ClearFunding.css";

export type ClearFundingState = "unavailable" | "not_linked" | "full" | "read_only";

export function clearFundingState(c: { available: boolean; account: { access: "read_only" | "full" } | null }): ClearFundingState {
  if (c.account) return c.account.access;
  return c.available ? "not_linked" : "unavailable";
}

/** The helper line under "Your Clear business account" (the frame's words when not linked). */
export function clearHelper(state: ClearFundingState, address: string | null): string {
  if (state === "full" && address) return `Instant, from ${shortAddress(address)}`;
  if (state === "read_only") return "Shared read-only: money is added inside Clear";
  if (state === "unavailable") return "Not available here yet";
  return "Instant, once connected. Connect it here";
}

export function useClearFunding(businessId: string) {
  const clear = useClear();
  const toast = useToast();
  const refresh = useRefreshMoney();
  const state = clearFundingState(clear);

  async function connect() {
    await clear.link();
  }

  /** Full access: quote, Clear sends it (confirmed on Clear's page), then the API credits it. */
  async function confirm(amountMicros: number) {
    const q = await call(ledgerApi.quoteClearTransfer, { params: { businessId }, body: { amountMicros } });
    const txHash = await clear.transfer({ to: q.to, tokenAddress: q.token.address, chainId: q.chainId, amountUnits: q.amountUnits });
    const res = await call(ledgerApi.confirmClearTransfer, { params: { businessId }, body: { amountMicros, txHash } });
    await refresh();
    const amount = money(amountMicros, { trimCents: true });
    toast.show({ message: res.status === "arrived" ? `${amount} is in your balance` : `${amount} is on its way` });
    return res;
  }

  return { clear, state, connect, confirm };
}

/** Read-only: where to send money from inside Clear. The address comes from the balance (E7); without it, only the words. */
export function ClearReadOnly({ businessId }: { businessId: string }) {
  const balance = useApi(ledgerApi.getBalance, { params: { businessId } }, { schema: BalanceX });
  const address = balance.data?.depositAddress ?? null;
  return (
    <div className="bz-clear-ro">
      <p className="bz-clear-ro__p">
        Clear shares your account read-only, so money is added inside Clear. {address ? "Send USDC to your balance at this address, and it's available once it arrives." : "Open Clear to send money to your balance."}
      </p>
      {address && (
        <p className="bz-clear-ro__addr" aria-label="Your balance's address">
          {address}
        </p>
      )}
    </div>
  );
}
