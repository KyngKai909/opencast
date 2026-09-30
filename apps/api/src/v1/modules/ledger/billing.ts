// Pay-as-you-go for stations (added 2026-09-29, follow-up Phase 2). Part of the ledger module: it
// owns ledger.usage_days, ledger.station_billing and ledger.usage_bills, and posts to the ledger.
//
// One channel per station, and being on air is free. A station pays for what costs Opencast the
// most (docs/pricing.md): storage (originals and prepared segments together, GB a month, measured
// daily and averaged), relays of everything it airs (per hour, per station, however many
// platforms), and live hours through Livepeer. Relays of live shows only are free; radio live
// through the worker's own ingest is its own type, free by default (Open).
//
// Through the month:
//   - every hour, today's usage is measured again (usage_days); a cap reached pauses that usage;
//   - each day is closed the next day (UTC): its charge after the free allowance, at that day's
//     price (rules with effective dates), never past the cap, is accrued in one `usage` entry:
//     usage_owed (the station's) −, usage_billed (Opencast's) +. No money moves.
//   - before every payout, what's owed is taken from the station's earnings first (`usage_payment`:
//     station_earnings −, usage_owed +, usage_billed −, opencast_usage +, which the outbox moves
//     from the station's account to Opencast's treasury).
// At month end the bill is closed (rounded to the cent), earnings pay what they can, and the rest
// is charged to the station's funding source: the owner's linked Clear wallet (full access; the
// owner approves the transfer on Clear's page) or its card (an off-session Stripe PaymentIntent).
// Nothing to charge, a declined card or a Clear payment waiting: the grace period starts (14 days,
// `billing.grace`); relays and live hours keep going until it ends, then pause until it's paid.
// The channel never pauses. The owners are told at each step (`station.account`).

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import { CARD_MINIMUM_MICROS, USAGE_TYPE_ORDER, USAGE_TYPES, type StationAccount, type UsageBill, type UsageLine, type UsageType, type UsageTypeDef } from "@opencast/contracts";
import type { Executor, ModuleContext } from "../../context.js";
import type { Events } from "../../events.js";
import type { CurrentUser } from "../../http.js";
import { badRequest, conflict, HttpError, refused } from "../../errors.js";
import type { PaymentEvent, StationCardRail } from "../../payments/index.js";
import type { ClearLinkView } from "../accounts/service.js";
import { accountDirectory } from "./moves.js";
import type { StatementView } from "./service.js";
import {
  DAY_MS,
  dayCharge,
  dayOf,
  daysInMonth,
  floorCent,
  monthCharge,
  monthEstimate,
  monthKey,
  monthStartOf,
  nextMonthStart,
  startOfDay,
  toCent,
  unionHours,
  type MonthCharge
} from "./usageMath.js";

/** What's paused for a station now. Never its channel. */
export interface PausedUsage {
  relays: boolean;
  liveHours: boolean;
  radioLive: boolean;
  storage: boolean;
}

export interface BillingTickResult {
  metered: number;
  closedDays: number;
  closedMonths: number;
  grace: { warned: number; paused: number } | null;
  clearPayments: number;
}

type StatementLine = StatementView["lines"][number];

export interface BillingService {
  /** What's paused for the station (relays, live hours, storage), read by playout, translators and uploads. */
  paused(stationId: string): Promise<PausedUsage>;
  /** 409 `storage_paused` when storage is at its cap this month. */
  requireStorage(stationId: string): Promise<void>;

  account(stationId: string, user: CurrentUser, owner: boolean): Promise<StationAccount>;
  setCaps(stationId: string, user: CurrentUser, caps: Partial<Record<UsageType, number | null>>): Promise<StationAccount>;
  startCardSetup(stationId: string): Promise<{ setupIntentId: string; clientSecret: string; publishableKey: string | null }>;
  saveCard(stationId: string, user: CurrentUser | null, setupIntentId: string): Promise<StationAccount | null>;
  removeCard(stationId: string, user: CurrentUser): Promise<StationAccount>;
  setFunding(stationId: string, user: CurrentUser, source: "clear" | "card"): Promise<StationAccount>;
  payNow(stationId: string, user: CurrentUser): Promise<StationAccount>;
  quoteClearPayment(stationId: string, user: CurrentUser): Promise<{ to: string; token: { address: string; symbol: "USDC"; decimals: 6 }; chainId: number; amountMicros: number; amountUnits: string; from: string }>;
  confirmClearPayment(stationId: string, user: CurrentUser, input: { amountMicros: number; txHash: string }): Promise<StationAccount>;

  /** Measures a day's usage to `until` (today's, hourly; a finished day's, once more before it's closed). */
  meterDay(day: string, until: Date, options?: { storage?: "always" | "if_missing" }): Promise<number>;
  /** Closes a finished day: each station's charges, accrued in one `usage` entry. */
  closeDay(day: string): Promise<number>;
  /** Closes a finished month's bills: rounded, paid from earnings, then the funding source, or grace. */
  closeMonth(monthStart: Date): Promise<number>;
  /** Grace periods: the warning before the end, then relays and live hours paused. */
  graceSteps(): Promise<{ warned: number; paused: number }>;
  /** Caps reached this month pause their usage (and tell the owners). */
  checkCaps(): Promise<number>;
  /** The jobs tick: hourly metering, and at each UTC day's end closing days, months and grace steps. */
  tick(): Promise<BillingTickResult>;
  /** Takes usage owed from stations' earnings (all, or one), before a payout. */
  collectFromEarnings(stationId?: string): Promise<{ stations: number; micros: number }>;
  /** What a station owes for usage now (this month's accrued and anything due). */
  owedMicros(stationId: string): Promise<number>;
  /** The usage section of a station's statement for [start, end). */
  statementLines(stationId: string, start: Date, end: Date): Promise<StatementLine[]>;
  handlePaymentEvent(event: Extract<PaymentEvent, { kind: "usage_paid" | "usage_failed" | "station_card_saved" }>): Promise<void>;
  /** Transfers from Clear wallets that weren't mined yet when they were confirmed. */
  recheckClearPayments(): Promise<number>;
}

const UD = schema.usageDays;
const SB = schema.stationBilling;
const UB = schema.usageBills;
const E = schema.entries;
const P = schema.postings;
const L = schema.accountsTable;

/** Who pays: independent stations and studios. Claimable stations (Opencast runs them), listed city streams and the catalog station don't (Open). */
const BILLED_KINDS = new Set(["station", "studio"]);
const CAPPABLE = USAGE_TYPE_ORDER.filter((t) => USAGE_TYPES[t].cappable);

const dollars = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;
const monthName = (monthStart: Date) => new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(monthStart);
const dateLabel = (at: Date) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(at);
const round2 = (n: number) => Math.round(n * 100) / 100;
/** Quantities as shown: to a millionth (a day's GB over the month adds float noise). */
const q6 = (n: number) => Math.round(n * 1e6) / 1e6;

function quantityText(def: UsageTypeDef, quantity: number) {
  if (def.unit === "gb_month") return `${quantity.toFixed(2)} GB-months`;
  const h = round2(quantity);
  return `${h} ${h === 1 ? "hour" : "hours"}`;
}

function priceText(def: UsageTypeDef, price: number | null) {
  if (price === null) return "price not set yet";
  if (price === 0) return "free";
  const p = `$${(price / 1_000_000).toFixed(price % 10_000 ? 3 : 2)}`;
  return def.unit === "gb_month" ? `at ${p} a GB-month` : `at ${p} an hour`;
}

