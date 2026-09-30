// A business's money for its books (added 2026-09-29, the business app's requests): monthly
// statements shaped as the business reads them (E3: the balance's lines, then spent by spot and
// station; this month so far), receipts with a PDF each (E4), removing a funding source and
// choosing the default (E5), what an airings estimate is based on (E6), and money left over after
// a business closed (P21).
//
// A business statement counts the money the business has at Opencast: its available balance and
// what's held for it together. Holds and releases move money between the two, so they don't show;
// what reached a station (airings, sponsorships, orders), what came in and what went out do.

import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import { relayViewersLabel, relayWaitingLabel, type Receipt, type Statement } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import { conflict, notFound } from "../../errors.js";
import { publicUrl } from "../../lib/url.js";
import { simplePdf } from "../../lib/pdf.js";
import { accountDirectory } from "./moves.js";
import type { LedgerService } from "./service.js";

type Line = Statement["lines"][number];

export interface BusinessMoney {
  /** E3: the business's monthly statements (issued ones, and this month so far), newest first. */
  businessStatements(businessId: string): Promise<Statement[]>;
  /** E4. */
  receipts(businessId: string): Promise<Receipt[]>;
  /** E4: a receipt's or statement's PDF, when the link's signature is this business's. Null: no such receipt. */
  receiptPdf(businessId: string, receiptId: string, signature: string): Promise<{ filename: string; pdf: Buffer } | null>;
  removeFundingSource(businessId: string, sourceId: string): Promise<Array<{ id: string; kind: "clear_bank" | "card" | "clear_account"; label: string; isDefault: boolean }>>;
  makeDefaultFundingSource(businessId: string, sourceId: string): Promise<Array<{ id: string; kind: "clear_bank" | "card" | "clear_account"; label: string; isDefault: boolean }>>;
  /** P21: sends what's left of a closed business's balance back once nothing is held for it. */
  sweepClosedBusinesses(): Promise<number>;
  /** E7: where to send USDC from inside Clear; null where Clear funding isn't available. */
  depositAddress(businessId: string): Promise<string | null>;
  /** How much of each hold was held when it was made. */
  holdAmounts(holdIds: string[]): Promise<Map<string, number>>;
  /** How much each hold has returned to the balance (refunds, what an airing didn't use). */
  releasedFromHolds(holdIds: string[]): Promise<Map<string, number>>;
}

const E = schema.entries;
const P = schema.postings;
const H = schema.holds;
const D = schema.deposits;
const DAY = 86_400_000;

const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const nextMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
const dollars = (micros: number) => `$${(Math.abs(micros) / 1_000_000).toFixed(2)}`;
const monthName = (d: Date) => new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(d);
const dayName = (d: Date) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(d);
const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

