import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { Agreement, CarriageRequest, Offer, StationIdent } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import { badRequest, notFound, refused } from "../../errors.js";
import { addDays, localDay, localWeekday, roundUpToMinute, zonedTime } from "../../lib/time.js";

type Term = "barter" | "cash" | "cash_plus_barter" | "free";

export interface AgreementRef {
  id: string;
  makerStationId: string;
  carrierStationId: string;
  programId: string;
  term: Term;
  cashPriceMicros: number | null;
  cashPriceUnit: "per_airing" | "per_hour" | null;
  barterMakerMsPerHour: number | null;
  airingsPerEpisode: number | null;
  windowDays: number;
  liveOnly: boolean;
  startedAt: Date;
  endsAt: Date | null;
}

export interface TermsInput {
  termsOffered: Term[];
  cashPriceMicros: number | null;
  cashPriceUnit: "per_airing" | "per_hour" | null;
  barterMakerMsPerHour: number | null;
  airingsPerEpisode: number | null;
  windowDays: 7 | 30;
  liveOnly: boolean;
  noticeDays: number;
  approval: "any_station" | "i_approve";
  radioBandAllowed: boolean;
}

export interface CatalogService {
  agreementsByIds(ids: string[]): Promise<Map<string, AgreementRef>>;
  /** Throws unless this airing is allowed under the agreement (dates, per-episode limit, window, live only). */
  checkAiring(input: { agreementId: string; carrierStationId: string; itemId: string; startsAt: Date; excludeEntryId?: string }): Promise<void>;
  carrierCount(programId: string): Promise<number>;
  /**
   * A carried episode aired: under a cash deal the carrier pays the maker, once per log entry
   * (per airing, or per hour of the slot). Barter is settled with the spots in its breaks.
   */
  chargeCarriedAiring(input: { agreementId: string; carrierStationId: string; logEntryId: string }): Promise<number>;
  /** The program's open offer, if it has one. */
  openOfferFor(programId: string): Promise<string | null>;
  /** Active agreements a station is party to, for earnings and playout. */
  activeAgreements(stationId: string): Promise<AgreementRef[]>;

  browse(filter: { forStation?: string; category?: string; band?: "tv" | "radio"; term?: Term; fitsSchedule?: boolean; q?: string }): Promise<Offer[]>;
  offer(offerId: string): Promise<Offer & { episodes: Array<{ id: string; title: string; durationMs: number | null; breakPointsMs: number[]; previewUrl: string | null }>; carriedBy: Array<{ station: StationIdent; since: string }> }>;
  countPreview(offerId: string): Promise<number>;
  makerOfOffer(offerId: string): Promise<string>;
  offerProgram(programId: string, terms: TermsInput): Promise<Offer>;
  updateOffer(offerId: string, patch: Partial<TermsInput> & { status?: "offered" | "withdrawn" }): Promise<Offer>;
  request(offerId: string, input: { carrierStationId: string; term: Term; slots: Array<{ weekday: number; time: string }>; startsOn: string; audioOnly: boolean }): Promise<CarriageRequest>;
  requests(stationId: string): Promise<{ incoming: CarriageRequest[]; outgoing: CarriageRequest[] }>;
  makerOfRequest(requestId: string): Promise<string>;
  decide(requestId: string, userId: string, decision: { decision: "approve" } | { decision: "decline"; reason: "not_right_fit" | "time_slot" | "terms" | null }): Promise<CarriageRequest>;
  agreements(stationId: string): Promise<{ carrying: Agreement[]; carriedBy: Agreement[] }>;
  partiesOf(agreementId: string): Promise<{ makerStationId: string; carrierStationId: string }>;
  endAgreement(agreementId: string, by: "maker" | "carrier"): Promise<Agreement>;
  place(agreementId: string, input: { from: string; weeks: number; replaceExisting: boolean }): Promise<{ placed: number; replaced: number; blockedByLimit: number }>;
}

