// Catalog sponsors (added 2026-09-29, follow-up Phase 0 item 11, desk-pages 03). Catalog programs keep
// one sponsor credit an hour, and Network desk sells it by series and market: a business sponsors one
// catalog series (or every catalog series) in one market, a month at a time. It's a sponsorship like
// any other underneath (spots.sponsorships, with its market): the catalog station makes the series,
// so the station is the catalog station and the program the series'. Each month is held from the
// business's balance at its start and paid at its end by rollSponsorships, an unfunded month lapses,
// and until the split is decided (`shares.catalog_sponsorship`, Open) the money settles into the
// catalog station's earnings as any sponsorship of its programs would.
//
// Wherever nobody has bought the slot, the credit thanks the house sponsor, Clear. Those credits are
// counted from the as-run log and, on the 1st, last month's Clear-filled slots are recorded
// (spots.catalog_house_credits). Nothing is billed for them: whether Clear pays is Open.
//
// Prices come from the rules registry (`catalog.sponsor_prices`, per market): a slot is for sale
// once its price is set. A market's lead or an admin offers a slot to a business (it answers from its
// own side), assigns it to a business that has agreed (its first month held now), or ends it.

import { and, asc, eq, ilike, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import { checkCreditText } from "@opencast/domain";
import { CATALOG_HOUSE_SPONSOR, RULES, type CatalogSlot, type CatalogSponsorBusiness, type CatalogSponsors, type CatalogSponsorship, type Market } from "@opencast/contracts";
import type { Executor, ModuleContext } from "../../context.js";
import type { CurrentUser } from "../../http.js";
import { conflict, HttpError, notFound, refused } from "../../errors.js";

/** The credit a catalog program's break airs: its series, and who it thanks. */
export interface CatalogCredit {
  subject: string;
  /** The series' colour, the credit's ground (the station's when it has none). */
  colour: string | null;
  sponsor: { business: string; creditText: string };
  house: boolean;
  sponsorshipId: string | null;
}

export interface CatalogSponsorsPart {
  catalogSponsors(user: CurrentUser, marketId?: string): Promise<CatalogSponsors>;
  catalogSponsorBusinesses(q: string | undefined): Promise<CatalogSponsorBusiness[]>;
  offerCatalogSponsorship(user: CurrentUser, input: SlotInput): Promise<CatalogSponsorship>;
  assignCatalogSponsorship(user: CurrentUser, input: SlotInput): Promise<CatalogSponsorship>;
  endCatalogSponsorship(user: CurrentUser, sponsorshipId: string): Promise<CatalogSponsorship>;
  businessCatalogSponsorships(businessId: string): Promise<CatalogSponsorship[]>;
  answerCatalogOffer(businessId: string, userId: string, sponsorshipId: string, decision: "accept" | "decline"): Promise<CatalogSponsorship>;
  /**
   * Playout: the credit for catalog programs airing on a station at a moment: the sponsor of the
   * series in the station's market, else the market's every-series sponsor, else the house sponsor.
   * Only catalog programs are in the map.
   */
  catalogCredits(stationId: string, programIds: string[], at: Date): Promise<Map<string, CatalogCredit>>;
  /** Records a month's Clear-filled slots with the credits that aired (once; again changes nothing). */
  recordHouseCredits(month: string): Promise<number>;
  /** Tells on-air stations in the markets whose catalog credit may have changed to plan again. */
  replanMarkets(marketIds: string[]): Promise<void>;
}

interface SlotInput {
  seriesId: string | null;
  marketId: string;
  businessId: string;
  creditText: string;
  startsOn: string;
}

interface SeriesInfo {
  id: string;
  title: string;
  colour: string | null;
  programId: string;
  stationId: string;
}

type Row = typeof schema.sponsorships.$inferSelect;
type MonthRow = typeof schema.sponsorshipMonths.$inferSelect;

const SS = schema.sponsorships;
const SM = schema.sponsorshipMonths;
const HC = schema.catalogHouseCredits;
const AD = schema.advertisers;
const DAY = 86_400_000;
const WEEK = 7 * DAY;

export const monthOf = (date: string | Date) => (typeof date === "string" ? date : date.toISOString()).slice(0, 7) + "-01";
const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 10);
};
const lastDayOf = (month: string) => new Date(Date.parse(shiftMonth(month, 1)) - DAY).toISOString().slice(0, 10);
const dollars = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;

