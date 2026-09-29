// The one interface the ledger uses to move money in and out. Spots, catalog and playout never
// call a provider: they ask the ledger, which posts balanced entries and, through the outbox,
// tells the provider what to do.
//
// Three adapters implement it:
// - clear: Clear holds every station's and advertiser's money (a Clear business account each,
//   holding USDC, in Clear's own systems and Privy app, reached through Clear's API); a hold is
//   an encumbrance on the advertiser's balance. Stripe is the card on-ramp (advertisers' card
//   top-ups, viewers' pledges).
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

/** Whether a transfer happened as asked. Pending until it's mined, or while the chain can't be read. */
export type TransferCheck = { status: "confirmed" } | { status: "pending" } | { status: "failed"; reason: string };

/**
 * Money to and from a person's linked Clear wallet (a Privy global wallet: Clear's Privy app is
 * the provider, Opencast's the requester). Clear and the fake have it; Stripe-only doesn't.
 */
export interface ClearWalletRail {
  /** The business's balance account on chain: where a transfer from a Clear wallet is sent. */
  depositAddress(owner: Owner & { type: "advertiser" }, accounts: AccountDirectory): Promise<string>;
  /** Checks a transfer: from the linked wallet, to the business's account, at least the amount (USDC, 6 decimals). */
  verifyTransfer(input: { businessId: string; txHash: string; from: string; to: string; amountMicros: number }): Promise<TransferCheck>;
}

/** A payout's destination when it's a linked Clear wallet rather than a bank: `wallet:<address>`. */
export const walletDestination = (address: string) => `wallet:${address}`;
export const destinationWallet = (ref: string | null) => (ref?.startsWith("wallet:") ? ref.slice("wallet:".length) : null);

/** The card a pledge is charged to (E1): "Visa ending 4242", usable until `expiresOn` (YYYY-MM-DD). */
export interface PledgeCard {
  label: string;
  expiresOn: string | null;
}

/** "Visa ending 4242", good to the last day of its expiry month. */
export function cardFrom(card: { brand: string; last4: string; exp_month?: number | null; exp_year?: number | null }): PledgeCard {
  const brand = card.brand === "amex" ? "American Express" : card.brand.charAt(0).toUpperCase() + card.brand.slice(1);
  const expiresOn = card.exp_month && card.exp_year ? new Date(Date.UTC(card.exp_year, card.exp_month, 0)).toISOString().slice(0, 10) : null;
  return { label: `${brand} ending ${card.last4}`, expiresOn };
}

/** What a provider tells us happened (from a webhook). */
export type PaymentEvent =
  | { kind: "deposit_arrived"; depositId: string }
  | { kind: "deposit_failed"; depositId: string; reason: string }
  | { kind: "pledge_paid"; pledgeId: string; amountMicros: number; feeMicros: number; providerRef: string; card?: PledgeCard | null }
  /** A monthly pledge's subscription started: from now on it's known by `providerRef` (Stripe's `sub_…`). */
  | { kind: "pledge_started"; pledgeId: string; providerRef: string; card: PledgeCard | null }
  /** The card on a pledge changed (E1). */
  | { kind: "pledge_card"; pledgeId: string; card: PledgeCard }
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
  /** Money out to a bank (or, with `wallet:<address>`, a linked Clear wallet): an advertiser's withdrawal, or a station's payout. */
  startPayout(input: { payoutId: string; from: Owner; destinationRef: string | null; amountMicros: number }, accounts: AccountDirectory): Promise<{ providerRef: string }>;
  /** A viewer's pledge by card. Returns a checkout URL when the provider needs one. */
  startPledge(input: { pledgeId: string; stationId: string; stationName: string; amountMicros: number; cadence: "monthly" | "once"; returnUrl: string }): Promise<{
    providerRef: string;
    checkoutUrl: string | null;
    paidNow: boolean;
    feeMicros: number;
    /** The card, when it's known at once (the fake). Otherwise it comes with the provider's event. */
    card?: PledgeCard | null;
  }>;
  /** Stops a monthly pledge at the provider (the current month stays paid). */
  endPledge(providerRef: string): Promise<void>;
  /** Undoes endPledge before the month is out: it carries on monthly. */
  resumePledge(providerRef: string): Promise<void>;
  /**
   * E1: a page (the provider's) to change the card on a monthly pledge, which returns to
   * `returnUrl`. The provider reports the new card by webhook (`pledge_card`); the fake changes it
   * at once and returns it.
   */
  pledgeCardSession(input: { pledgeId: string; providerRef: string; returnUrl: string }): Promise<{ url: string; card?: PledgeCard | null }>;

  /** Which wallet a ledger account's money sits in; null when the provider or the chain moves it itself. */
  custody(account: LedgerAccount, holdAdvertiserId: string | null): Wallet | null;
  /** Carries out one outbox move. Idempotent by `move.idempotencyKey`. */
  applyMove(move: ProviderMove, accounts: AccountDirectory): Promise<{ providerRef: string }>;
  /** The account a station (or business) is paid into: opened if needed, with a link if the owner must finish it. */
  payoutAccount(owner: Owner & { type: "station" | "advertiser" }, accounts: AccountDirectory): Promise<{ status: "active" | "needs_onboarding"; url: string | null }>;
  /** Funding from and payouts to linked Clear wallets; absent when the provider can't (Stripe-only). */
  readonly clearWallet?: ClearWalletRail;
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
      return chainCustody(account);
  }
}

/**
 * On-chain wallets: the escrow contract, the creators it has paid, the creator fund. Moves to or
 * from them are recorded like any other, but the chain moved the money: providers skip them.
 */
export function chainCustody(account: LedgerAccount): Wallet | null {
  if (account.kind === "escrow") return "chain:escrow";
  if (account.kind === "creator") return `chain:creator:${account.userId}`;
  if (account.kind === "creator_fund") return "chain:fund";
  return null;
}

export const onChain = (wallet: Wallet | null) => Boolean(wallet?.startsWith("chain:"));