const O = schema.offers;
const Q = schema.requests;
const G = schema.agreements;
const DAY = 86_400_000;

export function createCatalogService({ deps, services }: ModuleContext): CatalogService {
  const { db } = deps;

  function agreementRef(a: typeof G.$inferSelect): AgreementRef {
    return {
      id: a.id,
      makerStationId: a.makerStationId,
      carrierStationId: a.carrierStationId,
      programId: a.programId,
      term: a.term,
      cashPriceMicros: a.cashPriceMicros,
      cashPriceUnit: a.cashPriceUnit,
      barterMakerMsPerHour: a.barterMakerMsPerHour,
      airingsPerEpisode: a.airingsPerEpisode,
      windowDays: a.windowDays,
      liveOnly: a.liveOnly,
      startedAt: a.startedAt,
      endsAt: a.endsAt
    };
  }

  async function activeCarriers(programIds: string[]) {
    if (!programIds.length) return new Map<string, Array<typeof G.$inferSelect>>();
    const now = deps.clock.now();
    const rows = await db
      .select()
      .from(G)
      .where(and(inArray(G.programId, programIds), or(isNull(G.endsAt), gt(G.endsAt, now))));
    const by = new Map<string, Array<typeof G.$inferSelect>>();
    for (const r of rows) by.set(r.programId, [...(by.get(r.programId) ?? []), r]);
    return by;
  }

  async function offerViews(rows: Array<typeof O.$inferSelect>, forStation?: string): Promise<Offer[]> {
    if (!rows.length) return [];
    const programs = await services.library.programsByIds(rows.map((r) => r.programId));
    const profiles = await services.stations.profiles(rows.map((r) => r.makerStationId));
    const carriers = await activeCarriers(rows.map((r) => r.programId));
    const episodes = new Map(await Promise.all(rows.map(async (r) => [r.programId, await services.library.episodes(r.programId)] as const)));
    const previews = await db
      .select({ offerId: schema.offerPreviews.offerId, n: sql<number>`sum(${schema.offerPreviews.count})::int` })
      .from(schema.offerPreviews)
      .where(inArray(schema.offerPreviews.offerId, rows.map((r) => r.id)))
      .groupBy(schema.offerPreviews.offerId);
    const previewsBy = new Map(previews.map((p) => [p.offerId, p.n]));
    let gaps: Array<{ startsAt: string; endsAt: string }> | null = null;
    if (forStation) {
      const now = deps.clock.now();
      gaps = await services.log.gaps(forStation, now, new Date(now.getTime() + 7 * DAY));
    }
    return rows.flatMap((r) => {
      const program = programs.get(r.programId);
      const maker = profiles.get(r.makerStationId);
      if (!program || !maker) return [];
      const eps = episodes.get(r.programId) ?? [];
      const longest = Math.max(0, ...eps.map((e) => e.durationMs ?? 0));
      return [
        {
          id: r.id,
          program: {
            id: program.id,
            title: program.title,
            description: program.description,
            category: program.category,
            live: program.live,
            episodeCount: eps.length,
            rightsNote: program.rightsNote
          },
          maker: maker.ident,
          makerKind: maker.kind === "studio" ? "studio" : maker.kind === "catalog" ? "catalog" : "station",
          status: r.status,
          carriers: carriers.get(r.programId)?.length ?? 0,
          fitsYourSchedule: gaps ? gaps.some((g) => Date.parse(g.endsAt) - Date.parse(g.startsAt) >= roundUpToMinute(longest || 30 * 60_000)) : null,
          previews: previewsBy.get(r.id) ?? 0,
          termsOffered: r.termsOffered as Term[],
          cashPriceMicros: r.cashPriceMicros,
          cashPriceUnit: r.cashPriceUnit,
          barterMakerMsPerHour: r.barterMakerMsPerHour,
          airingsPerEpisode: r.airingsPerEpisode,
          windowDays: r.windowDays === 30 ? 30 : 7,
          liveOnly: r.liveOnly,
          noticeDays: r.noticeDays,
          approval: r.approval,
          radioBandAllowed: r.radioBandAllowed
        }
      ];
    });
  }

  async function requestViews(rows: Array<typeof Q.$inferSelect>): Promise<CarriageRequest[]> {
    if (!rows.length) return [];
    const offers = await db.select().from(O).where(inArray(O.id, rows.map((r) => r.offerId)));
    const offerBy = new Map(offers.map((o) => [o.id, o]));
    const programs = await services.library.programsByIds(offers.map((o) => o.programId));
    const idents = await services.stations.idents([...rows.map((r) => r.carrierStationId), ...offers.map((o) => o.makerStationId)]);
    const rules = new Map(await Promise.all([...new Set(rows.map((r) => r.carrierStationId))].map(async (id) => [id, await services.stations.breakRule(id)] as const)));
    return rows.flatMap((r) => {
      const offer = offerBy.get(r.offerId);
      const program = offer && programs.get(offer.programId);
      const carrier = idents.get(r.carrierStationId);
      const maker = offer && idents.get(offer.makerStationId);
      if (!offer || !program || !carrier || !maker) return [];
      return [
        {
          id: r.id,
          offerId: r.offerId,
          program: { id: program.id, title: program.title },
          carrier,
          maker,
          term: r.term,
          slots: r.slots as Array<{ weekday: number; time: string }>,
          startsOn: r.startsOn,
          audioOnly: r.audioOnly,
          status: r.status,
          declineReason: r.declineReason,
          carrierSpotMsPerHour: rules.get(r.carrierStationId)?.spotMsPerHour ?? 180_000,
          createdAt: r.createdAt.toISOString(),
          decidedAt: r.decidedAt?.toISOString() ?? null
        }
      ];
    });
  }

  async function agreementViews(rows: Array<typeof G.$inferSelect>): Promise<Agreement[]> {
    if (!rows.length) return [];
    const now = deps.clock.now();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [programs, idents, airings, paid] = await Promise.all([
      services.library.programsByIds(rows.map((r) => r.programId)),
      services.stations.idents(rows.flatMap((r) => [r.makerStationId, r.carrierStationId])),
      services.playout.carriedAirings(rows.map((r) => r.id), monthStart, now),
      services.ledger.carriagePaid(rows.map((r) => r.id), monthStart, now)
    ]);
    return rows.flatMap((r) => {
      const program = programs.get(r.programId);
      const maker = idents.get(r.makerStationId);
      const carrier = idents.get(r.carrierStationId);
      if (!program || !maker || !carrier) return [];
      return [
        {
          id: r.id,
          program: { id: program.id, title: program.title },
          maker,
          carrier,
          term: r.term,
          terms: {
            cashPriceMicros: r.cashPriceMicros,
            cashPriceUnit: r.cashPriceUnit,
            barterMakerMsPerHour: r.barterMakerMsPerHour,
            airingsPerEpisode: r.airingsPerEpisode,
            windowDays: r.windowDays === 30 ? 30 : 7,
            liveOnly: r.liveOnly,
            noticeDays: r.noticeDays
          },
          audioOnly: r.audioOnly,
          startedAt: r.startedAt.toISOString(),
          endNoticeGivenAt: r.endNoticeGivenAt?.toISOString() ?? null,
          endsAt: r.endsAt?.toISOString() ?? null,
          airingsThisMonth: airings.get(r.id) ?? 0,
          paidThisMonthMicros: paid.get(r.id) ?? 0
        }
      ];
    });
  }

  function validateTerms(terms: Partial<TermsInput>, makerKind: string) {
    const offered = terms.termsOffered ?? [];
    if (offered.includes("free") && makerKind !== "catalog") throw badRequest("Free carriage is the Opencast catalog's term.");
    if ((offered.includes("cash") || offered.includes("cash_plus_barter")) && (!terms.cashPriceMicros || !terms.cashPriceUnit)) {
      throw badRequest("Set a cash price and whether it's per airing or per hour.", { cashPriceMicros: "Required" });
    }
    if ((offered.includes("barter") || offered.includes("cash_plus_barter")) && !terms.barterMakerMsPerHour) {
      throw badRequest("Say how much break time you fill each hour under barter.", { barterMakerMsPerHour: "Required" });
    }
  }

  async function createAgreement(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], request: typeof Q.$inferSelect, offer: typeof O.$inferSelect, startsOnTz: string) {
    const startedAt = localDay(request.startsOn, startsOnTz).from;
    await tx.insert(G).values({
      requestId: request.id,
      offerId: offer.id,
      programId: offer.programId,
      makerStationId: offer.makerStationId,
      carrierStationId: request.carrierStationId,
      term: request.term,
      cashPriceMicros: request.term === "cash" || request.term === "cash_plus_barter" ? offer.cashPriceMicros : null,
      cashPriceUnit: request.term === "cash" || request.term === "cash_plus_barter" ? offer.cashPriceUnit : null,
      barterMakerMsPerHour: request.term === "barter" || request.term === "cash_plus_barter" ? offer.barterMakerMsPerHour : null,
      airingsPerEpisode: offer.airingsPerEpisode,
      windowDays: offer.windowDays,
      liveOnly: offer.liveOnly,
      noticeDays: offer.noticeDays,
      audioOnly: request.audioOnly,
      startedAt
    });
  }

  async function previewEpisodes(offerId: string, programId: string) {
    const episodes = await services.library.episodes(programId);
    await services.library.content.needPreview(episodes.map((e) => e.contentId).filter((v): v is string => Boolean(v)), "offer", offerId);
  }

  const service: CatalogService = {
    async agreementsByIds(ids) {
      if (!ids.length) return new Map();
      const rows = await db.select().from(G).where(inArray(G.id, [...new Set(ids)]));
      return new Map(rows.map((r) => [r.id, agreementRef(r)]));
    },

    async checkAiring({ agreementId, carrierStationId, itemId, startsAt, excludeEntryId }) {
      const [agreement] = await db.select().from(G).where(eq(G.id, agreementId));
      if (!agreement || agreement.carrierStationId !== carrierStationId) throw refused("needs_agreement", "Another station's program needs a carriage agreement.");
      if (startsAt < agreement.startedAt) throw refused("before_agreement", "The agreement hasn't started by then.");
      if (agreement.endsAt && startsAt >= agreement.endsAt) throw refused("agreement_ended", "The agreement has ended by then.");
      const item = (await services.library.itemsByIds([itemId])).get(itemId);
      if (!item || item.programId !== agreement.programId) throw refused("not_this_program", "That isn't an episode of the program you carry.");
      if (agreement.airingsPerEpisode) {
        const count = await services.log.countCarried({ carrierStationId, agreementId, itemId, excludeEntryId });
        if (count >= agreement.airingsPerEpisode) {
          throw refused("airing_limit", `The agreement allows ${agreement.airingsPerEpisode} ${agreement.airingsPerEpisode === 1 ? "airing" : "airings"} of each episode.`);
        }
      }
      const firstOnMaker = await services.log.firstAiring(agreement.makerStationId, itemId);
      if (firstOnMaker && startsAt.getTime() > firstOnMaker.getTime() + agreement.windowDays * DAY) {
        throw refused("outside_window", `Episodes can air within ${agreement.windowDays} days of their first airing on the maker.`);
      }
      if (agreement.liveOnly && !(await services.log.airsAt(agreement.makerStationId, itemId, startsAt))) {
        throw refused("live_only", "This program is carried live only, at the same time as the maker airs it.");
      }
    },

    async chargeCarriedAiring(input) {
      const agreement = (await service.agreementsByIds([input.agreementId])).get(input.agreementId);
      if (!agreement || (agreement.term !== "cash" && agreement.term !== "cash_plus_barter") || !agreement.cashPriceMicros) return 0;
      const span = await services.log.entrySpan(input.logEntryId);
      if (!span) return 0;
      const hours = (span.endsAt.getTime() - span.startsAt.getTime()) / 3_600_000;
      const micros = agreement.cashPriceUnit === "per_hour" ? Math.round(agreement.cashPriceMicros * hours) : agreement.cashPriceMicros;
      await db.transaction((tx) =>
        services.ledger.chargeCarriageFee(tx, {
          agreementId: agreement.id,
          carrierStationId: input.carrierStationId,
          makerStationId: agreement.makerStationId,
          micros,
          source: { memo: "Carried episode aired", idempotencyKey: `carriage:${input.logEntryId}` }
        })
      );
      return micros;
    },

    async openOfferFor(programId) {
      const [row] = await db.select({ id: O.id }).from(O).where(and(eq(O.programId, programId), eq(O.status, "offered")));
      return row?.id ?? null;
    },

    async carrierCount(programId) {
      return (await activeCarriers([programId])).get(programId)?.length ?? 0;
    },

    async activeAgreements(stationId) {
      const now = deps.clock.now();
      const rows = await db
        .select()
        .from(G)
        .where(and(or(eq(G.makerStationId, stationId), eq(G.carrierStationId, stationId)), or(isNull(G.endsAt), gt(G.endsAt, now))));
      return rows.map(agreementRef);
    },

    async browse(filter) {
      const rows = await db.select().from(O).where(eq(O.status, "offered")).orderBy(desc(O.createdAt));
      let offers = await offerViews(rows, filter.forStation);
      if (filter.forStation) offers = offers.filter((o) => o.maker.id !== filter.forStation);
      if (filter.category) offers = offers.filter((o) => o.program.category === filter.category);
      if (filter.band === "radio") offers = offers.filter((o) => o.radioBandAllowed);
      if (filter.term) offers = offers.filter((o) => o.termsOffered.includes(filter.term!));
      if (filter.fitsSchedule) offers = offers.filter((o) => o.fitsYourSchedule);
      if (filter.q) {
        const q = filter.q.toLowerCase();
        offers = offers.filter((o) => o.program.title.toLowerCase().includes(q) || (o.maker.callSign ?? "").toLowerCase() === q);
      }
      return offers;
    },

    async offer(offerId) {
      const rows = await db.select().from(O).where(eq(O.id, offerId));
      const [view] = await offerViews(rows);
      if (!view) throw notFound("That offer");
      const [episodes, carriers] = await Promise.all([services.library.episodes(view.program.id), activeCarriers([view.program.id])]);
      const idents = await services.stations.idents((carriers.get(view.program.id) ?? []).map((a) => a.carrierStationId));
      return {
        ...view,
        episodes: await Promise.all(episodes.map(async (e) => ({ id: e.id, title: e.title, durationMs: e.durationMs, breakPointsMs: e.breakPointsMs, previewUrl: await services.library.content.previewUrl(e.contentId) }))),
        carriedBy: (carriers.get(view.program.id) ?? []).flatMap((a) => {
          const station = idents.get(a.carrierStationId);
          return station ? [{ station, since: a.startedAt.toISOString() }] : [];
        })
      };
    },

    async countPreview(offerId) {
      const day = deps.clock.now().toISOString().slice(0, 10);
      await db
        .insert(schema.offerPreviews)
        .values({ offerId, day, count: 1 })
        .onConflictDoUpdate({ target: [schema.offerPreviews.offerId, schema.offerPreviews.day], set: { count: sql`${schema.offerPreviews.count} + 1` } });
      const [row] = await db
        .select({ n: sql<number>`sum(${schema.offerPreviews.count})::int` })
        .from(schema.offerPreviews)
        .where(eq(schema.offerPreviews.offerId, offerId));
      return row.n;
    },

    async makerOfOffer(offerId) {
      const [row] = await db.select({ maker: O.makerStationId }).from(O).where(eq(O.id, offerId));
      if (!row) throw notFound("That offer");
      return row.maker;
    },

    async offerProgram(programId, terms) {
      const makerStationId = await services.library.stationOfProgram(programId);
      if (await services.library.hasLinkImports(programId)) {
        throw refused("link_imports", "Link imports stay local: this program can't be offered.");
      }
      const standing = await services.trust.standing(makerStationId);
      if (standing.status === "offers_paused") throw refused("offers_paused", "Carriage offers are paused while upheld claims are on the record.");
      const kind = await services.stations.kindOf(makerStationId);
      validateTerms(terms, kind ?? "station");
      const [row] = await db
        .insert(O)
        .values({ programId, makerStationId, ...terms })
        .returning();
      await previewEpisodes(row.id, programId);
      return (await offerViews([row]))[0];
    },

    async updateOffer(offerId, patch) {
      const [current] = await db.select().from(O).where(eq(O.id, offerId));
      if (!current) throw notFound("That offer");
      const kind = await services.stations.kindOf(current.makerStationId);
      const merged = { ...current, ...patch };
      validateTerms({ ...merged, termsOffered: merged.termsOffered as Term[], windowDays: merged.windowDays === 30 ? 30 : 7 }, kind ?? "station");
      const [row] = await db
        .update(O)
        .set({ ...patch, updatedAt: deps.clock.now() })
        .where(eq(O.id, offerId))
        .returning();
      // Previews exist only while it's offered in the market.
      if (patch.status === "withdrawn") await services.library.content.dropPreview("offer", offerId);
      if (patch.status === "offered" && current.status !== "offered") await previewEpisodes(offerId, current.programId);
      return (await offerViews([row]))[0];
    },

    async request(offerId, input) {
      const [offer] = await db.select().from(O).where(and(eq(O.id, offerId), eq(O.status, "offered")));
      if (!offer) throw notFound("That offer");
      if (offer.makerStationId === input.carrierStationId) throw badRequest("You can't carry your own program.");
      if (!(offer.termsOffered as Term[]).includes(input.term)) throw badRequest("Choose one of the deals offered.", { term: "Not offered" });
      const carrier = (await services.stations.profiles([input.carrierStationId])).get(input.carrierStationId);
      if (!carrier) throw notFound("That station");
      if (carrier.ident.band === "radio" && !offer.radioBandAllowed) throw refused("no_radio", "The maker doesn't offer this to radio-band stations.");
      const audioOnly = input.audioOnly || carrier.ident.band === "radio";
      const tz = await services.stations.timezoneOf(input.carrierStationId);
      const request = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(Q)
          .values({ offerId, carrierStationId: input.carrierStationId, term: input.term, slots: input.slots, startsOn: input.startsOn, audioOnly })
          .returning();
        if (offer.approval === "any_station") {
          const [approved] = await tx.update(Q).set({ status: "approved", decidedAt: deps.clock.now() }).where(eq(Q.id, row.id)).returning();
          await createAgreement(tx, approved, offer, tz);
          return approved;
        }
        return row;
      });
      deps.bus.emit("carriage.requested", { requestId: request.id, makerStationId: offer.makerStationId, carrierStationId: input.carrierStationId });
      return (await requestViews([request]))[0];
    },

    async requests(stationId) {
      const offers = await db.select({ id: O.id }).from(O).where(eq(O.makerStationId, stationId));
      const [incoming, outgoing] = await Promise.all([
        offers.length ? db.select().from(Q).where(inArray(Q.offerId, offers.map((o) => o.id))).orderBy(desc(Q.createdAt)) : [],
        db.select().from(Q).where(eq(Q.carrierStationId, stationId)).orderBy(desc(Q.createdAt))
      ]);
      return { incoming: await requestViews(incoming), outgoing: await requestViews(outgoing) };
    },

    async makerOfRequest(requestId) {
      const [row] = await db.select({ maker: O.makerStationId }).from(Q).innerJoin(O, eq(O.id, Q.offerId)).where(eq(Q.id, requestId));
      if (!row) throw notFound("That request");
      return row.maker;
    },

    async decide(requestId, userId, decision) {
      const [row] = await db.select({ request: Q, offer: O }).from(Q).innerJoin(O, eq(O.id, Q.offerId)).where(eq(Q.id, requestId));
      if (!row) throw notFound("That request");
      if (row.request.status !== "asked") throw refused("already_decided", "That request has been answered.");
      const tz = await services.stations.timezoneOf(row.request.carrierStationId);
      const updated = await db.transaction(async (tx) => {
        const [r] = await tx
          .update(Q)
          .set({
            status: decision.decision === "approve" ? "approved" : "declined",
            declineReason: decision.decision === "decline" ? decision.reason : null,
            decidedAt: deps.clock.now(),
            decidedBy: userId
          })
          .where(eq(Q.id, requestId))
          .returning();
        if (decision.decision === "approve") await createAgreement(tx, r, row.offer, tz);
        return r;
      });
      deps.bus.emit("carriage.decided", {
        requestId,
        makerStationId: row.offer.makerStationId,
        carrierStationId: row.request.carrierStationId,
        approved: decision.decision === "approve"
      });
      return (await requestViews([updated]))[0];
    },

    async agreements(stationId) {
      const now = deps.clock.now();
      const rows = await db
        .select()
        .from(G)
        .where(and(or(eq(G.makerStationId, stationId), eq(G.carrierStationId, stationId)), or(isNull(G.endsAt), gt(G.endsAt, now))))
        .orderBy(desc(G.startedAt));
      const views = await agreementViews(rows);
      return { carrying: views.filter((v) => v.carrier.id === stationId), carriedBy: views.filter((v) => v.maker.id === stationId) };
    },

    async partiesOf(agreementId) {
      const [row] = await db.select().from(G).where(eq(G.id, agreementId));
      if (!row) throw notFound("That agreement");
      return { makerStationId: row.makerStationId, carrierStationId: row.carrierStationId };
    },

    async endAgreement(agreementId, by) {
      const [row] = await db.select().from(G).where(eq(G.id, agreementId));
      if (!row) throw notFound("That agreement");
      if (row.endNoticeGivenAt) throw refused("notice_given", "Notice has already been given.");
      const now = deps.clock.now();
      const [updated] = await db
        .update(G)
        .set({ endNoticeGivenAt: now, endNoticeGivenBy: by, endsAt: new Date(now.getTime() + row.noticeDays * DAY) })
        .where(eq(G.id, agreementId))
        .returning();
      return (await agreementViews([updated]))[0];
    },

    async place(agreementId, input) {
      const [row] = await db.select({ agreement: G, request: Q }).from(G).innerJoin(Q, eq(Q.id, G.requestId)).where(eq(G.id, agreementId));
      if (!row) throw notFound("That agreement");
      const tz = await services.stations.timezoneOf(row.agreement.carrierStationId);
      const slots = row.request.slots as Array<{ weekday: number; time: string }>;
      const starts: Date[] = [];
      for (let d = 0; d < input.weeks * 7; d++) {
        const day = addDays(input.from, d);
        const weekday = localWeekday(localDay(day, tz).from, tz);
        for (const slot of slots.filter((s) => s.weekday === weekday)) {
          const start = zonedTime(day, slot.time, tz);
          if (start >= row.agreement.startedAt && start > deps.clock.now()) starts.push(start);
        }
      }
      starts.sort((a, b) => a.getTime() - b.getTime());
      return services.log.placeCarried({
        agreementId,
        carrierStationId: row.agreement.carrierStationId,
        programId: row.agreement.programId,
        starts,
        replaceExisting: input.replaceExisting
      });
    }
  };
  return service;
}
