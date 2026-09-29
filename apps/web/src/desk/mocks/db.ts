// The mock API's shared, changeable state: markets, stations, the waitlist's holds, creators and
// their works, permission requests and answers, recipes, listed sources and held earnings. Kept in
// localStorage so a reload keeps what you did ("oc-mock-desk-db"; remove it to start again).
//
// Every handler reads and writes this one model, and the views below turn it into the contracts'
// shapes, so the board, the pipeline, the setup page and held earnings always agree: setting up a
// station puts it on the board, signing it on moves the creator to On air, a claim takes it off
// held earnings.

import type { Creator, CreatorWork, HeldEarnings, Market, MarketBoard, PermissionPage, Recipe, StationIdent } from "@opencast/contracts";
import { now } from "../../lib/clock";
import { seedCreators, seedRequests, seedWorks, type DbCreator, type DbRequest, type DbWork } from "./fixtures/creators";
import { ESCROW, seedBalances, type DbBalance } from "./fixtures/held";
import { U } from "./fixtures/ids";
import { seedListed, type DbListed } from "./fixtures/listed";
import { HD, IE, MARKETS } from "./fixtures/markets";
import { team } from "./fixtures/people";
import { seedRecipes } from "./fixtures/recipes";
import { seedReservations, seedStations, type DbReservation, type DbStation } from "./fixtures/stations";

export interface DbHandover {
  id: string;
  stationId: string;
  kind: "claim" | "stop";
  startedAt: string;
  completedAt: string | null;
}

export interface Db {
  /** Bumped when the seed changes shape, so an old saved mock is replaced. */
  version: number;
  markets: Market[];
  stations: DbStation[];
  reservations: DbReservation[];
  creators: DbCreator[];
  works: DbWork[];
  requests: DbRequest[];
  recipes: Recipe[];
  listed: DbListed[];
  balances: Record<string, DbBalance>;
  handovers: DbHandover[];
  /** Local share of tonight, per market and band (the log isn't mocked here). */
  localShare: Record<string, { tv: number | null; radio: number | null; market: number | null }>;
  /** Stations with a gap in the next hour. */
  deadAir: string[];
  seq: number;
}

export const DB_VERSION = 4;
export const DB_KEY = "oc-mock-desk-db";

export function seed(): Db {
  const works = seedWorks();
  const requests = seedRequests();
  // A yes covers the works included when it was given: the seed's answers name none, so fill them in.
  for (const r of requests) if (r.answer?.answer === "yes" && !r.answer.workIds.length) r.answer.workIds = works.filter((w) => w.creatorId === r.creatorId && !w.leftOutReason).map((w) => w.id);
  return {
    version: DB_VERSION,
    markets: MARKETS,
    stations: seedStations(),
    reservations: seedReservations(),
    creators: seedCreators(),
    works,
    requests,
    recipes: seedRecipes(),
    listed: seedListed(),
    balances: seedBalances(),
    handovers: [],
    localShare: { [IE.id]: { tv: 74, radio: 64, market: 71 }, [HD.id]: { tv: 38, radio: null, market: 38 } },
    deadAir: [U(113)],
    seq: 0
  };
}

let db: Db | null = null;

export function getDb(): Db {
  if (db) return db;
  try {
    const raw = localStorage.getItem(DB_KEY);
    const saved = raw ? (JSON.parse(raw) as Db) : null;
    db = saved && saved.version === DB_VERSION ? saved : seed();
  } catch {
    db = seed();
  }
  return db;
}

export function saveDb() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(getDb()));
  } catch {
    // Private windows: the mock keeps state for this visit only.
  }
}

export function resetDb() {
  db = seed();
  saveDb();
}

// Another tab of the app changed it (the creator's permission page answering, in the one mock
// world): read it again on the next request.
if (typeof window !== "undefined")
  window.addEventListener("storage", (e) => {
    if (e.key === DB_KEY || e.key === null) db = null;
  });

/** A new id, never one the seed uses. */
export function newId(): string {
  const d = getDb();
  d.seq += 1;
  return U(900_000 + d.seq);
}

// ---- Time moves things on ----

