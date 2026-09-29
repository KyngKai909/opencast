// Double-entry money. Every movement is a balanced entry; nothing is edited, a
// reversal is a new entry. The database refuses unbalanced entries, a negative
// advertiser balance or hold, and escrow paid anywhere but the creator or the fund.
//
// Advertisers prepay. Money is held when a spot is placed and settled when it airs:
// the station gets the real cost; the rest of the hold goes back. A station is
// never left airing something unpaid: if a business can't cover a per-thousand
// airing's real cost, Opencast absorbs the gap and records it.

import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { Executor, ModuleContext } from "../../context.js";
import { badRequest, conflict, HttpError, notFound, refused } from "../../errors.js";
import { stripeCardFeeMicros, walletDestination, type FundingKind, type Owner, type PaymentEvent } from "../../payments/index.js";
import { accountDirectory, recordMoves, sendMoves } from "./moves.js";
import { createBusinessMoney, type BusinessMoney } from "./business.js";

type AccountKind = (typeof schema.accountKind.enumValues)[number];
type EntryKind = (typeof schema.entryKind.enumValues)[number];

export interface Line {
  account: string;
  micros: number;
  holdId?: string;
}

export interface Source {
  sourceType?: string;
  sourceId?: string;
  memo?: string;
  idempotencyKey?: string;
}

export interface BalanceView {
  availableMicros: number;
  heldMicros: number;
  heldAirings: number;
  spentThisMonthMicros: number;
  spentThisMonthAirings: number;
  pacePerDayMicros: number;
  runwayDays: number | null;
  pendingDeposits: Array<{ id: string; amountMicros: number; expectedAt: string | null; method: string }>;
  fundingSources: Array<{ id: string; kind: FundingKind; label: string; isDefault: boolean }>;
}

export interface RevenueConfig {
  opencastSpotShareBps: number;
  opencastPledgeShareBps: number;
  opencastProductionShareBps: number;
  poolShareBps: number;
  /** How the pool is shared out each month: an equal base share, a share by watch time, and the creator fund. */
  poolBaseBps: number;
  poolWatchTimeBps: number;
  poolFundBps: number;
  payoutSchedule: "weekly" | "monthly";
  unclaimedPeriodDays: number;
}

export interface LedgerService extends BusinessMoney {
  account(db: Executor, kind: AccountKind, owner?: { advertiserId?: string; stationId?: string; userId?: string; label?: string }): Promise<string>;
  post(db: Executor, kind: EntryKind, lines: Line[], source?: Source): Promise<string | null>;
  config(at?: Date): Promise<RevenueConfig>;

  /** Moves money from available into a hold. Fails (and changes nothing) if available doesn't cover it. */
  hold(db: Executor, input: { businessId: string; purpose: "airing" | "sponsorship_month" | "production_order"; amountMicros: number; spotId?: string; stationId?: string; sponsorshipId?: string; productionOrderId?: string; isEstimate?: boolean; memo?: string }): Promise<string>;
  openAmount(holdIds: string[]): Promise<Map<string, number>>;
  /** Returns what's left of a hold (or part of it) to available. */
  release(db: Executor, holdId: string, micros?: number, source?: Source): Promise<number>;
  /** What's still held on each hold (0 once settled or released). */
  openHolds(holdIds: string[]): Promise<Map<string, number>>;
  /**
   * Pays a station for something that aired or was delivered: the real cost from the hold
   * (topped up from available, then absorbed by Opencast), less Opencast's share and the
   * pool; the rest of the hold goes back. A barter split sends part to the producer.
   */
  settle(db: Executor, input: { holdId: string; stationId: string; costMicros: number; kind: "airing" | "sponsorship" | "production"; source: Source; barter?: { producerStationId: string; producerShare: number; agreementId: string } }): Promise<{ paidMicros: number; absorbedMicros: number; returnedMicros: number }>;
  chargeCarriageFee(db: Executor, input: { agreementId: string; carrierStationId: string; makerStationId: string; micros: number; source: Source }): Promise<void>;
  carriagePaid(agreementIds: string[], from: Date, to: Date): Promise<Map<string, number>>;

  balance(businessId: string): Promise<BalanceView>;
  runwayDays(businessIds: string[]): Promise<Map<string, number | null>>;
  movements(businessId: string, filter: { filter: "all" | "money" | "airings"; before?: string; limit: number }): Promise<MovementView[]>;
  /** `clear_account` with token "linked" adds the caller's linked Clear wallet (withdrawals can go to it). */
  addFundingSource(businessId: string, input: { kind: FundingKind; token: string; makeDefault: boolean }, byUserId?: string): Promise<BalanceView["fundingSources"]>;
  quoteDeposit(
    businessId: string,
    input: { amountMicros: number; method: FundingKind }
  ): Promise<{ amountMicros: number; feeMicros: number; arrives: string; roughAirings: number | null; basis: { rateKind: "per_thousand" | "per_airing"; rateMicros: number; station: import("@opencast/contracts").StationIdent | null } | null }>;
  addMoney(businessId: string, input: { amountMicros: number; fundingSourceId: string }): Promise<{ depositId: string; status: "pending" | "arrived"; balance: BalanceView }>;
  /** Funding from the caller's linked Clear wallet (full access): where to send it. 409 when the link is read-only or missing. */
  quoteClearTransfer(businessId: string, userId: string, amountMicros: number): Promise<ClearTransferQuote>;
  /** The transfer from Clear was sent: checked on chain, then credited like any deposit. Idempotent on the transaction. */
  confirmClearTransfer(businessId: string, userId: string, input: { amountMicros: number; txHash: string }): Promise<{ depositId: string; status: "pending" | "arrived"; balance: BalanceView }>;
  /** Checks pending transfers from Clear wallets again (the jobs tick). */
  recheckClearTransfers(): Promise<{ arrived: number; failed: number }>;
  /** A pending deposit has arrived (the provider's webhook, or the fake). */
  completeDeposit(depositId: string): Promise<void>;
  cancelDeposit(businessId: string, depositId: string): Promise<BalanceView>;
  withdraw(businessId: string, input: { amountMicros: number; fundingSourceId: string }): Promise<{ payoutId: string; balance: BalanceView }>;
  statements(accountOwner: { businessId?: string; stationId?: string }): Promise<StatementView[]>;
  stationEarnings(stationId: string, period: "week" | "month" | "year"): Promise<StationEarningsView>;
  moveToBank(stationId: string, micros: number): Promise<{ payoutId: string; scheduledFor: string }>;
  pledge(userId: string, stationId: string, input: { cadence: "monthly" | "once"; amountMicros: number; creditOnAir: boolean }): Promise<{ pledge: PledgeView; checkoutUrl: string | null }>;
  pledges(userId: string): Promise<PledgeView[]>;
  updatePledge(userId: string, pledgeId: string, input: { amountMicros?: number; creditOnAir?: boolean; stop?: true; cadence?: "monthly" | "once" }): Promise<PledgeView>;
  /** E1: a page to change the card on a monthly pledge. */
  pledgeCardSession(userId: string, pledgeId: string, returnTo?: string): Promise<{ url: string }>;
  /** A3: every pledge of the person's stops after this month. */
  stopPledgesOf(userId: string): Promise<void>;
  /** Pledges for on-air member credits. */
  memberCredits(stationId: string): Promise<{ members: number; named: string[] }>;
  /** A claimable station's money: owed to escrow (settled, not yet deposited) and in escrow. */
  escrowBalances(stationIds: string[]): Promise<Map<string, { owed: number; held: number }>>;
  /** Anything that ever moved from a claimable station's escrow to an Opencast account. Always 0. */
  everMovedToOpencast(): Promise<number>;
  /** What each as-run airing cost the business (the station's pay, Opencast's share and the pool together). */
  costsOfAsRun(asRunIds: string[]): Promise<Map<string, number>>;
  /** A spot's budget used: held plus paid (held money counts against the budget), in total and since `dayStart`. */
  spotSpend(spotIds: string[], dayStart: Date): Promise<Map<string, { used: number; usedToday: number }>>;
  /** Warns a business at 3 days and 1 day of spend left, and pauses spots it can't cover. */
  checkRunway(businessId: string): Promise<void>;
  /** Something a provider reported (a deposit arrived, a pledge was paid, a payout failed). */
  handlePaymentEvent(event: PaymentEvent): Promise<void>;
  /** Where a station is paid: its Clear account (or Stripe Connect), or the owner's linked Clear wallet, with a link if it must finish setting it up. */
  payoutAccount(stationId: string): Promise<PayoutAccountView>;
  /** Pays the station to the owner's linked Clear wallet (read-only access is enough), or back to its own account. */
  setPayoutDestination(stationId: string, userId: string, kind: "clear_account" | "clear_wallet"): Promise<PayoutAccountView>;
  /** Sends the outbox's pending moves to the provider. */
  sendMoves(): Promise<{ sent: number; failed: number }>;
  /**
   * The weekly deposit: every claimable station's owed earnings go into the escrow contract in one
   * batch, and once it confirms they're held there. Null when the chain isn't set up.
   */
  escrowWeekly(): Promise<{ stations: number; micros: number; txHash: string } | null>;
  /** Reads the escrow contract's events since last time: claims paid, releases to the fund, claims approved or cancelled. */
  syncChain(): Promise<{ events: number } | null>;
  /** Pays every station its earnings (the schedule's day: weekly by default). Stations still setting up payouts wait. */
  runPayouts(): Promise<{ paid: number; micros: number; waiting: number }>;
  /** Shares out the pool for a month: equal base, by watch time, and to the creator fund. All 0 until decided. */
  distributePool(monthStart: Date): Promise<{ micros: number; stations: number; fundMicros: number }>;
  /** Statements for a period: weekly for stations, monthly for businesses. */
  issueStatements(period: "week" | "month", start: Date): Promise<number>;
  /** A statement's ledger entries as CSV. */
  statementCsv(statementId: string): Promise<{ owner: { businessId: string | null; stationId: string | null }; filename: string; csv: string }>;
  /** Monthly pledges on the fake provider (Stripe charges real ones itself). */
  renewPledges(): Promise<number>;
  /** What the ledger says each provider wallet holds (the provider's balances should match). */
  custodyBalances(): Promise<Map<string, number>>;
}

export interface ClearTransferQuote {
  to: string;
  token: { address: string; symbol: "USDC"; decimals: 6 };
  chainId: number;
  amountUnits: string;
  from: string;
}

export interface PayoutAccountView {
  status: "active" | "needs_onboarding";
  url: string | null;
  destination: { kind: "clear_account" | "clear_wallet" | "stripe_connect"; label: string; address: string | null };
}

export interface MovementView {
  id: string;
  at: string;
  kind: "aired" | "held" | "returned" | "added" | "withdrawn" | "fee" | "order" | "sponsorship" | "refund";
  label: string;
  amountMicros: number;
  detail: string | null;
}

export interface StatementView {
  id: string;
  period: "week" | "month";
  periodStart: string;
  periodEnd: string;
  openingMicros: number;
  closingMicros: number;
  lines: Array<{
    label: string;
    detail: string | null;
    amountMicros: number;
    notSetYet: boolean;
    group?: StatementGroup | "balance" | "spent";
    airings?: number;
    kind?: "added" | "aired" | "returned" | "fees" | "sponsorship" | "order" | "withdrawn" | "refund" | "spot_station";
    includedAbove?: boolean;
  }>;
  issuedAt: string;
  csvUrl: string;
  pdfUrl: string | null;
  paidOn?: string | null;
  destination?: string | null;
  inProgress?: boolean;
  asOf?: string;
  finalOn?: string | null;
  closingAvailableMicros?: number;
  closingHeldMicros?: number;
}

