// The Clear adapter. Clear holds every advertiser's and station's money: each gets a Clear
// business account holding USDC, with bank deposits and payouts through Clear's own stack. That
// account lives in Clear's own systems and Clear's own Privy app, not Opencast's: Opencast reaches
// it only through Clear's API (this client) and, for a person's own Clear wallet, the global
// wallet they link through Privy's cross-app linking (docs/clear-integration.md). A hold on an
// airing is an encumbrance on the advertiser's balance; settlement moves USDC from the
// advertiser's account to the station's. Stripe is the card on-ramp.
//
// `ClearClient` is the shape Opencast needs from Clear, not Clear's API: what exists and what's
// missing is listed in docs/clear-integration.md. Until a real client is written against Clear's
// endpoints, `fakeClear()` stands in (in memory).

import { createHash, randomUUID } from "node:crypto";
import { getAddress, type Hex } from "viem";
import type { UsdcTransfers } from "../chain/usdc.js";
import type { StripeCards } from "./stripe.js";
import {
  destinationWallet,
  onChain,
  ownAccountsCustody,
  ownerWallet,
  stripeCardFeeMicros,
  walletOwner,
  type AccountDirectory,
  type Owner,
  type PaymentEvent,
  type Payments,
  type ProviderMove,
  type Wallet
} from "./types.js";

export interface ClearClient {
  /**
   * A Clear business account for an advertiser or station (or Opencast). `needs_verification` comes
   * with Clear's hosted KYB link. Whether Clear lets Opencast open one on someone's behalf is open
   * (docs/open-decisions.md); under the safe default they open it in Clear first, and this finds it.
   */
  openAccount(input: { owner: Owner; legalName: string; idempotencyKey: string }): Promise<{ accountId: string; status: "active" | "needs_verification"; verificationUrl: string | null }>;
  /** Links a bank from a Plaid Link public token. */
  linkBank(input: { accountId: string; plaidPublicToken: string }): Promise<{ bankRef: string; label: string }>;
  /** Pulls from a linked bank into the account (ACH debit). Arrives in 1 to 2 business days. */
  pullFromBank(input: { accountId: string; bankRef: string; amountMicros: number; idempotencyKey: string; memo: string }): Promise<{ transferId: string; expectedAt: Date | null }>;
  cancelPull(transferId: string): Promise<void>;
  /** Places an encumbrance: the money stays in the account but can't be spent or withdrawn. */
  encumber(input: { accountId: string; amountMicros: number; reference: string; idempotencyKey: string }): Promise<{ encumbranceId: string }>;
  /** Releases part or all of an encumbrance. */
  releaseEncumbrance(input: { accountId: string; reference: string; amountMicros: number; idempotencyKey: string }): Promise<void>;
  /** Moves USDC from one Clear account to another (or to an on-chain address). */
  transfer(input: { fromAccountId: string; toAccountId: string; amountMicros: number; idempotencyKey: string; memo: string }): Promise<{ transferId: string }>;
  /** Sends money from the account to its linked bank (ACH credit). */
  payout(input: { accountId: string; bankRef: string | null; amountMicros: number; idempotencyKey: string; memo: string }): Promise<{ payoutId: string }>;
  /** Reads Clear's webhook (deposit arrived or failed, payout confirmed or failed, account verified). */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): Promise<PaymentEvent | null>;
  /** The account's address on chain (USDC on Base): where a transfer from a person's linked Clear wallet is sent. */
  accountAddress(accountId: string): Promise<string>;
  /** Sends USDC from the account to an address on chain: a payout or withdrawal to an owner's linked Clear wallet. */
  sendToWallet(input: { accountId: string; address: string; amountMicros: number; idempotencyKey: string; memo: string }): Promise<{ transferId: string }>;
}