/**
 * What the clock does by itself: a station whose sign-on time has come signs on (its creator goes
 * to On air, unless their work is already licensed, which keeps its stage), and an import runs on.
 */
export function advance(at: Date = now()): void {
  const d = getDb();
  let changed = false;
  for (const c of d.creators) {
    if (!c.stationId || !c.setup) continue;
    const s = d.stations.find((x) => x.ident.id === c.stationId);
    if (!s) continue;
    // One item prepared for air every 20 seconds after setup, up to all of them.
    const done = c.setup.running ? Math.min(c.setup.importTotal, Math.max(c.setup.importDone ?? 0, Math.floor((at.getTime() - Date.parse(c.setup.setupAt)) / 20_000))) : (c.setup.importDone ?? 0);
    if (done !== (c.setup.importDone ?? 0)) {
      c.setup.importDone = done;
      changed = true;
    }
    if (!s.public && s.signOnAt && Date.parse(s.signOnAt) <= at.getTime()) {
      s.public = true;
      s.firstSignedOnAt = s.signOnAt;
      c.setup.importDone = c.setup.importTotal;
      if (c.stage === "setting_up") c.stage = "on_air";
      c.nextAction = "Claim invite";
      d.balances[s.ident.id] ??= { heldMicros: 0, owedMicros: 0 };
      changed = true;
    }
  }
  if (changed) saveDb();
}

// ---- Lookups ----

export function marketById(id: string): Market | undefined {
  return getDb().markets.find((m) => m.id === id);
}

export function marketBySlug(slug: string): Market | undefined {
  return getDb().markets.find((m) => m.slug === slug);
}

export function stationById(id: string | null | undefined): DbStation | undefined {
  return id ? getDb().stations.find((s) => s.ident.id === id) : undefined;
}

export function creatorById(id: string): DbCreator | undefined {
  return getDb().creators.find((c) => c.id === id);
}

export function worksOf(creatorId: string): DbWork[] {
  return getDb().works.filter((w) => w.creatorId === creatorId);
}

/** The creator's latest yes, if any. */
export function yesOf(creatorId: string): DbRequest | undefined {
  return getDb()
    .requests.filter((r) => r.creatorId === creatorId && r.answer?.answer === "yes")
    .sort((a, b) => b.answer!.answeredAt.localeCompare(a.answer!.answeredAt))[0];
}

/** Tenths of a channel ("33.1" → 331). */
export function tenthsOf(channel: string): number {
  return Math.round(Number(channel) * 10);
}

/** Who holds a channel in a market and band: a station, or a waitlist hold. */
export function channelTakenBy(marketId: string, band: "tv" | "radio", channel: string): { station?: DbStation; hold?: DbReservation } | null {
  const d = getDb();
  const t = tenthsOf(channel);
  const station = d.stations.find((s) => s.marketId === marketId && s.ident.band === band && s.ident.channel && tenthsOf(s.ident.channel) === t);
  if (station) return { station };
  const hold = d.reservations.find((r) => r.marketId === marketId && r.band === band && r.channel && (band === "tv" ? Math.floor(tenthsOf(r.channel) / 10) === Math.floor(t / 10) : tenthsOf(r.channel) === t));
  if (hold) return { hold };
  // On TV a main channel belongs to whoever has its first subchannel.
  if (band === "tv") {
    const major = d.stations.find((s) => s.marketId === marketId && s.ident.band === "tv" && s.ident.channel && Math.floor(tenthsOf(s.ident.channel) / 10) === Math.floor(t / 10) && s.ident.kind !== "listed");
    if (major) return { station: major };
  }
  return null;
}

export function callSignTaken(callSign: string): boolean {
  const d = getDb();
  return d.stations.some((s) => s.ident.callSign === callSign) || d.reservations.some((r) => r.callSign === callSign);
}

// ---- Views: the contracts' shapes ----

export function workView(w: DbWork): CreatorWork {
  const yes = yesOf(w.creatorId);
  const { creatorId: _c, ...rest } = w;
  const covered = yes?.answer?.workIds.includes(w.id) ? "permission" : w.licence?.allowsCarriage ? "licence" : "none";
  return { ...rest, covered };
}