type StatementGroup = "spots" | "sponsors_pledges" | "carriage" | "shared" | "card_fees" | "production" | "other";

/** E3: the group a statement line belongs to, from its label (statements issued before this carry no group). */
function statementGroup(label: string, accountKind: string): StatementGroup {
  if (accountKind === "advertiser_available") return /^Spent/.test(label) ? "spots" : /fee/i.test(label) ? "card_fees" : "other";
  if (label === "Spots") return "spots";
  if (label === "Sponsors" || label === "Pledges") return "sponsors_pledges";
  if (label === "Your programs on other stations" || label === "Programs you carry") return "carriage";
  if (label === "The pool" || label === "Opencast's share") return "shared";
  if (label === "Made for you") return "production";
  return "other";
}

export interface StationEarningsView {
  period: "week" | "month" | "year";
  lines: {
    spots: { micros: number; airings: number; businesses: number };
    sponsors: { micros: number; sponsors: number; list?: Array<{ name: string; monthlyMicros: number }> };
    pledges: { micros: number; members: number; newMembers: number };
    carriageIn: { micros: number; detail: string };
    carriageOut: { micros: number; detail: string };
    production: { micros: number; orders: number };
    opencastShare: { micros: number; notSetYet: boolean };
    pool: { micros: number; notSetYet: boolean };
    /** "Ads from partners, paid when received": its own line, never held or escrowed. 0 until the backfill exists. */
    partnerAds: { on: boolean; micros: number; pendingMicros: number };
  };
  totalMicros: number;
  held: { tonightMicros: number; tonightAirings: number; restOfWeekMicros: number; restOfWeekAirings: number; tonightBreaks?: number };
  account: { availableMicros: number; paidOutThisMonthMicros: number };
  nextPayout: { on: string; schedule: "weekly" | "monthly"; destination: string | null; amountMicros?: number } | null;
}

export interface PledgeView {
  id: string;
  station: import("@opencast/contracts").StationIdent;
  cadence: "monthly" | "once";
  amountMicros: number;
  creditOnAir: boolean;
  startedAt: string;
  nextChargeOn: string | null;
  endsAfter: string | null;
  receipts: { count: number; totalMicros: number; items: Array<{ id: string; on: string; amountMicros: number; url: string | null }> };
  card: { label: string; expired: boolean; expiresOn: string | null } | null;
}

const L = schema.accountsTable;
const E = schema.entries;
const P = schema.postings;
const H = schema.holds;
const DAY = 86_400_000;
const BPS = 10_000;

const dollars = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;
const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** How a ledger entry reads on a statement. */
function statementLabel(kind: string, sourceType: string | null, amount: number, accountKind: string): string {
  if (accountKind === "advertiser_available") {
    const labels: Record<string, string> = { deposit: "Added", withdrawal: "Taken out", hold: "Held for airings and orders", release: "Returned from holds", settle: "Spent (beyond what was held)", reversal: "Reversed" };
    return labels[kind] ?? kind;
  }
  if (kind === "settle") return sourceType === "sponsorship_month" ? "Sponsors" : sourceType === "production_order" ? "Made for you" : "Spots";
  if (kind === "carriage_fee" || kind === "barter_split") return amount > 0 ? "Your programs on other stations" : "Programs you carry";
  const labels: Record<string, string> = { pledge: "Pledges", pool: "The pool", payout: "Paid out", escrow_deposit: "Into escrow", reversal: "Reversed" };
  return labels[kind] ?? kind;
}

