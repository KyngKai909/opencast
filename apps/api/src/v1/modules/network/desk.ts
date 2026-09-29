// Network desk: Opencast's own view of each market's dial, the creator pipeline,
// permission and licence records, claimable stations set up from recipes, held
// earnings, and listed city streams.

import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import { formatChannelNumber, parseChannelNumber, type Band } from "@opencast/domain";
import { RecipeBreakRule, type Creator, type CreatorWork, type HeldEarnings, type ListedSource, type Market, type MarketBoard, type PermissionPage, type Recipe } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { CurrentUser } from "../../http.js";
import { badRequest, conflict, notFound, refused } from "../../errors.js";
import { parseIcs } from "../../lib/ics.js";
import { clockTime, localDay, localDate } from "../../lib/time.js";

type Stage = Creator["stage"];
type Pronoun = "she" | "he" | "they";
type ProposedOptions = { band: Band; channels: string[] };
type HandoverStatus = "verifying" | "approved" | "waiting_period" | "completed" | "cancelled";

/** "CC BY 4.0": the licence's short name, with its version when the link says it. */
export function licenceName(licence: string, url: string | null): string {
  const names: Record<string, string> = { cc0: "CC0", cc_by: "CC BY", cc_by_sa: "CC BY-SA", cc_by_nd: "CC BY-ND", cc_by_nc: "CC BY-NC", cc_by_nc_sa: "CC BY-NC-SA", cc_by_nc_nd: "CC BY-NC-ND", other: "A licence" };
  const version = url?.match(/\/(\d\.\d)\/?/)?.[1];
  const name = names[licence] ?? licence;
  return version && licence !== "other" ? `${name} ${version}` : name;
}

/** Block explorers for the chains the escrow can live on (N9). */
const EXPLORERS: Record<number, { name: string; explorerUrl: string }> = {
  1: { name: "Ethereum", explorerUrl: "https://etherscan.io" },
  11155111: { name: "Sepolia", explorerUrl: "https://sepolia.etherscan.io" },
  8453: { name: "Base", explorerUrl: "https://basescan.org" },
  84532: { name: "Base Sepolia", explorerUrl: "https://sepolia.basescan.org" }
};

function handoverStatus(h: { approvedAt: Date | null; payableAfter: Date | null; cancelledAt: Date | null; completedAt: Date | null }): HandoverStatus {
  if (h.completedAt) return "completed";
  if (h.cancelledAt) return "cancelled";
  if (h.approvedAt && h.payableAfter) return "waiting_period";
  if (h.approvedAt) return "approved";
  return "verifying";
}

export interface DeskPart {
  board(marketSlug: string, band: Band): Promise<MarketBoard>;
  createMarket(input: { slug: string; name: string; timezone: string; zips: string[] }): Promise<Market>;
  creators(filter: { marketId?: string; stage?: Stage }): Promise<Creator[]>;
  addCreator(input: {
    marketId: string;
    displayName: string;
    personName?: string;
    description?: string;
    sourcePlatform: Creator["sourcePlatform"];
    sourceUrl: string;
    contactEmail?: string;
    pronoun?: Pronoun;
    proposedOptions?: ProposedOptions;
  }): Promise<Creator>;
  updateCreator(
    creatorId: string,
    input: Partial<{
      stage: Stage;
      proposed: { band: Band; channel: string } | null;
      nextAction: string | null;
      nextActionDue: string | null;
      contactEmail: string | null;
      personName: string | null;
      pronoun: Pronoun | null;
      proposedOptions: ProposedOptions | null;
    }>
  ): Promise<Creator>;
  works(creatorId: string): Promise<CreatorWork[]>;
  addWorks(creatorId: string, works: Array<{ title: string; durationMs: number | null; sourceUrl: string; groupLabel?: string; leftOutReason?: string; noun?: string }>): Promise<CreatorWork[]>;
  recordLicence(workId: string, input: { licence: string; licenceUrl: string; attribution: string }): Promise<CreatorWork>;
  askPermission(creatorId: string, userId: string, input: { sentVia: string[]; note?: string; proposed?: { band: Band; channel: string }; recipeId?: string; workIds?: string[] }): Promise<{ requestId: string; link: string; preview: PermissionPage }>;
  permissionPage(token: string): Promise<PermissionPage>;
  answerPermission(token: string, input: { answer: "yes" | "no"; copyTo?: string; wordingVersion?: string }, from: string | null): Promise<PermissionPage>;
  /** B8: the creator stops it from the link. */
  stopFromLink(token: string, from: string | null): Promise<PermissionPage>;
  /** B8: the creator claims from the link, before or after the station exists. */
  claimFromLink(user: CurrentUser, token: string): Promise<PermissionPage>;
  /** N2: the one reminder. */
  remindCreator(creatorId: string): Promise<Creator>;
  /** N3: the claim invite, or the claim link. */
  sendClaimInvite(creatorId: string, kind: "invite" | "link"): Promise<Creator>;
  recipes(): Promise<Recipe[]>;
  saveRecipe(input: Omit<Recipe, "id">): Promise<Recipe>;
  setUpClaimable(creatorId: string, input: { recipeId: string; marketId: string; band: Band; channel: string; callSign: string; name: string; colour?: string; operatorUserId: string; signOnAt?: string }): Promise<{ station: import("@opencast/contracts").StationIdent; importable: number }>;
  heldEarnings(): Promise<HeldEarnings>;
  startHandover(user: CurrentUser, stationId: string, input: { kind: "claim" | "stop"; sourceAccountProof: string }): Promise<{ handoverId: string; status: "verifying" | "approved" | "waiting_period" | "completed" | "cancelled"; payableAfter: string | null }>;
  approveHandover(handoverId: string): Promise<{
    handoverId: string;
    payableAfter: string;
    onChain: { contract: string; escrowStationId: number; payee: string; kind: "claim" | "stop"; calldata: string } | null;
  }>;
  /** Who a claimed station's escrow was paid to (its creator's user), for the ledger. */
  claimantOf(stationId: string): Promise<{ userId: string; kind: "claim" | "stop" } | null>;
  /** The escrow contract said something about a claim: approved and waiting, cancelled, or paid. */
  onEscrowEvent(stationId: string, event: import("../../chain/index.js").EscrowEvent): Promise<void>;
  listedSources(marketId?: string): Promise<ListedSource[]>;
  addListedSource(input: { marketId: string; band: Band; channel: string; callSign: string; name: string; description?: string; streamUrl: string; embedTerms: "allowed" | "unclear"; calendarUrl?: string }): Promise<ListedSource>;
  syncListedSource(sourceId: string): Promise<ListedSource>;
}

const CR = schema.creators;
const W = schema.creatorWorks;
const PQ = schema.permissionRequests;
const PR = schema.permissionRecords;
const PW = schema.permissionRecordWorks;
const LR = schema.licenceRecords;
const RE = schema.recipes;
const LS = schema.listedSources;
const LA = schema.listedAirings;
const HO = schema.handovers;
const WAITING_PERIOD_MS = 72 * 3_600_000;

