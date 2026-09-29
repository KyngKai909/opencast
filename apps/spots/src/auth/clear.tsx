// "Connect Clear": the person's Clear wallet, linked through Privy's cross-app linking (Clear's
// Privy app is the provider, Opencast's the requester; the person approves on a page Clear hosts).
// Clear shares it read-only (the address: a payout or withdrawal destination; funding happens in
// Clear) or with full access (Opencast can ask for a transfer, which the person confirms on
// Clear's page). The linked account always comes from the API (`Me.clear`), never guessed here.

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCrossAppAccounts, usePrivy } from "@privy-io/react-auth";
import { accountsApi, type ClearLink } from "@opencast/contracts";
import { call } from "../api/client";
import { keyFor } from "../api/hooks";
import { useMe } from "../business/BusinessContext";
import { config } from "../config";

export interface ClearTransfer {
  /** The business's balance account (from ledger.quoteClearTransfer). */
  to: string;
  /** USDC's contract. */
  tokenAddress: string;
  chainId: number;
  /** In the token's units (USDC: 6 decimals). */
  amountUnits: string;
}

export interface ClearState {
  /** Whether Connect Clear is set up here (Clear's provider app id configured, or mock mode). */
  available: boolean;
  /** The linked account, from the API; null when not linked. */
  account: ClearLink | null;
  loading: boolean;
  /** Links it (Clear's approval page), then records it with the API. */
  link(): Promise<ClearLink>;
  unlink(): Promise<void>;
  /** Full access only: asks Clear to send USDC; the person confirms on Clear's page. Returns the transaction hash. */
  transfer(t: ClearTransfer): Promise<string>;
}

/** ERC-20 `transfer(to, amount)` calldata. */
export function erc20TransferData(to: string, amountUnits: string): `0x${string}` {
  const addr = to.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const amount = BigInt(amountUnits).toString(16).padStart(64, "0");
  return `0xa9059cbb${addr}${amount}`;
}

function useApiSide() {
  const me = useMe();
  const qc = useQueryClient();
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: keyFor(accountsApi.getMe).slice(0, 2) }), [qc]);
  return { account: me.data?.clear ?? null, loading: me.isLoading, refresh };
}

function useNoClear(): ClearState {
  const api = useApiSide();
  const fail = async (): Promise<never> => {
    throw new Error("Connect Clear isn't set up here.");
  };
  return { available: false, account: api.account, loading: api.loading, link: fail, unlink: fail, transfer: fail };
}

/** Mock mode: linking succeeds at once (the mock API decides the access: see mocks/handlers/accounts.ts). */
function useMockClear(): ClearState {
  const api = useApiSide();
  const link = useCallback(async () => {
    await new Promise((r) => setTimeout(r, 400));
    const l = await call(accountsApi.linkClear);
    await api.refresh();
    return l;
  }, [api]);
  const unlink = useCallback(async () => {
    await call(accountsApi.unlinkClear);
    await api.refresh();
  }, [api]);
  const transfer = useCallback(async () => {
    await new Promise((r) => setTimeout(r, 600));
    const hex = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    return `0x${hex}`;
  }, []);
  return { available: true, account: api.account, loading: api.loading, link, unlink, transfer };
}

function usePrivyClear(): ClearState {
  const api = useApiSide();
  const { user } = usePrivy();
  const cross = useCrossAppAccounts();
  const appId = config.clearProviderAppId!;
  const linked = user?.linkedAccounts.find((a) => a.type === "cross_app" && a.providerApp.id === appId) as { subject: string } | undefined;
  const link = useCallback(async () => {
    if (!linked) await cross.linkCrossAppAccount({ appId });
    const l = await call(accountsApi.linkClear);
    await api.refresh();
    return l;
  }, [cross, appId, linked, api]);
  const unlink = useCallback(async () => {
    if (linked) await cross.unlinkCrossAppAccount({ subject: linked.subject });
    await call(accountsApi.unlinkClear);
    await api.refresh();
  }, [cross, linked, api]);
  const transfer = useCallback(
    async (t: ClearTransfer) => {
      if (!api.account) throw new Error("Connect Clear first.");
      if (api.account.access !== "full") throw new Error("Clear shares this account read-only. Add money inside Clear.");
      return cross.sendTransaction({ to: t.tokenAddress, data: erc20TransferData(t.to, t.amountUnits), chainId: t.chainId }, { address: api.account.address });
    },
    [cross, api.account]
  );
  return { available: true, account: api.account, loading: api.loading, link, unlink, transfer };
}

// Chosen once, at start: hooks must be called the same way on every render.
// The real-API runs' test sign-in has no Privy underneath: Connect Clear isn't set up there.
const useImpl = import.meta.env.DEV && import.meta.env.VITE_DEV_TOKEN_AUTH === "true" ? useNoClear : config.mock ? useMockClear : config.privyAppId && config.clearProviderAppId ? usePrivyClear : useNoClear;

export function useClear(): ClearState {
  return useImpl();
}

/** "0x1234…abcd" */
export function shortAddress(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