export function createLedgerService({ deps, services }: ModuleContext): LedgerService {
  const { db } = deps;

  async function balanceOf(accountIds: string[]): Promise<number> {
    if (!accountIds.length) return 0;
    const [row] = await db
      .select({ sum: sql<string>`coalesce(sum(${P.amountMicros}), 0)` })
      .from(P)
      .where(inArray(P.accountId, accountIds));
    return Number(row.sum);
  }

  async function stationAccountKind(stationId: string): Promise<"station_earnings" | "escrow_owed"> {
    // A claimable station has no wallet: its earnings are owed to escrow until the weekly deposit.
    return (await services.stations.kindOf(stationId)) === "claimable" ? "escrow_owed" : "station_earnings";
  }

  async function heldFor(businessId: string) {
    const rows = await db
      .select({ holdId: H.id, purpose: H.purpose, open: sql<string>`coalesce(sum(${P.amountMicros}), 0)` })
      .from(H)
      .leftJoin(P, eq(P.holdId, H.id))
      .where(eq(H.advertiserId, businessId))
      .groupBy(H.id, H.purpose);
    return rows.map((r) => ({ holdId: r.holdId, purpose: r.purpose, open: Number(r.open) })).filter((r) => r.open > 0);
  }

  async function spentBetween(businessId: string, from: Date, to: Date) {
    // Spent: what left this business's holds and balance to pay for airings (settle entries).
    const available = await service.account(db, "advertiser_available", { advertiserId: businessId });
    const rows = await db
      .select({ entryId: E.id, amount: P.amountMicros, holdAdvertiser: H.advertiserId, accountId: P.accountId })
      .from(E)
      .innerJoin(P, eq(P.entryId, E.id))
      .leftJoin(H, eq(H.id, P.holdId))
      .where(and(eq(E.kind, "settle"), gte(E.occurredAt, from), lt(E.occurredAt, to), eq(E.sourceType, "as_run")));
    let micros = 0;
    const entries = new Set<string>();
    for (const r of rows) {
      if ((r.holdAdvertiser === businessId || r.accountId === available) && r.amount < 0) {
        micros += -r.amount;
        entries.add(r.entryId);
      }
    }
    return { micros, airings: entries.size };
  }

  async function checkRunway(businessId: string) {
    const business = await services.spots.moneySettings(businessId);
    if (!business) return;
    const balance = await service.balance(businessId);
    if (balance.runwayDays === null) return;
    const D = schema.deposits;
    const [lastTopUp] = await db
      .select({ id: D.id, createdAt: D.createdAt })
      .from(D)
      .where(and(eq(D.advertiserId, businessId), inArray(D.status, ["pending", "arrived"])))
      .orderBy(desc(D.createdAt))
      .limit(1);
    // Auto top-up, when it's on: once the runway is short, from the default funding source, at most once a day.
    if (business.autoTopUp && business.autoTopUpMicros && balance.runwayDays <= business.autoTopUpBelowDays) {
      const recent = lastTopUp && deps.clock.now().getTime() - lastTopUp.createdAt.getTime() < 86_400_000;
      const source = balance.fundingSources.find((f) => f.isDefault);
      if (!recent && source) {
        await service.addMoney(businessId, { amountMicros: business.autoTopUpMicros, fundingSourceId: source.id }).catch((error) => console.error(`[ledger] auto top-up for ${businessId} failed`, error));
        return;
      }
    }
    const warnAt = [...business.warnDays].sort((a, b) => a - b);
    const threshold = warnAt.find((d) => balance.runwayDays! <= d);
    if (threshold !== undefined) deps.bus.emit("business.low_balance", { businessId, daysLeft: threshold, since: lastTopUp?.id ?? "start" });
    await services.spots.reviewBalance(businessId);
  }

  /** Asks the provider to send a payout already taken out of the ledger; puts it back if refused. */
  async function sendPayout(payoutId: string, entryId: string, from: Owner, destinationRef: string | null, micros: number) {
    try {
      const started = await deps.payments.startPayout({ payoutId, from, destinationRef, amountMicros: micros }, accountDirectory(db));
      await db.update(schema.payouts).set({ status: "sent", providerRef: started.providerRef }).where(eq(schema.payouts.id, payoutId));
    } catch (error) {
      await db.transaction(async (tx) => {
        await reverse(tx, entryId, `Payout didn't go through: ${(error as Error).message}`.slice(0, 200));
        await tx.update(schema.payouts).set({ status: "failed" }).where(eq(schema.payouts.id, payoutId));
      });
      throw refused("payout_failed", `That payout didn't go through: ${(error as Error).message}`);
    }
  }

  /** Takes a station's earnings out of the ledger and asks the provider to pay them to its bank. */
  async function payoutStation(stationId: string, micros: number, memo: string, idempotencyKey?: string) {
    if ((await stationAccountKind(stationId)) === "escrow_owed") throw refused("escrow", "A claimable station's earnings go to escrow.");
    const account = await service.account(db, "station_earnings", { stationId });
    if ((await balanceOf([account])) < micros) throw refused("insufficient_balance", "That's more than the station has.");
    // The owner's linked Clear wallet, if that's where the station is paid; else its own account.
    const where = await service.payoutAccount(stationId);
    const toWallet = where.destination.kind === "clear_wallet";
    if (toWallet && (where.status !== "active" || !where.destination.address)) {
      throw conflict("clear_unlinked", "Payouts go to a Clear wallet that's no longer linked to the station's owner. Connect Clear again, or pay out to the station's account.");
    }
    const scheduledFor = deps.clock.now().toISOString().slice(0, 10);
    const { payoutId, entryId } = await db.transaction(async (tx) => {
      const entryId = await service.post(
        tx,
        "payout",
        [
          { account, micros: -micros },
          { account: await service.account(tx, "external", { label: "clear" }), micros }
        ],
        { sourceType: "payout", memo, idempotencyKey }
      );
      const [payout] = await tx
        .insert(schema.payouts)
        .values({ accountId: account, amountMicros: micros, destination: toWallet ? where.destination.label : "bank", scheduledFor, status: "scheduled", entryId })
        .returning();
      return { payoutId: payout.id, entryId: entryId! };
    });
    await sendPayout(payoutId, entryId, { type: "station", id: stationId }, toWallet ? walletDestination(where.destination.address!) : null, micros);
    return { payoutId, scheduledFor };
  }

  /** Funding from and payouts to linked Clear wallets, when the provider has them. */
  function clearRail() {
    const rail = deps.payments.clearWallet;
    if (!rail) throw conflict("clear_unavailable", "Clear isn't available on this server.");
    return rail;
  }

  async function linkedClear(userId: string) {
    const link = await services.accounts.clearLink(userId);
    if (!link) throw conflict("clear_not_linked", "Clear isn't linked yet. Connect Clear first.");
    return link;
  }

  async function businessOwner(businessId: string): Promise<Owner & { type: "advertiser" }> {
    const name = (await services.spots.businessNames([businessId])).get(businessId) ?? "Business";
    return { type: "advertiser", id: businessId, name };
  }

  /** Checks a transfer from a Clear wallet again, and credits it once it's confirmed. */
  async function settleClearTransfer(deposit: typeof schema.deposits.$inferSelect) {
    if (deposit.status !== "pending" || !deposit.txHash || !deposit.fromAddress) return deposit.status;
    const rail = clearRail();
    const to = await rail.depositAddress(await businessOwner(deposit.advertiserId), accountDirectory(db));
    const check = await rail.verifyTransfer({ businessId: deposit.advertiserId, txHash: deposit.txHash, from: deposit.fromAddress, to, amountMicros: deposit.amountMicros });
    if (check.status === "confirmed") {
      await service.completeDeposit(deposit.id);
      return "arrived" as const;
    }
    if (check.status === "failed") {
      await db.update(schema.deposits).set({ status: "failed" }).where(and(eq(schema.deposits.id, deposit.id), eq(schema.deposits.status, "pending")));
      return "failed" as const;
    }
    return "pending" as const;
  }

  /** A reversal: a new entry with every posting of the original, the other way round. */
  async function reverse(tx: Executor, entryId: string, memo: string) {
    const postings = await tx.select().from(P).where(eq(P.entryId, entryId));
    const [entry] = await tx
      .insert(E)
      .values({ kind: "reversal", occurredAt: deps.clock.now(), reversesEntryId: entryId, sourceType: "reversal", sourceId: entryId, memo })
      .returning({ id: E.id });
    const lines = postings.map((p) => ({ account: p.accountId, micros: -p.amountMicros, holdId: p.holdId ?? undefined }));
    await tx.insert(P).values(lines.map((l) => ({ entryId: entry.id, accountId: l.account, amountMicros: l.micros, holdId: l.holdId ?? null })));
    await recordMoves(tx, deps.payments, entry.id, lines);
    return entry.id;
  }

  /** A pledge payment arrived: the station gets it less Stripe's fee and Opencast's share (0 until decided). */
  async function pledgeReceived(pledgeId: string, amountMicros: number, feeMicros: number, providerRef: string) {
    const [pledge] = await db.select().from(schema.pledges).where(eq(schema.pledges.id, pledgeId));
    if (!pledge) return;
    const config = await service.config();
    const share = Math.floor((amountMicros * config.opencastPledgeShareBps) / BPS);
    await db.transaction(async (tx) => {
      await service.post(
        tx,
        "pledge",
        [
          { account: await service.account(tx, "external", { label: "stripe" }), micros: -amountMicros },
          { account: await service.account(tx, "card_fees"), micros: feeMicros },
          { account: await service.account(tx, "opencast_share"), micros: share },
          { account: await service.account(tx, await stationAccountKind(pledge.stationId), { stationId: pledge.stationId }), micros: amountMicros - feeMicros - share }
        ],
        { sourceType: "pledge", sourceId: pledgeId, memo: `Pledge, ${dollars(amountMicros)}`, idempotencyKey: `pledge:${providerRef}` }
      );
    });
  }

  const service = {
    async account(tx, kind, owner = {}) {
      const values = { kind, advertiserId: owner.advertiserId ?? null, stationId: owner.stationId ?? null, userId: owner.userId ?? null, label: owner.label ?? null };
      await tx.insert(L).values(values).onConflictDoNothing();
      const [row] = await tx
        .select({ id: L.id })
        .from(L)
        .where(
          and(
            eq(L.kind, kind),
            values.advertiserId ? eq(L.advertiserId, values.advertiserId) : sql`${L.advertiserId} is null`,
            values.stationId ? eq(L.stationId, values.stationId) : sql`${L.stationId} is null`,
            values.userId ? eq(L.userId, values.userId) : sql`${L.userId} is null`,
            values.label ? eq(L.label, values.label) : sql`${L.label} is null`
          )
        );
      return row.id;
    },

    async post(tx, kind, lines, source = {}) {
      const real = lines.filter((l) => l.micros !== 0);
      if (!real.length) return null;
      const total = real.reduce((sum, l) => sum + l.micros, 0);
      if (total !== 0) throw new Error(`Unbalanced ${kind} entry (${total})`);
      // The same idempotency key twice is the same entry: the second post does nothing.
      if (source.idempotencyKey) {
        const [existing] = await tx.select({ id: E.id }).from(E).where(eq(E.idempotencyKey, source.idempotencyKey));
        if (existing) return existing.id;
      }
      const [entry] = await tx
        .insert(E)
        .values({ kind, occurredAt: deps.clock.now(), sourceType: source.sourceType ?? null, sourceId: source.sourceId ?? null, memo: source.memo ?? null, idempotencyKey: source.idempotencyKey ?? null })
        .returning({ id: E.id });
      await tx.insert(P).values(real.map((l) => ({ entryId: entry.id, accountId: l.account, amountMicros: l.micros, holdId: l.holdId ?? null })));
      // What the provider has to do, written with the entry and sent after it commits.
      await recordMoves(tx, deps.payments, entry.id, real);
      return entry.id;
    },

    async config(at = deps.clock.now()) {
      const [row] = await db
        .select()
        .from(schema.revenueConfig)
        .where(lte(schema.revenueConfig.effectiveFrom, at.toISOString().slice(0, 10)))
        .orderBy(desc(schema.revenueConfig.effectiveFrom))
        .limit(1);
      return {
        opencastSpotShareBps: row?.opencastSpotShareBps ?? 0,
        opencastPledgeShareBps: row?.opencastPledgeShareBps ?? 0,
        opencastProductionShareBps: row?.opencastProductionShareBps ?? 0,
        poolShareBps: row?.poolShareBps ?? 0,
        poolBaseBps: row?.poolBaseBps ?? 0,
        poolWatchTimeBps: row?.poolWatchTimeBps ?? 0,
        poolFundBps: row?.poolFundBps ?? 0,
        payoutSchedule: row?.payoutSchedule ?? "weekly",
        unclaimedPeriodDays: row?.unclaimedPeriodDays ?? 1095
      };
    },

    async hold(tx, input) {
      if (input.amountMicros <= 0) throw badRequest("A hold has to be for something.");
      const available = await service.account(tx, "advertiser_available", { advertiserId: input.businessId });
      const holds = await service.account(tx, "holds");
      const [hold] = await tx
        .insert(H)
        .values({
          advertiserId: input.businessId,
          purpose: input.purpose,
          spotId: input.spotId ?? null,
          stationId: input.stationId ?? null,
          sponsorshipId: input.sponsorshipId ?? null,
          productionOrderId: input.productionOrderId ?? null,
          amountMicros: input.amountMicros,
          isEstimate: input.isEstimate ?? false
        })
        .returning({ id: H.id });
      // Checked now, not at commit, so a caller can try the next spot instead.
      const [row] = await tx
        .select({ sum: sql<string>`coalesce(sum(${P.amountMicros}), 0)` })
        .from(P)
        .where(eq(P.accountId, available));
      if (Number(row.sum) < input.amountMicros) {
        throw refused("insufficient_balance", "Not enough available to hold.");
      }
      await service.post(
        tx,
        "hold",
        [
          { account: available, micros: -input.amountMicros },
          { account: holds, micros: input.amountMicros, holdId: hold.id }
        ],
        { sourceType: "hold", sourceId: hold.id, memo: input.memo }
      );
      return hold.id;
    },

    async openAmount(holdIds) {
      if (!holdIds.length) return new Map();
      const rows = await db
        .select({ holdId: P.holdId, open: sql<string>`sum(${P.amountMicros})` })
        .from(P)
        .where(inArray(P.holdId, holdIds))
        .groupBy(P.holdId);
      return new Map(rows.map((r) => [r.holdId!, Number(r.open)]));
    },

    async openHolds(holdIds) {
      if (!holdIds.length) return new Map();
      const rows = await db
        .select({ holdId: P.holdId, open: sql<string>`coalesce(sum(${P.amountMicros}), 0)` })
        .from(P)
        .where(inArray(P.holdId, holdIds))
        .groupBy(P.holdId);
      return new Map(rows.map((r) => [r.holdId!, Number(r.open)]));
    },

    async release(tx, holdId, micros, source = {}) {
      const [hold] = await tx.select().from(H).where(eq(H.id, holdId));
      if (!hold) throw notFound("That hold");
      const [row] = await tx
        .select({ open: sql<string>`coalesce(sum(${P.amountMicros}), 0)` })
        .from(P)
        .where(eq(P.holdId, holdId));
      const open = Number(row.open);
      const amount = Math.min(open, micros ?? open);
      if (amount <= 0) return 0;
      await service.post(
        tx,
        "release",
        [
          { account: await service.account(tx, "holds"), micros: -amount, holdId },
          { account: await service.account(tx, "advertiser_available", { advertiserId: hold.advertiserId }), micros: amount }
        ],
        { sourceType: source.sourceType ?? "hold", sourceId: source.sourceId ?? holdId, memo: source.memo }
      );
      return amount;
    },

    async settle(tx, input) {
      const [hold] = await tx.select().from(H).where(eq(H.id, input.holdId));
      if (!hold) throw notFound("That hold");
      const [row] = await tx
        .select({ open: sql<string>`coalesce(sum(${P.amountMicros}), 0)` })
        .from(P)
        .where(eq(P.holdId, input.holdId));
      const open = Number(row.open);
      const available = await service.account(tx, "advertiser_available", { advertiserId: hold.advertiserId });
      const [bal] = await tx.select({ sum: sql<string>`coalesce(sum(${P.amountMicros}), 0)` }).from(P).where(eq(P.accountId, available));

      const cost = Math.max(0, Math.round(input.costMicros));
      const fromHold = Math.min(open, cost);
      const fromAvailable = Math.min(cost - fromHold, Math.max(0, Number(bal.sum)));
      const absorbed = cost - fromHold - fromAvailable;

      const config = await service.config();
      const shareBps = input.kind === "production" ? config.opencastProductionShareBps : config.opencastSpotShareBps;
      // Opencast's share and the pool come out of what the station receives, never added to the business's rate.
      const share = Math.floor((cost * shareBps) / BPS);
      const pool = Math.floor((cost * config.poolShareBps) / BPS);
      const net = cost - share - pool;
      const stationKind = await stationAccountKind(input.stationId);
      const stationAccount = await service.account(tx, stationKind, { stationId: input.stationId });

      await service.post(
        tx,
        "settle",
        [
          { account: await service.account(tx, "holds"), micros: -fromHold, holdId: input.holdId },
          { account: available, micros: -fromAvailable },
          { account: await service.account(tx, "opencast_absorbed"), micros: -absorbed },
          { account: stationAccount, micros: net },
          { account: await service.account(tx, "opencast_share"), micros: share },
          { account: await service.account(tx, "pool"), micros: pool }
        ],
        input.source
      );

      if (input.barter && input.barter.producerShare > 0) {
        const producerPart = Math.floor(net * input.barter.producerShare);
        await service.post(
          tx,
          "barter_split",
          [
            { account: stationAccount, micros: -producerPart },
            { account: await service.account(tx, await stationAccountKind(input.barter.producerStationId), { stationId: input.barter.producerStationId }), micros: producerPart }
          ],
          { sourceType: "agreement", sourceId: input.barter.agreementId, memo: `The producer's barter share: ${input.source.memo ?? "an airing"}` }
        );
      }

      const returned = await service.release(tx, input.holdId, undefined, { sourceType: input.source.sourceType, sourceId: input.source.sourceId });
      return { paidMicros: cost, absorbedMicros: absorbed, returnedMicros: returned };
    },

    async chargeCarriageFee(tx, input) {
      if (input.micros <= 0) return;
      await service.post(
        tx,
        "carriage_fee",
        [
          { account: await service.account(tx, await stationAccountKind(input.carrierStationId), { stationId: input.carrierStationId }), micros: -input.micros },
          { account: await service.account(tx, await stationAccountKind(input.makerStationId), { stationId: input.makerStationId }), micros: input.micros }
        ],
        { ...input.source, sourceType: "agreement", sourceId: input.agreementId }
      );
    },

    async carriagePaid(agreementIds, from, to) {
      if (!agreementIds.length) return new Map();
      const rows = await db
        .select({ agreementId: E.sourceId, micros: sql<string>`sum(${P.amountMicros})` })
        .from(E)
        .innerJoin(P, eq(P.entryId, E.id))
        .innerJoin(L, eq(L.id, P.accountId))
        .where(
          and(
            eq(E.sourceType, "agreement"),
            inArray(E.sourceId, agreementIds),
            inArray(E.kind, ["carriage_fee", "barter_split"]),
            inArray(L.kind, ["station_earnings", "escrow_owed"]),
            sql`${P.amountMicros} > 0`,
            gte(E.occurredAt, from),
            lt(E.occurredAt, to)
          )
        )
        .groupBy(E.sourceId);
      return new Map(rows.map((r) => [r.agreementId!, Number(r.micros)]));
    },

    async balance(businessId) {
      const now = deps.clock.now();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const available = await balanceOf([await service.account(db, "advertiser_available", { advertiserId: businessId })]);
      const held = await heldFor(businessId);
      const month = await spentBetween(businessId, monthStart, now);
      const last30 = await spentBetween(businessId, new Date(now.getTime() - 30 * DAY), now);
      const days = Math.max(1, Math.min(30, (now.getTime() - (await firstActivity(businessId)).getTime()) / DAY));
      const pace = Math.round(last30.micros / days);
      const [pending, sources] = await Promise.all([
        db
          .select()
          .from(schema.deposits)
          .where(and(eq(schema.deposits.advertiserId, businessId), eq(schema.deposits.status, "pending")))
          .orderBy(asc(schema.deposits.createdAt)),
        db
          .select()
          .from(schema.fundingSources)
          .where(and(eq(schema.fundingSources.advertiserId, businessId), sql`${schema.fundingSources.removedAt} is null`))
          .orderBy(asc(schema.fundingSources.createdAt))
      ]);
      const kinds = new Map(sources.map((s) => [s.id, s.kind]));
      // A linked Clear wallet stops working (and stops showing) once it's unlinked.
      const unlinked = new Set<string>();
      for (const source of sources) {
        if (source.clearLinkId && !(await services.accounts.clearLinkById(source.clearLinkId))?.active) unlinked.add(source.id);
      }
      return {
        availableMicros: available,
        heldMicros: held.reduce((sum, h) => sum + h.open, 0),
        heldAirings: held.filter((h) => h.purpose === "airing").length,
        spentThisMonthMicros: month.micros,
        spentThisMonthAirings: month.airings,
        pacePerDayMicros: pace,
        runwayDays: pace > 0 ? Math.floor(available / pace) : null,
        pendingDeposits: pending.map((d) => ({
          id: d.id,
          amountMicros: d.amountMicros,
          expectedAt: d.expectedAt?.toISOString() ?? null,
          method: (d.fundingSourceId && kinds.get(d.fundingSourceId)) || (d.txHash ? "clear_account" : "clear_bank")
        })),
        fundingSources: sources.filter((s) => !unlinked.has(s.id)).map((s) => ({ id: s.id, kind: s.kind, label: s.label, isDefault: s.isDefault }))
      };
    },

    async runwayDays(businessIds) {
      const result = new Map<string, number | null>();
      for (const id of [...new Set(businessIds)]) result.set(id, (await service.balance(id)).runwayDays);
      return result;
    },

    async movements(businessId, filter) {
      const available = await service.account(db, "advertiser_available", { advertiserId: businessId });
      const holdIds = (await db.select({ id: H.id }).from(H).where(eq(H.advertiserId, businessId))).map((h) => h.id);
      const rows = await db
        .select({ entry: E, posting: P })
        .from(E)
        .innerJoin(P, eq(P.entryId, E.id))
        .where(
          and(
            holdIds.length ? sql`(${P.accountId} = ${available} or ${inArray(P.holdId, holdIds)})` : eq(P.accountId, available),
            ...(filter.before ? [lt(E.occurredAt, new Date(filter.before))] : [])
          )
        )
        .orderBy(desc(E.occurredAt))
        .limit(filter.limit * 4);
      const byEntry = new Map<string, { entry: typeof E.$inferSelect; amount: number }>();
      for (const { entry, posting } of rows) {
        // What left or reached the business: its balance moves, plus what left its holds when paid out.
        const counts = posting.accountId === available || (entry.kind === "settle" && posting.holdId);
        if (!counts) continue;
        const current = byEntry.get(entry.id) ?? { entry, amount: 0 };
        current.amount += posting.amountMicros;
        byEntry.set(entry.id, current);
      }
      const views: MovementView[] = [];
      for (const { entry, amount } of byEntry.values()) {
        let kind: MovementView["kind"];
        let label: string;
        switch (entry.kind) {
          case "deposit":
            kind = "added";
            label = entry.memo ?? "Money added";
            break;
          case "withdrawal":
            kind = "withdrawn";
            label = "Taken out";
            break;
          case "card_fee":
            kind = "fee";
            label = "Stripe's fee, at cost";
            break;
          case "hold":
            kind = "held";
            label = entry.memo ?? "Held for an airing";
            break;
          case "release":
            kind = "returned";
            label = entry.memo ?? "Returned";
            break;
          case "settle":
            kind = entry.sourceType === "as_run" ? "aired" : entry.sourceType === "production_order" ? "order" : "sponsorship";
            label = entry.memo ?? "Aired";
            break;
          default:
            kind = "refund";
            label = entry.memo ?? entry.kind;
        }
        if (filter.filter === "money" && !["added", "withdrawn", "fee"].includes(kind)) continue;
        if (filter.filter === "airings" && !["aired", "held", "returned"].includes(kind)) continue;
        views.push({ id: entry.id, at: entry.occurredAt.toISOString(), kind, label, amountMicros: amount, detail: null });
      }
      return views.slice(0, filter.limit);
    },

    async addFundingSource(businessId, input, byUserId) {
      if (input.kind === "clear_account" && input.token === "linked") {
        // The owner's own Clear wallet, linked through Privy: withdrawals can go to it.
        clearRail();
        if (!byUserId) throw conflict("clear_not_linked", "Clear isn't linked yet. Connect Clear first.");
        const link = await linkedClear(byUserId);
        await db.transaction(async (tx) => {
          const existing = await tx
            .select()
            .from(schema.fundingSources)
            .where(and(eq(schema.fundingSources.advertiserId, businessId), sql`${schema.fundingSources.removedAt} is null`));
          const makeDefault = input.makeDefault || existing.length === 0;
          if (makeDefault) await tx.update(schema.fundingSources).set({ isDefault: false }).where(eq(schema.fundingSources.advertiserId, businessId));
          const same = existing.find((f) => f.clearLinkId === link.id);
          if (same) {
            if (makeDefault) await tx.update(schema.fundingSources).set({ isDefault: true }).where(eq(schema.fundingSources.id, same.id));
            return;
          }
          await tx.insert(schema.fundingSources).values({
            advertiserId: businessId,
            kind: "clear_account",
            label: `Clear wallet ${shortAddress(link.address)}`,
            providerRef: walletDestination(link.address),
            clearLinkId: link.id,
            isDefault: makeDefault
          });
        });
        return (await service.balance(businessId)).fundingSources;
      }
      const businessName = (await services.spots.businessNames([businessId])).get(businessId) ?? "Business";
      const linked = await deps.payments.linkFundingSource({ businessId, businessName, kind: input.kind, token: input.token }, accountDirectory(db));
      await db.transaction(async (tx) => {
        const existing = await tx.select({ id: schema.fundingSources.id }).from(schema.fundingSources).where(eq(schema.fundingSources.advertiserId, businessId));
        const makeDefault = input.makeDefault || existing.length === 0;
        if (makeDefault) await tx.update(schema.fundingSources).set({ isDefault: false }).where(eq(schema.fundingSources.advertiserId, businessId));
        await tx.insert(schema.fundingSources).values({ advertiserId: businessId, kind: input.kind, label: linked.label, providerRef: linked.providerRef, isDefault: makeDefault });
      });
      return (await service.balance(businessId)).fundingSources;
    },

    async quoteDeposit(businessId, input) {
      const feeMicros = deps.payments.depositFeeMicros(input.method, input.amountMicros);
      const [spots, basis] = await Promise.all([services.spots.typicalAiringCost(businessId), services.spots.airingCostBasis(businessId)]);
      // E6: what "roughly N airings" is worked out on.
      const station = basis?.stationId ? ((await services.stations.idents([basis.stationId])).get(basis.stationId) ?? null) : null;
      return {
        amountMicros: input.amountMicros,
        feeMicros,
        arrives: deps.payments.arrives(input.method),
        roughAirings: spots ? Math.floor(input.amountMicros / spots) : null,
        basis: basis ? { rateKind: basis.rateKind, rateMicros: basis.rateMicros, station } : null
      };
    },

    async addMoney(businessId, input) {
      const [source] = await db
        .select()
        .from(schema.fundingSources)
        .where(and(eq(schema.fundingSources.id, input.fundingSourceId), eq(schema.fundingSources.advertiserId, businessId)));
      if (!source || source.removedAt) throw notFound("That funding source");
      if (source.clearLinkId) throw conflict("clear_transfer_needed", "Money from a Clear wallet comes in by a transfer you confirm in Clear.");
      const feeMicros = deps.payments.depositFeeMicros(source.kind, input.amountMicros);
      // The deposit exists first, so the provider can report back against it.
      const [deposit] = await db
        .insert(schema.deposits)
        .values({ advertiserId: businessId, fundingSourceId: source.id, amountMicros: input.amountMicros, feeMicros, status: "pending" })
        .returning();
      let started;
      try {
        started = await deps.payments.startDeposit(
          { depositId: deposit.id, businessId, kind: source.kind, sourceRef: source.providerRef, amountMicros: input.amountMicros, feeMicros },
          accountDirectory(db)
        );
      } catch (error) {
        await db.update(schema.deposits).set({ status: "failed" }).where(eq(schema.deposits.id, deposit.id));
        throw refused("deposit_failed", `That didn't go through: ${(error as Error).message}`);
      }
      await db.update(schema.deposits).set({ providerRef: started.providerRef, expectedAt: started.expectedAt }).where(eq(schema.deposits.id, deposit.id));
      if (started.status === "arrived") await service.completeDeposit(deposit.id);
      return { depositId: deposit.id, status: started.status, balance: await service.balance(businessId) };
    },

    async quoteClearTransfer(businessId, userId, amountMicros) {
      const rail = clearRail();
      const usdc = deps.config.usdc;
      if (!usdc) throw conflict("clear_unavailable", "Funding from Clear isn't set up on this server.");
      const link = await linkedClear(userId);
      if (link.access !== "full") throw conflict("clear_read_only", "Clear lets Opencast only read your Clear wallet, so add money from inside Clear.");
      const to = await rail.depositAddress(await businessOwner(businessId), accountDirectory(db));
      return { to, token: { address: usdc.address, symbol: "USDC", decimals: 6 }, chainId: usdc.chainId, amountUnits: String(amountMicros), from: link.address };
    },

    async confirmClearTransfer(businessId, userId, input) {
      const txHash = input.txHash.toLowerCase();
      const D = schema.deposits;
      const reply = async (deposit: typeof D.$inferSelect) => {
        if (deposit.advertiserId !== businessId) throw conflict("transfer_already_used", "That transfer was already used for another deposit.");
        if (deposit.amountMicros !== input.amountMicros) throw conflict("transfer_already_used", "That transfer was already recorded for a different amount.");
        if (deposit.status === "failed") throw refused("transfer_not_valid", "That transfer didn't check out, so it wasn't added.");
        const status = deposit.status === "pending" ? await settleClearTransfer(deposit) : deposit.status;
        return { depositId: deposit.id, status: status === "arrived" ? ("arrived" as const) : ("pending" as const), balance: await service.balance(businessId) };
      };
      // The same transaction again: the same answer (checked again if it was still pending).
      const [seen] = await db.select().from(D).where(eq(D.txHash, txHash));
      if (seen) return reply(seen);

      const rail = clearRail();
      const link = await linkedClear(userId);
      const to = await rail.depositAddress(await businessOwner(businessId), accountDirectory(db));
      const check = await rail.verifyTransfer({ businessId, txHash, from: link.address, to, amountMicros: input.amountMicros });
      if (check.status === "failed") throw refused("transfer_not_valid", check.reason);
      const [source] = await db
        .select({ id: schema.fundingSources.id })
        .from(schema.fundingSources)
        .where(and(eq(schema.fundingSources.advertiserId, businessId), eq(schema.fundingSources.clearLinkId, link.id), sql`${schema.fundingSources.removedAt} is null`));
      const [deposit] = await db
        .insert(D)
        .values({ advertiserId: businessId, fundingSourceId: source?.id ?? null, amountMicros: input.amountMicros, feeMicros: 0, status: "pending", txHash, fromAddress: link.address, providerRef: `tx:${txHash}` })
        .onConflictDoNothing()
        .returning();
      if (!deposit) {
        // Confirmed twice at once: the other request recorded it.
        const [other] = await db.select().from(D).where(eq(D.txHash, txHash));
        return reply(other);
      }
      if (check.status === "confirmed") await service.completeDeposit(deposit.id);
      return { depositId: deposit.id, status: check.status === "confirmed" ? "arrived" : "pending", balance: await service.balance(businessId) };
    },

    async recheckClearTransfers() {
      if (!deps.payments.clearWallet) return { arrived: 0, failed: 0 };
      const pending = await db
        .select()
        .from(schema.deposits)
        .where(and(eq(schema.deposits.status, "pending"), sql`${schema.deposits.txHash} is not null`))
        .orderBy(asc(schema.deposits.createdAt))
        .limit(100);
      let arrived = 0;
      let failed = 0;
      for (const deposit of pending) {
        const status = await settleClearTransfer(deposit).catch((error) => {
          console.error(`[ledger] checking the Clear transfer for deposit ${deposit.id} failed`, error);
          return "pending" as const;
        });
        if (status === "arrived") arrived++;
        if (status === "failed") failed++;
      }
      return { arrived, failed };
    },

    async completeDeposit(depositId) {
      const businessId = await db.transaction(async (tx) => {
        const [deposit] = await tx.select().from(schema.deposits).where(eq(schema.deposits.id, depositId)).for("update");
        if (!deposit || deposit.status !== "pending") return null;
        const [source] = deposit.fundingSourceId
          ? await tx.select().from(schema.fundingSources).where(eq(schema.fundingSources.id, deposit.fundingSourceId))
          : [];
        const kind = source?.kind ?? (deposit.txHash ? "clear_account" : "clear_bank");
        const external = await service.account(tx, "external", { label: kind === "card" ? "stripe" : "clear" });
        const entryId = await service.post(
          tx,
          "deposit",
          [
            { account: await service.account(tx, "advertiser_available", { advertiserId: deposit.advertiserId }), micros: deposit.amountMicros },
            { account: external, micros: -deposit.amountMicros }
          ],
          { sourceType: "deposit", sourceId: deposit.id, memo: kind === "card" ? "Added by card" : kind === "clear_account" ? "Added from Clear" : "Added by bank transfer", idempotencyKey: `deposit:${deposit.id}` }
        );
        if (deposit.feeMicros > 0) {
          // The fee is paid on top, at cost; it never comes out of the balance.
          await service.post(
            tx,
            "card_fee",
            [
              { account: await service.account(tx, "card_fees"), micros: deposit.feeMicros },
              { account: external, micros: -deposit.feeMicros }
            ],
            { sourceType: "deposit", sourceId: deposit.id, memo: "Stripe's fee, at cost" }
          );
        }
        await tx.update(schema.deposits).set({ status: "arrived", entryId }).where(eq(schema.deposits.id, depositId));
        return deposit.advertiserId;
      });
      if (businessId) await services.spots.reviewBalance(businessId, true);
    },

    async cancelDeposit(businessId, depositId) {
      const [deposit] = await db
        .select()
        .from(schema.deposits)
        .where(and(eq(schema.deposits.id, depositId), eq(schema.deposits.advertiserId, businessId)));
      if (!deposit) throw notFound("That deposit");
      if (deposit.status !== "pending") throw refused("already_arrived", "That money has arrived. Take it out instead.");
      // A transfer from a Clear wallet is already on chain: it arrives once it's checked.
      if (deposit.txHash) throw refused("not_cancellable", "A transfer from Clear can't be undone here.");
      if (deposit.providerRef) await deps.payments.cancelDeposit(deposit.providerRef);
      await db.update(schema.deposits).set({ status: "cancelled" }).where(eq(schema.deposits.id, depositId));
      return service.balance(businessId);
    },

    async withdraw(businessId, input) {
      const [source] = await db
        .select()
        .from(schema.fundingSources)
        .where(and(eq(schema.fundingSources.id, input.fundingSourceId), eq(schema.fundingSources.advertiserId, businessId)));
      if (!source) throw notFound("That funding source");
      if (source.kind === "card") throw refused("not_to_a_card", "Money goes back to a bank or Clear account, not a card.");
      if (source.clearLinkId && !(await services.accounts.clearLinkById(source.clearLinkId))?.active) {
        throw conflict("clear_unlinked", "That Clear wallet isn't linked anymore. Connect Clear again to use it.");
      }
      const available = await service.account(db, "advertiser_available", { advertiserId: businessId });
      if ((await balanceOf([available])) < input.amountMicros) throw refused("insufficient_balance", "That's more than you have available. Held money stays held.");
      // Out of the balance first; if the provider refuses, a reversal puts it back.
      const { payoutId, entryId } = await db.transaction(async (tx) => {
        const entryId = await service.post(
          tx,
          "withdrawal",
          [
            { account: available, micros: -input.amountMicros },
            { account: await service.account(tx, "external", { label: "clear" }), micros: input.amountMicros }
          ],
          { sourceType: "withdrawal", memo: `Taken out to ${source.label}` }
        );
        const [payout] = await tx
          .insert(schema.payouts)
          .values({ accountId: available, amountMicros: input.amountMicros, destination: source.label, scheduledFor: deps.clock.now().toISOString().slice(0, 10), status: "scheduled", entryId })
          .returning();
        return { payoutId: payout.id, entryId: entryId! };
      });
      await sendPayout(payoutId, entryId, { type: "advertiser", id: businessId }, source.providerRef, input.amountMicros);
      await checkRunway(businessId);
      return { payoutId, balance: await service.balance(businessId) };
    },

    async statements(owner) {
      // E3: a business's statements are shaped as it reads them.
      if (owner.businessId) return businessMoney.businessStatements(owner.businessId);
      const accountIds = owner.businessId
        ? [await service.account(db, "advertiser_available", { advertiserId: owner.businessId })]
        : owner.stationId
          ? [await service.account(db, await stationAccountKind(owner.stationId), { stationId: owner.stationId })]
          : [];
      if (!accountIds.length) return [];
      const rows = await db.select().from(schema.statements).where(inArray(schema.statements.accountId, accountIds)).orderBy(desc(schema.statements.periodStart));
      const accountKind = owner.businessId ? "advertiser_available" : "station_earnings";
      // E3: the payout after each period (stations are paid after the week closes).
      const paid = await db
        .select()
        .from(schema.payouts)
        .where(and(inArray(schema.payouts.accountId, accountIds), inArray(schema.payouts.status, ["sent", "confirmed"])))
        .orderBy(asc(schema.payouts.scheduledFor));
      return rows.map((s) => {
        const payout = owner.stationId ? paid.find((p) => p.accountId === s.accountId && p.scheduledFor > s.periodEnd) : undefined;
        return {
          id: s.id,
          period: s.period,
          periodStart: s.periodStart,
          periodEnd: s.periodEnd,
          openingMicros: s.openingMicros,
          closingMicros: s.closingMicros,
          lines: (s.lines as StatementView["lines"]).map((l) => {
            const group = l.group ?? statementGroup(l.label, accountKind);
            const counted = /^(\d+) entr/.exec(l.detail ?? "");
            return { ...l, group, ...(l.airings === undefined && group === "spots" && counted && accountKind !== "advertiser_available" ? { airings: Number(counted[1]) } : {}) };
          }),
          issuedAt: s.issuedAt.toISOString(),
          csvUrl: `/v1/statements/${s.id}/csv`,
          pdfUrl: null,
          paidOn: payout?.scheduledFor ?? null,
          destination: payout?.destination ?? null
        };
      });
    },

    async stationEarnings(stationId, period) {
      const now = deps.clock.now();
      const from =
        period === "week"
          ? new Date(now.getTime() - 7 * DAY)
          : period === "month"
            ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
            : new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      const kind = await stationAccountKind(stationId);
      const account = await service.account(db, kind, { stationId });
      const rows = await db
        .select({ entry: E, amount: P.amountMicros })
        .from(E)
        .innerJoin(P, eq(P.entryId, E.id))
        .where(and(eq(P.accountId, account), gte(E.occurredAt, from), lt(E.occurredAt, now)));
      const sum = (pred: (e: typeof E.$inferSelect, amount: number) => boolean) => rows.filter((r) => pred(r.entry, r.amount)).reduce((s, r) => s + r.amount, 0);
      const spots = sum((e) => e.kind === "settle" && e.sourceType === "as_run");
      const sponsors = sum((e) => e.kind === "settle" && e.sourceType === "sponsorship_month");
      const production = sum((e) => e.kind === "settle" && e.sourceType === "production_order");
      const pledges = sum((e) => e.kind === "pledge");
      const carriageIn = sum((e, a) => (e.kind === "carriage_fee" || e.kind === "barter_split") && a > 0);
      const carriageOut = sum((e, a) => (e.kind === "carriage_fee" || e.kind === "barter_split") && a < 0);
      const config = await service.config();

      // Held for this station's upcoming airings.
      const tonightEnd = new Date(now.getTime() + 12 * 3_600_000);
      const weekEnd = new Date(now.getTime() + 7 * DAY);
      const upcoming = await services.spots.heldAirings(stationId, now, weekEnd);
      const open = await service.openAmount(upcoming.map((u) => u.holdId));
      const tonight = upcoming.filter((u) => u.scheduledAt < tonightEnd);
      const rest = upcoming.filter((u) => u.scheduledAt >= tonightEnd);
      const heldSum = (list: typeof upcoming) => list.reduce((s, u) => s + (open.get(u.holdId) ?? 0), 0);

      const payouts = await db
        .select({ sum: sql<string>`coalesce(sum(${schema.payouts.amountMicros}), 0)` })
        .from(schema.payouts)
        .where(and(eq(schema.payouts.accountId, account), gte(schema.payouts.createdAt, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)))));
      const nextMonday = new Date(now);
      nextMonday.setUTCDate(now.getUTCDate() + ((8 - now.getUTCDay()) % 7 || 7));
      const nextPayoutOn = config.payoutSchedule === "monthly" ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) : nextMonday;
      const settleCount = rows.filter((r) => r.entry.kind === "settle" && r.entry.sourceType === "as_run").length;
      const pledgeMembers = await service.memberCredits(stationId);
      // Opencast's share and the pool, from this station's own settlements (0 until decided).
      const settleIds = [...new Set(rows.filter((r) => r.entry.kind === "settle" && r.amount > 0).map((r) => r.entry.id))];
      const cuts = settleIds.length
        ? await db
            .select({ kind: L.kind, sum: sql<string>`coalesce(sum(${P.amountMicros}), 0)` })
            .from(P)
            .innerJoin(L, eq(L.id, P.accountId))
            .where(and(inArray(P.entryId, settleIds), inArray(L.kind, ["opencast_share", "pool"])))
            .groupBy(L.kind)
        : [];
      const cut = (kind: string) => Number(cuts.find((c) => c.kind === kind)?.sum ?? 0);
      const [joined] = await db
        .select({ n: sql<number>`count(distinct ${schema.pledges.userId})::int` })
        .from(schema.pledges)
        .where(and(eq(schema.pledges.stationId, stationId), gte(schema.pledges.startedAt, from)));
      const payoutAccount = kind === "escrow_owed" ? null : await service.payoutAccount(stationId).catch(() => null);
      const rule = await services.stations.breakRule(stationId);
      const [sponsorList, available] = await Promise.all([services.spots.activeSponsors(stationId), balanceOf([account])]);

      return {
        period,
        lines: {
          spots: { micros: spots, airings: settleCount, businesses: await services.spots.businessesAiredOn(stationId, from, now) },
          sponsors: { micros: sponsors, sponsors: await services.spots.activeSponsorCount(stationId), list: sponsorList },
          pledges: { micros: pledges, members: pledgeMembers.members, newMembers: joined.n },
          carriageIn: { micros: carriageIn, detail: "Your programs on other stations" },
          carriageOut: { micros: carriageOut, detail: "Programs you carry" },
          production: { micros: production, orders: rows.filter((r) => r.entry.sourceType === "production_order").length },
          opencastShare: { micros: -cut("opencast_share"), notSetYet: config.opencastSpotShareBps === 0 },
          pool: { micros: -cut("pool"), notSetYet: config.poolShareBps === 0 },
          // Paid when the partner pays (30 to 90 days after airing), so nothing is ever held for it.
          partnerAds: { on: rule.adsFromPartners, micros: 0, pendingMicros: 0 }
        },
        totalMicros: rows.reduce((s, r) => s + r.amount, 0),
        held: {
          tonightMicros: heldSum(tonight),
          tonightAirings: tonight.length,
          restOfWeekMicros: heldSum(rest),
          restOfWeekAirings: rest.length,
          tonightBreaks: new Set(tonight.map((t) => t.breakId)).size
        },
        account: { availableMicros: available, paidOutThisMonthMicros: Number(payouts[0].sum) },
        nextPayout:
          kind === "escrow_owed"
            ? null
            : {
                on: nextPayoutOn.toISOString().slice(0, 10),
                schedule: config.payoutSchedule,
                destination: payoutAccount?.status === "active" ? payoutAccount.destination.label : null,
                // E2: what it would pay if it went now.
                amountMicros: Math.max(0, available)
              }
      };
    },

    async moveToBank(stationId, micros) {
      return payoutStation(stationId, micros, "Moved to bank");
    },

    async pledge(userId, stationId, input) {
      const profile = (await services.stations.profiles([stationId])).get(stationId);
      if (!profile?.public) throw notFound("That station");
      const [row] = await db
        .insert(schema.pledges)
        .values({ userId, stationId, cadence: input.cadence, amountMicros: input.amountMicros, creditOnAir: input.creditOnAir, startedAt: deps.clock.now() })
        .returning();
      const started = await deps.payments.startPledge({
        pledgeId: row.id,
        stationId,
        stationName: profile.ident.name,
        amountMicros: input.amountMicros,
        cadence: input.cadence,
        returnUrl: `${deps.config.appOrigin}/stations/${stationId}`
      });
      await db
        .update(schema.pledges)
        .set({ stripeRef: started.providerRef, ...(started.card ? { cardLabel: started.card.label, cardExpiresOn: started.card.expiresOn } : {}) })
        .where(eq(schema.pledges.id, row.id));
      // Paid now (the fake), or when Stripe says so (the webhook).
      if (started.paidNow) await pledgeReceived(row.id, input.amountMicros, started.feeMicros, started.providerRef);
      return { pledge: (await service.pledges(userId)).find((p) => p.id === row.id)!, checkoutUrl: started.checkoutUrl };
    },

    async pledges(userId) {
      const rows = await db.select().from(schema.pledges).where(eq(schema.pledges.userId, userId)).orderBy(desc(schema.pledges.startedAt));
      const idents = await services.stations.idents(rows.map((r) => r.stationId));
      // Each payment is a pledge entry; what the person paid is what came in from the card network.
      const receipts = rows.length
        ? await db
            .select({
              id: E.id,
              pledgeId: E.sourceId,
              occurredAt: E.occurredAt,
              micros: sql<number>`sum(case when ${P.amountMicros} < 0 then -${P.amountMicros} else 0 end)::bigint`
            })
            .from(E)
            .innerJoin(P, eq(P.entryId, E.id))
            .where(and(eq(E.kind, "pledge"), inArray(E.sourceId, rows.map((r) => r.id))))
            .groupBy(E.id)
            .orderBy(desc(E.occurredAt))
        : [];
      const today = deps.clock.now().toISOString().slice(0, 10);
      return rows.flatMap((r) => {
        const station = idents.get(r.stationId);
        if (!station) return [];
        const items = receipts
          .filter((x) => x.pledgeId === r.id)
          .map((x) => ({ id: x.id, on: x.occurredAt.toISOString().slice(0, 10), amountMicros: Number(x.micros), url: null }));
        const count = items.length;
        const next = new Date(r.startedAt);
        next.setUTCMonth(next.getUTCMonth() + Math.max(1, count));
        return [
          {
            id: r.id,
            station,
            cadence: r.cadence,
            amountMicros: r.amountMicros,
            creditOnAir: r.creditOnAir,
            startedAt: r.startedAt.toISOString(),
            nextChargeOn: r.cadence === "monthly" && !r.endsAfter ? next.toISOString().slice(0, 10) : null,
            endsAfter: r.endsAfter,
            receipts: { count, totalMicros: items.reduce((sum, x) => sum + x.amountMicros, 0), items },
            card: r.cardLabel ? { label: r.cardLabel, expiresOn: r.cardExpiresOn, expired: Boolean(r.cardExpiresOn && r.cardExpiresOn < today) } : null
          }
        ];
      });
    },

    async updatePledge(userId, pledgeId, input) {
      const [row] = await db.select().from(schema.pledges).where(and(eq(schema.pledges.id, pledgeId), eq(schema.pledges.userId, userId)));
      if (!row) throw notFound("That pledge");
      const now = deps.clock.now();
      const today = now.toISOString().slice(0, 10);
      const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
      // E1: monthly or once. A monthly pledge set to once isn't charged again: it ends after this
      // month, like stopping. Set back to monthly before then, it carries on.
      let endsAfter: string | null | undefined = input.stop ? monthEnd : undefined;
      let end = Boolean(input.stop && row.cadence === "monthly");
      let resume = false;
      if (input.cadence === "monthly" && row.cadence === "once") throw refused("new_pledge_needed", "A one-time pledge can't become monthly. Pledge again, monthly.");
      if (input.cadence === "once" && row.cadence === "monthly" && !row.endsAfter) {
        endsAfter = monthEnd;
        end = true;
      }
      if (input.cadence === "monthly" && row.cadence === "monthly" && row.endsAfter && !input.stop) {
        if (row.endsAfter < today) throw refused("pledge_ended", "This pledge has ended. Pledge again to start it.");
        endsAfter = null;
        resume = true;
      }
      await db
        .update(schema.pledges)
        .set({
          ...(input.amountMicros !== undefined ? { amountMicros: input.amountMicros } : {}),
          ...(input.creditOnAir !== undefined ? { creditOnAir: input.creditOnAir } : {}),
          ...(endsAfter !== undefined ? { endsAfter } : {})
        })
        .where(eq(schema.pledges.id, pledgeId));
      if (end && row.stripeRef) await deps.payments.endPledge(row.stripeRef);
      if (resume && row.stripeRef) await deps.payments.resumePledge(row.stripeRef);
      return (await service.pledges(userId)).find((p) => p.id === pledgeId)!;
    },

    async pledgeCardSession(userId, pledgeId, returnTo) {
      const [row] = await db.select().from(schema.pledges).where(and(eq(schema.pledges.id, pledgeId), eq(schema.pledges.userId, userId)));
      if (!row) throw notFound("That pledge");
      if (row.cadence !== "monthly" || row.endsAfter || !row.stripeRef) {
        throw refused("no_card_to_change", row.cadence === "once" ? "A one-time pledge has nothing more to charge." : "This pledge isn't charged again.");
      }
      const returnUrl = `${deps.config.appOrigin.replace(/\/+$/, "")}${returnTo ?? `/you/pledges/${pledgeId}`}`;
      let session;
      try {
        session = await deps.payments.pledgeCardSession({ pledgeId, providerRef: row.stripeRef, returnUrl });
      } catch (error) {
        console.error("[ledger] card session failed", error);
        throw new HttpError(502, "provider_unavailable", "Couldn't open the card page just now. Try again in a moment.");
      }
      if (session.card) await db.update(schema.pledges).set({ cardLabel: session.card.label, cardExpiresOn: session.card.expiresOn }).where(eq(schema.pledges.id, pledgeId));
      return { url: session.url };
    },

    async stopPledgesOf(userId) {
      const now = deps.clock.now();
      const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
      const rows = await db
        .select()
        .from(schema.pledges)
        .where(and(eq(schema.pledges.userId, userId), eq(schema.pledges.cadence, "monthly"), isNull(schema.pledges.endsAfter)));
      for (const row of rows) {
        await db.update(schema.pledges).set({ endsAfter: monthEnd }).where(eq(schema.pledges.id, row.id));
        if (row.stripeRef) await deps.payments.endPledge(row.stripeRef).catch((error) => console.error(`[ledger] ending pledge ${row.id} at the provider failed`, error));
      }
    },

    checkRunway: (businessId) => checkRunway(businessId),

    async handlePaymentEvent(event) {
      switch (event.kind) {
        case "deposit_arrived":
          return service.completeDeposit(event.depositId);
        case "deposit_failed": {
          await db
            .update(schema.deposits)
            .set({ status: "failed" })
            .where(and(eq(schema.deposits.id, event.depositId), eq(schema.deposits.status, "pending")));
          return;
        }
        case "pledge_paid":
          if (event.card) await db.update(schema.pledges).set({ cardLabel: event.card.label, cardExpiresOn: event.card.expiresOn }).where(eq(schema.pledges.id, event.pledgeId));
          return pledgeReceived(event.pledgeId, event.amountMicros, event.feeMicros, event.providerRef);
        case "pledge_started":
          await db
            .update(schema.pledges)
            .set({ stripeRef: event.providerRef, ...(event.card ? { cardLabel: event.card.label, cardExpiresOn: event.card.expiresOn } : {}) })
            .where(eq(schema.pledges.id, event.pledgeId));
          return;
        case "pledge_card":
          await db.update(schema.pledges).set({ cardLabel: event.card.label, cardExpiresOn: event.card.expiresOn }).where(eq(schema.pledges.id, event.pledgeId));
          return;
        case "pledge_ended": {
          const today = deps.clock.now().toISOString().slice(0, 10);
          await db.update(schema.pledges).set({ endsAfter: today }).where(and(eq(schema.pledges.id, event.pledgeId), sql`${schema.pledges.endsAfter} is null`));
          return;
        }
        case "payout_confirmed":
        case "payout_failed": {
          const [payout] = await db.select().from(schema.payouts).where(eq(schema.payouts.providerRef, event.payoutRef));
          if (!payout || payout.status === "confirmed" || payout.status === "failed") return;
          if (event.kind === "payout_confirmed") {
            await db.update(schema.payouts).set({ status: "confirmed" }).where(eq(schema.payouts.id, payout.id));
            return;
          }
          // The bank sent it back: the money is ours again.
          await db.transaction(async (tx) => {
            if (payout.entryId) await reverse(tx, payout.entryId, "Payout returned by the bank");
            await tx.update(schema.payouts).set({ status: "failed" }).where(eq(schema.payouts.id, payout.id));
          });
          return;
        }
        case "account_ready": {
          if (event.owner.type === "opencast") return;
          await db
            .update(schema.providerAccounts)
            .set({ status: "active", onboardingUrl: null })
            .where(and(eq(schema.providerAccounts.ownerType, event.owner.type), eq(schema.providerAccounts.ownerId, event.owner.id)));
          return;
        }
      }
    },

    async payoutAccount(stationId) {
      const [chosen] = await db.select().from(schema.payoutDestinations).where(eq(schema.payoutDestinations.stationId, stationId));
      if (chosen?.kind === "clear_wallet" && chosen.clearLinkId) {
        // Only while it's still linked, and its person still owns the station.
        const link = await services.accounts.clearLinkById(chosen.clearLinkId);
        const owners = link ? await services.accounts.stationMemberIds(stationId, ["owner"]) : [];
        const usable = Boolean(link?.active && owners.includes(link.userId));
        const label = !link?.active ? "Clear wallet (not linked anymore)" : usable ? `Clear wallet ${shortAddress(link.address)}` : "Clear wallet (a former owner's)";
        return { status: usable ? "active" : "needs_onboarding", url: null, destination: { kind: "clear_wallet", label, address: link?.address ?? null } };
      }
      const ident = (await services.stations.idents([stationId])).get(stationId);
      const account = await deps.payments.payoutAccount({ type: "station", id: stationId, name: ident?.name ?? "Station" }, accountDirectory(db));
      const destination =
        deps.payments.name === "stripe_only"
          ? { kind: "stripe_connect" as const, label: "Stripe", address: null }
          : { kind: "clear_account" as const, label: "The station's Clear account", address: null };
      return { ...account, destination };
    },

    async setPayoutDestination(stationId, userId, kind) {
      if ((await stationAccountKind(stationId)) === "escrow_owed") throw refused("escrow", "A claimable station's earnings go to escrow.");
      let clearLinkId: string | null = null;
      if (kind === "clear_wallet") {
        clearRail();
        clearLinkId = (await linkedClear(userId)).id;
      }
      const values = { stationId, kind, clearLinkId, setBy: userId, updatedAt: deps.clock.now() };
      await db
        .insert(schema.payoutDestinations)
        .values(values)
        .onConflictDoUpdate({ target: schema.payoutDestinations.stationId, set: { kind, clearLinkId, setBy: userId, updatedAt: values.updatedAt } });
      return service.payoutAccount(stationId);
    },

    sendMoves: () => sendMoves(deps),

    async escrowWeekly() {
      const chain = deps.chain;
      if (!chain) return null;
      const D = schema.escrowDeposits;
      type Item = { stationId: string; escrowId: number; amountMicros: number };
      const confirm = async (depositId: string, items: Item[], txHash: string) => {
        await db.transaction(async (tx) => {
          const lines = [];
          for (const i of items) {
            lines.push({ account: await service.account(tx, "escrow_owed", { stationId: i.stationId }), micros: -i.amountMicros });
            lines.push({ account: await service.account(tx, "escrow", { stationId: i.stationId }), micros: i.amountMicros });
          }
          const entryId = await service.post(tx, "escrow_deposit", lines, { sourceType: "escrow_deposit", sourceId: depositId, memo: `Weekly deposit into escrow (${txHash.slice(0, 10)}…)`, idempotencyKey: `escrow-deposit:${depositId}` });
          await tx.update(D).set({ status: "confirmed", confirmedAt: deps.clock.now(), entryId }).where(eq(D.id, depositId));
        });
      };

      // A batch sent but not recorded (a crash in between) is recorded, never sent again.
      const [unfinished] = await db.select().from(D).where(and(eq(D.status, "sent"), sql`${D.entryId} is null`)).limit(1);
      if (unfinished?.txHash) {
        await confirm(unfinished.id, unfinished.items as Item[], unfinished.txHash);
        return { stations: (unfinished.items as Item[]).length, micros: (unfinished.items as Item[]).reduce((s, i) => s + i.amountMicros, 0), txHash: unfinished.txHash };
      }
      const [sending] = await db.select().from(D).where(eq(D.status, "sending")).limit(1);
      if (sending) throw refused("escrow_in_flight", "An escrow deposit was being sent when something stopped; check it on-chain before sending another.");

      const owed = await db
        .select({ stationId: L.stationId, sum: sql<string>`coalesce(sum(${P.amountMicros}), 0)` })
        .from(L)
        .innerJoin(P, eq(P.accountId, L.id))
        .where(eq(L.kind, "escrow_owed"))
        .groupBy(L.stationId);
      const positive = owed.filter((o) => Number(o.sum) > 0);
      if (!positive.length) return { stations: 0, micros: 0, txHash: "" };
      const profiles = await services.stations.profiles(positive.map((o) => o.stationId!));
      const items: Item[] = positive.map((o) => ({ stationId: o.stationId!, escrowId: profiles.get(o.stationId!)!.escrowId, amountMicros: Number(o.sum) }));
      const [row] = await db.insert(D).values({ chainId: chain.chainId, contractAddress: chain.escrow, items, status: "sending" }).returning();
      let txHash: string;
      try {
        txHash = (await chain.depositBatch(items.map((i) => ({ escrowId: i.escrowId, amountMicros: i.amountMicros })))).txHash;
      } catch (error) {
        await db.update(D).set({ status: "failed", error: (error as Error).message.slice(0, 500) }).where(eq(D.id, row.id));
        throw error;
      }
      await db.update(D).set({ status: "sent", txHash, chainId: chain.chainId }).where(eq(D.id, row.id));
      await confirm(row.id, items, txHash);
      return { stations: items.length, micros: items.reduce((s, i) => s + i.amountMicros, 0), txHash };
    },

    async syncChain() {
      const chain = deps.chain;
      if (!chain) return null;
      const C = schema.chainCursor;
      const [cursor] = await db.select().from(C).where(eq(C.name, "escrow"));
      const { toBlock, events } = await chain.events(cursor ? cursor.block + 1n : 0n);
      const stations = await services.stations.byEscrowIds([...new Set(events.map((e) => e.escrowId))]);
      for (const event of events) {
        const stationId = stations.get(event.escrowId);
        if (!stationId) continue;
        const key = `chain:${event.tx}:${event.logIndex}`;
        // Money that left the escrow: to the creator (claim, stop, or a later deposit forwarded to them) or to the fund.
        const out =
          event.type === "paid" && event.amountMicros > 0
            ? { micros: event.amountMicros, toFund: event.reason === "unclaimed", kind: event.reason === "unclaimed" ? ("escrow_unclaimed" as const) : event.reason === "stop" ? ("escrow_stop" as const) : ("escrow_claim" as const) }
            : event.type === "deposited" && event.forwardedTo
              ? { micros: event.amountMicros, toFund: event.forwardedTo.toLowerCase() === (chain.fund ?? "").toLowerCase(), kind: "escrow_claim" as const }
              : null;
        const [seen] = out ? await db.select({ id: E.id }).from(E).where(eq(E.idempotencyKey, key)) : [];
        if (out && !seen) {
          const claimant = out.toFund ? null : await services.network.claimantOf(stationId);
          if (!out.toFund && !claimant) {
            console.error(`[escrow] ${key}: paid a creator for station ${stationId}, but no approved claim names who; not recorded`);
          } else {
            await db.transaction(async (tx) => {
              const to = out.toFund ? await service.account(tx, "creator_fund") : await service.account(tx, "creator", { stationId, userId: claimant!.userId });
              await service.post(
                tx,
                out.toFund ? "escrow_unclaimed" : out.kind,
                [
                  { account: await service.account(tx, "escrow", { stationId }), micros: -out.micros },
                  { account: to, micros: out.micros }
                ],
                { sourceType: "chain", memo: out.toFund ? "Unclaimed: paid to the creator fund" : "Paid to the creator", idempotencyKey: key }
              );
            });
          }
        }
        await services.network.onEscrowEvent(stationId, event);
      }
      await db
        .insert(C)
        .values({ name: "escrow", block: toBlock, updatedAt: deps.clock.now() })
        .onConflictDoUpdate({ target: C.name, set: { block: toBlock, updatedAt: deps.clock.now() } });
      return { events: events.length };
    },

    async runPayouts() {
      const rows = await db
        .select({ stationId: L.stationId, sum: sql<string>`coalesce(sum(${P.amountMicros}), 0)` })
        .from(L)
        .innerJoin(P, eq(P.accountId, L.id))
        .where(eq(L.kind, "station_earnings"))
        .groupBy(L.stationId);
      let paid = 0;
      let micros = 0;
      let waiting = 0;
      const week = deps.clock.now().toISOString().slice(0, 10);
      for (const row of rows) {
        const amount = Number(row.sum);
        // Under a dollar waits for next time; a station owing carriage fees isn't paid.
        if (amount < 1_000_000) continue;
        const account = await service.payoutAccount(row.stationId!);
        if (account.status !== "active") {
          waiting++;
          continue;
        }
        await payoutStation(row.stationId!, amount, "Weekly payout", `payout:${row.stationId}:${week}`).catch((error) => {
          console.error(`[ledger] payout to ${row.stationId} failed`, error);
          waiting++;
        });
        paid++;
        micros += amount;
      }
      return { paid, micros, waiting };
    },

    async distributePool(monthStart) {
      const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
      const month = monthStart.toISOString().slice(0, 7);
      const poolAccount = await service.account(db, "pool");
      const pool = await balanceOf([poolAccount]);
      const config = await service.config(monthStart);
      if (pool <= 0) return { micros: 0, stations: 0, fundMicros: 0 };
      const base = Math.floor((pool * config.poolBaseBps) / BPS);
      const watch = Math.floor((pool * config.poolWatchTimeBps) / BPS);
      // The fund's share goes on-chain to the creator fund, so it waits until the chain is set up.
      const fund = deps.chain?.fund ? Math.floor((pool * config.poolFundBps) / BPS) : 0;
      const aired = await services.playout.stationsThatAired(monthStart, monthEnd);
      const minutes = await services.audience.watchMinutes(monthStart, monthEnd);
      const totalMinutes = aired.reduce((s, id) => s + (minutes.get(id) ?? 0), 0);
      const shares = new Map<string, number>();
      for (const id of aired) {
        const b = aired.length ? Math.floor(base / aired.length) : 0;
        const w = totalMinutes ? Math.floor((watch * (minutes.get(id) ?? 0)) / totalMinutes) : 0;
        if (b + w > 0) shares.set(id, b + w);
      }
      const paidOut = [...shares.values()].reduce((s, v) => s + v, 0) + fund;
      if (paidOut <= 0) return { micros: 0, stations: 0, fundMicros: 0 };
      await db.transaction(async (tx) => {
        const lines = [{ account: poolAccount, micros: -paidOut }];
        for (const [stationId, micros] of shares) lines.push({ account: await service.account(tx, await stationAccountKind(stationId), { stationId }), micros });
        if (fund) lines.push({ account: await service.account(tx, "creator_fund"), micros: fund });
        await service.post(tx, "pool", lines, { sourceType: "pool", memo: `The pool for ${month}`, idempotencyKey: `pool:${month}` });
      });
      if (fund && deps.chain) await deps.chain.contribute(fund, `pool:${month}`);
      return { micros: paidOut, stations: shares.size, fundMicros: fund };
    },

    async issueStatements(period, start) {
      const end = period === "week" ? new Date(start.getTime() + 7 * DAY) : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
      const kinds = period === "week" ? (["station_earnings", "escrow_owed"] as const) : (["advertiser_available"] as const);
      const accounts = await db.select().from(L).where(inArray(L.kind, [...kinds]));
      const config = await service.config(start);
      let issued = 0;
      for (const account of accounts) {
        const rows = await db
          .select({ entry: E, amount: P.amountMicros })
          .from(P)
          .innerJoin(E, eq(E.id, P.entryId))
          .where(and(eq(P.accountId, account.id), lt(E.occurredAt, end)));
        const opening = rows.filter((r) => r.entry.occurredAt < start).reduce((s, r) => s + r.amount, 0);
        const inPeriod = rows.filter((r) => r.entry.occurredAt >= start);
        if (!inPeriod.length && opening === 0) continue;
        const lines = new Map<string, { label: string; detail: string | null; amountMicros: number; count: number }>();
        for (const r of inPeriod) {
          const label = statementLabel(r.entry.kind, r.entry.sourceType, r.amount, account.kind);
          const line = lines.get(label) ?? { label, detail: null, amountMicros: 0, count: 0 };
          line.amountMicros += r.amount;
          line.count++;
          lines.set(label, line);
        }
        const out: StatementView["lines"] = [...lines.values()].map((l) => {
          const group = statementGroup(l.label, account.kind);
          return {
            label: l.label,
            detail: `${l.count} ${l.count === 1 ? "entry" : "entries"}`,
            amountMicros: l.amountMicros,
            notSetYet: false,
            // E3: each settled spot entry is one airing.
            group,
            ...(group === "spots" && account.kind !== "advertiser_available" ? { airings: l.count } : {})
          };
        });
        if (account.kind !== "advertiser_available") out.push({ label: "Opencast's share", detail: null, amountMicros: 0, notSetYet: config.opencastSpotShareBps === 0, group: "shared" });
        const [row] = await db
          .insert(schema.statements)
          .values({
            accountId: account.id,
            period,
            periodStart: start.toISOString().slice(0, 10),
            periodEnd: new Date(end.getTime() - DAY).toISOString().slice(0, 10),
            lines: out,
            openingMicros: opening,
            closingMicros: opening + inPeriod.reduce((s, r) => s + r.amount, 0),
            issuedAt: deps.clock.now()
          })
          .onConflictDoNothing()
          .returning({ id: schema.statements.id });
        if (row) issued++;
      }
      return issued;
    },

    async statementCsv(statementId) {
      const [stored] = await db.select().from(schema.statements).where(eq(schema.statements.id, statementId));
      // A business's statement for this month, so far: its id is the business's balance account.
      const [current] = stored ? [] : await db.select().from(L).where(and(eq(L.id, statementId), eq(L.kind, "advertiser_available")));
      if (!stored && !current) throw notFound("That statement");
      const now = deps.clock.now();
      const statement = stored ?? {
        accountId: current.id,
        period: "month" as const,
        periodStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10),
        periodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
      };
      const [account] = await db.select().from(L).where(eq(L.id, statement.accountId));
      const start = new Date(`${statement.periodStart}T00:00:00Z`);
      const end = new Date(new Date(`${statement.periodEnd}T00:00:00Z`).getTime() + DAY);
      const rows = await db
        .select({ entry: E, amount: P.amountMicros })
        .from(P)
        .innerJoin(E, eq(E.id, P.entryId))
        .where(and(eq(P.accountId, statement.accountId), gte(E.occurredAt, start), lt(E.occurredAt, end)))
        .orderBy(asc(E.occurredAt));
      const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
      const csv = [
        "date,what,memo,amount_usd,entry_id",
        ...rows.map((r) =>
          [r.entry.occurredAt.toISOString(), statementLabel(r.entry.kind, r.entry.sourceType, r.amount, account.kind), r.entry.memo ?? "", (r.amount / 1_000_000).toFixed(2), r.entry.id].map((v) => cell(String(v))).join(",")
        )
      ].join("\n");
      return { owner: { businessId: account.advertiserId, stationId: account.stationId }, filename: `opencast-${statement.period}-${statement.periodStart}.csv`, csv: `${csv}\n` };
    },

    async renewPledges() {
      if (deps.payments.name !== "fake") return 0;
      const now = deps.clock.now();
      const rows = await db.select().from(schema.pledges).where(eq(schema.pledges.cadence, "monthly"));
      let renewed = 0;
      for (const pledge of rows) {
        if (pledge.endsAfter && pledge.endsAfter < now.toISOString().slice(0, 10)) continue;
        const months = (now.getUTCFullYear() - pledge.startedAt.getUTCFullYear()) * 12 + now.getUTCMonth() - pledge.startedAt.getUTCMonth() - (now.getUTCDate() < pledge.startedAt.getUTCDate() ? 1 : 0);
        for (let m = 1; m <= months; m++) {
          const due = new Date(Date.UTC(pledge.startedAt.getUTCFullYear(), pledge.startedAt.getUTCMonth() + m, pledge.startedAt.getUTCDate()));
          await pledgeReceived(pledge.id, pledge.amountMicros, stripeCardFeeMicros(pledge.amountMicros), `${pledge.id}:${due.toISOString().slice(0, 7)}`);
          renewed++;
        }
      }
      return renewed;
    },

    async custodyBalances() {
      const rows = await db
        .select({ account: L, holdAdvertiserId: H.advertiserId, micros: P.amountMicros })
        .from(P)
        .innerJoin(L, eq(L.id, P.accountId))
        .leftJoin(H, eq(H.id, P.holdId));
      const result = new Map<string, number>();
      for (const r of rows) {
        const wallet = deps.payments.custody(
          { kind: r.account.kind, advertiserId: r.account.advertiserId, stationId: r.account.stationId, userId: r.account.userId, label: r.account.label },
          r.holdAdvertiserId
        );
        if (wallet) result.set(wallet, (result.get(wallet) ?? 0) + r.micros);
      }
      return result;
    },

    async escrowBalances(stationIds) {
      const result = new Map<string, { owed: number; held: number }>(stationIds.map((id) => [id, { owed: 0, held: 0 }]));
      if (!stationIds.length) return result;
      const rows = await db
        .select({ stationId: L.stationId, kind: L.kind, sum: sql<string>`coalesce(sum(${P.amountMicros}), 0)` })
        .from(L)
        .leftJoin(P, eq(P.accountId, L.id))
        .where(and(inArray(L.stationId, stationIds), inArray(L.kind, ["escrow_owed", "escrow"])))
        .groupBy(L.stationId, L.kind);
      for (const r of rows) {
        const entry = result.get(r.stationId!)!;
        if (r.kind === "escrow_owed") entry.owed = Number(r.sum);
        else entry.held = Number(r.sum);
      }
      return result;
    },

    async everMovedToOpencast() {
      const rows = await db.execute<{ sum: string }>(sql`
        select coalesce(sum(p.amount_micros), 0) as sum
        from ledger.postings p
        join ledger.accounts a on a.id = p.account_id and a.kind in ('opencast_share', 'pool', 'opencast_absorbed')
        where p.entry_id in (
          select q.entry_id from ledger.postings q join ledger.accounts b on b.id = q.account_id
          where b.kind = 'escrow' and q.amount_micros < 0)`);
      return Number(rows.rows[0].sum);
    },

    async costsOfAsRun(asRunIds) {
      if (!asRunIds.length) return new Map();
      const rows = await db
        .select({ asRunId: E.sourceId, micros: sql<string>`sum(${P.amountMicros})` })
        .from(E)
        .innerJoin(P, eq(P.entryId, E.id))
        .innerJoin(L, eq(L.id, P.accountId))
        .where(and(eq(E.kind, "settle"), eq(E.sourceType, "as_run"), inArray(E.sourceId, asRunIds), inArray(L.kind, ["station_earnings", "escrow_owed", "opencast_share", "pool"])))
        .groupBy(E.sourceId);
      return new Map(rows.map((r) => [r.asRunId!, Number(r.micros)]));
    },

    async spotSpend(spotIds, dayStart) {
      const result = new Map<string, { used: number; usedToday: number }>(spotIds.map((id) => [id, { used: 0, usedToday: 0 }]));
      if (!spotIds.length) return result;
      const holds = await db.select().from(H).where(inArray(H.spotId, spotIds));
      if (!holds.length) return result;
      const holdIds = holds.map((h) => h.id);
      const open = await service.openAmount(holdIds);
      // Paid out of each hold, plus anything drawn from available in the same settlement.
      const paid = await db.execute<{ hold_id: string; paid: string }>(sql`
        select h.hold_id, sum(-p.amount_micros) as paid
        from (select distinct entry_id, hold_id from ledger.postings where hold_id in ${holdIds}) h
        join ledger.entries e on e.id = h.entry_id and e.kind = 'settle'
        join ledger.postings p on p.entry_id = e.id and p.amount_micros < 0
        join ledger.accounts a on a.id = p.account_id and a.kind in ('holds', 'advertiser_available')
        where p.hold_id = h.hold_id or p.hold_id is null
        group by h.hold_id`);
      const paidBy = new Map(paid.rows.map((r) => [r.hold_id, Number(r.paid)]));
      for (const hold of holds) {
        const used = (open.get(hold.id) ?? 0) + (paidBy.get(hold.id) ?? 0);
        const entry = result.get(hold.spotId!)!;
        entry.used += used;
        if (hold.createdAt >= dayStart) entry.usedToday += used;
      }
      return result;
    },

    async memberCredits(stationId) {
      const today = deps.clock.now().toISOString().slice(0, 10);
      const rows = await db
        .select({ userId: schema.pledges.userId, creditOnAir: schema.pledges.creditOnAir })
        .from(schema.pledges)
        .where(and(eq(schema.pledges.stationId, stationId), sql`(${schema.pledges.endsAfter} is null or ${schema.pledges.endsAfter} >= ${today})`));
      const members = new Set(rows.map((r) => r.userId));
      const names = await services.accounts.displayNames(rows.filter((r) => r.creditOnAir).map((r) => r.userId));
      return { members: members.size, named: [...names.values()].filter((n): n is string => Boolean(n)) };
    }
  } as LedgerService;

  const businessMoney = createBusinessMoney({ deps, services }, service);
  Object.assign(service, businessMoney);

  async function firstActivity(businessId: string): Promise<Date> {
    return (await services.spots.moneySettings(businessId))?.createdAt ?? deps.clock.now();
  }

  return service;
}