export function createDesk({ deps, services }: ModuleContext): DeskPart {
  const { db } = deps;

  const channelOf = (band: Band | null, tenths: number | null | undefined) => (band && tenths ? formatChannelNumber({ band, tenths }) : null);

  async function creatorViews(rows: Array<typeof CR.$inferSelect>): Promise<Creator[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const stationIds = rows.map((r) => r.stationId).filter((v): v is string => Boolean(v));
    const [counts, idents, asked, answered, claimed, licences, profiles, signOns, imports, operators] = await Promise.all([
      db
        .select({ creatorId: W.creatorId, n: sql<number>`count(*)::int`, ms: sql<number>`coalesce(sum(${W.durationMs}), 0)::bigint` })
        .from(W)
        .where(and(inArray(W.creatorId, ids), isNull(W.leftOutReason)))
        .groupBy(W.creatorId),
      services.stations.idents(stationIds),
      // N3: the pipeline's dates.
      db.select({ creatorId: PQ.creatorId, at: sql<Date>`max(${PQ.sentAt})` }).from(PQ).where(inArray(PQ.creatorId, ids)).groupBy(PQ.creatorId),
      db
        .select({ creatorId: PQ.creatorId, at: sql<Date>`max(${PR.answeredAt})` })
        .from(PR)
        .innerJoin(PQ, eq(PQ.id, PR.requestId))
        .where(inArray(PQ.creatorId, ids))
        .groupBy(PQ.creatorId),
      db
        .select({ creatorId: HO.creatorId, at: sql<Date>`max(${HO.completedAt})` })
        .from(HO)
        .where(and(inArray(HO.creatorId, ids), eq(HO.kind, "claim"), isNotNull(HO.completedAt)))
        .groupBy(HO.creatorId),
      // N9: the licence their works carry, when it's one that counts.
      db
        .select({ creatorId: W.creatorId, licence: LR.licence, url: LR.licenceUrl })
        .from(LR)
        .innerJoin(W, eq(W.id, LR.creatorWorkId))
        .where(and(inArray(W.creatorId, ids), eq(LR.allowsCarriage, true)))
        .orderBy(asc(LR.createdAt)),
      // N5: the setup, read back.
      services.stations.profiles(stationIds),
      services.playout.nextSignOn(stationIds),
      services.library.creatorWorkImports(stationIds),
      services.accounts.displayNames(rows.map((r) => r.operatorUserId).filter((v): v is string => Boolean(v)))
    ]);
    const dateOf = (list: Array<{ creatorId: string; at: Date | string | null }>, id: string) => {
      const at = list.find((x) => x.creatorId === id)?.at;
      return at ? new Date(at).toISOString() : null;
    };
    return rows.map((r) => {
      const count = counts.find((c) => c.creatorId === r.id);
      const channels = (r.proposedChannels ?? (r.proposedTenths ? [r.proposedTenths] : [])).map((t) => channelOf(r.proposedBand, t)).filter((c): c is string => Boolean(c));
      const licence = licences.find((l) => l.creatorId === r.id);
      const profile = r.stationId ? profiles.get(r.stationId) : undefined;
      const setup =
        profile && r.recipeId && profile.ident.band && profile.ident.channel && profile.ident.callSign
          ? {
              recipeId: r.recipeId,
              band: profile.ident.band,
              channel: profile.ident.channel,
              callSign: profile.ident.callSign,
              name: profile.ident.name,
              colour: profile.ident.colour,
              operator: r.operatorUserId ? { id: r.operatorUserId, name: operators.get(r.operatorUserId) ?? "Opencast team" } : null,
              signOnAt: (profile.firstSignedOnAt ?? signOns.get(profile.id) ?? null)?.toISOString() ?? null,
              importDone: imports.get(profile.id)?.done ?? 0,
              importTotal: imports.get(profile.id)?.total ?? 0,
              escrowStationId: profile.escrowId
            }
          : null;
      return {
        id: r.id,
        displayName: r.displayName,
        personName: r.personName,
        description: r.description,
        sourcePlatform: r.sourcePlatform,
        sourceUrl: r.sourceUrl,
        contactEmail: r.contactEmail,
        stage: r.stage,
        proposed: r.proposedBand && channels[0] ? { band: r.proposedBand, channel: channels[0] } : null,
        nextAction: r.nextAction,
        nextActionDue: r.nextActionDue,
        doNotAsk: r.doNotAsk,
        station: r.stationId ? (idents.get(r.stationId) ?? null) : null,
        works: count?.n ?? 0,
        worksDurationMs: Number(count?.ms ?? 0),
        proposedOptions: r.proposedBand ? { band: r.proposedBand, channels } : null,
        askedAt: dateOf(asked, r.id),
        remindedAt: r.remindedAt?.toISOString() ?? null,
        answeredAt: dateOf(answered, r.id),
        claimInviteSentAt: r.claimInviteSentAt?.toISOString() ?? null,
        claimLinkSentAt: r.claimLinkSentAt?.toISOString() ?? null,
        claimedAt: dateOf(claimed, r.id),
        licenceName: licence ? licenceName(licence.licence, licence.url) : null,
        ...(r.pronoun ? { pronoun: r.pronoun } : {}),
        setup
      };
    });
  }

  /** Channels proposed, as stored: the band, and the first channel also as the single `proposed`. */
  function proposedPatch(options: ProposedOptions | null): Partial<typeof CR.$inferInsert> {
    if (!options) return { proposedBand: null, proposedTenths: null, proposedChannels: null };
    const tenths = options.channels.map((channel) => {
      const parsed = parseChannelNumber(options.band, channel);
      if (!parsed) throw badRequest(`${channel} isn't in the band.`);
      return parsed.tenths;
    });
    return { proposedBand: options.band, proposedTenths: tenths[0] ?? null, proposedChannels: tenths };
  }

  async function creatorRow(creatorId: string) {
    const [row] = await db.select().from(CR).where(eq(CR.id, creatorId));
    if (!row) throw notFound("That creator");
    return row;
  }

  async function workViews(rows: Array<typeof W.$inferSelect>): Promise<CreatorWork[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [licences, permitted] = await Promise.all([
      db.select().from(LR).where(inArray(LR.creatorWorkId, ids)),
      db
        .select({ workId: PW.creatorWorkId })
        .from(PW)
        .innerJoin(PR, eq(PR.id, PW.permissionRecordId))
        .innerJoin(PQ, eq(PQ.id, PR.requestId))
        // A yes stopped from the link (B8) covers nothing any more.
        .where(and(inArray(PW.creatorWorkId, ids), eq(PR.answer, "yes"), isNull(PQ.stoppedAt)))
    ]);
    const yes = new Set(permitted.map((p) => p.workId));
    return rows.map((r) => {
      const licence = licences.find((l) => l.creatorWorkId === r.id);
      return {
        id: r.id,
        title: r.title,
        durationMs: r.durationMs,
        sourceUrl: r.sourceUrl,
        groupLabel: r.groupLabel,
        noun: r.noun,
        leftOutReason: r.leftOutReason,
        covered: yes.has(r.id) ? "permission" : licence?.allowsCarriage ? "licence" : "none",
        licence: licence ? { licence: licence.licence, url: licence.licenceUrl, attribution: licence.attribution, allowsCarriage: licence.allowsCarriage } : null
      };
    });
  }

  /** A day built from titles and lengths only: the creator's works in the recipe's creator blocks. */
  async function schedulePreview(creatorId: string, recipeId?: string, included?: Set<string>): Promise<PermissionPage["schedulePreview"]> {
    const all = await db.select().from(W).where(eq(W.creatorId, creatorId)).orderBy(asc(W.createdAt));
    const works = all.filter((w) => (included ? included.has(w.id) : !w.leftOutReason));
    const [recipe] = recipeId ? await db.select().from(RE).where(eq(RE.id, recipeId)) : await db.select().from(RE).limit(1);
    const blocks = (recipe?.blocks as Recipe["blocks"] | undefined) ?? [{ start: "18:00", end: "22:00", source: "creator" as const }];
    const preview: PermissionPage["schedulePreview"] = [];
    let index = 0;
    for (const block of blocks) {
      const [sh, sm] = block.start.split(":").map(Number);
      const [eh, em] = block.end.split(":").map(Number);
      let cursor = sh * 60 + sm;
      const end = eh * 60 + em || 24 * 60;
      if (block.source !== "creator" || !works.length) {
        preview.push({ time: block.start, title: block.source === "catalog" ? "From the Opencast catalog" : block.source === "carried" ? "A local program, carried" : "Repeats", source: block.source === "overnight" ? "repeats" : block.source });
        continue;
      }
      while (cursor < end && index < works.length * 3) {
        const work = works[index % works.length];
        const minutes = Math.max(1, Math.ceil((work.durationMs ?? 30 * 60_000) / 60_000));
        preview.push({ time: `${String(Math.floor(cursor / 60) % 24).padStart(2, "0")}:${String(cursor % 60).padStart(2, "0")}`, title: work.title, source: "creator" });
        cursor += minutes;
        index++;
      }
    }
    return preview;
  }

  /** The works a request covers: the ones ticked when asking (B7), else every work not left out. */
  function includedBy(request: typeof PQ.$inferSelect, works: Array<typeof W.$inferSelect>): Set<string> {
    if (request.workIds) {
      const ticked = new Set(request.workIds);
      return new Set(works.filter((w) => ticked.has(w.id)).map((w) => w.id));
    }
    return new Set(works.filter((w) => !w.leftOutReason).map((w) => w.id));
  }

  /** The latest claim for a creator (from the link, or on the station), for the permission page (B8). */
  async function latestClaim(creatorId: string) {
    const [row] = await db
      .select()
      .from(HO)
      .where(and(eq(HO.creatorId, creatorId), eq(HO.kind, "claim")))
      .orderBy(desc(HO.createdAt))
      .limit(1);
    return row ?? null;
  }

  async function page(request: typeof PQ.$inferSelect): Promise<PermissionPage> {
    const creator = await creatorRow(request.creatorId);
    const [works, [record]] = await Promise.all([
      db.select().from(W).where(eq(W.creatorId, creator.id)).orderBy(asc(W.createdAt)),
      db.select().from(PR).where(eq(PR.requestId, request.id))
    ]);
    const recordWorks = record ? await db.select().from(PW).where(eq(PW.permissionRecordId, record.id)) : [];
    // Once answered yes, the page shows exactly the works the yes covers.
    const included = record?.answer === "yes" ? new Set(recordWorks.map((w) => w.creatorWorkId)) : includedBy(request, works);
    const station = creator.stationId ? ((await services.stations.idents([creator.stationId])).get(creator.stationId) ?? null) : null;
    const market = creator.marketId ? (await services.network.marketsByIds([creator.marketId])).get(creator.marketId) : undefined;
    const claim = await latestClaim(creator.id);
    return {
      creator: { displayName: creator.displayName, personName: creator.personName, sourcePlatform: creator.sourcePlatform },
      proposed: request.proposedBand && request.proposedTenths ? { band: request.proposedBand, channel: formatChannelNumber({ band: request.proposedBand, tenths: request.proposedTenths }) } : null,
      note: request.note,
      works: works.map((w) => ({
        id: w.id,
        title: w.title,
        durationMs: w.durationMs,
        included: included.has(w.id),
        leftOutReason: included.has(w.id) ? null : (w.leftOutReason ?? "Left out when asking"),
        groupLabel: w.groupLabel,
        noun: w.noun
      })),
      schedulePreview: await schedulePreview(creator.id, undefined, included),
      answer: record ? { answer: record.answer, answeredAt: record.answeredAt.toISOString(), works: recordWorks.length } : null,
      station,
      claimable: Boolean(station && creator.stage !== "claimed" && !request.stoppedAt),
      summary: null,
      ...(market ? { marketName: market.name } : {}),
      stoppedAt: request.stoppedAt?.toISOString() ?? null,
      claim: claim ? { handoverId: claim.id, status: handoverStatus(claim), startedAt: claim.createdAt.toISOString() } : null
    };
  }

  /** The creator's latest yes that hasn't been stopped. */
  async function latestYes(creatorId: string) {
    const [yes] = await db
      .select({ record: PR, request: PQ })
      .from(PR)
      .innerJoin(PQ, eq(PQ.id, PR.requestId))
      .where(and(eq(PQ.creatorId, creatorId), eq(PR.answer, "yes")))
      .orderBy(desc(PR.answeredAt))
      .limit(1);
    return yes ?? null;
  }

  function recipeView(r: typeof RE.$inferSelect): Recipe {
    return {
      id: r.id,
      name: r.name,
      category: r.category,
      band: r.band,
      blocks: r.blocks as Recipe["blocks"],
      maxAiringsPerWorkPerWeek: r.maxAiringsPerWorkPerWeek,
      breakRule: r.breakRule as Record<string, unknown>,
      ...(r.whenText ? { when: r.whenText } : {}),
      ...(r.catalogAbout ? { catalogAbout: r.catalogAbout } : {})
    };
  }

  async function requestByToken(token: string) {
    const [request] = await db.select().from(PQ).where(eq(PQ.linkToken, token));
    if (!request) throw notFound("That page");
    return request;
  }

  async function listedViews(rows: Array<typeof LS.$inferSelect>): Promise<ListedSource[]> {
    if (!rows.length) return [];
    const idents = await services.stations.idents(rows.map((r) => r.stationId));
    const counts = await db
      .select({ sourceId: LA.listedSourceId, n: sql<number>`count(*)::int` })
      .from(LA)
      .where(and(inArray(LA.listedSourceId, rows.map((r) => r.id)), sql`${LA.startsAt} >= ${deps.clock.now()}`))
      .groupBy(LA.listedSourceId);
    return rows.flatMap((r) => {
      const station = idents.get(r.stationId);
      return station
        ? [
            {
              id: r.id,
              station,
              name: r.name,
              description: r.description,
              streamUrl: r.streamUrl,
              embedTerms: r.embedTerms,
              calendarUrl: r.calendarUrl,
              calendarSync: r.calendarSync,
              listingState: r.listingState,
              lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
              upcoming: counts.find((c) => c.sourceId === r.id)?.n ?? 0
            }
          ]
        : [];
    });
  }

  const part: DeskPart = {
    async board(marketSlug, band) {
      const market = await services.network.marketBySlug(marketSlug);
      if (!market) throw notFound("That market");
      const [stations, held, waitlistHere] = await Promise.all([
        services.stations.inMarkets([market.id]),
        services.waitlist.heldChannels(market.id, band),
        services.waitlist.countInMarket(market.id)
      ]);
      const onDial = stations.filter((s) => s.ident.band);
      const onBand = onDial.filter((s) => s.ident.band === band);
      const [next, creators] = await Promise.all([
        services.playout.nextSignOn(onBand.map((s) => s.id)),
        onBand.length ? db.select({ id: CR.id, stationId: CR.stationId }).from(CR).where(inArray(CR.stationId, onBand.map((s) => s.id))) : Promise.resolve([])
      ]);
      const majors = band === "tv" ? Array.from({ length: 68 }, (_, i) => i + 2) : Array.from({ length: 100 }, (_, i) => 881 + i * 2);
      const slots: MarketBoard["slots"] = majors.map((major) => {
        const here = onBand.filter((s) => {
          const tenths = Math.round(Number(s.ident.channel) * 10);
          return band === "tv" ? Math.floor(tenths / 10) === major : tenths === major;
        });
        const hold = held.find((h) => (band === "tv" ? Math.floor(h.tenths / 10) === major : h.tenths === major));
        const first = here[0];
        const state = first
          ? first.kind === "claimable"
            ? "claimable"
            : first.kind === "listed"
              ? "listed"
              : first.kind === "catalog"
                ? "catalog"
                : "station"
          : hold
            ? "held"
            : "open";
        const signOn = first ? next.get(first.id) : undefined;
        const notYet = Boolean(first && !first.public);
        return {
          major,
          state,
          stations: here.map((s) => s.ident),
          heldFor: hold?.callSign ?? null,
          status: first && !first.public ? (signOn ? `Signs on ${clockTime(signOn, market.timezone)} ${localDate(signOn, market.timezone)}` : "Setting up") : null,
          signOnAt: notYet && signOn ? signOn.toISOString() : null,
          creatorId: state === "claimable" && first ? (creators.find((c) => c.stationId === first.id)?.id ?? null) : null
        };
      });
      // Tonight, 6 pm to midnight: how much is local programming, not carried or catalog. Per band,
      // and for the whole market (both bands).
      const today = localDate(deps.clock.now(), market.timezone);
      const { from: dayStart, to: dayEnd } = localDay(today, market.timezone);
      const tonightFrom = new Date(dayStart.getTime() + 18 * 3_600_000);
      const publicOnDial = onDial.filter((s) => s.public);
      const window = await services.log.window(publicOnDial.map((s) => s.id), tonightFrom, dayEnd);
      const share = { tv: { local: 0, total: 0 }, radio: { local: 0, total: 0 } };
      for (const [stationId, airings] of window) {
        const station = onDial.find((s) => s.id === stationId);
        if (!station?.ident.band) continue;
        for (const a of airings) {
          if (a.kind === "off_air") continue;
          const ms = Math.min(Date.parse(a.endsAt), dayEnd.getTime()) - Math.max(Date.parse(a.startsAt), tonightFrom.getTime());
          if (ms <= 0) continue;
          share[station.ident.band].total += ms;
          if (!a.carriedFrom && station.kind !== "catalog") share[station.ident.band].local += ms;
        }
      }
      const percent = (local: number, total: number) => (total ? Math.round((local / total) * 100) : null);
      const soon = new Date(deps.clock.now().getTime() + 3_600_000);
      const deadAir: Array<(typeof onDial)[number]["ident"]> = [];
      for (const s of publicOnDial) {
        if ((await services.log.gaps(s.id, deps.clock.now(), soon)).length) deadAir.push(s.ident);
      }
      const [{ n: saidYes }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(CR)
        .where(and(eq(CR.marketId, market.id), eq(CR.stage, "said_yes"), isNull(CR.stationId)));
      const claimableOnAir = (list: typeof onDial) => list.filter((s) => s.kind === "claimable" && s.public).length;
      return {
        market,
        band,
        slots,
        stats: {
          localShareOfTonightPercent: percent(share[band].local, share[band].total),
          claimableOnAir: claimableOnAir(onBand),
          saidYesNotSetUp: saidYes,
          deadAirComing: deadAir.filter((s) => s.band === band),
          waitlistHere,
          market: {
            localShareOfTonightPercent: percent(share.tv.local + share.radio.local, share.tv.total + share.radio.total),
            claimableOnAir: claimableOnAir(onDial),
            deadAirComing: deadAir
          }
        }
      };
    },

    async createMarket(input) {
      const market = await db.transaction(async (tx) => {
        const [row] = await tx.insert(schema.markets).values({ slug: input.slug, name: input.name, timezone: input.timezone }).returning();
        if (input.zips.length) await tx.insert(schema.zipMarkets).values(input.zips.map((zip) => ({ zip, marketId: row.id }))).onConflictDoNothing();
        return row;
      });
      return (await services.network.marketsByIds([market.id])).get(market.id)!;
    },

    async creators(filter) {
      const rows = await db
        .select()
        .from(CR)
        .where(and(...(filter.marketId ? [eq(CR.marketId, filter.marketId)] : []), ...(filter.stage ? [eq(CR.stage, filter.stage)] : [])))
        .orderBy(sql`${CR.nextActionDue} nulls last`, desc(CR.createdAt));
      return creatorViews(rows);
    },

    async addCreator(input) {
      const [row] = await db
        .insert(CR)
        .values({
          marketId: input.marketId,
          displayName: input.displayName,
          personName: input.personName ?? null,
          description: input.description ?? null,
          sourcePlatform: input.sourcePlatform,
          sourceUrl: input.sourceUrl,
          contactEmail: input.contactEmail ?? null,
          pronoun: input.pronoun ?? null,
          ...(input.proposedOptions ? proposedPatch(input.proposedOptions) : {})
        })
        .returning();
      return (await creatorViews([row]))[0];
    },

    async updateCreator(creatorId, input) {
      await creatorRow(creatorId);
      const patch: Partial<typeof CR.$inferInsert> = {};
      if (input.stage !== undefined) {
        patch.stage = input.stage;
        if (input.stage === "declined") patch.doNotAsk = true;
      }
      if (input.proposed !== undefined) {
        const parsed = input.proposed ? parseChannelNumber(input.proposed.band, input.proposed.channel) : null;
        if (input.proposed && !parsed) throw badRequest("That channel isn't in the band.");
        patch.proposedBand = input.proposed?.band ?? null;
        patch.proposedTenths = parsed?.tenths ?? null;
        patch.proposedChannels = parsed ? [parsed.tenths] : null;
      }
      if (input.proposedOptions !== undefined) Object.assign(patch, proposedPatch(input.proposedOptions));
      if (input.pronoun !== undefined) patch.pronoun = input.pronoun;
      if (input.nextAction !== undefined) patch.nextAction = input.nextAction;
      if (input.nextActionDue !== undefined) patch.nextActionDue = input.nextActionDue;
      if (input.contactEmail !== undefined) patch.contactEmail = input.contactEmail;
      if (input.personName !== undefined) patch.personName = input.personName;
      const [row] = await db.update(CR).set(patch).where(eq(CR.id, creatorId)).returning();
      return (await creatorViews([row]))[0];
    },

    async works(creatorId) {
      await creatorRow(creatorId);
      return workViews(await db.select().from(W).where(eq(W.creatorId, creatorId)).orderBy(asc(W.createdAt)));
    },

    async addWorks(creatorId, works) {
      await creatorRow(creatorId);
      if (works.length) {
        await db.insert(W).values(works.map((w) => ({ creatorId, title: w.title, durationMs: w.durationMs, sourceUrl: w.sourceUrl, groupLabel: w.groupLabel ?? null, noun: w.noun ?? null, leftOutReason: w.leftOutReason ?? null })));
      }
      return part.works(creatorId);
    },

    async recordLicence(workId, input) {
      const [work] = await db.select().from(W).where(eq(W.id, workId));
      if (!work) throw notFound("That work");
      await db.insert(LR).values({ creatorWorkId: workId, licence: input.licence as typeof LR.$inferInsert.licence, licenceUrl: input.licenceUrl, attribution: input.attribution, lastCheckedAt: deps.clock.now() });
      // A creator whose works are all openly licensed skips asking.
      const views = await workViews([work]);
      const [creator] = await db.select().from(CR).where(eq(CR.id, work.creatorId));
      if (views[0].covered === "licence" && creator?.stage === "found") await db.update(CR).set({ stage: "already_licensed" }).where(eq(CR.id, creator.id));
      return views[0];
    },

    async askPermission(creatorId, userId, input) {
      const creator = await creatorRow(creatorId);
      if (creator.doNotAsk) throw refused("do_not_ask", "They said no. Don't ask again.");
      const proposed = input.proposed ? parseChannelNumber(input.proposed.band, input.proposed.channel) : null;
      // B7: only the ticked works are asked about. The rest are left out (with their reason, or
      // "Left out when asking"); ticking one that was left out brings it back in.
      let workIds: string[] | null = null;
      if (input.workIds) {
        const works = await db.select().from(W).where(eq(W.creatorId, creatorId));
        const mine = new Set(works.map((w) => w.id));
        const unknown = input.workIds.filter((id) => !mine.has(id));
        if (unknown.length) throw badRequest("Some of those works aren't this creator's.", { workIds: "Not this creator's" });
        workIds = [...new Set(input.workIds)];
        const ticked = new Set(workIds);
        await db.transaction(async (tx) => {
          const back = works.filter((w) => ticked.has(w.id) && w.leftOutReason).map((w) => w.id);
          const out = works.filter((w) => !ticked.has(w.id) && !w.leftOutReason).map((w) => w.id);
          if (back.length) await tx.update(W).set({ leftOutReason: null }).where(inArray(W.id, back));
          if (out.length) await tx.update(W).set({ leftOutReason: "Left out when asking" }).where(inArray(W.id, out));
        });
      }
      const token = randomBytes(24).toString("base64url");
      const [request] = await db
        .insert(PQ)
        .values({
          creatorId,
          linkToken: token,
          sentVia: input.sentVia,
          note: input.note ?? null,
          proposedBand: input.proposed?.band ?? creator.proposedBand,
          proposedTenths: proposed?.tenths ?? creator.proposedTenths,
          sentBy: userId,
          sentAt: deps.clock.now(),
          workIds
        })
        .returning();
      await db.update(CR).set({ stage: "asked", remindedAt: null, nextAction: "Reminder", nextActionDue: new Date(deps.clock.now().getTime() + 7 * 86_400_000).toISOString().slice(0, 10) }).where(eq(CR.id, creatorId));
      const link = `${deps.config.appOrigin}/permission/${token}`;
      if (creator.contactEmail) {
        await deps.notifier.email(creator.contactEmail, { title: `A station for ${creator.displayName}?`, body: input.note ?? "We'd like to put your work on a local station.", link });
      }
      return { requestId: request.id, link, preview: await page(request) };
    },

    async permissionPage(token) {
      return page(await requestByToken(token));
    },

    async answerPermission(token, input, from) {
      const request = await requestByToken(token);
      const [existing] = await db.select().from(PR).where(eq(PR.requestId, request.id));
      if (existing) throw refused("already_answered", "This has been answered. Write to us to change it.");
      const creator = await creatorRow(request.creatorId);
      const allWorks = await db.select().from(W).where(eq(W.creatorId, creator.id));
      const covered = includedBy(request, allWorks);
      await db.transaction(async (tx) => {
        const [record] = await tx
          .insert(PR)
          .values({
            requestId: request.id,
            answer: input.answer,
            answeredAt: deps.clock.now(),
            answeredFromIp: from,
            copySentTo: input.copyTo ?? creator.contactEmail,
            copySentAt: input.copyTo ?? creator.contactEmail ? deps.clock.now() : null,
            wordingVersion: input.wordingVersion ?? null
          })
          .returning();
        if (input.answer === "yes" && covered.size) {
          // The exact list of works the request asked about, as it stood when they said yes.
          await tx.insert(PW).values([...covered].map((creatorWorkId) => ({ permissionRecordId: record.id, creatorWorkId })));
        }
        await tx
          .update(CR)
          .set(input.answer === "yes" ? { stage: "said_yes", nextAction: "Set up", nextActionDue: null } : { stage: "declined", doNotAsk: true, nextAction: null, nextActionDue: null })
          .where(eq(CR.id, creator.id));
      });
      const copyTo = input.copyTo ?? creator.contactEmail;
      if (copyTo) await deps.notifier.email(copyTo, { title: "A copy of your answer", body: input.answer === "yes" ? "You said yes. Here's the list of works." : "You said no thanks.", link: `${deps.config.appOrigin}/permission/${token}` });
      return page(request);
    },

    async stopFromLink(token, from) {
      const request = await requestByToken(token);
      const [record] = await db.select().from(PR).where(eq(PR.requestId, request.id));
      if (record?.answer !== "yes") throw refused("nothing_to_stop", "There's nothing to stop: you haven't said yes.");
      if (request.stoppedAt) return page(request);
      const creator = await creatorRow(request.creatorId);
      const now = deps.clock.now();
      await db.transaction(async (tx) => {
        await tx.update(PQ).set({ stoppedAt: now, stoppedFromIp: from }).where(eq(PQ.id, request.id));
        // Don't ask again: stopping is a no from here on.
        await tx.update(CR).set({ stage: "declined", doNotAsk: true, nextAction: null, nextActionDue: null }).where(eq(CR.id, creator.id));
        // A claim still waiting is overtaken by the stop.
        await tx
          .update(HO)
          .set({ cancelledAt: now, cancelReason: "Stopped from the permission link" })
          .where(and(eq(HO.creatorId, creator.id), eq(HO.kind, "claim"), isNull(HO.completedAt), isNull(HO.cancelledAt), isNull(HO.approvedAt)));
      });
      if (creator.stationId && (await services.stations.kindOf(creator.stationId)) === "claimable") {
        const stationId = creator.stationId;
        // Nothing the yes covered airs again. The held money goes to them by the stop path once
        // they're verified: a stop handover the desk checks (the escrow pays only the creator).
        await services.playout.cancelSignOns(stationId);
        await services.playout.signOff(stationId, true);
        const [open] = await db.select().from(HO).where(and(eq(HO.stationId, stationId), isNull(HO.completedAt), isNull(HO.cancelledAt)));
        if (!open) await db.insert(HO).values({ stationId, requestId: request.id, creatorId: creator.id, kind: "stop", claimantUserId: null, createdAt: now });
      }
      const admins = await services.accounts.adminIds();
      await services.notifications.notify(admins, {
        kind: "rights_claim",
        title: `${creator.displayName} stopped their station`,
        body: creator.stationId ? "They stopped it from their permission link. It's signed off; check the stop so their held money can go to them." : "They stopped it from their permission link before it was set up. Nothing of theirs can air.",
        link: `/desk/pipeline/${creator.id}`,
        scope: { kind: "station", id: creator.stationId },
        dedupeKey: `stopped:${request.id}`
      });
      return page((await db.select().from(PQ).where(eq(PQ.id, request.id)))[0]);
    },

    async claimFromLink(user, token) {
      const request = await requestByToken(token);
      const [record] = await db.select().from(PR).where(eq(PR.requestId, request.id));
      if (record?.answer !== "yes" || request.stoppedAt) throw refused("nothing_to_claim", "There's no station to claim from this link.");
      const creator = await creatorRow(request.creatorId);
      const [open] = await db
        .select()
        .from(HO)
        .where(and(eq(HO.creatorId, creator.id), isNull(HO.completedAt), isNull(HO.cancelledAt)));
      if (open) throw refused("in_progress", "A claim for this station is already in progress.");
      if (creator.stationId && (await services.stations.kindOf(creator.stationId)) !== "claimable") throw refused("nothing_to_claim", "This station has been claimed already.");
      // The link was sent to them, and they're signed in: the desk checks the rest before approving.
      await db.insert(HO).values({ stationId: creator.stationId, requestId: request.id, creatorId: creator.id, kind: "claim", claimantUserId: user.id, sourceAccountVerifiedAt: null, createdAt: deps.clock.now() });
      await db.update(CR).set({ nextAction: "Check the claim", nextActionDue: null }).where(eq(CR.id, creator.id));
      return page(request);
    },

    async remindCreator(creatorId) {
      const creator = await creatorRow(creatorId);
      if (creator.stage !== "asked") throw refused("not_asked", "There's no question out to remind them of.");
      if (creator.remindedAt) throw refused("reminded", "They've had their one reminder.");
      const [request] = await db.select().from(PQ).where(eq(PQ.creatorId, creatorId)).orderBy(desc(PQ.sentAt)).limit(1);
      if (!request) throw refused("not_asked", "There's no question out to remind them of.");
      const now = deps.clock.now();
      const [row] = await db
        .update(CR)
        .set({ remindedAt: now, nextAction: "No answer", nextActionDue: new Date(now.getTime() + 7 * 86_400_000).toISOString().slice(0, 10) })
        .where(eq(CR.id, creatorId))
        .returning();
      if (creator.contactEmail) {
        await deps.notifier.email(creator.contactEmail, {
          title: `Still thinking about a station for ${creator.displayName}?`,
          body: "A reminder about the station we'd like to put your work on. Yes or no, one tap on the page. This is the only reminder we'll send.",
          link: `${deps.config.appOrigin}/permission/${request.linkToken}`
        });
      }
      return (await creatorViews([row]))[0];
    },

    async sendClaimInvite(creatorId, kind) {
      const creator = await creatorRow(creatorId);
      if (!creator.stationId || (await services.stations.kindOf(creator.stationId)) !== "claimable") throw refused("no_station", "Set up their station first.");
      if (!creator.contactEmail) throw refused("no_contact", "Add their email first.");
      const [request] = await db
        .select({ request: PQ })
        .from(PQ)
        .innerJoin(PR, eq(PR.requestId, PQ.id))
        .where(and(eq(PQ.creatorId, creatorId), eq(PR.answer, "yes")))
        .orderBy(desc(PR.answeredAt))
        .limit(1);
      const station = (await services.stations.idents([creator.stationId])).get(creator.stationId);
      const now = deps.clock.now();
      // The claim is on their permission page ("Claim it now"); a creator with a licence and no
      // permission page gets the station's page.
      const link = request ? `${deps.config.appOrigin}/permission/${request.request.linkToken}` : `${deps.config.appOrigin}/${station?.handle ?? ""}`;
      await deps.notifier.email(creator.contactEmail, {
        title: kind === "invite" ? `${station?.name ?? "Your station"} is on the air` : `Claim ${station?.name ?? "your station"}`,
        body:
          kind === "invite"
            ? "Your station is on the air, run by Opencast for you. It's yours whenever you want it: claim it to run it yourself and receive what it's earned."
            : "Here's your claim link. Sign in, connect the account your work is on, and the station and what it's earned become yours.",
        link
      });
      const [row] = await db
        .update(CR)
        .set(kind === "invite" ? { claimInviteSentAt: now, nextAction: "Claim link" } : { claimLinkSentAt: now, nextAction: null, nextActionDue: null })
        .where(eq(CR.id, creatorId))
        .returning();
      return (await creatorViews([row]))[0];
    },

    async recipes() {
      const rows = await db.select().from(RE).orderBy(asc(RE.name));
      return rows.map(recipeView);
    },

    async saveRecipe(input) {
      // N6: the break rule's known keys must have their types (the desk reads them typed).
      const rule = RecipeBreakRule.safeParse(input.breakRule);
      if (!rule.success) throw badRequest(`Check the break rule: ${rule.error.issues[0]?.path.join(".")} isn't right.`, { breakRule: "Wrong type" });
      const [row] = await db
        .insert(RE)
        .values({ name: input.name, category: input.category, band: input.band, blocks: input.blocks, maxAiringsPerWorkPerWeek: input.maxAiringsPerWorkPerWeek, breakRule: input.breakRule, whenText: input.when ?? null, catalogAbout: input.catalogAbout ?? null })
        .returning();
      return recipeView(row);
    },

    async setUpClaimable(creatorId, input) {
      const creator = await creatorRow(creatorId);
      if (!["said_yes", "already_licensed"].includes(creator.stage)) throw refused("no_permission", "Set up a station only after they say yes, or when their work is already licensed.");
      if (creator.stationId) throw refused("already_set_up", "This creator already has a station.");
      const number = parseChannelNumber(input.band, input.channel);
      if (!number) throw badRequest("That channel isn't in the band.");
      const [recipe] = await db.select().from(RE).where(eq(RE.id, input.recipeId));
      if (!recipe) throw notFound("That recipe");
      const works = await part.works(creatorId);
      const covered = works.filter((w) => w.covered !== "none");
      const yes = await latestYes(creatorId);
      if (yes?.request.stoppedAt && !covered.length) throw refused("no_permission", "They stopped it from the link. Nothing of theirs can air.");
      const stationId = await db.transaction(async (tx) => {
        const id = await services.stations.createManaged(tx, { kind: "claimable", name: input.name, callSign: input.callSign, colour: input.colour, marketId: input.marketId, band: input.band, tenths: number.tenths, description: creator.description ?? undefined });
        await services.accounts.addStationMember(tx, id, input.operatorUserId, "operator");
        // Only works covered by the yes, or by a licence that allows it, and only by title and link for now.
        for (const work of covered) {
          const itemId = await services.library.addCreatorWork(tx, { stationId: id, creatorWorkId: work.id, title: work.title, durationMs: work.durationMs, sourceUrl: work.sourceUrl });
          if (work.covered === "permission" && yes) await services.library.confirmCreatorWorkRights(tx, itemId, { permissionRecordId: yes.record.id });
          else {
            const [licence] = await tx.select().from(LR).where(and(eq(LR.creatorWorkId, work.id), eq(LR.allowsCarriage, true))).limit(1);
            if (licence) await services.library.confirmCreatorWorkRights(tx, itemId, { licenceRecordId: licence.id });
          }
        }
        await tx
          .update(CR)
          .set({ stationId: id, stage: "setting_up", nextAction: "Sign on", proposedBand: input.band, proposedTenths: number.tenths, proposedChannels: [number.tenths], recipeId: recipe.id, operatorUserId: input.operatorUserId })
          .where(eq(CR.id, creatorId));
        // A claim started from the link before there was a station (B8) joins it now.
        await tx.update(HO).set({ stationId: id }).where(and(eq(HO.creatorId, creatorId), isNull(HO.stationId), isNull(HO.cancelledAt)));
        return id;
      });
      if (input.signOnAt) await services.playout.scheduleSignOn(stationId, new Date(input.signOnAt));
      const station = (await services.stations.idents([stationId])).get(stationId)!;
      return { station, importable: covered.length };
    },

    async heldEarnings() {
      const creators = await db.select().from(CR).where(sql`${CR.stationId} is not null`);
      const stationIds = creators.map((c) => c.stationId!);
      const [profiles, balances, handovers, moved, views, config] = await Promise.all([
        services.stations.profiles(stationIds),
        services.ledger.escrowBalances(stationIds),
        stationIds.length ? db.select().from(HO).where(inArray(HO.stationId, stationIds)).orderBy(desc(HO.createdAt)) : Promise.resolve([]),
        services.ledger.everMovedToOpencast(),
        creatorViews(creators),
        services.ledger.config()
      ]);
      const signOns = await services.playout.nextSignOn(stationIds);
      const stations: HeldEarnings["stations"] = creators.flatMap((c) => {
        const profile = profiles.get(c.stationId!);
        if (!profile || profile.kind !== "claimable") return [];
        const view = views.find((v) => v.id === c.id);
        const balance = balances.get(c.stationId!) ?? { owed: 0, held: 0 };
        const handover = handovers.find((h) => h.stationId === c.stationId && !h.cancelledAt);
        const status: HeldEarnings["stations"][number]["status"] = handover?.completedAt
          ? handover.kind === "stop"
            ? "stopped"
            : "claimed"
          : handover
            ? "claim_pending"
            : c.stage === "claimed"
              ? "claimed"
              : !profile.public
                ? "not_on_air_yet"
                : c.claimLinkSentAt
                  ? "claim_link_sent"
                  : c.claimInviteSentAt
                    ? "invited"
                    : "on_air";
        return [
          {
            station: profile.ident,
            // As drawn ("for Marcus Reyes"): the person when known, else the creator's name.
            creator: c.personName ?? c.displayName,
            escrowStationId: profile.escrowId,
            onAirSince: profile.firstSignedOnAt?.toISOString() ?? null,
            rightsBasis: c.stage === "already_licensed" || (view?.licenceName && !view.answeredAt) ? "licence" : "permission",
            heldMicros: balance.held,
            owedNotYetDepositedMicros: balance.owed,
            status,
            invitedAt: c.claimInviteSentAt?.toISOString() ?? null,
            claimLinkSentAt: c.claimLinkSentAt?.toISOString() ?? null,
            signOnAt: profile.public ? null : (signOns.get(profile.id)?.toISOString() ?? null),
            licenceName: view?.licenceName ?? null,
            creatorId: c.id,
            creatorName: c.displayName
          }
        ];
      });
      // Money first: the biggest balance at the top; nothing held (not on air yet) last.
      stations.sort((a, b) => b.heldMicros + b.owedNotYetDepositedMicros - (a.heldMicros + a.owedNotYetDepositedMicros));
      const chainId = deps.chain?.chainId ?? 0;
      return {
        contractAddress: deps.config.escrowContractAddress,
        stations,
        totalHeldMicros: stations.reduce((s, x) => s + x.heldMicros + x.owedNotYetDepositedMicros, 0),
        everMovedToOpencastMicros: moved,
        stationsHoldingMoney: stations.filter((x) => x.heldMicros + x.owedNotYetDepositedMicros > 0).length,
        unclaimedPeriodDays: config.unclaimedPeriodDays,
        chain: deps.chain ? (EXPLORERS[chainId] ?? null) : null
      };
    },

    async startHandover(user, stationId, input) {
      const [creator] = await db.select().from(CR).where(eq(CR.stationId, stationId));
      if (!creator || (await services.stations.kindOf(stationId)) !== "claimable") throw notFound("That station");
      const [open] = await db.select().from(HO).where(and(eq(HO.stationId, stationId), isNull(HO.completedAt), isNull(HO.cancelledAt)));
      if (open) throw refused("in_progress", "A claim for this station is already in progress.");
      // The source account is verified by connecting it (OAuth with the platform). Until that's
      // wired per platform, the proof is recorded and a person checks it before approving.
      const [row] = await db
        .insert(HO)
        .values({ stationId, creatorId: creator.id, kind: input.kind, claimantUserId: user.id, sourceAccountVerifiedAt: null })
        .returning();
      return { handoverId: row.id, status: "verifying", payableAfter: null };
    },

    async approveHandover(handoverId) {
      const [row] = await db.select().from(HO).where(eq(HO.id, handoverId));
      if (!row || row.cancelledAt || row.completedAt) throw notFound("That claim");
      if (!row.stationId) throw refused("no_station", "Set up their station first: the claim joins it, then it can be approved.");
      const stationId = row.stationId;
      const now = deps.clock.now();
      // The escrow pays only the creator's own wallet, the one they signed in with.
      const payee = row.claimantUserId ? await services.accounts.walletOf(row.claimantUserId) : null;
      if (deps.chain && !payee) throw refused("no_wallet", "The creator needs to sign in first: their wallet is where the escrow pays.");
      // The earliest it can be paid; with the contract live, the verifiers' approvals on-chain start the 72 hours.
      const payableAfter = new Date(now.getTime() + WAITING_PERIOD_MS);
      await db.update(HO).set({ approvedAt: now, sourceAccountVerifiedAt: row.sourceAccountVerifiedAt ?? now, payableAfter, payeeAddress: payee }).where(eq(HO.id, handoverId));
      const escrowId = (await services.stations.profiles([stationId])).get(stationId)?.escrowId;
      const onChain =
        deps.chain && payee && escrowId !== undefined
          ? { contract: deps.chain.escrow, escrowStationId: escrowId, payee, kind: row.kind, calldata: deps.chain.approveCalldata(escrowId, payee as `0x${string}`, row.kind) }
          : null;
      return { handoverId, payableAfter: payableAfter.toISOString(), onChain };
    },

    async claimantOf(stationId) {
      const [row] = await db
        .select()
        .from(HO)
        .where(and(eq(HO.stationId, stationId), isNull(HO.cancelledAt), sql`${HO.approvedAt} is not null`))
        .orderBy(desc(HO.approvedAt))
        .limit(1);
      return row?.claimantUserId ? { userId: row.claimantUserId, kind: row.kind } : null;
    },

    async onEscrowEvent(stationId, event) {
      const [open] = await db
        .select()
        .from(HO)
        .where(and(eq(HO.stationId, stationId), isNull(HO.cancelledAt), isNull(HO.completedAt)))
        .orderBy(desc(HO.createdAt))
        .limit(1);
      if (!open) return;
      if (event.type === "claim_proposed" && open.payeeAddress && event.payee.toLowerCase() !== open.payeeAddress.toLowerCase()) {
        // Not the wallet the desk checked. The verifiers can cancel it during the 72 hours; make sure they know.
        console.warn(`[escrow] station ${stationId}: a claim on-chain names ${event.payee}, not the creator's ${open.payeeAddress}`);
        const admins = await services.accounts.adminIds();
        await services.notifications.notify(admins, {
          kind: "rights_claim",
          title: "A claim names the wrong wallet",
          body: `A claim on the escrow contract would pay ${event.payee}, not the creator's wallet. Cancel it before its 72 hours are up.`,
          link: `/desk/held-earnings`,
          scope: { kind: "station", id: stationId },
          dedupeKey: `wrong-payee:${event.tx}`
        });
      }
      if (event.type === "ready") await db.update(HO).set({ payableAfter: event.readyAt }).where(eq(HO.id, open.id));
      if (event.type === "cancelled") await db.update(HO).set({ cancelledAt: deps.clock.now(), cancelReason: "Cancelled by a verifier" }).where(eq(HO.id, open.id));
      if (event.type === "paid" && event.reason !== "unclaimed") {
        await db.transaction(async (tx) => {
          await tx.update(HO).set({ completedAt: deps.clock.now() }).where(eq(HO.id, open.id));
          await tx.update(CR).set({ stage: "claimed", nextAction: null }).where(eq(CR.id, open.creatorId));
          if (event.reason === "claim") {
            // The station is theirs now: an ordinary station, earning into its own account.
            await services.stations.handOver(tx, stationId);
            if (open.claimantUserId) await services.accounts.addStationMember(tx, stationId, open.claimantUserId, "owner");
          }
        });
        if (event.reason === "stop") await services.playout.signOff(stationId, true);
      }
    },

    async listedSources(marketId) {
      const rows = await db.select().from(LS).orderBy(asc(LS.name));
      if (!marketId) return listedViews(rows);
      const inMarket = new Set((await services.stations.inMarkets([marketId])).map((s) => s.id));
      return listedViews(rows.filter((r) => inMarket.has(r.stationId)));
    },

    async addListedSource(input) {
      const number = parseChannelNumber(input.band, input.channel);
      if (!number) throw badRequest("That channel isn't in the band.");
      const sourceId = await db.transaction(async (tx) => {
        const stationId = await services.stations.createManaged(tx, { kind: "listed", name: input.name, callSign: input.callSign, marketId: input.marketId, band: input.band, tenths: number.tenths, description: input.description });
        // Listed means on the dial: the station row is public from now.
        await services.stations.markSignedOn(tx, stationId);
        const [row] = await tx
          .insert(LS)
          .values({ stationId, name: input.name, description: input.description ?? null, streamUrl: input.streamUrl, embedTerms: input.embedTerms, calendarUrl: input.calendarUrl ?? null, listingState: input.embedTerms === "allowed" ? "listed" : "checking" })
          .returning();
        return row.id;
      });
      if (input.calendarUrl) return part.syncListedSource(sourceId);
      return (await listedViews(await db.select().from(LS).where(eq(LS.id, sourceId))))[0];
    },

    async syncListedSource(sourceId) {
      const [source] = await db.select().from(LS).where(eq(LS.id, sourceId));
      if (!source) throw notFound("That listed source");
      if (!source.calendarUrl) throw refused("no_calendar", "Add the source's agenda calendar first.");
      let events;
      try {
        const response = await fetch(source.calendarUrl, { signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        events = parseIcs(await response.text());
      } catch {
        await db.update(LS).set({ calendarSync: "calendar_not_found" }).where(eq(LS.id, sourceId));
        return (await listedViews(await db.select().from(LS).where(eq(LS.id, sourceId))))[0];
      }
      const now = deps.clock.now();
      await db.transaction(async (tx) => {
        await tx.delete(LA).where(and(eq(LA.listedSourceId, sourceId), sql`${LA.startsAt} >= ${now}`));
        const upcoming = events.filter((e) => e.start >= now);
        if (upcoming.length) {
          await tx.insert(LA).values(upcoming.map((e) => ({ listedSourceId: sourceId, title: e.summary, startsAt: e.start, endsAt: e.end, externalId: e.uid })));
        }
        await tx.update(LS).set({ calendarSync: "synced", lastSyncedAt: now }).where(eq(LS.id, sourceId));
      });
      return (await listedViews(await db.select().from(LS).where(eq(LS.id, sourceId))))[0];
    }
  };
  return part;
}