export function clearPayments(clear: ClearClient, stripe: StripeCards | null, fallbackCard: Payments, options: { usdc?: UsdcTransfers | null } = {}): Payments {
  async function accountFor(owner: Owner, accounts: AccountDirectory): Promise<string> {
    const known = await accounts.get(owner, "clear");
    if (known) return known.ref;
    const legalName = owner.type === "opencast" ? `Opencast ${owner.label}` : (owner.name ?? owner.id);
    const opened = await clear.openAccount({ owner, legalName, idempotencyKey: `open:${ownerWallet(owner)}` });
    await accounts.save(owner, "clear", { ref: opened.accountId, status: opened.status === "active" ? "active" : "needs_onboarding", onboardingUrl: opened.verificationUrl });
    return opened.accountId;
  }

  async function accountForWallet(wallet: Wallet, accounts: AccountDirectory) {
    const owner = walletOwner(wallet);
    if (!owner) throw new Error(`No Clear account for wallet ${wallet}`);
    return accountFor(owner, accounts);
  }

  return {
    name: "clear",
    depositFeeMicros: (kind, amount) => (kind === "card" ? stripeCardFeeMicros(amount) : 0),
    arrives: (kind) => (kind === "clear_bank" ? "1 to 2 business days" : kind === "card" ? "Arrives right away" : "Instant"),

    async linkFundingSource(input, accounts) {
      const owner = { type: "advertiser" as const, id: input.businessId, name: input.businessName };
      if (input.kind === "card") return stripe ? stripe.link(owner, input.token, accounts) : fallbackCard.linkFundingSource(input, accounts);
      const accountId = await accountFor(owner, accounts);
      if (input.kind === "clear_account") return { providerRef: accountId, label: "Clear business account" };
      const bank = await clear.linkBank({ accountId, plaidPublicToken: input.token });
      return { providerRef: bank.bankRef, label: bank.label };
    },

    async startDeposit(input, accounts) {
      const owner = { type: "advertiser" as const, id: input.businessId };
      if (input.kind === "card") {
        if (!stripe) return fallbackCard.startDeposit(input, accounts);
        return stripe.charge({ depositId: input.depositId, owner, paymentMethodId: input.sourceRef!, amountMicros: input.amountMicros, feeMicros: input.feeMicros, bank: false }, accounts);
      }
      // A Clear account's own balance is already the business's: nothing moves.
      if (input.kind === "clear_account") return { providerRef: `clear_account:${input.depositId}`, status: "arrived", expectedAt: null };
      const accountId = await accountFor(owner, accounts);
      const pull = await clear.pullFromBank({ accountId, bankRef: input.sourceRef!, amountMicros: input.amountMicros, idempotencyKey: `deposit:${input.depositId}`, memo: "Opencast balance" });
      return { providerRef: pull.transferId, status: "pending", expectedAt: pull.expectedAt };
    },

    async cancelDeposit(providerRef) {
      if (providerRef.startsWith("pi_")) return stripe?.cancel(providerRef);
      if (!providerRef.startsWith("clear_account:")) await clear.cancelPull(providerRef);
    },

    async startPayout(input, accounts) {
      const accountId = await accountFor(input.from, accounts);
      // To an owner's linked Clear wallet: USDC on chain, no bank.
      const wallet = destinationWallet(input.destinationRef);
      if (wallet) {
        const sent = await clear.sendToWallet({ accountId, address: wallet, amountMicros: input.amountMicros, idempotencyKey: `payout:${input.payoutId}`, memo: "Opencast" });
        return { providerRef: sent.transferId };
      }
      const out = await clear.payout({ accountId, bankRef: input.destinationRef, amountMicros: input.amountMicros, idempotencyKey: `payout:${input.payoutId}`, memo: "Opencast" });
      return { providerRef: out.payoutId };
    },

    clearWallet: {
      async depositAddress(owner, accounts) {
        return clear.accountAddress(await accountFor(owner, accounts));
      },
      async verifyTransfer({ txHash, from, to, amountMicros }) {
        // Without the chain configured the transfer can't be checked yet: the deposit waits.
        if (!options.usdc) return { status: "pending" };
        return options.usdc.check({ txHash: txHash as Hex, from, to, minUnits: BigInt(amountMicros) });
      }
    },

    async startPledge(input) {
      if (!stripe) return fallbackCard.startPledge(input);
      return stripe.pledge(input);
    },

    async endPledge(ref) {
      await stripe?.endSubscription(ref);
    },

    async resumePledge(ref) {
      if (!stripe) return fallbackCard.resumePledge(ref);
      await stripe.resumeSubscription(ref);
    },

    async pledgeCardSession(input) {
      if (!stripe) return fallbackCard.pledgeCardSession(input);
      return stripe.cardSession(input);
    },

    // Pay-as-you-go: stations' cards through Stripe (faked without a key, like pledges).
    stationCards: stripe ? stripe.stationCards() : fallbackCard.stationCards,

    custody: ownAccountsCustody,

    async applyMove(move: ProviderMove, accounts) {
      // The chain moved it (the weekly escrow deposit from the settlement wallet, a claim paid).
      if (onChain(move.fromWallet) || onChain(move.toWallet)) return { providerRef: "on-chain" };
      const from = await accountForWallet(move.fromWallet, accounts);
      if (move.kind === "encumber") {
        const done = await clear.encumber({ accountId: from, amountMicros: move.amountMicros, reference: `hold:${move.holdId}`, idempotencyKey: move.idempotencyKey });
        return { providerRef: done.encumbranceId };
      }
      if (move.kind === "release") {
        await clear.releaseEncumbrance({ accountId: from, reference: `hold:${move.holdId}`, amountMicros: move.amountMicros, idempotencyKey: move.idempotencyKey });
        return { providerRef: `hold:${move.holdId}` };
      }
      const to = await accountForWallet(move.toWallet!, accounts);
      const done = await clear.transfer({ fromAccountId: from, toAccountId: to, amountMicros: move.amountMicros, idempotencyKey: move.idempotencyKey, memo: "Opencast" });
      return { providerRef: done.transferId };
    },

    async payoutAccount(owner, accounts) {
      await accountFor(owner, accounts);
      const known = await accounts.get(owner, "clear");
      return known?.status === "active" ? { status: "active", url: null } : { status: "needs_onboarding", url: known?.onboardingUrl ?? null };
    },

    async webhook(provider, rawBody, headers) {
      if (provider === "stripe") return stripe ? stripe.parse(rawBody, headers["stripe-signature"]) : null;
      return clear.parseWebhook(rawBody, headers);
    }
  };
}