export function creatorView(c: DbCreator): Creator {
  const station = stationById(c.stationId);
  const included = worksOf(c.id).filter((w) => !w.leftOutReason);
  const first = c.proposedOptions?.channels[0];
  const setup = c.setup && station
    ? {
        recipeId: c.setup.recipeId,
        band: station.ident.band ?? "tv",
        channel: station.ident.channel ?? "",
        callSign: station.ident.callSign ?? "",
        name: station.ident.name,
        colour: station.ident.colour,
        operator: team().find((p) => p.id === c.setup!.operatorId) ? { id: c.setup.operatorId, name: team().find((p) => p.id === c.setup!.operatorId)!.displayName! } : null,
        signOnAt: station.firstSignedOnAt ?? station.signOnAt,
        importDone: c.setup.importDone ?? 0,
        importTotal: c.setup.importTotal,
        escrowStationId: station.escrowId
      }
    : null;
  return {
    id: c.id,
    displayName: c.displayName,
    personName: c.personName,
    description: c.description,
    sourcePlatform: c.sourcePlatform,
    sourceUrl: c.sourceUrl,
    contactEmail: c.contactEmail,
    stage: c.stage,
    proposed: c.proposedOptions && first ? { band: c.proposedOptions.band, channel: first } : null,
    nextAction: c.nextAction,
    nextActionDue: c.nextActionDue,
    doNotAsk: c.doNotAsk,
    station: station?.ident ?? null,
    works: included.length,
    worksDurationMs: included.reduce((s, w) => s + (w.durationMs ?? 0), 0),
    proposedOptions: c.proposedOptions,
    askedAt: c.askedAt,
    remindedAt: c.remindedAt,
    answeredAt: c.answeredAt,
    claimInviteSentAt: c.claimInviteSentAt,
    claimLinkSentAt: c.claimLinkSentAt,
    claimedAt: c.claimedAt,
    licenceName: c.licenceName,
    pronoun: c.pronoun,
    setup
  };
}

/** One band of a market's board, with the market-wide stats (N7) and each slot's sign-on (N7). */
export function boardView(market: Market, band: "tv" | "radio"): MarketBoard {
  const d = getDb();
  const onBand = d.stations.filter((s) => s.marketId === market.id && s.ident.band === band && s.ident.channel);
  const holds = d.reservations.filter((r) => r.marketId === market.id && r.band === band && r.channel);
  const majors = band === "tv" ? Array.from({ length: 68 }, (_, i) => i + 2) : Array.from({ length: 100 }, (_, i) => 881 + i * 2);
  const slots = majors.map((major) => {
    const here = onBand
      .filter((s) => (band === "tv" ? Math.floor(tenthsOf(s.ident.channel!) / 10) === major : tenthsOf(s.ident.channel!) === major))
      .sort((a, b) => tenthsOf(a.ident.channel!) - tenthsOf(b.ident.channel!));
    const hold = holds.find((h) => (band === "tv" ? Math.floor(tenthsOf(h.channel!) / 10) === major : tenthsOf(h.channel!) === major));
    const first = here[0];
    const state: MarketBoard["slots"][number]["state"] = first
      ? first.ident.kind === "claimable"
        ? "claimable"
        : first.ident.kind === "listed"
          ? "listed"
          : first.ident.kind === "catalog"
            ? "catalog"
            : "station"
      : hold
        ? "held"
        : "open";
    const creator = first ? d.creators.find((c) => c.stationId === first.ident.id) : undefined;
    const notYet = first && !first.public;
    return {
      major,
      state,
      stations: here.map((s) => s.ident),
      heldFor: hold?.callSign ?? null,
      status: notYet ? (first.signOnAt ? "Signs on" : "Setting up") : null,
      signOnAt: notYet ? first.signOnAt : null,
      creatorId: state === "claimable" ? (creator?.id ?? null) : null
    };
  });
  const claimable = (b: "tv" | "radio") => d.stations.filter((s) => s.marketId === market.id && s.ident.band === b && s.ident.kind === "claimable" && s.public).length;
  const dead = (b: "tv" | "radio"): StationIdent[] => d.stations.filter((s) => s.marketId === market.id && s.ident.band === b && d.deadAir.includes(s.ident.id)).map((s) => s.ident);
  const share = d.localShare[market.id];
  const anyOnAir = d.stations.some((s) => s.marketId === market.id && s.public && s.ident.channel);
  return {
    market,
    band,
    slots,
    stats: {
      localShareOfTonightPercent: onBand.some((s) => s.public) ? (share?.[band] ?? null) : null,
      claimableOnAir: claimable(band),
      saidYesNotSetUp: d.creators.filter((c) => c.marketId === market.id && c.stage === "said_yes" && !c.stationId).length,
      deadAirComing: dead(band),
      waitlistHere: d.reservations.filter((r) => r.marketId === market.id).length,
      market: { localShareOfTonightPercent: anyOnAir ? (share?.market ?? null) : null, claimableOnAir: claimable("tv") + claimable("radio"), deadAirComing: [...dead("tv"), ...dead("radio")] }
    }
  };
}