export function createBillingService({ deps, services }: ModuleContext): BillingService {
  const { db } = deps;

  // ---------- rules: prices by day, the allowance by month, the grace period ----------

  const priceCache = new Map<string, number | null>();
  async function priceOn(type: UsageType, at: Date): Promise<number | null> {
    const def = USAGE_TYPES[type];
    if (!def.priceRule || !def.priceField) return 0;
    const key = `${type}:${at.toISOString()}`;
    if (priceCache.has(key)) return priceCache.get(key)!;
    const value = (await services.settings.valueAt(def.priceRule, at)) as Record<string, number | null>;
    const price = value[def.priceField] ?? null;
    // Only past days are cached (a price set for today or later may still be added).
    if (at.getTime() < deps.clock.now().getTime() - DAY_MS) priceCache.set(key, price);
    return price;
  }

  async function allowanceOf(monthStart: Date) {
    return services.settings.valueAt("prices.free_allowance", monthStart);
  }
  const allowanceFor = (type: UsageType, a: { storageGb: number; liveHours: number }) => (USAGE_TYPES[type].allowanceField ? a[USAGE_TYPES[type].allowanceField!] : 0);

  // ---------- rows ----------

  async function billingRow(stationId: string, tx: Executor = db) {
    const [row] = await tx.select().from(SB).where(eq(SB.stationId, stationId));
    return row ?? null;
  }

  async function ensureRow(tx: Executor, stationId: string) {
    await tx.insert(SB).values({ stationId }).onConflictDoNothing();
    const [row] = await tx.select().from(SB).where(eq(SB.stationId, stationId));
    return row;
  }

  async function ensureBill(tx: Executor, stationId: string, monthStart: Date) {
    const month = dayOf(monthStart);
    await tx.insert(UB).values({ stationId, month }).onConflictDoNothing();
    const [bill] = await tx.select().from(UB).where(and(eq(UB.stationId, stationId), eq(UB.month, month)));
    return bill;
  }

  async function monthRows(stationId: string, monthStart: Date, throughDay?: string) {
    return db
      .select()
      .from(UD)
      .where(and(eq(UD.stationId, stationId), gte(UD.day, dayOf(monthStart)), lt(UD.day, dayOf(nextMonthStart(monthStart))), throughDay ? lte(UD.day, throughDay) : undefined))
      .orderBy(asc(UD.day));
  }

  type DayRowDb = typeof UD.$inferSelect;

  async function typeCharge(type: UsageType, rows: DayRowDb[], monthStart: Date, capMicros: number | null, allowance: { storageGb: number; liveHours: number }): Promise<MonthCharge> {
    const def = USAGE_TYPES[type];
    const dayRows = [];
    for (const r of rows) dayRows.push({ quantity: r.quantity, priceMicros: await priceOn(type, startOfDay(r.day)) });
    return monthCharge({ unit: def.unit, monthDays: daysInMonth(monthStart), allowance: allowanceFor(type, allowance), rows: dayRows, capMicros: def.cappable ? capMicros : null });
  }

  /** A station's `usage_owed` account, if it has one (reading never makes one). */
  async function owedAccount(stationId: string): Promise<string | null> {
    const [row] = await db.select({ id: L.id }).from(L).where(and(eq(L.kind, "usage_owed"), eq(L.stationId, stationId)));
    return row?.id ?? null;
  }

  const capOf = (row: { caps: Record<string, number | null> } | null, type: UsageType) => {
    const v = row?.caps?.[type];
    return typeof v === "number" ? v : null;
  };

  /** A station's money per bill: accrued, and paid from earnings, Clear and card. */
  async function billTotals(billIds: string[]) {
    const out = new Map<string, { accrued: number; earnings: number; clear: number; card: number; other: number }>();
    for (const id of billIds) out.set(id, { accrued: 0, earnings: 0, clear: 0, card: 0, other: 0 });
    if (!billIds.length) return out;
    const rows = await db.execute<{ bill_id: string; kind: string; owed: string; payer: number }>(sql`
      select e.source_id as bill_id, e.kind,
        sum(case when a.kind = 'usage_owed' then p.amount_micros else 0 end) as owed,
        max(case when a.kind = 'station_earnings' then 1 when a.kind = 'external' and a.label = 'stripe' then 2 when a.kind = 'external' and a.label = 'clear' then 3 else 0 end) as payer
      from ${E} e join ${P} p on p.entry_id = e.id join ${L} a on a.id = p.account_id
      where e.source_type = 'usage_bill' and e.source_id in ${billIds}
      group by e.id, e.source_id, e.kind`);
    for (const r of rows.rows) {
      const t = out.get(r.bill_id)!;
      const owed = Number(r.owed);
      if (r.kind === "usage") t.accrued += -owed;
      else if (Number(r.payer) === 1) t.earnings += owed;
      else if (Number(r.payer) === 2) t.card += owed;
      else if (Number(r.payer) === 3) t.clear += owed;
      else t.other += owed;
    }
    return out;
  }
  const dueFrom = (t: { accrued: number; earnings: number; clear: number; card: number; other: number }) => t.accrued - t.earnings - t.clear - t.card - t.other;

  /** Bills with something still to pay, oldest first (`open` too, when asked: this month's accruals, at a payout). */
  async function billsOwing(stationId: string | null, withOpen: boolean, tx: Executor = db) {
    const bills = await tx
      .select()
      .from(UB)
      .where(and(stationId ? eq(UB.stationId, stationId) : undefined, inArray(UB.status, withOpen ? ["open", "due"] : ["due"])))
      .orderBy(asc(UB.month));
    const totals = await billTotals(bills.map((b) => b.id));
    return bills.map((b) => ({ bill: b, due: dueFrom(totals.get(b.id)!) })).filter((b) => b.due > 0);
  }

  async function stationName(stationId: string) {
    const ident = (await services.stations.idents([stationId])).get(stationId);
    return ident ? `${ident.callSign ?? ident.name}${ident.channel ? ` ${ident.channel}` : ""}` : "Station";
  }

  /** Notices held back while a month closes, so the month's summary comes first. */
  let held: Array<Events["station.account"]> | null = null;
  function tell(stationId: string, step: Events["station.account"]["step"], title: string, body: string, dedupeKey: string) {
    const notice = { stationId, step, title, body, dedupeKey };
    if (held) held.push(notice);
    else deps.bus.emit("station.account", notice);
  }

  function cards(): StationCardRail {
    const rail = deps.payments.stationCards;
    if (!rail) throw conflict("cards_unavailable", "Cards aren't set up on this server.");
    return rail;
  }

  // ---------- postings ----------

  async function postPayment(tx: Executor, input: { stationId: string; billId: string; micros: number; from: { kind: "station_earnings" } | { kind: "external"; label: "stripe" | "clear" }; memo: string; key?: string }) {
    const payer =
      input.from.kind === "station_earnings"
        ? await services.ledger.account(tx, "station_earnings", { stationId: input.stationId })
        : await services.ledger.account(tx, "external", { label: input.from.label });
    return services.ledger.post(
      tx,
      "usage_payment",
      [
        { account: payer, micros: -input.micros },
        { account: await services.ledger.account(tx, "usage_owed", { stationId: input.stationId }), micros: input.micros },
        { account: await services.ledger.account(tx, "usage_billed"), micros: -input.micros },
        { account: await services.ledger.account(tx, "opencast_usage"), micros: input.micros }
      ],
      { sourceType: "usage_bill", sourceId: input.billId, memo: input.memo, idempotencyKey: input.key }
    );
  }

  /** Closed bills with nothing left to pay are paid. */
  async function refreshBills(stationId: string) {
    const bills = await db.select().from(UB).where(and(eq(UB.stationId, stationId), eq(UB.status, "due")));
    const totals = await billTotals(bills.map((b) => b.id));
    for (const b of bills) {
      if (dueFrom(totals.get(b.id)!) <= 0) await db.update(UB).set({ status: "paid", paidAt: deps.clock.now(), lastFailure: null, clearTxHash: null, clearAmountMicros: null }).where(eq(UB.id, b.id));
    }
  }

  async function totalDue(stationId: string) {
    return (await billsOwing(stationId, false)).reduce((s, b) => s + b.due, 0);
  }

  // ---------- standing: grace, paused, resumed ----------

  async function graceRule(at: Date) {
    return services.settings.valueAt("billing.grace", at);
  }

  async function startGrace(stationId: string, step: "charge_failed" | "grace_started" | "clear_approval", detail: { due: number; reason?: string | null; monthStart: Date; card?: string | null; attemptKey: string }) {
    const now = deps.clock.now();
    const row = await ensureRow(db, stationId);
    let startedAt = row.graceStartedAt;
    if (row.standing === "ok") {
      startedAt = now;
      await db.update(SB).set({ standing: "grace", graceStartedAt: now, updatedAt: now }).where(eq(SB.stationId, stationId));
    }
    const rule = await graceRule(startedAt ?? now);
    const pausesOn = new Date((startedAt ?? now).getTime() + rule.days * DAY_MS);
    const month = monthName(detail.monthStart);
    const keepGoing = row.standing === "paused" ? "Relays and live shows are paused until it's paid; your channel is still on air." : `Relays and live shows keep going until ${dateLabel(pausesOn)}, then pause until it's paid. Your channel stays on air.`;
    if (step === "charge_failed") {
      tell(stationId, step, `Your card wasn't charged for ${month}'s usage`, `${detail.card ?? "The card"}: ${detail.reason ?? "it was declined."} ${dollars(detail.due)} is due. ${keepGoing} Add another card or pay from Clear in Station account.`, `usage-charge-failed:${detail.attemptKey}`);
    } else if (step === "clear_approval") {
      tell(stationId, step, `Approve ${month}'s usage in Clear`, `${dollars(detail.due)} is due. Approve the payment from your Clear wallet in master control, Station settings, Station account. ${keepGoing}`, `usage-clear-approval:${detail.attemptKey}`);
    } else {
      tell(stationId, step, `${month}'s usage is due`, `${dollars(detail.due)} is due and there's no card or Clear wallet to charge. ${keepGoing} Add a card or connect Clear in Station account.`, `usage-grace:${stationId}:${(startedAt ?? now).toISOString()}`);
    }
  }

  async function clearStanding(stationId: string) {
    const row = await billingRow(stationId);
    if (!row || row.standing === "ok") return;
    const now = deps.clock.now();
    await db.update(SB).set({ standing: "ok", graceStartedAt: null, pausedAt: null, updatedAt: now }).where(eq(SB.stationId, stationId));
    if (row.standing === "paused") {
      tell(stationId, "resumed", "Relays and live shows are back", "Thanks: what was due is paid, so relays and live shows are running again.", `usage-resumed:${stationId}:${row.graceStartedAt?.toISOString() ?? now.toISOString()}`);
      await services.playout.replan(stationId).catch(() => undefined);
    } else {
      tell(stationId, "paid", "Your usage is paid", "Thanks: nothing is due. Relays and live shows carry on as they were.", `usage-paid:${stationId}:${row.graceStartedAt?.toISOString() ?? now.toISOString()}`);
    }
  }

  // ---------- charging ----------

  async function recordCardPayment(billId: string, amount: number, fee: number, providerRef: string) {
    const [bill] = await db.select().from(UB).where(eq(UB.id, billId));
    if (!bill) return;
    const row = await billingRow(bill.stationId);
    await db.transaction(async (tx) => {
      await postPayment(tx, { stationId: bill.stationId, billId, micros: amount, from: { kind: "external", label: "stripe" }, memo: `Usage for ${monthName(startOfDay(bill.month))}, charged to ${row?.cardLabel ?? "the card"}`, key: `usage-card:${providerRef}` });
      // Stripe's fee comes out of what Opencast receives: the price covers it.
      if (fee > 0) {
        await services.ledger.post(
          tx,
          "card_fee",
          [
            { account: await services.ledger.account(tx, "card_fees"), micros: fee },
            { account: await services.ledger.account(tx, "opencast_usage"), micros: -fee }
          ],
          { sourceType: "usage_bill", sourceId: billId, memo: "Stripe's fee on a usage charge", idempotencyKey: `usage-card-fee:${providerRef}` }
        );
      }
    });
    await db.update(UB).set({ lastFailure: null, lastProviderRef: providerRef }).where(eq(UB.id, billId));
    await refreshBills(bill.stationId);
  }

  /** Charges the card for each bill due, oldest first. The first decline stops it. */
  async function chargeCard(stationId: string): Promise<{ ok: boolean; reason: string | null; due: number; bill: typeof UB.$inferSelect | null }> {
    const row = await billingRow(stationId);
    if (!row?.cardRef) return { ok: false, reason: "There's no card saved.", due: await totalDue(stationId), bill: null };
    const rail = cards();
    const name = await stationName(stationId);
    for (const { bill, due } of await billsOwing(stationId, false)) {
      const attempt = bill.attempts + 1;
      const res = await rail.chargeUsage(
        { billId: bill.id, attempt, stationId, stationName: name, paymentMethodId: row.cardRef, amountMicros: due, description: `Opencast usage for ${name}, ${monthName(startOfDay(bill.month))} ${bill.month.slice(0, 4)}` },
        accountDirectory(db)
      );
      await db.update(UB).set({ attempts: attempt, lastAttemptAt: deps.clock.now(), lastMethod: "card", lastFailure: res.status === "failed" ? res.reason : null, lastProviderRef: res.providerRef }).where(eq(UB.id, bill.id));
      if (res.status === "succeeded" && res.providerRef) await recordCardPayment(bill.id, due, res.feeMicros, res.providerRef);
      if (res.status === "failed") return { ok: false, reason: res.reason, due: await totalDue(stationId), bill: { ...bill, attempts: attempt } };
    }
    return { ok: true, reason: null, due: await totalDue(stationId), bill: null };
  }

  /**
   * What pays what earnings don't cover: the owners' choice when they made one; otherwise an
   * owner's linked Clear wallet if Clear gave Opencast full access, otherwise the card on file.
   */
  async function resolveFunding(stationId: string, row: typeof SB.$inferSelect | null): Promise<{ kind: "clear"; link: ClearLinkView } | { kind: "card" } | null> {
    const rail = deps.payments.clearWallet;
    const clearOk = (link: ClearLinkView | null): link is ClearLinkView => Boolean(rail && deps.config.usdc && link?.active && link.access === "full");
    if (row?.funding === "card") return row.cardRef && deps.payments.stationCards ? { kind: "card" } : null;
    if (row?.funding === "clear") {
      const link = row.clearLinkId ? await services.accounts.clearLinkById(row.clearLinkId) : null;
      return clearOk(link) ? { kind: "clear", link } : null;
    }
    if (rail && deps.config.usdc) {
      for (const owner of await services.accounts.stationMemberIds(stationId, ["owner"])) {
        const link = await services.accounts.clearLink(owner);
        if (clearOk(link)) return { kind: "clear", link };
      }
    }
    return row?.cardRef && deps.payments.stationCards ? { kind: "card" } : null;
  }

  /**
   * What's due is paid: earnings first, then the funding source. At month end, small amounts
   * (under the card minimum) wait for next month; anything else that can't be charged starts grace.
   */
  async function settle(stationId: string, why: "month_end" | "card_saved" | "earnings"): Promise<void> {
    await service.collectFromEarnings(stationId);
    await refreshBills(stationId);
    const owing = await billsOwing(stationId, false);
    const due = owing.reduce((s, b) => s + b.due, 0);
    if (due === 0 || due < CARD_MINIMUM_MICROS) {
      // Nothing due, or too little to charge: it's added to next month's.
      await clearStanding(stationId);
      return;
    }
    if (why === "earnings") return;
    const row = await ensureRow(db, stationId);
    const oldest = owing[0].bill;
    const monthStart = startOfDay(oldest.month);
    const source = await resolveFunding(stationId, row);
    if (source?.kind === "card") {
      const res = await chargeCard(stationId);
      if (res.ok) {
        await clearStanding(stationId);
        return;
      }
      await startGrace(stationId, "charge_failed", { due: res.due, reason: res.reason, monthStart, card: row.cardLabel, attemptKey: `${res.bill?.id ?? oldest.id}:${res.bill?.attempts ?? oldest.attempts}` });
      return;
    }
    if (source?.kind === "clear") {
      for (const b of owing) await db.update(UB).set({ lastMethod: "clear", lastAttemptAt: deps.clock.now(), lastFailure: "Waiting for approval in Clear" }).where(eq(UB.id, b.bill.id));
      await startGrace(stationId, "clear_approval", { due, monthStart, attemptKey: `${oldest.id}:clear` });
      return;
    }
    await startGrace(stationId, "grace_started", { due, monthStart, attemptKey: oldest.id });
  }

  // ---------- metering ----------

  async function measure(day: string, until: Date) {
    const from = startOfDay(day);
    const to = new Date(Math.min(from.getTime() + DAY_MS, until.getTime()));
    const [storage, sessions, live] = await Promise.all([services.library.storageUse(), services.playout.relaySessions(from, to), services.playout.liveAired(from, to)]);
    const prepared = await services.playout.preparedBytes([...new Set([...storage.values()].flatMap((s) => s.contentIds))]);
    const modes = await services.stations.relayModes([...new Set(sessions.filter((s) => !s.relayMode).map((s) => s.translatorId))]);
    const stationIds = [...new Set([...storage.keys(), ...sessions.map((s) => s.stationId), ...live.map((l) => l.stationId)])];
    const idents = await services.stations.idents(stationIds);
    const out = new Map<string, Partial<Record<UsageType, { quantity: number; detail?: Record<string, number> }>>>();
    for (const id of stationIds) {
      const ident = idents.get(id);
      if (!ident || !BILLED_KINDS.has(ident.kind)) continue;
      const m: Partial<Record<UsageType, { quantity: number; detail?: Record<string, number> }>> = {};
      const st = storage.get(id);
      if (st) {
        const preparedBytes = st.contentIds.reduce((s, cid) => s + (prepared.get(cid) ?? 0), 0);
        m.storage = { quantity: (st.originalBytes + preparedBytes) / 1e9, detail: { originalBytes: st.originalBytes, preparedBytes } };
      }
      const mine = sessions.filter((s) => s.stationId === id);
      // What the session says it relayed (the relay service's), else the translator's mode (before Phase 3).
      const modeOf = (s: (typeof sessions)[number]) => s.relayMode ?? modes.get(s.translatorId);
      const everything = unionHours(mine.filter((s) => modeOf(s) !== "live_only"));
      const liveOnly = unionHours(mine.filter((s) => modeOf(s) === "live_only"));
      if (everything > 0) m.relay_everything = { quantity: everything };
      if (liveOnly > 0) m.relay_live_only = { quantity: liveOnly };
      const liveHours = unionHours(live.filter((l) => l.stationId === id));
      // TV live comes through Livepeer; radio live through the worker's own ingest.
      if (liveHours > 0) m[ident.band === "radio" ? "radio_live" : "live_hours"] = { quantity: liveHours };
      if (Object.keys(m).length) out.set(id, m);
    }
    return out;
  }

  // ---------- statements ----------

  function lineFor(type: UsageType, t: { units: number; billable: number; micros: number; price: number | null }): StatementLine {
    const def = USAGE_TYPES[type];
    const free = q6(Math.max(0, t.units - t.billable));
    const parts = [quantityText(def, t.units), free > 0 ? `${def.unit === "gb_month" ? free.toFixed(2) : round2(free)} free` : null, priceText(def, def.priceRule ? t.price : 0)].filter(Boolean);
    return {
      label: def.label,
      detail: parts.join(", "),
      amountMicros: -t.micros,
      notSetYet: def.priceRule !== null && t.price === null,
      group: "usage",
      includedAbove: true,
      usage: { type, unit: def.unit, quantity: q6(t.units), freeQuantity: q6(free), billableQuantity: q6(t.billable), priceMicros: def.priceRule ? t.price : 0 }
    } as StatementLine;
  }

  // ---------- the Station account ----------

  async function accountView(stationId: string, user: CurrentUser | null, owner: boolean): Promise<StationAccount> {
    const now = deps.clock.now();
    const monthStart = monthStartOf(now);
    const monthEnd = new Date(nextMonthStart(now).getTime() - DAY_MS);
    const [rows, row, allowance, ident] = await Promise.all([monthRows(stationId, monthStart), billingRow(stationId), allowanceOf(monthStart), services.stations.idents([stationId]).then((m) => m.get(stationId))]);
    const month = monthKey(now);
    const D = daysInMonth(monthStart);
    const elapsedDays = (now.getTime() - monthStart.getTime()) / DAY_MS;
    const today = dayOf(now);
    const unpaid = row?.standing === "paused";
    const usage: UsageLine[] = [];
    for (const type of USAGE_TYPE_ORDER) {
      const def = USAGE_TYPES[type];
      const typeRows = rows.filter((r) => r.usageType === type);
      const cap = capOf(row, type);
      const through = await typeCharge(type, typeRows, monthStart, cap, allowance);
      const closed = typeRows.reduce((s, r) => s + (r.chargeMicros ?? 0), 0);
      const soFar = def.priceRule ? Math.max(closed, through.cappedMicros) : 0;
      const price = await priceOn(type, now);
      const currentGb = type === "storage" ? (typeRows.find((r) => r.day === today)?.quantity ?? typeRows.at(-1)?.quantity ?? 0) : null;
      const estimate = def.priceRule
        ? monthEstimate({ unit: def.unit, monthDays: D, allowance: allowanceFor(type, allowance), soFar: through, daysMeasured: now.getUTCDate(), currentGb: currentGb ?? 0, elapsedDays, priceMicros: price, capMicros: def.cappable ? cap : null })
        : monthEstimate({ unit: def.unit, monthDays: D, allowance: 0, soFar: through, daysMeasured: now.getUTCDate(), currentGb: 0, elapsedDays, priceMicros: 0, capMicros: null });
      const allowanceQty = def.allowanceField ? allowance[def.allowanceField] : null;
      const capReached = row?.capsReached?.[type] === month;
      usage.push({
        type,
        label: def.label,
        unit: def.unit,
        quantity: q6(through.quantity),
        currentGb: currentGb === null ? null : q6(currentGb),
        allowance: allowanceQty === null ? null : { quantity: allowanceQty, left: q6(Math.max(0, allowanceQty - through.quantity)) },
        priceMicros: def.priceRule ? price : 0,
        free: !def.priceRule || price === 0,
        soFarMicros: soFar,
        estimate: { quantity: q6(estimate.quantity), micros: Math.max(soFar, estimate.micros) },
        cap: { micros: def.cappable ? cap : null, reached: capReached, cappable: def.cappable },
        paused: capReached ? "cap" : unpaid && def.pausedWhenUnpaid ? "unpaid" : null,
        pauses: def.pauses
      });
    }
    const storageLine = usage.find((u) => u.type === "storage")!;
    const liveLine = usage.find((u) => u.type === "live_hours")!;

    // What pays what earnings don't cover.
    const rail = deps.payments.clearWallet;
    const usdc = deps.config.usdc;
    const source = await resolveFunding(stationId, row);
    let link: ClearLinkView | null = source?.kind === "clear" ? source.link : null;
    if (!link && row?.funding === "clear" && row.clearLinkId) link = await services.accounts.clearLinkById(row.clearLinkId);
    if (!link && owner && user) link = await services.accounts.clearLink(user.id);
    const clearWhy = !rail || !usdc ? "Paying from Clear isn't set up on this server." : !link ? "Connect Clear first." : !link.active ? "That Clear wallet isn't linked anymore." : link.access !== "full" ? "Clear lets Opencast only read your Clear wallet, so it can't pay from it." : null;

    const earningsAccount = ident?.kind === "claimable" ? null : await services.ledger.account(db, "station_earnings", { stationId });
    const [earnings] = earningsAccount ? await db.select({ sum: sql<string>`coalesce(sum(${P.amountMicros}), 0)` }).from(P).where(eq(P.accountId, earningsAccount)) : [{ sum: "0" }];

    const bills = await db.select().from(UB).where(eq(UB.stationId, stationId)).orderBy(desc(UB.month)).limit(6);
    const totals = await billTotals(bills.map((b) => b.id));
    const billViews: UsageBill[] = bills.map((b) => {
      const t = totals.get(b.id)!;
      const due = Math.max(0, dueFrom(t));
      return {
        id: b.id,
        month: b.month.slice(0, 7),
        status: b.status,
        amountMicros: t.accrued,
        fromEarningsMicros: t.earnings,
        fromClearMicros: t.clear,
        fromCardMicros: t.card,
        dueMicros: due,
        lastAttempt:
          b.lastAttemptAt && b.lastMethod && b.status !== "paid"
            ? { at: b.lastAttemptAt.toISOString(), method: b.lastMethod, result: b.clearTxHash ? "pending" : b.lastMethod === "clear" ? "waiting_for_approval" : b.lastFailure ? "failed" : "pending", reason: b.lastFailure }
            : null,
        paidAt: b.paidAt?.toISOString() ?? null,
        lines: (b.lines as UsageBill["lines"]) ?? null
      };
    });
    const due = billViews.filter((b) => b.status === "due").reduce((s, b) => s + b.dueMicros, 0);
    let grace: StationAccount["grace"] = null;
    if (row && row.standing !== "ok" && row.graceStartedAt) {
      const rule = await graceRule(row.graceStartedAt);
      const pausesAt = new Date(row.graceStartedAt.getTime() + rule.days * DAY_MS);
      grace = { startedOn: dayOf(row.graceStartedAt), pausesOn: dayOf(pausesAt), daysLeft: Math.max(0, Math.ceil((pausesAt.getTime() - now.getTime()) / DAY_MS)), dueMicros: due };
    }
    return {
      stationId,
      month,
      monthStart: dayOf(monthStart),
      monthEnd: dayOf(monthEnd),
      asOf: now.toISOString(),
      usage,
      totals: { soFarMicros: usage.reduce((s, u) => s + u.soFarMicros, 0), estimateMicros: usage.reduce((s, u) => s + u.estimate.micros, 0) },
      allowance: { storageGb: allowance.storageGb, liveHours: allowance.liveHours, storageGbLeft: storageLine.allowance?.left ?? 0, liveHoursLeft: liveLine.allowance?.left ?? 0 },
      standing: row?.standing ?? "ok",
      grace,
      dueMicros: due,
      funding: {
        earningsFirst: true,
        earningsAvailableMicros: Math.max(0, Number(earnings.sum)),
        source: source?.kind ?? null,
        chosen: row?.funding ?? null,
        clear: { available: !clearWhy, access: link?.access ?? null, address: link?.active ? link.address : null, why: clearWhy },
        card: row?.cardLabel ? { label: row.cardLabel, expiresOn: row.cardExpiresOn, expired: Boolean(row.cardExpiresOn && row.cardExpiresOn < today) } : null,
        cardsAvailable: Boolean(deps.payments.stationCards)
      },
      bills: billViews,
      canManage: owner
    };
  }

  /** The owner's linked Clear wallet, if it can pay (full access). Throws the reason otherwise. */
  async function payingClear(user: CurrentUser) {
    const rail = deps.payments.clearWallet;
    if (!rail || !deps.config.usdc) throw conflict("clear_unavailable", "Paying from Clear isn't set up on this server.");
    const link = await services.accounts.clearLink(user.id);
    if (!link || !link.active) throw conflict("clear_not_linked", "Clear isn't linked yet. Connect Clear first.");
    if (link.access !== "full") throw conflict("clear_read_only", "Clear lets Opencast only read your Clear wallet, so it can't pay from it. Add a card instead.");
    return { rail, link, usdc: deps.config.usdc };
  }

  const treasury = { type: "opencast" as const, label: "treasury" as const };

  async function recordClearPayment(stationId: string, amount: number, txHash: string) {
    let left = amount;
    const owing = await billsOwing(stationId, true);
    await db.transaction(async (tx) => {
      for (const { bill, due } of owing) {
        if (left <= 0) break;
        const take = Math.min(left, due);
        await postPayment(tx, { stationId, billId: bill.id, micros: take, from: { kind: "external", label: "clear" }, memo: `Usage for ${monthName(startOfDay(bill.month))}, paid from Clear`, key: `usage-clear:${txHash}:${bill.id}` });
        left -= take;
      }
      // Anything over what's owed is a credit against the month's usage.
      if (left > 0) {
        const bill = await ensureBill(tx, stationId, monthStartOf(deps.clock.now()));
        await postPayment(tx, { stationId, billId: bill.id, micros: left, from: { kind: "external", label: "clear" }, memo: "Paid from Clear, ahead", key: `usage-clear:${txHash}:credit` });
      }
    });
    await db.update(UB).set({ clearTxHash: null, clearAmountMicros: null, lastFailure: null, lastProviderRef: txHash }).where(eq(UB.clearTxHash, txHash));
    await refreshBills(stationId);
    if ((await totalDue(stationId)) === 0) await clearStanding(stationId);
  }

  // ---------- the service ----------

  let lastMeterHour = "";
  let lastDay = "";

  const service: BillingService = {
    async paused(stationId) {
      const row = await billingRow(stationId);
      if (!row) return { relays: false, liveHours: false, radioLive: false, storage: false };
      const month = monthKey(deps.clock.now());
      const cap = (type: UsageType) => row.capsReached?.[type] === month;
      const unpaid = row.standing === "paused";
      return { relays: unpaid || cap("relay_everything"), liveHours: unpaid || cap("live_hours"), radioLive: cap("radio_live"), storage: cap("storage") };
    },

    async requireStorage(stationId) {
      if (!(await service.paused(stationId)).storage) return;
      const row = await billingRow(stationId);
      const next = nextMonthStart(deps.clock.now());
      throw conflict("storage_paused", `Storage reached its cap for ${monthName(monthStartOf(deps.clock.now()))} (${dollars(capOf(row, "storage") ?? 0)}). New uploads wait until ${dateLabel(next)}, or raise the cap in Station account.`);
    },

    account: (stationId, user, owner) => accountView(stationId, user, owner),

    async setCaps(stationId, user, caps) {
      for (const [type, micros] of Object.entries(caps)) {
        const def = USAGE_TYPES[type as UsageType];
        if (!def) throw badRequest("That usage type doesn't exist.", { caps: "Unknown type" });
        if (!def.cappable && micros !== null) throw refused("not_cappable", `${def.label} is free, so it has no cap.`);
      }
      await db.transaction(async (tx) => {
        const row = await ensureRow(tx, stationId);
        const next = { ...(row.caps ?? {}) };
        for (const [type, micros] of Object.entries(caps)) {
          if (micros === null || micros === undefined) delete next[type];
          else next[type] = micros;
        }
        await tx.update(SB).set({ caps: next, updatedBy: user.id, updatedAt: deps.clock.now() }).where(eq(SB.stationId, stationId));
      });
      await checkCapsFor(stationId);
      return accountView(stationId, user, true);
    },

    async startCardSetup(stationId) {
      const rail = cards();
      const name = await stationName(stationId);
      try {
        const setup = await rail.setupCard({ stationId, stationName: name }, accountDirectory(db));
        return { ...setup, publishableKey: rail.publishableKey };
      } catch (error) {
        console.error("[billing] card setup failed", error);
        throw new HttpError(502, "provider_unavailable", "Couldn't start saving a card just now. Try again in a moment.");
      }
    },

    async saveCard(stationId, user, setupIntentId) {
      const rail = cards();
      let card: Awaited<ReturnType<StationCardRail["savedCard"]>>;
      try {
        card = await rail.savedCard({ stationId, setupIntentId });
      } catch (error) {
        if (!user) return null;
        throw refused("card_not_saved", `That card wasn't saved: ${(error as Error).message}`);
      }
      const row = await ensureRow(db, stationId);
      if (row.cardRef === card.paymentMethodId) return user ? accountView(stationId, user, true) : null;
      await db
        .update(SB)
        .set({ cardRef: card.paymentMethodId, cardLabel: card.label, cardExpiresOn: card.expiresOn, updatedBy: user?.id ?? row.updatedBy, updatedAt: deps.clock.now() })
        .where(eq(SB.stationId, stationId));
      if (row.cardRef) await rail.detachCard(row.cardRef).catch((error) => console.error("[billing] removing the old card failed", error));
      // A card added while something's due pays it (and resumes what was paused).
      if ((await resolveFunding(stationId, await billingRow(stationId)))?.kind === "card" && (await totalDue(stationId)) > 0) await settle(stationId, "card_saved");
      return user ? accountView(stationId, user, true) : null;
    },

    async removeCard(stationId, user) {
      const row = await billingRow(stationId);
      if (row?.cardRef) {
        await db
          .update(SB)
          .set({ cardRef: null, cardLabel: null, cardExpiresOn: null, funding: row.funding === "card" ? null : row.funding, updatedBy: user.id, updatedAt: deps.clock.now() })
          .where(eq(SB.stationId, stationId));
        await deps.payments.stationCards?.detachCard(row.cardRef).catch((error) => console.error("[billing] removing the card failed", error));
      }
      return accountView(stationId, user, true);
    },

    async setFunding(stationId, user, source) {
      const row = await ensureRow(db, stationId);
      if (source === "card") {
        if (!row.cardRef) throw conflict("no_card", "Add a card first.");
        await db.update(SB).set({ funding: "card", clearLinkId: null, updatedBy: user.id, updatedAt: deps.clock.now() }).where(eq(SB.stationId, stationId));
      } else {
        const { link } = await payingClear(user);
        await db.update(SB).set({ funding: "clear", clearLinkId: link.id, updatedBy: user.id, updatedAt: deps.clock.now() }).where(eq(SB.stationId, stationId));
      }
      return accountView(stationId, user, true);
    },

    async payNow(stationId, user) {
      await service.collectFromEarnings(stationId);
      await refreshBills(stationId);
      const due = await totalDue(stationId);
      if (due <= 0) {
        await clearStanding(stationId);
        throw conflict("nothing_due", "Nothing is due.");
      }
      const row = await ensureRow(db, stationId);
      const source = await resolveFunding(stationId, row);
      if (source?.kind === "clear") throw conflict("pay_from_clear", "The station pays from Clear: approve the payment from your Clear wallet.");
      if (!row.cardRef) throw conflict("no_card", "Add a card first.");
      if (due < CARD_MINIMUM_MICROS) throw conflict("under_card_minimum", `${dollars(due)} is under the card minimum, so it's added to next month's bill.`);
      const res = await chargeCard(stationId);
      if (!res.ok) {
        await startGrace(stationId, "charge_failed", { due: res.due, reason: res.reason, monthStart: startOfDay(res.bill?.month ?? dayOf(monthStartOf(deps.clock.now()))), card: row.cardLabel, attemptKey: `${res.bill?.id}:${res.bill?.attempts}` });
        throw refused("card_declined", res.reason ?? "The card was declined.");
      }
      await clearStanding(stationId);
      return accountView(stationId, user, true);
    },

    async quoteClearPayment(stationId, user) {
      const { rail, link, usdc } = await payingClear(user);
      await service.collectFromEarnings(stationId);
      const due = await totalDue(stationId);
      if (due <= 0) throw conflict("nothing_due", "Nothing is due.");
      const to = await rail.depositAddress(treasury, accountDirectory(db));
      return { to, token: { address: usdc.address, symbol: "USDC", decimals: 6 }, chainId: usdc.chainId, amountMicros: due, amountUnits: String(due), from: link.address };
    },

    async confirmClearPayment(stationId, user, input) {
      const txHash = input.txHash.toLowerCase();
      const [seen] = await db.select().from(UB).where(eq(UB.clearTxHash, txHash));
      if (seen && seen.stationId !== stationId) throw conflict("transfer_already_used", "That transfer was already used for another station.");
      const [used] = await db.select({ id: E.id }).from(E).where(sql`${E.idempotencyKey} like ${`usage-clear:${txHash}:%`}`).limit(1);
      if (used) return accountView(stationId, user, true);
      const { rail, link } = await payingClear(user);
      const due = await totalDue(stationId);
      if (due <= 0 && !seen) throw conflict("nothing_due", "Nothing is due.");
      if (input.amountMicros < due) throw conflict("amount_changed", `${dollars(due)} is due now. Send that instead.`);
      const to = await rail.depositAddress(treasury, accountDirectory(db));
      const check = await rail.verifyTransfer({ businessId: stationId, txHash, from: link.address, to, amountMicros: input.amountMicros, wallet: "opencast:treasury" });
      if (check.status === "failed") throw refused("transfer_not_valid", check.reason);
      if (check.status === "pending") {
        const [oldest] = await billsOwing(stationId, false);
        if (oldest) await db.update(UB).set({ clearTxHash: txHash, clearAmountMicros: input.amountMicros, lastMethod: "clear", lastAttemptAt: deps.clock.now(), lastFailure: null }).where(eq(UB.id, oldest.bill.id));
        return accountView(stationId, user, true);
      }
      await recordClearPayment(stationId, input.amountMicros, txHash);
      return accountView(stationId, user, true);
    },

    async meterDay(day, until, options = {}) {
      const measured = await measure(day, until);
      const storageMode = options.storage ?? "always";
      const now = deps.clock.now();
      let n = 0;
      for (const [stationId, m] of measured) {
        for (const [type, v] of Object.entries(m) as Array<[UsageType, { quantity: number; detail?: Record<string, number> }]>) {
          if (type === "storage" && storageMode === "if_missing") {
            await db.insert(UD).values({ stationId, usageType: type, day, quantity: v.quantity, detail: v.detail ?? null, updatedAt: now }).onConflictDoNothing();
          } else {
            await db
              .insert(UD)
              .values({ stationId, usageType: type, day, quantity: v.quantity, detail: v.detail ?? null, updatedAt: now })
              .onConflictDoUpdate({ target: [UD.stationId, UD.usageType, UD.day], set: { quantity: v.quantity, detail: v.detail ?? null, updatedAt: now }, setWhere: isNull(UD.closedAt) });
          }
          n++;
        }
      }
      // Storage that's gone since the last measurement today reads 0.
      if (storageMode === "always") {
        const kept = [...measured].filter(([, m]) => m.storage).map(([id]) => id);
        await db
          .update(UD)
          .set({ quantity: 0, detail: null, updatedAt: now })
          .where(and(eq(UD.day, day), eq(UD.usageType, "storage"), isNull(UD.closedAt), kept.length ? sql`${UD.stationId} not in ${kept}` : undefined));
      }
      return n;
    },

    async closeDay(day) {
      const stations = await db.selectDistinct({ stationId: UD.stationId }).from(UD).where(and(eq(UD.day, day), isNull(UD.closedAt)));
      const monthStart = monthStartOf(startOfDay(day));
      const allowance = await allowanceOf(monthStart);
      let entries = 0;
      for (const { stationId } of stations) {
        const row = await billingRow(stationId);
        const rows = await monthRows(stationId, monthStart, day);
        const parts: string[] = [];
        let total = 0;
        const charges: Array<{ type: UsageType; micros: number }> = [];
        for (const type of USAGE_TYPE_ORDER) {
          const typeRows = rows.filter((r) => r.usageType === type);
          const today = typeRows.find((r) => r.day === day && !r.closedAt);
          if (!today) continue;
          const through = await typeCharge(type, typeRows, monthStart, capOf(row, type), allowance);
          const before = typeRows.filter((r) => r.day < day).reduce((s, r) => s + (r.chargeMicros ?? 0), 0);
          const micros = USAGE_TYPES[type].priceRule ? dayCharge(through, before) : 0;
          charges.push({ type, micros });
          total += micros;
          if (micros > 0) parts.push(`${USAGE_TYPES[type].label.toLowerCase()} ${dollars(micros)}`);
        }
        await db.transaction(async (tx) => {
          const bill = await ensureBill(tx, stationId, monthStart);
          let entryId: string | null = null;
          if (total > 0) {
            entryId = await services.ledger.post(
              tx,
              "usage",
              [
                { account: await services.ledger.account(tx, "usage_owed", { stationId }), micros: -total },
                { account: await services.ledger.account(tx, "usage_billed"), micros: total }
              ],
              { sourceType: "usage_bill", sourceId: bill.id, memo: `Usage on ${day}: ${parts.join(", ")}`, idempotencyKey: `usage:${stationId}:${day}` }
            );
            entries++;
          }
          for (const c of charges) {
            await tx.update(UD).set({ chargeMicros: c.micros, closedAt: deps.clock.now(), entryId: c.micros > 0 ? entryId : null }).where(and(eq(UD.stationId, stationId), eq(UD.usageType, c.type), eq(UD.day, day)));
          }
        });
      }
      return entries;
    },

    async closeMonth(monthStart) {
      const month = dayOf(monthStart);
      const bills = await db.select().from(UB).where(and(eq(UB.month, month), eq(UB.status, "open")));
      const allowance = await allowanceOf(monthStart);
      let closed = 0;
      for (const bill of bills) {
        const [unclosed] = await db.select({ n: sql<number>`count(*)::int` }).from(UD).where(and(eq(UD.stationId, bill.stationId), gte(UD.day, month), lt(UD.day, dayOf(nextMonthStart(monthStart))), isNull(UD.closedAt)));
        if (unclosed.n > 0) continue;
        const rows = await monthRows(bill.stationId, monthStart);
        const row = await billingRow(bill.stationId);
        const lines: NonNullable<UsageBill["lines"]> = [];
        for (const type of USAGE_TYPE_ORDER) {
          const typeRows = rows.filter((r) => r.usageType === type);
          if (!typeRows.length) continue;
          const through = await typeCharge(type, typeRows, monthStart, capOf(row, type), allowance);
          const last = typeRows.at(-1)!;
          lines.push({
            type,
            quantity: q6(through.quantity),
            freeQuantity: q6(through.freeQuantity),
            billableQuantity: q6(through.billableQuantity),
            priceMicros: USAGE_TYPES[type].priceRule ? await priceOn(type, startOfDay(last.day)) : 0,
            micros: typeRows.reduce((s, r) => s + (r.chargeMicros ?? 0), 0)
          });
        }
        await db.transaction(async (tx) => {
          const totals = await billTotals([bill.id]);
          const accrued = totals.get(bill.id)!.accrued;
          // Closed to the cent.
          const adjust = toCent(accrued) - accrued;
          if (adjust !== 0) {
            await services.ledger.post(
              tx,
              "usage",
              [
                { account: await services.ledger.account(tx, "usage_owed", { stationId: bill.stationId }), micros: -adjust },
                { account: await services.ledger.account(tx, "usage_billed"), micros: adjust }
              ],
              { sourceType: "usage_bill", sourceId: bill.id, memo: `${monthName(monthStart)}'s usage, rounded to the cent`, idempotencyKey: `usage-round:${bill.id}` }
            );
          }
          await tx.update(UB).set({ status: "due", lines, closedAt: deps.clock.now() }).where(eq(UB.id, bill.id));
        });
        held = [];
        try {
          await settle(bill.stationId, "month_end");
          await refreshBills(bill.stationId);
          const after = held;
          held = null;
          await summaryNotice(bill.id);
          for (const n of after) deps.bus.emit("station.account", n);
        } finally {
          held = null;
        }
        closed++;
      }
      return closed;
    },

    async graceSteps() {
      const now = deps.clock.now();
      const rows = await db.select().from(SB).where(and(eq(SB.standing, "grace"), isNotNull(SB.graceStartedAt)));
      let warned = 0;
      let paused = 0;
      for (const row of rows) {
        const due = await totalDue(row.stationId);
        if (due < CARD_MINIMUM_MICROS) {
          await clearStanding(row.stationId);
          continue;
        }
        const rule = await graceRule(row.graceStartedAt!);
        const pausesAt = new Date(row.graceStartedAt!.getTime() + rule.days * DAY_MS);
        const [oldest] = await billsOwing(row.stationId, false);
        const month = oldest ? monthName(startOfDay(oldest.bill.month)) : "Last month";
        if (now >= pausesAt) {
          await db.update(SB).set({ standing: "paused", pausedAt: now, updatedAt: now }).where(and(eq(SB.stationId, row.stationId), eq(SB.standing, "grace")));
          tell(row.stationId, "paused", "Relays and live shows are paused", `${dollars(due)} is still due for ${month}'s usage. Your channel is still on air. Pay from your card or Clear in Station account to bring relays and live shows back.`, `usage-paused:${row.stationId}:${row.graceStartedAt!.toISOString()}`);
          await services.playout.replan(row.stationId).catch(() => undefined);
          paused++;
        } else if (now.getTime() >= pausesAt.getTime() - rule.warnDaysBefore * DAY_MS) {
          const days = Math.max(1, Math.ceil((pausesAt.getTime() - now.getTime()) / DAY_MS));
          tell(row.stationId, "grace_ending", `Relays and live shows pause in ${days} ${days === 1 ? "day" : "days"}`, `${dollars(due)} is still due for ${month}'s usage. Pay by ${dateLabel(new Date(pausesAt.getTime() - 1))} to keep them going. Your channel stays on air either way.`, `usage-grace-ending:${row.stationId}:${row.graceStartedAt!.toISOString()}`);
          warned++;
        }
      }
      return { warned, paused };
    },

    async checkCaps() {
      const stations = await db.selectDistinct({ stationId: SB.stationId }).from(SB).where(sql`${SB.caps} <> '{}'::jsonb or ${SB.capsReached} <> '{}'::jsonb`);
      let reached = 0;
      for (const { stationId } of stations) reached += await checkCapsFor(stationId);
      return reached;
    },

    async tick() {
      const now = deps.clock.now();
      const today = dayOf(now);
      const hour = now.toISOString().slice(0, 13);
      const result: BillingTickResult = { metered: 0, closedDays: 0, closedMonths: 0, grace: null, clearPayments: 0 };
      if (today !== lastDay) {
        // The days that ended since the last measured one: measured once more to their end (hours
        // exactly; storage only where the day has none), then closed, in order. Metering starts
        // the day it's first run: nothing before it is measured.
        const [{ last }] = await db.select({ last: sql<string | null>`max(${UD.day})::text` }).from(UD);
        if (last) {
          const earliest = dayOf(new Date(startOfDay(today).getTime() - 31 * DAY_MS));
          for (let d = last < earliest ? earliest : last; d < today; d = dayOf(new Date(startOfDay(d).getTime() + DAY_MS))) {
            result.metered += await service.meterDay(d, new Date(startOfDay(d).getTime() + DAY_MS), { storage: "if_missing" });
          }
        }
        const open = await db.selectDistinct({ day: UD.day }).from(UD).where(and(isNull(UD.closedAt), lt(UD.day, today))).orderBy(asc(UD.day));
        for (const { day } of open) {
          await service.closeDay(day);
          result.closedDays++;
        }
        // Months that ended.
        const months = await db.selectDistinct({ month: UB.month }).from(UB).where(and(eq(UB.status, "open"), lt(UB.month, dayOf(monthStartOf(now))))).orderBy(asc(UB.month));
        for (const { month } of months) result.closedMonths += await service.closeMonth(startOfDay(month));
        result.grace = await service.graceSteps();
        lastDay = today;
      }
      if (hour !== lastMeterHour) {
        result.metered += await service.meterDay(today, now);
        await service.checkCaps();
        lastMeterHour = hour;
      }
      result.clearPayments = await service.recheckClearPayments();
      return result;
    },

    async collectFromEarnings(stationId) {
      const owing = await billsOwing(stationId ?? null, true);
      const byStation = new Map<string, typeof owing>();
      for (const o of owing) byStation.set(o.bill.stationId, [...(byStation.get(o.bill.stationId) ?? []), o]);
      let stations = 0;
      let micros = 0;
      for (const [id, list] of byStation) {
        if ((await services.stations.kindOf(id)) === "claimable") continue;
        let took = 0;
        await db.transaction(async (tx) => {
          // One at a time per station (a payout and the month's close can meet).
          await ensureRow(tx, id);
          await tx.select().from(SB).where(eq(SB.stationId, id)).for("update");
          const earnings = await services.ledger.account(tx, "station_earnings", { stationId: id });
          const [bal] = await tx.select({ sum: sql<string>`coalesce(sum(${P.amountMicros}), 0)` }).from(P).where(eq(P.accountId, earnings));
          let available = Number(bal.sum);
          const fresh = await billTotals(list.map((l) => l.bill.id));
          for (const { bill } of list) {
            const due = dueFrom(fresh.get(bill.id)!);
            const take = floorCent(Math.min(available, due));
            if (take <= 0) continue;
            await postPayment(tx, { stationId: id, billId: bill.id, micros: take, from: { kind: "station_earnings" }, memo: `Usage for ${monthName(startOfDay(bill.month))}, taken from earnings` });
            available -= take;
            took += take;
          }
        });
        if (took > 0) {
          stations++;
          micros += took;
          await refreshBills(id);
          const row = await billingRow(id);
          if (row && row.standing !== "ok" && (await totalDue(id)) === 0) await clearStanding(id);
        }
      }
      return { stations, micros };
    },

    async owedMicros(stationId) {
      const account = await owedAccount(stationId);
      if (!account) return 0;
      const [row] = await db.select({ sum: sql<string>`coalesce(sum(${P.amountMicros}), 0)` }).from(P).where(eq(P.accountId, account));
      return Math.max(0, -Number(row.sum));
    },

    async statementLines(stationId, start, end) {
      const rows = await db
        .select()
        .from(UD)
        .where(and(eq(UD.stationId, stationId), gte(UD.day, dayOf(monthStartOf(start))), lt(UD.day, dayOf(end))))
        .orderBy(asc(UD.day));
      const owedId = await owedAccount(stationId);
      if (!owedId && !rows.length) return [];
      const [owed] = owedId
        ? await db
            .select({ sum: sql<string>`coalesce(sum(${P.amountMicros}), 0)` })
            .from(P)
            .innerJoin(E, eq(E.id, P.entryId))
            .where(and(eq(P.accountId, owedId), lt(E.occurredAt, end)))
        : [{ sum: "0" }];
      const stillOwed = Math.max(0, -Number(owed.sum));
      if (!rows.some((r) => r.day >= dayOf(start)) && stillOwed === 0) return [];
      const row = await billingRow(stationId);
      const byType = new Map<UsageType, { units: number; billable: number; micros: number; price: number | null }>();
      // Month by month (a week can span two): each day's share of the allowance, as the month used it.
      const months = [...new Set(rows.map((r) => r.day.slice(0, 7)))];
      for (const m of months) {
        const monthStart = startOfDay(`${m}-01`);
        const allowance = await allowanceOf(monthStart);
        for (const type of USAGE_TYPE_ORDER) {
          const typeRows = rows.filter((r) => r.usageType === type && r.day.startsWith(m));
          if (!typeRows.length) continue;
          const through = await typeCharge(type, typeRows, monthStart, capOf(row, type), allowance);
          const t = byType.get(type) ?? { units: 0, billable: 0, micros: 0, price: null };
          typeRows.forEach((r, i) => {
            if (r.day < dayOf(start)) return;
            t.units += through.days[i].units;
            t.billable += through.days[i].billable;
            t.micros += r.chargeMicros ?? 0;
          });
          const lastIn = [...typeRows].reverse().find((r) => r.day >= dayOf(start));
          if (lastIn) t.price = await priceOn(type, startOfDay(lastIn.day));
          byType.set(type, t);
        }
      }
      const lines: StatementLine[] = [];
      for (const type of USAGE_TYPE_ORDER) {
        const t = byType.get(type);
        if (t && t.units > 0) lines.push(lineFor(type, t));
      }
      // A month's statement: how its bill was paid, whenever it was (at the close, by card, from Clear), and what's still due.
      const isMonth = start.getUTCDate() === 1 && end.getTime() === nextMonthStart(start).getTime();
      const [bill] = isMonth ? await db.select().from(UB).where(and(eq(UB.stationId, stationId), eq(UB.month, dayOf(start)))) : [];
      if (bill) {
        const payments = await db.execute<{ occurred_at: Date; payer: number; micros: string }>(sql`
          select e.occurred_at,
            max(case when a.kind = 'station_earnings' then 1 when a.kind = 'external' and a.label = 'stripe' then 2 when a.kind = 'external' and a.label = 'clear' then 3 else 0 end) as payer,
            sum(case when a.kind = 'usage_owed' then p.amount_micros else 0 end) as micros
          from ${E} e join ${P} p on p.entry_id = e.id join ${L} a on a.id = p.account_id
          where e.source_type = 'usage_bill' and e.source_id = ${bill.id} and e.kind = 'usage_payment'
          group by e.id, e.occurred_at`);
        const sum = (pred: (r: { occurred_at: Date; payer: number }) => boolean) => payments.rows.filter(pred).reduce((s, r) => s + Number(r.micros), 0);
        const atClose = sum((r) => Number(r.payer) === 1 && new Date(r.occurred_at) >= end);
        const byCard = sum((r) => Number(r.payer) === 2);
        const byClear = sum((r) => Number(r.payer) === 3);
        const due = Math.max(0, dueFrom((await billTotals([bill.id])).get(bill.id)!));
        const shown = (label: string, micros: number, detail: string | null = null) => ({ label, detail, amountMicros: -micros, notSetYet: false, group: "usage", includedAbove: true }) as StatementLine;
        if (atClose > 0) lines.push(shown("Usage taken from earnings when the month closed", atClose));
        if (byCard > 0) lines.push(shown(`Usage charged to ${row?.cardLabel ?? "your card"}`, byCard));
        if (byClear > 0) lines.push(shown("Usage paid from Clear", byClear));
        if (due > 0) lines.push(shown("Usage still due", due, "Charged to your funding source; relays and live shows pause if it isn't paid within the grace period"));
        return lines;
      }
      // Paid another way in the period (shown; the money never passed through earnings).
      const paid = await db.execute<{ label: string; micros: string }>(sql`
        select a.label, sum(-p.amount_micros) as micros
        from ${E} e join ${P} p on p.entry_id = e.id join ${L} a on a.id = p.account_id
        where e.kind = 'usage_payment' and a.kind = 'external' and e.occurred_at >= ${start} and e.occurred_at < ${end}
          and e.id in (select q.entry_id from ${P} q where q.account_id = ${owedId})
        group by a.label`);
      for (const r of paid.rows) {
        const m = Number(r.micros);
        if (m > 0) lines.push({ label: r.label === "stripe" ? `Usage charged to ${row?.cardLabel ?? "your card"}` : "Usage paid from Clear", detail: null, amountMicros: -m, notSetYet: false, group: "usage", includedAbove: true } as StatementLine);
      }
      if (stillOwed > 0) {
        lines.push({ label: "Usage still owed", detail: "Taken from earnings before the next payout; what earnings don't cover is charged at month end", amountMicros: -stillOwed, notSetYet: false, group: "usage", includedAbove: true } as StatementLine);
      }
      return lines;
    },

    async handlePaymentEvent(event) {
      if (event.kind === "station_card_saved") {
        await service.saveCard(event.stationId, null, event.setupIntentId).catch((error) => console.error("[billing] saving a card from Stripe's event failed", error));
        return;
      }
      const [bill] = await db.select().from(UB).where(eq(UB.id, event.billId));
      if (!bill) return;
      if (event.kind === "usage_paid") {
        await recordCardPayment(bill.id, event.amountMicros, event.feeMicros, event.providerRef);
        if ((await totalDue(bill.stationId)) === 0) await clearStanding(bill.stationId);
        return;
      }
      // A charge that failed after it was tried (Stripe reports it): once per attempt.
      if (bill.status === "paid") return;
      await db.update(UB).set({ lastFailure: event.reason, lastProviderRef: event.providerRef }).where(eq(UB.id, bill.id));
      const row = await billingRow(bill.stationId);
      await startGrace(bill.stationId, "charge_failed", { due: await totalDue(bill.stationId), reason: event.reason, monthStart: startOfDay(bill.month), card: row?.cardLabel ?? null, attemptKey: `${bill.id}:${event.providerRef}` });
    },

    async recheckClearPayments() {
      const rail = deps.payments.clearWallet;
      if (!rail) return 0;
      const pending = await db.select().from(UB).where(isNotNull(UB.clearTxHash));
      let paid = 0;
      for (const bill of pending) {
        const row = await billingRow(bill.stationId);
        const link = row?.clearLinkId ? await services.accounts.clearLinkById(row.clearLinkId) : null;
        const amount = bill.clearAmountMicros ?? 0;
        if (!link || !amount) continue;
        const to = await rail.depositAddress(treasury, accountDirectory(db));
        const check = await rail.verifyTransfer({ businessId: bill.stationId, txHash: bill.clearTxHash!, from: link.address, to, amountMicros: amount, wallet: "opencast:treasury" }).catch(() => ({ status: "pending" as const }));
        if (check.status === "confirmed") {
          await recordClearPayment(bill.stationId, amount, bill.clearTxHash!);
          paid++;
        } else if (check.status === "failed") {
          await db.update(UB).set({ clearTxHash: null, clearAmountMicros: null, lastFailure: check.reason }).where(eq(UB.id, bill.id));
        }
      }
      return paid;
    }
  };

  /** A station's caps against the month so far: reaching one pauses it (and tells the owners); raising it resumes. */
  async function checkCapsFor(stationId: string): Promise<number> {
    const row = await billingRow(stationId);
    if (!row) return 0;
    const now = deps.clock.now();
    const monthStart = monthStartOf(now);
    const month = monthKey(now);
    const rows = await monthRows(stationId, monthStart);
    const allowance = await allowanceOf(monthStart);
    const reached: Record<string, string> = {};
    let newly = 0;
    for (const type of CAPPABLE) {
      const cap = capOf(row, type);
      if (cap === null) continue;
      const typeRows = rows.filter((r) => r.usageType === type);
      const through = await typeCharge(type, typeRows, monthStart, cap, allowance);
      const closed = typeRows.reduce((s, r) => s + (r.chargeMicros ?? 0), 0);
      // A $0 cap is reached by anything billable (inside the free allowance costs nothing).
      if ((through.rawMicros >= cap && (cap > 0 || through.rawMicros > 0)) || (cap > 0 && closed >= cap)) {
        reached[type] = month;
        if (row.capsReached?.[type] !== month) {
          newly++;
          const def = USAGE_TYPES[type];
          const what = (def.pauses ?? def.label).replace(/ \(.*\)$/, "");
          tell(stationId, "cap_reached", `${def.label} reached ${dollars(cap)} for ${monthName(monthStart)}`, `You capped “${def.label}” at ${dollars(cap)} a month. ${what} are paused until ${dateLabel(nextMonthStart(now))}, or raise the cap in Station account. Your channel stays on air.`, `usage-cap:${stationId}:${type}:${month}`);
        }
      }
    }
    const before = JSON.stringify(Object.fromEntries(Object.entries(row.capsReached ?? {}).filter(([, m]) => m === month).sort()));
    const after = JSON.stringify(Object.fromEntries(Object.entries(reached).sort()));
    if (before !== after) {
      await db.update(SB).set({ capsReached: reached, updatedAt: now }).where(eq(SB.stationId, stationId));
      // Live blocks already planned are planned again (paused or back); relays follow on their own.
      await services.playout.replan(stationId).catch(() => undefined);
    }
    return newly;
  }

  /** The month's usage, told to the owners when its bill closes. */
  async function summaryNotice(billId: string) {
    const [bill] = await db.select().from(UB).where(eq(UB.id, billId));
    if (!bill) return;
    const lines = (bill.lines as UsageBill["lines"]) ?? [];
    if (!lines.some((l) => l.quantity > 0)) return;
    const totals = (await billTotals([bill.id])).get(bill.id)!;
    const monthStart = startOfDay(bill.month);
    const month = monthName(monthStart);
    const used = lines
      .filter((l) => l.quantity > 0)
      .map((l) => {
        const def = USAGE_TYPES[l.type];
        return `${def.label} ${def.unit === "gb_month" ? `${l.quantity.toFixed(2)} GB-months` : `${round2(l.quantity)} hours`}`;
      })
      .join("; ");
    const row = await billingRow(bill.stationId);
    // Nothing charged because a price wasn't set yet (before the price sheet's first day): no summary.
    if (totals.accrued === 0 && lines.some((l) => l.billableQuantity > 0 && l.priceMicros === null)) return;
    if (totals.accrued === 0) {
      tell(bill.stationId, "usage_summary", `${month}: inside the free allowance`, `${used}. Nothing to pay.`, `usage-summary:${bill.id}`);
      return;
    }
    const paid = [
      totals.earnings ? `${dollars(totals.earnings)} came from your earnings` : null,
      totals.card ? `${dollars(totals.card)} was charged to ${row?.cardLabel ?? "your card"}` : null,
      totals.clear ? `${dollars(totals.clear)} was paid from Clear` : null
    ].filter(Boolean);
    const due = Math.max(0, dueFrom(totals));
    const rest = due > 0 ? (due < CARD_MINIMUM_MICROS ? `${dollars(due)} is added to next month's bill.` : `${dollars(due)} is still due.`) : "Nothing is due.";
    tell(bill.stationId, "usage_summary", `${month}'s usage: ${dollars(totals.accrued)}`, `${used}. ${paid.length ? `${paid.join(", ")}. ` : ""}${rest}`, `usage-summary:${bill.id}`);
  }

  return service;
}
