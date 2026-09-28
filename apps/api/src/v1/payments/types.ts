// The one interface the ledger uses to move money in and out. Spots, catalog and playout never
// call a provider: they ask the ledger, which posts balanced entries and, through the outbox,
// tells the provider what to do.
//
// Three adapters implement it:
// - clear: Clear holds every station's and advertiser's money (a Clear business account each,
//   USDC in a Privy organization wallet); a hold is an encumbrance on the advertiser's balance.
//   Stripe is the card on-ramp (advertisers' card top-ups, viewers' pledges).
// - stripe_only: for anyone running Opencast without Clear. Advertisers' money sits in the
//   platform's Stripe balance; stations are paid through Stripe Connect Express.
// - fake: local development and tests. Moves nothing; keeps a mirror of every wallet.

export type FundingKind = "clear_bank" | "card" | "clear_account";

/** Where money physically sits: "advertiser:<id>", "station:<id>", "opencast:settlement", "opencast:treasury", "platform". */
export type Wallet = string;

export interface LedgerAccount {
  kind: string;
  advertiserId: string | null;
  stationId: string | null;
  userId: string | null;
  label: string | null;
}

export interface ProviderMove {
  id: string;
  kind: "encumber" | "release" | "transfer";
  fromWallet: Wallet;
  toWallet: Wallet | null;
  holdId: string | null;
  amountMicros: number;
  /** Stable across retries: the provider does it once. */
  idempotencyKey: string;
}

export interface DepositStarted {
  providerRef: string;
  status: "pending" | "arrived";
  expectedAt: Date | null;
  /** Card payments that need the business to confirm (3-D Secure) in the app. */
  clientSecret?: string | null;
}

/** The provider accounts Opencast has opened, read and written by the ledger. */
export interface AccountDirectory {
  get(owner: Owner, provider: ProviderAccountKind): Promise<{ ref: string; status: "active" | "needs_onboarding" | "closed"; onboardingUrl: string | null } | null>;
  save(owner: Owner, provider: ProviderAccountKind, account: { ref: string; status: "active" | "needs_onboarding"; onboardingUrl?: string | null }): Promise<void>;
}

export type ProviderAccountKind = "clear" | "stripe_customer" | "stripe_connect" | "fake";

export type Owner = { type: "advertiser" | "station"; id: string; name?: string } | { type: "opencast"; label: "settlement" | "treasury" };

/** What a provider tells us happened (from a webhook). */
export type PaymentEvent =
  | { kind: "deposit_arrived"; depositId: string }
  | { kind: "deposit_failed"; depositId: string; reason: string }
  | { kind: "pledge_paid"; pledgeId: string; amountMicros: number; feeMicros: number; providerRef: string }
  | { kind: "pledge_ended"; pledgeId: string }
  | { kind: "payout_confirmed" | "payout_failed"; payoutRef: string }
  | { kind: "account_ready"; owner: Owner };

export interface Payments {
  readonly name: "fake" | "clear" | "stripe_only";

  /** The fee the business pays on top, in dollars before paying. Only cards have one (Stripe's, at cost). */
  depositFeeMicros(kind: FundingKind, amountMicros: number): number;
  arrives(kind: FundingKind): string;
  linkFundingSource(input: { businessId: string; businessName: string; kind: FundingKind; token: string }, accounts: AccountDirectory): Promise<{ providerRef: string; label: string }>;
  startDeposit(input: { depositId: string; businessId: string; kind: FundingKind; sourceRef: string | null; amountMicros: number; feeMicros: number }, accounts: AccountDirectory): Promise<DepositStarted>;
  cancelDeposit(providerRef: string): Promise<void>;
  /** Money out to a bank: an advertiser's withdrawal, or a station's payout. */
  startPayout(input: { payoutId: string; from: Owner; destinationRef: string | null; amountMicros: number }, accounts: AccountDirectory): Promise<{ providerRef: string }>;
  /** A viewer's pledge by card. Returns a checkout URL when the provider needs one. */
  startPledge(input: { pledgeId: string; stationId: string; stationName: string; amountMicros: number; cadence: "monthly" | "once"; returnUrl: string }): Promise<{
    providerRef: string;
    checkoutUrl: string | null;
    paidNow: boolean;
    feeMicros: number;
  }>;
  /** Stops a monthly pledge at the provider (the current month stays paid). */
  endPledge(providerRef: string): Promise<void>;

  /** Which wallet a ledger account's money sits in; null when the provider or the chain moves it itself. */
  custody(account: LedgerAccount, holdAdvertiserId: string | null): Wallet | null;
  /** Carries out one outbox move. Idempotent by `move.idempotencyKey`. */
  applyMove(move: ProviderMove, accounts: AccountDirectory): Promise<{ providerRef: string }>;
  /** The account a station (or business) is paid into: opened if needed, with a link if the owner must finish it. */
  payoutAccount(owner: Owner & { type: "station" | "advertiser" }, accounts: AccountDirectory): Promise<{ status: "active" | "needs_onboarding"; url: string | null }>;
  /** Reads a provider's webhook. Null when it's not something the ledger acts on. Throws when the signature is wrong. */
  webhook(provider: "stripe" | "clear", rawBody: Buffer, headers: Record<string, string | undefined>): Promise<PaymentEvent | null>;
}

/** Stripe's US card fee: 2.9% + 30¢ ($7.55 on $250). */
export const stripeCardFeeMicros = (amountMicros: number) => Math.round(amountMicros * 0.029) + 300_000;

/** Whole cents, for providers that count in cents. */
export const toCents = (micros: number) => Math.round(micros / 10_000);
export const fromCents = (cents: number) => cents * 10_000;

export const ownerWallet = (owner: Owner): Wallet => (owner.type === "opencast" ? `opencast:${owner.label}` : `${owner.type}:${owner.id}`);

export function walletOwner(wallet: Wallet): Owner | null {
  const [type, id] = wallet.split(":");
  if (type === "advertiser" || type === "station") return { type, id };
  if (type === "opencast" && (id === "settlement" || id === "treasury")) return { type, label: id };
  return null;
}

/**
 * The usual custody when each business and station has its own account at the provider (Clear,
 * and the fake): available and held money in the advertiser's own; earnings in the station's;
 * a claimable station's earnings with Opencast's settlement wallet until the weekly escrow
 * deposit; Opencast's share, the pool, absorbed gaps and card money in Opencast's treasury.
 * Banks, card networks and the chain move money themselves: no custody.
 */
export function ownAccountsCustody(account: LedgerAccount, holdAdvertiserId: string | null): Wallet | null {
  switch (account.kind) {
    case "advertiser_available":
      return `advertiser:${account.advertiserId}`;
    case "holds":
      return holdAdvertiserId ? `advertiser:${holdAdvertiserId}` : null;
    case "station_earnings":
      return `station:${account.stationId}`;
    case "escrow_owed":
      return "opencast:settlement";
    case "opencast_share":
    case "pool":
    case "opencast_absorbed":
    case "card_fees":
      return "opencast:treasury";
    case "external":
      // Card money lands in Opencast's Stripe balance and is credited on from the treasury.
      return account.label === "stripe" ? "opencast:treasury" : null;
    default:
      // escrow, creator, creator_fund: on-chain, moved by the chain job.
      return null;
  }
}