export function createBusinessMoney({ deps, services }: ModuleContext, ledger: LedgerService): BusinessMoney {
  const { db } = deps;

  /** Every entry that moved this business's money (available or held), with its net change to the two together. */
  async function flows(businessId: string, to: Date) {
    const available = await ledger.account(db, "advertiser_available", { advertiserId: businessId });
    const holds = await db.select().from(H).where(eq(H.advertiserId, businessId));
    const holdIds = holds.map((h) => h.id);
    const rows = await db
      .select({ entry: E, accountId: P.accountId, holdId: P.holdId, amount: P.amountMicros })
      .from(P)
      .innerJoin(E, eq(E.id, P.entryId))
      .where(and(lt(E.occurredAt, to), holdIds.length ? sql`(${P.accountId} = ${available} or ${inArray(P.holdId, holdIds)})` : eq(P.accountId, available)))
      .orderBy(asc(E.occurredAt));
    const byEntry = new Map<string, { entry: typeof E.$inferSelect; net: number; toAvailable: number; holdId: string | null }>();
    for (const r of rows) {
      const e = byEntry.get(r.entry.id) ?? { entry: r.entry, net: 0, toAvailable: 0, holdId: null };
      e.net += r.amount;
      if (r.accountId === available) e.toAvailable += r.amount;
      if (r.holdId) e.holdId = r.holdId;
      byEntry.set(r.entry.id, e);
    }
    return { available, holds: new Map(holds.map((h) => [h.id, h])), entries: [...byEntry.values()] };
  }

  /** One period of a business statement: its lines, opening and closing, and the closing split. */
  async function period(businessId: string, from: Date, to: Date, options: { waiting?: boolean } = {}) {
    const { holds, entries } = await flows(businessId, to);
    const before = entries.filter((e) => e.entry.occurredAt < from);
    const inside = entries.filter((e) => e.entry.occurredAt >= from);
    const opening = before.reduce((s, e) => s + e.net, 0);
    const closing = opening + inside.reduce((s, e) => s + e.net, 0);
    const closingAvailable = entries.reduce((s, e) => s + e.toAvailable, 0);

    const lines: Line[] = [];
    const push = (line: Omit<Line, "notSetYet">) => lines.push({ notSetYet: false, ...line });
    for (const e of inside.filter((x) => x.entry.kind === "deposit")) {
      push({ group: "balance", kind: "added", label: "Added", detail: `${e.entry.memo ?? "Money added"}, ${dayName(e.entry.occurredAt)}`, amountMicros: e.net });
    }
    const aired = inside.filter((x) => x.entry.kind === "settle" && x.entry.sourceType === "as_run");
    push({ group: "balance", kind: "aired", label: "Spent on airings", detail: plural(aired.length, "airing"), amountMicros: aired.reduce((s, e) => s + e.net, 0), airings: aired.length });
    // Relay viewers (2026-09-30): each platform's settled relay part is its own line, added in.
    for (const platform of ["youtube", "twitch"] as const) {
      const label = relayViewersLabel(platform);
      const settled = inside.filter((x) => x.entry.kind === "settle" && x.entry.sourceType === "relay_viewers" && x.entry.memo === label);
      if (settled.length) {
        push({ group: "balance", kind: "relay_viewers", label, detail: plural(settled.length, "airing"), amountMicros: settled.reduce((s, e) => s + e.net, 0), airings: settled.length, relay: { platform } });
      }
    }
    const returned = inside.filter((x) => x.entry.kind === "release" && (x.entry.sourceType === "as_run" || x.entry.sourceType === "relay_viewers"));
    const returnedMicros = returned.reduce((s, e) => s + e.toAvailable, 0);
    push({
      group: "balance",
      kind: "returned",
      label: "Returned after airings",
      detail: returnedMicros > 0 ? "What holds didn't use (short airings, per-thousand estimates), included above" : "None this month",
      amountMicros: returnedMicros,
      includedAbove: true
    });
    for (const e of inside.filter((x) => x.entry.kind === "settle" && x.entry.sourceType === "sponsorship_month")) {
      push({ group: "balance", kind: "sponsorship", label: "Sponsorships", detail: e.entry.memo, amountMicros: e.net });
    }
    for (const e of inside.filter((x) => x.entry.kind === "settle" && x.entry.sourceType === "production_order")) {
      push({ group: "balance", kind: "order", label: "Made for you", detail: e.entry.memo, amountMicros: e.net });
    }
    for (const e of inside.filter((x) => x.entry.kind === "withdrawal")) {
      push({ group: "balance", kind: "withdrawn", label: "Taken out", detail: e.entry.memo, amountMicros: e.net });
    }
    for (const e of inside.filter((x) => x.entry.kind === "reversal" && x.net !== 0)) {
      push({ group: "balance", kind: "refund", label: "Refunds", detail: e.entry.memo, amountMicros: e.net });
    }
    // Still held for relay viewers until YouTube's location data arrives: shown, already in the closing.
    if (options.waiting) {
      const waiting = await services.spots.relayWaiting(businessId);
      for (const w of waiting) {
        push({ group: "balance", kind: "relay_waiting", label: relayWaitingLabel(w.platform), detail: plural(w.airings, "airing"), amountMicros: w.heldMicros, includedAbove: true, airings: w.airings, relay: { platform: w.platform } });
      }
    }
    // Card fees are paid on top, never from the balance.
    const deposits = await db.select().from(D).where(and(eq(D.advertiserId, businessId), eq(D.status, "arrived")));
    const inPeriod = new Set(inside.map((e) => e.entry.id));
    const fees = deposits.filter((d) => d.entryId && inPeriod.has(d.entryId)).reduce((s, d) => s + d.feeMicros, 0);
    push({ group: "balance", kind: "fees", label: "Fees", detail: fees ? "Card fees, Stripe's at cost, paid on top" : "None. Bank transfers through Clear are free", amountMicros: -fees, includedAbove: true });

    // Spent, by spot and station: the biggest first.
    const bySpotStation = new Map<string, { spotId: string; stationId: string; micros: number; airings: number }>();
    for (const e of [...aired, ...inside.filter((x) => x.entry.kind === "settle" && x.entry.sourceType === "relay_viewers")]) {
      const hold = e.holdId ? holds.get(e.holdId) : undefined;
      if (!hold?.spotId || !hold.stationId) continue;
      const key = `${hold.spotId}:${hold.stationId}`;
      const row = bySpotStation.get(key) ?? { spotId: hold.spotId, stationId: hold.stationId, micros: 0, airings: 0 };
      row.micros += -e.net;
      // Relay viewers are part of an airing already counted.
      if (e.entry.sourceType === "as_run") row.airings++;
      bySpotStation.set(key, row);
    }
    const rows = [...bySpotStation.values()].sort((a, b) => b.micros - a.micros);
    const [idents, titles] = await Promise.all([
      services.stations.idents(rows.map((r) => r.stationId)),
      Promise.all([...new Set(rows.map((r) => r.spotId))].map(async (id) => [id, (await services.spots.spotSummary(id)).title] as const)).then((pairs) => new Map(pairs))
    ]);
    for (const r of rows) {
      const station = idents.get(r.stationId);
      const where = station ? [station.callSign ?? station.name, station.channel].filter(Boolean).join(" ") : "a station";
      push({ group: "spent", kind: "spot_station", label: `${titles.get(r.spotId) ?? "A spot"} on ${where}`, detail: plural(r.airings, "airing"), amountMicros: r.micros, airings: r.airings });
    }
    return { opening, closing, closingAvailable, closingHeld: closing - closingAvailable, lines, sponsorships: inside.filter((x) => x.entry.sourceType === "sponsorship_month" && x.entry.kind === "settle").length, airings: aired.length };
  }

  async function keyOf(businessId: string) {
    return services.spots.receiptsKey(businessId);
  }

  const sign = (key: string, receiptId: string) => createHmac("sha256", key).update(receiptId).digest("hex").slice(0, 32);
  const pdfLink = (businessId: string, receiptId: string, key: string) => publicUrl(deps, `/v1/receipts/${businessId}/${receiptId}/pdf?sig=${sign(key, receiptId)}`);

  async function issuedStatements(businessId: string, available: string) {
    return db
      .select()
      .from(schema.statements)
      .where(and(eq(schema.statements.accountId, available), eq(schema.statements.period, "month")))
      .orderBy(desc(schema.statements.periodStart));
  }

  const part: BusinessMoney = {
    async businessStatements(businessId) {
      const available = await ledger.account(db, "advertiser_available", { advertiserId: businessId });
      const key = await keyOf(businessId);
      const now = deps.clock.now();
      const thisMonth = dateOnly(monthStart(now));
      const issued = await issuedStatements(businessId, available);
      const out: Statement[] = [];
      if (!issued.some((s) => s.periodStart === thisMonth)) {
        // This month so far: its id is the business's balance account (the CSV reads it).
        const from = monthStart(now);
        const p = await period(businessId, from, new Date(now.getTime() + 1), { waiting: true });
        out.push({
          id: available,
          period: "month",
          periodStart: thisMonth,
          periodEnd: dateOnly(new Date(nextMonth(now).getTime() - DAY)),
          openingMicros: p.opening,
          closingMicros: p.closing,
          lines: p.lines,
          issuedAt: now.toISOString(),
          csvUrl: `/v1/statements/${available}/csv`,
          pdfUrl: pdfLink(businessId, available, key),
          inProgress: true,
          asOf: dateOnly(now),
          finalOn: dateOnly(nextMonth(now)),
          closingAvailableMicros: p.closingAvailable,
          closingHeldMicros: p.closingHeld
        });
      }
      for (const s of issued) {
        const from = new Date(`${s.periodStart}T00:00:00Z`);
        const to = new Date(new Date(`${s.periodEnd}T00:00:00Z`).getTime() + DAY);
        const p = await period(businessId, from, to);
        out.push({
          id: s.id,
          period: "month",
          periodStart: s.periodStart,
          periodEnd: s.periodEnd,
          openingMicros: p.opening,
          closingMicros: p.closing,
          lines: p.lines,
          issuedAt: s.issuedAt.toISOString(),
          csvUrl: `/v1/statements/${s.id}/csv`,
          pdfUrl: pdfLink(businessId, s.id, key),
          paidOn: null,
          destination: null,
          inProgress: false,
          asOf: s.periodEnd,
          finalOn: null,
          closingAvailableMicros: p.closingAvailable,
          closingHeldMicros: p.closingHeld
        });
      }
      return out;
    },

    async receipts(businessId) {
      const key = await keyOf(businessId);
      const now = deps.clock.now();
      const { entries, available } = await flows(businessId, new Date(now.getTime() + 1));
      const deposits = await db.select().from(D).where(and(eq(D.advertiserId, businessId), eq(D.status, "arrived")));
      const sources = await db.select().from(schema.fundingSources).where(eq(schema.fundingSources.advertiserId, businessId));
      const receipts: Receipt[] = [];
      for (const e of entries) {
        if (e.entry.kind === "deposit") {
          const deposit = deposits.find((d) => d.entryId === e.entry.id);
          const source = deposit?.fundingSourceId ? sources.find((f) => f.id === deposit.fundingSourceId) : undefined;
          const how = source?.kind === "card" ? `By card, ${source.label}` : deposit?.txHash ? "From Clear" : source ? `Bank transfer through Clear, ${source.label}` : (e.entry.memo ?? null);
          receipts.push({ id: e.entry.id, kind: "prepayment", title: "Money added", detail: how, amountMicros: e.net, at: e.entry.occurredAt.toISOString(), pdfUrl: pdfLink(businessId, e.entry.id, key) });
        }
        if (e.entry.kind === "settle" && (e.entry.sourceType === "sponsorship_month" || e.entry.sourceType === "production_order")) {
          receipts.push({
            id: e.entry.id,
            kind: "expense",
            title: e.entry.sourceType === "sponsorship_month" ? "Sponsorship" : "Production order",
            detail: e.entry.memo,
            amountMicros: -e.net,
            at: e.entry.occurredAt.toISOString(),
            pdfUrl: pdfLink(businessId, e.entry.id, key)
          });
        }
      }
      for (const s of await issuedStatements(businessId, available)) {
        const from = new Date(`${s.periodStart}T00:00:00Z`);
        const p = await period(businessId, from, new Date(new Date(`${s.periodEnd}T00:00:00Z`).getTime() + DAY));
        const spent = p.lines.filter((l) => l.group === "balance" && ["aired", "sponsorship", "order"].includes(l.kind ?? "")).reduce((sum, l) => sum - l.amountMicros, 0);
        receipts.push({
          id: s.id,
          kind: "statement",
          title: `${monthName(from)} statement`,
          detail: [plural(p.airings, "airing"), p.sponsorships ? plural(p.sponsorships, "sponsorship") : null].filter(Boolean).join(", "),
          amountMicros: spent,
          at: s.issuedAt.toISOString(),
          pdfUrl: pdfLink(businessId, s.id, key)
        });
      }
      return receipts.sort((a, b) => b.at.localeCompare(a.at));
    },

    async receiptPdf(businessId, receiptId, signature) {
      const key = await keyOf(businessId).catch(() => null);
      if (!key) return null;
      const expected = sign(key, receiptId);
      if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
      const business = await services.spots.businessForBooks(businessId);
      const head = [
        { text: business.legalName ?? business.name, bold: true, size: 14 },
        ...(business.legalName && business.legalName !== business.name ? [business.name] : []),
        ...(business.einLast4 ? [`EIN ending ${business.einLast4}`] : []),
        ""
      ];
      const statement = [...(await part.businessStatements(businessId))].find((s) => s.id === receiptId);
      if (statement) {
        const month = monthName(new Date(`${statement.periodStart}T00:00:00Z`));
        const body = [
          { text: `${month} statement${statement.inProgress ? ", so far" : ""}`, bold: true },
          `${statement.periodStart} to ${statement.inProgress ? statement.asOf : statement.periodEnd}`,
          "",
          `Opening balance  ${dollars(statement.openingMicros)}`,
          ...statement.lines.filter((l) => l.group === "balance").map((l) => `${l.label}${l.detail ? ` (${l.detail})` : ""}  ${l.amountMicros < 0 ? "-" : ""}${dollars(l.amountMicros)}${l.includedAbove ? ", not added in" : ""}`),
          `${statement.inProgress ? "Balance now" : "Closing balance"}  ${dollars(statement.closingMicros)} (${dollars(statement.closingAvailableMicros ?? 0)} available, ${dollars(statement.closingHeldMicros ?? 0)} held)`,
          "",
          { text: "Spent, by spot and station", bold: true },
          ...statement.lines.filter((l) => l.group === "spent").map((l) => `${l.label}, ${l.detail}  ${dollars(l.amountMicros)}`)
        ];
        return { filename: `opencast-statement-${statement.periodStart.slice(0, 7)}.pdf`, pdf: simplePdf([...head, ...body, "", "Opencast for business"]) };
      }
      const receipt = (await part.receipts(businessId)).find((r) => r.id === receiptId);
      if (!receipt) return null;
      const kind = { prepayment: "Prepayment: money added to your balance, not an expense", expense: "Expense", statement: "Monthly statement" }[receipt.kind];
      const body = [{ text: receipt.title, bold: true }, dayName(new Date(receipt.at)) + `, ${new Date(receipt.at).getUTCFullYear()}`, receipt.detail ?? "", dollars(receipt.amountMicros), kind];
      return { filename: `opencast-${receipt.title.toLowerCase().replace(/\W+/g, "-")}-${receipt.at.slice(0, 10)}.pdf`, pdf: simplePdf([...head, ...body, "", `Receipt ${receipt.id}`, "Opencast for business"]) };
    },

    async removeFundingSource(businessId, sourceId) {
      const FS = schema.fundingSources;
      const [source] = await db.select().from(FS).where(and(eq(FS.id, sourceId), eq(FS.advertiserId, businessId), sql`${FS.removedAt} is null`));
      if (!source) throw notFound("That funding source");
      if (source.isDefault) {
        const others = await db.select({ id: FS.id }).from(FS).where(and(eq(FS.advertiserId, businessId), sql`${FS.removedAt} is null`));
        throw conflict("default_source", others.length > 1 ? "That's your default. Make another one the default first." : "That's your only funding source. Add another one first.");
      }
      const [pending] = await db.select({ id: D.id }).from(D).where(and(eq(D.fundingSourceId, sourceId), eq(D.status, "pending"))).limit(1);
      if (pending) throw conflict("deposit_pending", "Money from it is still on its way. Remove it once it arrives, or undo the deposit.");
      await db.update(FS).set({ removedAt: deps.clock.now() }).where(eq(FS.id, sourceId));
      return (await ledger.balance(businessId)).fundingSources;
    },

    async makeDefaultFundingSource(businessId, sourceId) {
      const FS = schema.fundingSources;
      const [source] = await db.select().from(FS).where(and(eq(FS.id, sourceId), eq(FS.advertiserId, businessId), sql`${FS.removedAt} is null`));
      if (!source) throw notFound("That funding source");
      if (source.clearLinkId && !(await services.accounts.clearLinkById(source.clearLinkId))?.active) {
        throw conflict("clear_unlinked", "That Clear wallet isn't linked anymore. Connect Clear again to use it.");
      }
      await db.transaction(async (tx) => {
        await tx.update(FS).set({ isDefault: false }).where(eq(FS.advertiserId, businessId));
        await tx.update(FS).set({ isDefault: true }).where(eq(FS.id, sourceId));
      });
      return (await ledger.balance(businessId)).fundingSources;
    },

    async sweepClosedBusinesses() {
      let sent = 0;
      for (const businessId of await services.spots.closedBusinessIds()) {
        const balance = await ledger.balance(businessId);
        if (balance.heldMicros > 0 || balance.availableMicros <= 0) continue;
        const source = [...balance.fundingSources].sort((a, b) => Number(b.isDefault) - Number(a.isDefault)).find((f) => f.kind !== "card");
        if (!source) {
          console.warn(`[ledger] closed business ${businessId} has ${balance.availableMicros} micros and nowhere to send them`);
          continue;
        }
        try {
          await ledger.withdraw(businessId, { amountMicros: balance.availableMicros, fundingSourceId: source.id });
          sent++;
        } catch (error) {
          console.error(`[ledger] sending back what's left for closed business ${businessId} failed`, error);
        }
      }
      return sent;
    },

    async depositAddress(businessId) {
      const rail = deps.payments.clearWallet;
      if (!rail) return null;
      try {
        const name = (await services.spots.businessNames([businessId])).get(businessId) ?? "Business";
        return await rail.depositAddress({ type: "advertiser", id: businessId, name }, accountDirectory(db));
      } catch {
        return null;
      }
    },

    async holdAmounts(holdIds) {
      if (!holdIds.length) return new Map();
      const rows = await db.select({ id: H.id, amount: H.amountMicros }).from(H).where(inArray(H.id, holdIds));
      return new Map(rows.map((r) => [r.id, r.amount]));
    },

    async releasedFromHolds(holdIds) {
      if (!holdIds.length) return new Map();
      const rows = await db
        .select({ holdId: P.holdId, micros: sql<string>`coalesce(sum(-${P.amountMicros}), 0)` })
        .from(P)
        .innerJoin(E, eq(E.id, P.entryId))
        .where(and(inArray(P.holdId, holdIds), eq(E.kind, "release")))
        .groupBy(P.holdId);
      return new Map(rows.map((r) => [r.holdId!, Number(r.micros)]));
    }
  };
  return part;
}
