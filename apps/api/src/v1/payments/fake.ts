// The local stand-in for every provider: bank deposits arrive when told (or after two business
// days), cards at once, payouts instantly. It moves no money, but it keeps a mirror of every
// wallet and encumbrance as the outbox tells it, so tests can check the provider side always
// matches the ledger.

import { fakeAddress } from "./clear.js";
import { ownAccountsCustody, stripeCardFeeMicros, type Payments, type ProviderMove } from "./types.js";

export interface FakeMirror {
  /** Money in each wallet, encumbered or not. */
  wallets: Map<string, number>;
  /** Encumbered, per hold. */
  encumbered: Map<string, number>;
  applied: Set<string>;
}

export function fakePayments(clock: { now(): Date }): Payments & { mirror: FakeMirror } {
  let n = 0;
  const ref = (prefix: string) => `${prefix}_fake_${++n}`;
  const mirror: FakeMirror = { wallets: new Map(), encumbered: new Map(), applied: new Set() };
  const pending = new Map<string, { wallet: string; amountMicros: number }>();
  const add = (wallet: string, micros: number) => mirror.wallets.set(wallet, (mirror.wallets.get(wallet) ?? 0) + micros);
  const addBusinessDays = (from: Date, days: number) => {
    const at = new Date(from);
    let added = 0;
    while (added < days) {
      at.setUTCDate(at.getUTCDate() + 1);
      if (at.getUTCDay() !== 0 && at.getUTCDay() !== 6) added++;
    }
    return at;
  };
  return {
    name: "fake",
    mirror,
    depositFeeMicros: (kind, amount) => (kind === "card" ? stripeCardFeeMicros(amount) : 0),
    arrives: (kind) => (kind === "clear_bank" ? "1 to 2 business days" : kind === "card" ? "Arrives right away" : "Instant"),
    async linkFundingSource({ kind, token }) {
      const last4 = token.replace(/\D/g, "").slice(-4) || "0000";
      const label = kind === "card" ? `Visa ending ${last4}` : kind === "clear_bank" ? `Bank ending ${last4}` : "Clear business account";
      return { providerRef: ref(kind), label };
    },
    async startDeposit({ depositId, businessId, kind, amountMicros }) {
      // Bank and Clear money lands straight in the business's own account (a bank transfer when
      // it arrives); card money is credited on from the treasury by the outbox.
      if (kind === "clear_account") add(`advertiser:${businessId}`, amountMicros);
      if (kind === "clear_bank") pending.set(depositId, { wallet: `advertiser:${businessId}`, amountMicros });
      return kind === "clear_bank"
        ? { providerRef: ref("dep"), status: "pending", expectedAt: addBusinessDays(clock.now(), 2) }
        : { providerRef: ref("dep"), status: "arrived", expectedAt: null };
    },
    async cancelDeposit() {},
    async startPayout({ from, amountMicros }) {
      add(from.type === "opencast" ? `opencast:${from.label}` : `${from.type}:${from.id}`, -amountMicros);
      return { providerRef: ref("po") };
    },
    async startPledge({ amountMicros }) {
      return { providerRef: ref("pl"), checkoutUrl: null, paidNow: true, feeMicros: stripeCardFeeMicros(amountMicros) };
    },
    async endPledge() {},

    custody: ownAccountsCustody,

    async applyMove(move: ProviderMove) {
      if (mirror.applied.has(move.idempotencyKey)) return { providerRef: move.idempotencyKey };
      mirror.applied.add(move.idempotencyKey);
      if (move.kind === "encumber") mirror.encumbered.set(move.holdId!, (mirror.encumbered.get(move.holdId!) ?? 0) + move.amountMicros);
      if (move.kind === "release") mirror.encumbered.set(move.holdId!, (mirror.encumbered.get(move.holdId!) ?? 0) - move.amountMicros);
      if (move.kind === "transfer") {
        add(move.fromWallet, -move.amountMicros);
        add(move.toWallet!, move.amountMicros);
      }
      return { providerRef: `fake_${move.idempotencyKey}` };
    },

    async payoutAccount() {
      return { status: "active", url: null };
    },

    // A transfer from a linked Clear wallet is taken as sent (nothing is on chain here), once per transaction.
    clearWallet: {
      async depositAddress(owner) {
        return fakeAddress(`advertiser:${owner.id}`);
      },
      async verifyTransfer({ businessId, txHash, amountMicros }) {
        if (!mirror.applied.has(`clear-transfer:${txHash}`)) {
          mirror.applied.add(`clear-transfer:${txHash}`);
          add(`advertiser:${businessId}`, amountMicros);
        }
        return { status: "confirmed" };
      }
    },

    async webhook(_provider, rawBody) {
      // Tests post the event itself.
      const event = JSON.parse(rawBody.toString("utf8"));
      if (event.kind === "deposit_arrived" && pending.has(event.depositId)) {
        const p = pending.get(event.depositId)!;
        add(p.wallet, p.amountMicros);
        pending.delete(event.depositId);
      }
      return event;
    }
  };
}