/** The paid sponsorship crediting a slot at a moment: one of the series first, then the market's every-series one. */
function crediting(rows: Row[], months: MonthRow[], marketId: string | null, programId: string, at: Date): Row | null {
  if (!marketId) return null;
  const month = monthOf(at);
  const paid = rows.filter(
    (r) =>
      r.marketId === marketId &&
      (r.programId === programId || r.programId === null) &&
      (r.status === "approved" || r.status === "ended") &&
      months.some((m) => m.sponsorshipId === r.id && m.month === month) &&
      (!r.decidedAt || r.decidedAt.getTime() <= at.getTime())
  );
  paid.sort((a, b) => Number(b.programId !== null) - Number(a.programId !== null) || (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0));
  return paid[0] ?? null;
}

export function createCatalogSponsors({ deps, services }: ModuleContext): CatalogSponsorsPart {
  const { db } = deps;

  const seriesList = (): Promise<SeriesInfo[]> => services.shelf.catalogSeries();

  async function catalogRows(where?: ReturnType<typeof and>): Promise<Row[]> {
    return db
      .select()
      .from(SS)
      .where(and(isNotNull(SS.marketId), where))
      .orderBy(asc(SS.createdAt));
  }

  async function monthsOf(rows: Row[]): Promise<MonthRow[]> {
    return rows.length ? db.select().from(SM).where(inArray(SM.sponsorshipId, rows.map((r) => r.id))) : [];
  }

  async function priceOf(marketId: string, seriesId: string | null, at: Date): Promise<number | null> {
    const v = await services.settings.valueAt("catalog.sponsor_prices", at, marketId);
    return seriesId ? v.seriesMonthlyMicros : v.everySeriesMonthlyMicros;
  }

  async function editableMarkets(user: CurrentUser | null, markets: Market[]): Promise<Set<string>> {
    if (!user) return new Set();
    const ok = await Promise.all(markets.map(async (m) => [m.id, await services.settings.mayDesk(user, { market: m.id })] as const));
    return new Set(ok.filter(([, may]) => may).map(([id]) => id));
  }

  /** Everything the page and each sponsorship's view read: the series, markets, rows, what aired this month and what airs this week. */
  async function world(at: Date) {
    const month = monthOf(at);
    const [series, markets, rows] = await Promise.all([seriesList(), services.network.allMarkets(), catalogRows()]);
    const programIds = series.map((s) => s.programId);
    const [months, aired, upcoming] = await Promise.all([
      monthsOf(rows),
      services.playout.catalogCreditsAired(programIds, new Date(`${month}T00:00:00.000Z`), at),
      Promise.all(series.map(async (s) => (await services.log.upcomingForProgram(s.programId, 5000)).filter((e) => Date.parse(e.startsAt) < at.getTime() + WEEK).map((e) => ({ programId: s.programId, stationId: e.stationId }))))
    ]);
    const week = upcoming.flat();
    const profiles = await services.stations.profiles([...new Set([...aired.map((a) => a.stationId), ...week.map((w) => w.stationId)])]);
    const marketOf = (stationId: string) => profiles.get(stationId)?.marketId ?? null;
    // Each aired credit, and whom it thanked: the sponsor crediting the slot when it aired, or the house.
    const credits = aired.map((a) => {
      const marketId = marketOf(a.stationId);
      return { ...a, marketId, sponsorshipId: crediting(rows, months, marketId, a.programId, a.startedAt)?.id ?? null };
    });
    const airings = week.map((w) => ({ ...w, marketId: marketOf(w.stationId) }));
    return { month, series, markets, rows, months, credits, airings };
  }
  type World = Awaited<ReturnType<typeof world>>;

  function stateOf(r: Row, w: World): CatalogSponsorship["state"] {
    const paidNow = w.months.some((m) => m.sponsorshipId === r.id && m.month === w.month);
    if (r.status === "requested") return "offered";
    if (r.status === "approved") return paidNow ? "credited" : "starting";
    if (r.status === "ended") return paidNow ? "ending" : "ended";
    return r.status;
  }

  async function views(rows: Row[], w: World, user: CurrentUser | null): Promise<CatalogSponsorship[]> {
    if (!rows.length) return [];
    const [names, people, editable] = await Promise.all([
      services.spots.businessNames(rows.map((r) => r.advertiserId)),
      services.accounts.peopleByIds(rows.map((r) => r.offeredBy).filter((v): v is string => !!v)),
      editableMarkets(user, w.markets)
    ]);
    return rows.flatMap((r) => {
      const market = w.markets.find((m) => m.id === r.marketId);
      if (!market) return [];
      const s = r.programId ? w.series.find((x) => x.programId === r.programId) : null;
      if (r.programId && !s) return [];
      const state = stateOf(r, w);
      const paid = w.months.filter((m) => m.sponsorshipId === r.id).map((m) => m.month).sort();
      const stations = new Set(w.airings.filter((a) => a.marketId === r.marketId && (!r.programId || a.programId === r.programId)).map((a) => a.stationId));
      const person = r.offeredBy ? people.get(r.offeredBy) : undefined;
      return [
        {
          id: r.id,
          business: { id: r.advertiserId, name: names.get(r.advertiserId) ?? "" },
          series: s ? { id: s.id, title: s.title, colour: s.colour } : null,
          market,
          monthlyMicros: r.monthlyMicros,
          creditText: r.creditText,
          state,
          how: r.offeredBy && r.decidedBy === r.offeredBy ? "assigned" : "offered",
          startsOn: r.startsOn,
          renewsOn: state === "credited" || state === "starting" ? (state === "starting" && monthOf(r.startsOn) > w.month ? monthOf(r.startsOn) : shiftMonth(w.month, 1)) : null,
          endsOn: state === "ending" ? lastDayOf(w.month) : null,
          since: paid[0] ?? null,
          offeredBy: r.offeredBy ? { userId: r.offeredBy, name: person?.name ?? "Someone on the team" } : null,
          createdAt: r.createdAt.toISOString(),
          creditsThisMonth: w.credits.filter((c) => c.sponsorshipId === r.id).length,
          airsOn: stations.size,
          canEnd: editable.has(market.id) && (state === "offered" || state === "starting" || state === "credited")
        } satisfies CatalogSponsorship
      ];
    });
  }

  async function viewOf(id: string, user: CurrentUser | null): Promise<CatalogSponsorship> {
    const w = await world(deps.clock.now());
    const row = w.rows.find((r) => r.id === id);
    if (!row) throw notFound("That sponsorship");
    const [view] = await views([row], w, user);
    if (!view) throw notFound("That sponsorship");
    return view;
  }

  async function catalogRow(id: string): Promise<Row> {
    const [row] = await db.select().from(SS).where(and(eq(SS.id, id), isNotNull(SS.marketId)));
    if (!row) throw notFound("That sponsorship");
    return row;
  }

  /** Holds a sponsorship's month now, inside the caller's transaction (throws 422 `insufficient_balance`). */
  async function holdMonth(tx: Executor, row: Row, month: string, business: string) {
    let holdId: string;
    try {
      holdId = await services.ledger.hold(tx, {
        businessId: row.advertiserId,
        purpose: "sponsorship_month",
        sponsorshipId: row.id,
        amountMicros: row.monthlyMicros,
        memo: "Held for a month of catalog sponsorship"
      });
    } catch (error) {
      if (error instanceof HttpError && error.code === "insufficient_balance") {
        throw refused("insufficient_balance", `${business} doesn't have ${dollars(row.monthlyMicros)} available to hold for the first month.`);
      }
      throw error;
    }
    await tx.insert(SM).values({ sponsorshipId: row.id, month, holdId });
  }

  async function createSlot(user: CurrentUser, input: SlotInput, mode: "offer" | "assign"): Promise<CatalogSponsorship> {
    await services.settings.requireDesk(user, { market: input.marketId });
    const now = deps.clock.now();
    const thisMonth = monthOf(now);
    const market = (await services.network.marketsByIds([input.marketId])).get(input.marketId);
    if (!market) throw notFound("That market");
    const series = input.seriesId ? (await seriesList()).find((s) => s.id === input.seriesId) : null;
    if (input.seriesId && !series) throw notFound("That series");
    const [business] = await db.select().from(AD).where(eq(AD.id, input.businessId));
    if (!business) throw notFound("That business");
    if (business.closedAt) throw refused("business_closed", `${business.name} has closed its account.`);
    const check = checkCreditText(input.creditText);
    if (!check.passes) {
      throw refused("credit_text", `The credit can't be sent yet: ${check.flags.map((f) => `"${f.text}"`).join(", ")}. ${check.flags[0]?.suggestion ?? ""}`.trim());
    }
    if (!/^\d{4}-\d{2}-01$/.test(input.startsOn) || input.startsOn < thisMonth) throw refused("bad_month", "Choose the 1st of this month or a later one.");
    const price = await priceOf(input.marketId, input.seriesId, new Date(`${input.startsOn}T00:00:00.000Z`) > now ? new Date(`${input.startsOn}T00:00:00.000Z`) : now);
    if (price === null || price <= 0) {
      throw refused("not_for_sale", `This slot isn't for sale yet: ${input.seriesId ? "a series'" : "every series'"} price in ${market.name} isn't set (Settings, Rules, ${RULES["catalog.sponsor_prices"].title}).`);
    }
    const catalogStation = series?.stationId ?? (await services.stations.idsOfKinds(["catalog"]))[0];
    if (!catalogStation) throw refused("no_catalog_station", "There's no catalog station yet. Set one up on a market's board first.");
    const programId = series?.programId ?? null;
    const [taken] = await db
      .select({ id: SS.id })
      .from(SS)
      .where(and(eq(SS.marketId, input.marketId), programId ? eq(SS.programId, programId) : isNull(SS.programId), inArray(SS.status, ["requested", "approved"])));
    const takenError = () => conflict("slot_taken", `${series?.title ?? "Every catalog series"} in ${market.name} is taken or offered. End that first.`);
    if (taken) throw takenError();
    const values = {
      advertiserId: business.id,
      stationId: catalogStation,
      programId,
      marketId: input.marketId,
      monthlyMicros: price,
      creditText: input.creditText.trim(),
      creditCheckedAt: now,
      startsOn: input.startsOn,
      offeredBy: user.id,
      ...(mode === "assign" ? { status: "approved" as const, decidedAt: now, decidedBy: user.id } : {})
    };
    let id: string;
    try {
      id = await db.transaction(async (tx) => {
        const [row] = await tx.insert(SS).values(values).returning();
        // Assigned from this month: the first month is held now, or nothing is assigned.
        if (mode === "assign" && input.startsOn <= thisMonth) await holdMonth(tx, row, thisMonth, business.name);
        return row.id;
      });
    } catch (error) {
      if ((error as { code?: string; cause?: { code?: string } }).code === "23505" || (error as { cause?: { code?: string } }).cause?.code === "23505") throw takenError();
      throw error;
    }
    if (mode === "assign") await part.replanMarkets([input.marketId]);
    return viewOf(id, user);
  }

  const part: CatalogSponsorsPart = {
    async catalogSponsors(user, marketId) {
      const now = deps.clock.now();
      const w = await world(now);
      const editable = await editableMarkets(user, w.markets);
      const inScope = (id: string | null) => !marketId || id === marketId;
      const live = w.rows.filter((r) => r.status === "requested" || r.status === "approved" || (r.status === "ended" && w.months.some((m) => m.sponsorshipId === r.id && m.month === w.month)));
      const sponsors = await views(live.filter((r) => inScope(r.marketId)), w, user);

      const slots: CatalogSlot[] = [];
      const markets = w.markets.filter((m) => inScope(m.id));
      for (const market of w.markets) {
        const prices = await services.settings.valueAt("catalog.sponsor_prices", now, market.id);
        for (const s of [...w.series, null]) {
          const programId = s?.programId ?? null;
          const mine = w.rows.filter((r) => r.marketId === market.id && r.programId === programId);
          const offer = mine.find((r) => r.status === "requested") ?? null;
          const own = mine.find((r) => r.status === "approved") ?? null;
          const paidOwn = mine.find((r) => (r.status === "approved" || r.status === "ended") && w.months.some((m) => m.sponsorshipId === r.id && m.month === w.month)) ?? null;
          const every = s ? w.rows.find((r) => r.marketId === market.id && r.programId === null && (r.status === "approved" || r.status === "ended") && w.months.some((m) => m.sponsorshipId === r.id && m.month === w.month)) : null;
          const priceMicros = s ? prices.seriesMonthlyMicros : prices.everySeriesMonthlyMicros;
          const here = w.airings.filter((a) => a.marketId === market.id && (!s || a.programId === s.programId));
          slots.push({
            series: s ? { id: s.id, title: s.title, colour: s.colour } : null,
            market,
            creditedBy: paidOwn ? "sponsor" : every ? "every_series" : "house",
            sponsorshipId: (paidOwn ?? own)?.id ?? null,
            offerId: offer?.id ?? null,
            priceMicros,
            forSale: priceMicros !== null && priceMicros > 0 && !offer && !own,
            airsPerDay: Math.round(here.length / 7),
            stations: new Set(here.map((a) => a.stationId)).size,
            creditsThisMonth: w.credits.filter((c) => c.marketId === market.id && (!s || c.programId === s.programId)).length,
            canEdit: editable.has(market.id)
          });
        }
      }
      const split = await services.settings.valueAt("shares.catalog_sponsorship", now);
      const lastMonth = shiftMonth(w.month, -1);
      const [recorded] = await db
        .select({ slots: sql<number>`count(*)::int`, credits: sql<number>`coalesce(sum(${HC.credits}), 0)::int` })
        .from(HC)
        .where(eq(HC.month, lastMonth));
      const paidNow = w.rows.filter((r) => w.months.some((m) => m.sponsorshipId === r.id && m.month === w.month));
      return {
        month: w.month,
        stats: {
          creditsThisMonth: w.credits.length,
          monthlyMicros: paidNow.reduce((sum, r) => sum + r.monthlyMicros, 0),
          marketsWithOpenSlots: new Set(slots.filter((s) => s.forSale).map((s) => s.market.id)).size,
          fundShareBps: split.fundBps,
          fundShareSet: !!(split.opencastBps || split.poolBps || split.fundBps)
        },
        house: {
          name: CATALOG_HOUSE_SPONSOR.name,
          creditText: CATALOG_HOUSE_SPONSOR.creditText,
          creditsThisMonth: w.credits.filter((c) => !c.sponsorshipId).length,
          billedMicros: null,
          lastMonth: recorded && recorded.slots ? { month: lastMonth, slots: recorded.slots, credits: recorded.credits } : null
        },
        sponsors,
        slots: slots.filter((s) => markets.some((m) => m.id === s.market.id)),
        series: w.series.map((s) => ({ id: s.id, title: s.title, colour: s.colour })),
        markets: w.markets,
        editableMarketIds: [...editable]
      };
    },

    async catalogSponsorBusinesses(q) {
      const text = q?.trim();
      const rows = await db
        .select({ id: AD.id, name: AD.name, category: AD.category })
        .from(AD)
        .where(and(isNull(AD.closedAt), text ? ilike(AD.name, `%${text.replace(/[%_\\]/g, (c) => `\\${c}`)}%`) : undefined))
        .orderBy(asc(AD.name))
        .limit(20);
      if (!rows.length) return [];
      const places = await db
        .select({ advertiserId: schema.advertiserLocations.advertiserId, city: schema.advertiserLocations.city })
        .from(schema.advertiserLocations)
        .where(inArray(schema.advertiserLocations.advertiserId, rows.map((r) => r.id)))
        .orderBy(asc(schema.advertiserLocations.createdAt));
      return rows.map((r) => ({ ...r, city: places.find((p) => p.advertiserId === r.id)?.city ?? null }));
    },

    offerCatalogSponsorship: (user, input) => createSlot(user, input, "offer"),
    assignCatalogSponsorship: (user, input) => createSlot(user, input, "assign"),

    async endCatalogSponsorship(user, sponsorshipId) {
      const row = await catalogRow(sponsorshipId);
      await services.settings.requireDesk(user, { market: row.marketId! });
      if (row.status === "requested" || row.status === "approved") {
        await db.update(SS).set({ status: "ended" }).where(eq(SS.id, row.id));
        if (row.status === "approved") await part.replanMarkets([row.marketId!]);
      }
      return viewOf(row.id, user);
    },

    async businessCatalogSponsorships(businessId) {
      const w = await world(deps.clock.now());
      return views(w.rows.filter((r) => r.advertiserId === businessId).reverse(), w, null);
    },

    async answerCatalogOffer(businessId, userId, sponsorshipId, decision) {
      const row = await catalogRow(sponsorshipId);
      if (row.advertiserId !== businessId) throw notFound("That sponsorship");
      if (row.status !== "requested") throw refused("already_answered", "That offer has been answered, or withdrawn.");
      const now = deps.clock.now();
      const thisMonth = monthOf(now);
      if (decision === "decline") {
        await db.update(SS).set({ status: "declined", decidedAt: now, decidedBy: userId }).where(eq(SS.id, row.id));
        return viewOf(row.id, null);
      }
      const [business] = await db.select({ name: AD.name }).from(AD).where(eq(AD.id, businessId));
      await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(SS)
          .set({ status: "approved", decidedAt: now, decidedBy: userId })
          .where(and(eq(SS.id, row.id), eq(SS.status, "requested")))
          .returning();
        if (!updated) throw refused("already_answered", "That offer has been answered, or withdrawn.");
        // Started already: this month is held now (as a station's approval does); otherwise on the 1st.
        if (monthOf(row.startsOn) <= thisMonth) await holdMonth(tx, updated, thisMonth, business?.name ?? "The business");
      });
      await part.replanMarkets([row.marketId!]);
      return viewOf(row.id, null);
    },

    async catalogCredits(stationId, programIds, at) {
      const out = new Map<string, CatalogCredit>();
      if (!programIds.length) return out;
      const series = (await seriesList()).filter((s) => programIds.includes(s.programId));
      if (!series.length) return out;
      const marketId = (await services.stations.profiles([stationId])).get(stationId)?.marketId ?? null;
      let rows: Row[] = [];
      let months: MonthRow[] = [];
      if (marketId) {
        const found = await db
          .select({ sponsorship: SS, month: SM })
          .from(SS)
          .innerJoin(SM, and(eq(SM.sponsorshipId, SS.id), eq(SM.month, monthOf(at))))
          .where(and(eq(SS.marketId, marketId), inArray(SS.status, ["approved", "ended"])));
        rows = found.map((f) => f.sponsorship);
        months = found.map((f) => f.month);
      }
      const names = await services.spots.businessNames(rows.map((r) => r.advertiserId));
      for (const s of series) {
        const paid = crediting(rows, months, marketId, s.programId, at);
        out.set(s.programId, {
          subject: s.title,
          colour: s.colour,
          sponsor: paid ? { business: names.get(paid.advertiserId) ?? "", creditText: paid.creditText } : { business: CATALOG_HOUSE_SPONSOR.name, creditText: CATALOG_HOUSE_SPONSOR.creditText },
          house: !paid,
          sponsorshipId: paid?.id ?? null
        });
      }
      return out;
    },

    async recordHouseCredits(month) {
      const series = await seriesList();
      if (!series.length) return 0;
      const from = new Date(`${month}T00:00:00.000Z`);
      const to = new Date(`${shiftMonth(month, 1)}T00:00:00.000Z`);
      const [rows, aired] = await Promise.all([catalogRows(), services.playout.catalogCreditsAired(series.map((s) => s.programId), from, to)]);
      const months = await monthsOf(rows);
      const profiles = await services.stations.profiles([...new Set(aired.map((a) => a.stationId))]);
      const counts = new Map<string, { programId: string; marketId: string; credits: number }>();
      for (const a of aired) {
        const marketId = profiles.get(a.stationId)?.marketId ?? null;
        if (!marketId || crediting(rows, months, marketId, a.programId, a.startedAt)) continue;
        const key = `${a.programId}:${marketId}`;
        const c = counts.get(key) ?? { programId: a.programId, marketId, credits: 0 };
        c.credits++;
        counts.set(key, c);
      }
      if (!counts.size) return 0;
      const inserted = await db
        .insert(HC)
        .values([...counts.values()].map((c) => ({ ...c, month })))
        .onConflictDoNothing()
        .returning({ programId: HC.programId });
      return inserted.length;
    },

    async replanMarkets(marketIds) {
      const ids = [...new Set(marketIds)];
      if (!ids.length) return;
      for (const station of await services.stations.inMarkets(ids)) {
        await services.playout.replan(station.id).catch((error) => console.error("[catalog sponsors] replan failed", error));
      }
    }
  };
  return part;
}