export function heldView(): HeldEarnings {
  const d = getDb();
  const stations = d.creators.flatMap((c) => {
    const s = stationById(c.stationId);
    if (!s || s.ident.kind !== "claimable") return [];
    const b = d.balances[s.ident.id] ?? { heldMicros: 0, owedMicros: 0 };
    const h = d.handovers.find((x) => x.stationId === s.ident.id);
    const status = h?.completedAt
      ? h.kind === "stop"
        ? ("stopped" as const)
        : ("claimed" as const)
      : h
        ? ("claim_pending" as const)
        : !s.public
          ? ("not_on_air_yet" as const)
          : c.claimLinkSentAt
            ? ("claim_link_sent" as const)
            : c.claimInviteSentAt
              ? ("invited" as const)
              : ("on_air" as const);
    return [
      {
        station: s.ident,
        creator: c.personName ?? c.displayName,
        creatorId: c.id,
        creatorName: c.displayName,
        escrowStationId: s.escrowId ?? 0,
        onAirSince: s.public ? s.firstSignedOnAt : null,
        rightsBasis: c.licenceName ? ("licence" as const) : ("permission" as const),
        heldMicros: b.heldMicros,
        owedNotYetDepositedMicros: b.owedMicros,
        status,
        invitedAt: c.claimInviteSentAt,
        claimLinkSentAt: c.claimLinkSentAt,
        signOnAt: s.public ? null : s.signOnAt,
        licenceName: c.licenceName
      }
    ];
  });
  // Money first: the biggest balance at the top, not-yet-on-air last.
  stations.sort((a, b) => b.heldMicros + b.owedNotYetDepositedMicros - (a.heldMicros + a.owedNotYetDepositedMicros));
  return {
    contractAddress: ESCROW.address,
    stations,
    totalHeldMicros: stations.reduce((s, x) => s + x.heldMicros + x.owedNotYetDepositedMicros, 0),
    everMovedToOpencastMicros: 0,
    stationsHoldingMoney: stations.filter((x) => x.heldMicros + x.owedNotYetDepositedMicros > 0).length,
    unclaimedPeriodDays: ESCROW.unclaimedPeriodDays,
    chain: ESCROW.chain
  };
}

/** The creator's permission page for a request (the desk mock answers the public endpoints too). */
export function permissionView(r: DbRequest): PermissionPage {
  const c = creatorById(r.creatorId)!;
  const station = stationById(c.stationId);
  const works = worksOf(c.id);
  return {
    creator: { displayName: c.displayName, personName: c.personName },
    proposed: r.proposed,
    note: r.note,
    works: works.map((w) => ({ id: w.id, title: w.title, durationMs: w.durationMs, included: r.answer ? r.answer.workIds.includes(w.id) : !w.leftOutReason, leftOutReason: w.leftOutReason })),
    schedulePreview: [],
    answer: r.answer ? { answer: r.answer.answer, answeredAt: r.answer.answeredAt, works: r.answer.workIds.length } : null,
    station: station?.ident ?? null,
    claimable: !!station && c.stage !== "claimed"
  };
}