/**
 * Clear, in memory: accounts, balances, encumbrances, transfers. Every call is idempotent by its
 * key, as the real one must be. Bank pulls arrive when a test posts the webhook.
 */
export function fakeClear(): ClearClient & { balances: Map<string, number>; encumbered: Map<string, number>; calls: string[] } {
  const balances = new Map<string, number>();
  const encumbered = new Map<string, number>();
  const seen = new Map<string, unknown>();
  const pulls = new Map<string, { accountId: string; amountMicros: number }>();
  const calls: string[] = [];
  const once = async <T>(key: string, run: () => T): Promise<T> => {
    if (seen.has(key)) return seen.get(key) as T;
    const result = run();
    seen.set(key, result);
    return result;
  };
  const add = (id: string, micros: number) => balances.set(id, (balances.get(id) ?? 0) + micros);
  return {
    balances,
    encumbered,
    calls,
    openAccount: ({ idempotencyKey }) => once(idempotencyKey, () => ({ accountId: `clr_${randomUUID().slice(0, 8)}`, status: "active" as const, verificationUrl: null })),
    async linkBank({ plaidPublicToken }) {
      return { bankRef: `bank_${plaidPublicToken.slice(-4)}`, label: `Bank ending ${plaidPublicToken.replace(/\D/g, "").slice(-4) || "0000"}` };
    },
    pullFromBank: ({ accountId, amountMicros, idempotencyKey }) =>
      once(idempotencyKey, () => {
        const transferId = `pull_${randomUUID().slice(0, 8)}`;
        pulls.set(transferId, { accountId, amountMicros });
        calls.push(`pull ${amountMicros}`);
        return { transferId, expectedAt: null };
      }),
    async cancelPull(transferId) {
      pulls.delete(transferId);
    },
    encumber: ({ accountId, amountMicros, reference, idempotencyKey }) =>
      once(idempotencyKey, () => {
        const available = (balances.get(accountId) ?? 0) - (encumbered.get(accountId) ?? 0);
        if (available < amountMicros) throw new Error("Clear: not enough unencumbered balance");
        encumbered.set(accountId, (encumbered.get(accountId) ?? 0) + amountMicros);
        calls.push(`encumber ${amountMicros}`);
        return { encumbranceId: `${reference}:${idempotencyKey}` };
      }),
    releaseEncumbrance: ({ accountId, amountMicros, idempotencyKey }) =>
      once(idempotencyKey, () => {
        encumbered.set(accountId, (encumbered.get(accountId) ?? 0) - amountMicros);
        calls.push(`release ${amountMicros}`);
      }),
    transfer: ({ fromAccountId, toAccountId, amountMicros, idempotencyKey }) =>
      once(idempotencyKey, () => {
        add(fromAccountId, -amountMicros);
        add(toAccountId, amountMicros);
        calls.push(`transfer ${amountMicros}`);
        return { transferId: `xfer_${randomUUID().slice(0, 8)}` };
      }),
    payout: ({ accountId, amountMicros, idempotencyKey }) =>
      once(idempotencyKey, () => {
        add(accountId, -amountMicros);
        calls.push(`payout ${amountMicros}`);
        return { payoutId: `po_${randomUUID().slice(0, 8)}` };
      }),
    async accountAddress(accountId) {
      return fakeAddress(accountId);
    },
    sendToWallet: ({ accountId, amountMicros, idempotencyKey }) =>
      once(idempotencyKey, () => {
        add(accountId, -amountMicros);
        calls.push(`send to wallet ${amountMicros}`);
        return { transferId: `wallet_${randomUUID().slice(0, 8)}` };
      }),
    async parseWebhook(rawBody) {
      const event = JSON.parse(rawBody.toString("utf8")) as PaymentEvent & { transferId?: string };
      if (event.kind === "deposit_arrived" && event.transferId && pulls.has(event.transferId)) {
        const pull = pulls.get(event.transferId)!;
        add(pull.accountId, pull.amountMicros);
        pulls.delete(event.transferId);
      }
      return event;
    }
  };
}

/** A stable, made-up address for a fake account (never a real wallet). */
export const fakeAddress = (seed: string) => getAddress(`0x${createHash("sha256").update(`opencast-fake:${seed}`).digest("hex").slice(0, 40)}`);
