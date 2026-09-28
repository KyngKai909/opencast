// The one interface the ledger uses to move money in and out. Clear (bank, USDC)
// and Stripe (cards, pledges) implement it in Phase 6; until then a local fake
// stands in. Spots, catalog and playout never call a provider directly.

export type FundingKind = "clear_bank" | "card" | "clear_account";

export interface DepositStarted {
  providerRef: string;
  status: "pending" | "arrived";
  expectedAt: Date | null;
}

export interface Payments {
  /** The fee the business pays on top, in dollars before paying. Only cards have one (Stripe's, at cost). */
  depositFeeMicros(kind: FundingKind, amountMicros: number): number;
  arrives(kind: FundingKind): string;
  linkFundingSource(input: { businessId: string; kind: FundingKind; token: string }): Promise<{ providerRef: string; label: string }>;
  startDeposit(input: { businessId: string; kind: FundingKind; sourceRef: string | null; amountMicros: number; feeMicros: number }): Promise<DepositStarted>;
  cancelDeposit(providerRef: string): Promise<void>;
  startPayout(input: { destinationRef: string | null; amountMicros: number }): Promise<{ providerRef: string }>;
  /** A viewer's pledge by card. Returns a checkout URL when the provider needs one. */
  startPledge(input: { pledgeId: string; amountMicros: number; cadence: "monthly" | "once" }): Promise<{ providerRef: string; checkoutUrl: string | null; paidNow: boolean; feeMicros: number }>;
}

/** Stripe's US card fee: 2.9% + 30¢ ($7.55 on $250). */
export const stripeCardFeeMicros = (amountMicros: number) => Math.round(amountMicros * 0.029) + 300_000;

export function fakePayments(clock: { now(): Date }): Payments {
  let n = 0;
  const ref = (prefix: string) => `${prefix}_fake_${++n}`;
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
    depositFeeMicros: (kind, amount) => (kind === "card" ? stripeCardFeeMicros(amount) : 0),
    arrives: (kind) => (kind === "clear_bank" ? "1 to 2 business days" : kind === "card" ? "Arrives right away" : "Instant"),
    async linkFundingSource({ kind, token }) {
      const last4 = token.replace(/\D/g, "").slice(-4) || "0000";
      const label = kind === "card" ? `Visa ending ${last4}` : kind === "clear_bank" ? `Bank ending ${last4}` : "Clear business account";
      return { providerRef: ref(kind), label };
    },
    async startDeposit({ kind }) {
      return kind === "clear_bank"
        ? { providerRef: ref("dep"), status: "pending", expectedAt: addBusinessDays(clock.now(), 2) }
        : { providerRef: ref("dep"), status: "arrived", expectedAt: null };
    },
    async cancelDeposit() {},
    async startPayout() {
      return { providerRef: ref("po") };
    },
    async startPledge({ amountMicros }) {
      return { providerRef: ref("pl"), checkoutUrl: null, paidNow: true, feeMicros: stripeCardFeeMicros(amountMicros) };
    }
  };
}
