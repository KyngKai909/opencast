// The mock API's rights claims for the desk (desk-pages 01): every claim on every station, with the
// frame's four open ones (Late Crate on BEAT, answered, with three carriers; Tamales for forty on
// SAZN, its answer due in two days; Harbor Nights on REEL, carried by PREP with nothing scheduled;
// and Council Watch on CIVC, a privacy complaint carried by six stations), and a few closed ones,
// one of them in the High Desert for its market lead. Kept in localStorage ("oc-mock-desk-claims";
// remove it to start again). The timeline, what's next and the standing come from the contracts,
// the same code the API runs; the repeat limit and the dates from the mock's rules registry.

import {
  CLAIM_ANSWER_SOON_DAYS,
  claimNext,
  claimPhase,
  claimTimeline,
  repeatStanding,
  type Claim,
  type ClaimKind,
  type ClaimState,
  type DeskClaim,
  type DeskClaims,
  type DeskClaimStation
} from "@opencast/contracts";
import { now } from "../../lib/clock";
import type { MockPerson } from "../../mocks/people";
import { MARKETS } from "./fixtures/markets";
import { STATION_IDS as S } from "./fixtures/stations";
import { U } from "./fixtures/ids";
import { stationById } from "./db";
import { isAdminNow, mayRights, rolesOf, valueAt } from "./settingsDb";

export const CLAIMS_DB_KEY = "oc-mock-desk-claims";
const VERSION = 1;
const DAY = 86_400_000;

export interface MockClaim {
  id: string;
  kind: ClaimKind;
  itemId: string;
  itemTitle: string;
  stationId: string;
  claimantName: string;
  claimantRole: string | null;
  claimantContact: string;
  workKind: string | null;
  claimText: string;
  rangeStartMs: number | null;
  rangeEndMs: number | null;
  state: ClaimState;
  receivedAt: string;
  answerDueAt: string;
  closedAt: string | null;
  answer: { basis: string; note: string | null; attachmentUrl: string | null; answeredAt: string; claimantReplyDueAt: string } | null;
  attachments: Array<{ fileName: string; url: string }>;
  /** Where it was pulled: the maker and every carrier with airings. */
  takedowns: Array<{ stationId: string; pulledAt: string; airingsReplaced: number; restoredAt: string | null }>;
  /** Carriers under an agreement with nothing scheduled: off air there too while it's open. */
  agreementCarriers: string[];
  /** Where to write to the maker. */
  stationEmail: string | null;
}

interface ClaimsDb {
  version: number;
  claims: MockClaim[];
}

const pulled = (stationId: string, pulledAt: string, airingsReplaced: number, restoredAt: string | null = null) => ({ stationId, pulledAt, airingsReplaced, restoredAt });

function seed(): ClaimsDb {
  const late = "2026-09-12T21:04:00.000Z";
  const lateAnswer = "2026-09-15T17:30:00.000Z";
  const council = "2026-09-24T16:20:00.000Z";
  const tamales = "2026-09-15T00:30:00.000Z";
  const harbor = "2026-09-22T18:00:00.000Z";
  const base = { claimantRole: null, rangeStartMs: null, rangeEndMs: null, closedAt: null, answer: null, attachments: [], agreementCarriers: [] };
  const licence = `https://files.opencast.example/claims/${U(8101)}/northside-licence.pdf`;
  const claims: MockClaim[] = [
    {
      ...base,
      id: U(8104),
      kind: "privacy",
      itemId: U(8204),
      itemTitle: "Council Watch, Sept 22",
      stationId: S.CIVC,
      claimantName: "A Riverside resident",
      claimantContact: "resident@example.com",
      workKind: "Their face shown without consent",
      claimText: "I'm shown in the public comment line at 04:10 without my consent. I asked the camera operator not to film me.",
      rangeStartMs: 250_000,
      rangeEndMs: 262_000,
      state: "open",
      receivedAt: council,
      answerDueAt: new Date(Date.parse(council) + 14 * DAY).toISOString(),
      takedowns: [pulled(S.CIVC, council, 2), pulled(S.BEAT, council, 1), pulled(S.SAZN, council, 1), pulled(S.REEL, council, 1), pulled(S.PREP, council, 1), pulled(S.VOZE, council, 1), pulled(S.HALL, council, 1)],
      stationEmail: "desk@inlandcivic.example"
    },
    {
      ...base,
      id: U(8103),
      kind: "copyright",
      itemId: U(8203),
      itemTitle: "Harbor Nights, ep. 2",
      stationId: S.REEL,
      claimantName: "Harbor Light Pictures",
      claimantRole: "Says they distribute the film",
      claimantContact: "clearances@harborlight.example",
      workKind: "The whole episode",
      claimText: "This is our film, Harbor Nights, shown in full. We hold the US distribution rights.",
      state: "open",
      receivedAt: harbor,
      answerDueAt: new Date(Date.parse(harbor) + 14 * DAY).toISOString(),
      takedowns: [pulled(S.REEL, harbor, 1)],
      agreementCarriers: [S.PREP],
      stationEmail: "hello@reelinland.example"
    },
    {
      ...base,
      id: U(8102),
      kind: "copyright",
      itemId: U(8202),
      itemTitle: "Tamales for forty, ep. 3",
      stationId: S.SAZN,
      claimantName: "Marisol Vega Photography",
      claimantRole: "A photographer",
      claimantContact: "marisol@vegaphoto.example",
      workKind: "Stills used in the intro",
      claimText: "Four of my photographs of the Fontana market are in the opening titles. I never licensed them.",
      rangeStartMs: 0,
      rangeEndMs: 45_000,
      state: "open",
      receivedAt: tamales,
      answerDueAt: new Date(Date.parse(tamales) + 14 * DAY).toISOString(),
      takedowns: [pulled(S.SAZN, tamales, 2), pulled(S.VOZE, tamales, 1)],
      stationEmail: "sazon@example.com"
    },
    {
      ...base,
      id: U(8101),
      kind: "copyright",
      itemId: U(8201),
      itemTitle: "Late Crate, ep. 9",
      stationId: S.BEAT,
      claimantName: "Northside Records",
      claimantRole: "Says they own the master recordings",
      claimantContact: "rights@northside.example",
      workKind: "Two tracks in the second half",
      claimText: 'Two of our masters play in the second half: "Night Bus" from 31:10 and "Low Tide" from 41:30.',
      rangeStartMs: 1_870_000,
      rangeEndMs: 2_655_000,
      state: "answered",
      receivedAt: late,
      answerDueAt: new Date(Date.parse(late) + 14 * DAY).toISOString(),
      answer: { basis: "owner_permission", note: "Northside's own licence to BEAT for both tracks, signed in June.", attachmentUrl: licence, answeredAt: lateAnswer, claimantReplyDueAt: "2026-09-29T17:30:00.000Z" },
      attachments: [{ fileName: "northside-licence.pdf", url: licence }],
      takedowns: [pulled(S.BEAT, late, 2, lateAnswer), pulled(S.REEL, late, 1, lateAnswer), pulled(S.PREP, late, 1, lateAnswer), pulled(S.VOZE, late, 1, lateAnswer)],
      stationEmail: "kai@inlandbeat.example"
    },
    {
      ...base,
      id: U(8105),
      kind: "copyright",
      itemId: U(8205),
      itemTitle: "Desert Drive-In, ep. 4",
      stationId: S.MOJV,
      claimantName: "Sunset Reels Inc.",
      claimantContact: "legal@sunsetreels.example",
      workKind: "A trailer shown in the break",
      claimText: "The trailer at 12:00 is ours.",
      state: "withdrawn",
      receivedAt: "2026-09-02T17:00:00.000Z",
      answerDueAt: "2026-09-16T17:00:00.000Z",
      closedAt: "2026-09-09T18:00:00.000Z",
      takedowns: [pulled(S.MOJV, "2026-09-02T17:00:00.000Z", 1, "2026-09-09T18:00:00.000Z")],
      stationEmail: "mojave@example.com"
    },
    {
      ...base,
      id: U(8106),
      kind: "copyright",
      itemId: U(8206),
      itemTitle: "Crate Session 03",
      stationId: S.BEAT,
      claimantName: "Westside Tapes LLC",
      claimantContact: "legal@westside.example",
      workKind: "A master recording",
      claimText: "12:40 to 31:05 is our master.",
      state: "restored",
      receivedAt: "2026-08-19T18:10:00.000Z",
      answerDueAt: "2026-09-02T18:10:00.000Z",
      closedAt: "2026-09-03T17:00:00.000Z",
      answer: { basis: "made_it", note: null, attachmentUrl: null, answeredAt: "2026-08-20T16:00:00.000Z", claimantReplyDueAt: "2026-09-03T16:00:00.000Z" },
      takedowns: [pulled(S.BEAT, "2026-08-19T18:10:00.000Z", 1, "2026-08-20T16:00:00.000Z")],
      stationEmail: "kai@inlandbeat.example"
    },
    {
      ...base,
      id: U(8107),
      kind: "copyright",
      itemId: U(8207),
      itemTitle: "Borrowed film",
      stationId: S.REEL,
      claimantName: "Studio Nine",
      claimantContact: "x@studionine.example",
      workKind: "The whole film",
      claimText: "Ours.",
      state: "expired",
      receivedAt: "2026-08-01T17:00:00.000Z",
      answerDueAt: "2026-08-15T17:00:00.000Z",
      closedAt: "2026-08-15T17:00:00.000Z",
      takedowns: [pulled(S.REEL, "2026-08-01T17:00:00.000Z", 3)],
      stationEmail: "hello@reelinland.example"
    },
    {
      ...base,
      id: U(8108),
      kind: "copyright",
      itemId: U(8208),
      itemTitle: "Harbor Nights, ep. 1",
      stationId: S.REEL,
      claimantName: "Harbor Light Pictures",
      claimantContact: "clearances@harborlight.example",
      workKind: "The whole episode",
      claimText: "Our film, shown in full.",
      state: "upheld",
      receivedAt: "2026-06-02T17:00:00.000Z",
      answerDueAt: "2026-06-16T17:00:00.000Z",
      closedAt: "2026-07-10T17:00:00.000Z",
      answer: { basis: "public_domain", note: "We believed it was never renewed.", attachmentUrl: null, answeredAt: "2026-06-05T17:00:00.000Z", claimantReplyDueAt: "2026-06-19T17:00:00.000Z" },
      takedowns: [pulled(S.REEL, "2026-06-02T17:00:00.000Z", 2, "2026-06-05T17:00:00.000Z")],
      stationEmail: "hello@reelinland.example"
    }
  ];
  return { version: VERSION, claims };
}

let db: ClaimsDb | null = null;

export function claimsDb(): ClaimsDb {
  if (db) return db;
  try {
    const raw = localStorage.getItem(CLAIMS_DB_KEY);
    const saved = raw ? (JSON.parse(raw) as ClaimsDb) : null;
    db = saved && saved.version === VERSION ? saved : seed();
  } catch {
    db = seed();
  }
  return db;
}

export function saveClaims() {
  try {
    localStorage.setItem(CLAIMS_DB_KEY, JSON.stringify(claimsDb()));
  } catch {
    // Private windows: kept for this visit only.
  }
}

export function resetClaims() {
  db = seed();
  saveClaims();
}

if (typeof window !== "undefined")
  window.addEventListener("storage", (e) => {
    if (e.key === CLAIMS_DB_KEY || e.key === null) db = null;
  });

const identOf = (id: string) => stationById(id)?.ident ?? null;

/** The claim as a station sees it (trust's `Claim`). */
export function claimView(c: MockClaim, at: Date = now()): Claim | null {
  const station = identOf(c.stationId);
  if (!station) return null;
  return {
    id: c.id,
    kind: c.kind,
    item: { id: c.itemId, title: c.itemTitle },
    station,
    claimantName: c.claimantName,
    claimantRole: c.claimantRole,
    workKind: c.workKind,
    claimText: c.claimText,
    rangeStartMs: c.rangeStartMs,
    rangeEndMs: c.rangeEndMs,
    swornStatement: true,
    state: c.state,
    receivedAt: c.receivedAt,
    answerDueAt: c.answerDueAt,
    daysToAnswer: c.state === "open" && c.kind === "copyright" ? Math.max(0, Math.ceil((Date.parse(c.answerDueAt) - at.getTime()) / DAY)) : null,
    answer: c.answer,
    takedowns: c.takedowns.flatMap((t) => {
      const where = identOf(t.stationId);
      return where ? [{ station: where, pulledAt: t.pulledAt, airingsReplaced: t.airingsReplaced, replacedWith: null, restoredAt: t.restoredAt }] : [];
    })
  };
}

function deskView(c: MockClaim, at: Date): DeskClaim | null {
  const claim = claimView(c, at);
  if (!claim) return null;
  const phase = claimPhase(c.state);
  const facts = { kind: c.kind, state: c.state, receivedAt: c.receivedAt, answerDueAt: c.answerDueAt, closedAt: c.closedAt, answer: c.answer, takedowns: c.takedowns };
  const lastRestore = c.takedowns.map((t) => t.restoredAt).filter((v): v is string => !!v).sort().at(-1) ?? null;
  const carriers: DeskClaim["carriers"] = claim.takedowns.filter((t) => t.station.id !== c.stationId).map((t) => ({ station: t.station, airingsPulled: t.airingsReplaced, pulledAt: t.pulledAt, restoredAt: t.restoredAt }));
  if (phase === "open") {
    for (const id of c.agreementCarriers) {
      const s = identOf(id);
      if (s && !carriers.some((k) => k.station.id === id)) carriers.push({ station: s, airingsPulled: 0, pulledAt: null, restoredAt: c.state === "answered" ? lastRestore : null });
    }
  }
  const marketId = stationById(c.stationId)?.marketId;
  return {
    ...claim,
    phase,
    claimantContact: c.claimantContact,
    market: MARKETS.find((m) => m.id === marketId) ?? null,
    next: claimNext(facts),
    carriers,
    timeline: claimTimeline(facts),
    stationEmail: c.stationEmail,
    attachments: c.attachments
  };
}

/** Everywhere (admins, rights reviewers), or a market lead's markets. */
export function marketsFor(p: MockPerson): Set<string> | null {
  if (isAdminNow(p) || mayRights(p)) return null;
  return new Set(rolesOf(p).flatMap((g) => (g.role === "market_lead" && g.market ? [g.market.id] : [])));
}

/** The desk's list, as `trust.listDeskClaims` answers it. */
export function deskClaimsView(p: MockPerson, marketId?: string | null): DeskClaims {
  const at = now();
  const allowed = marketsFor(p);
  const markets = marketId ? new Set([marketId]) : allowed;
  const rows = [...claimsDb().claims]
    .filter((c) => !markets || markets.has(stationById(c.stationId)?.marketId ?? ""))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const claims = rows.flatMap((c) => deskView(c, at) ?? []);
  const limit = (valueAt("rights.repeat_limit", at) as { upheldIn12Months: number }).upheldIn12Months;
  const dates = valueAt("rights.claim_dates", at) as { answerDays: number; counterNoticeBusinessDays: number };
  const yearAgo = at.getTime() - 365 * DAY;
  const byStation = new Map<string, DeskClaimStation & { upheld: number }>();
  for (const c of rows) {
    const view = claims.find((x) => x.id === c.id);
    if (!view) continue;
    const s = byStation.get(c.stationId) ?? { station: view.station, open: 0, closed: 0, upheldLast12Months: 0, standing: "good" as const, upheld: 0 };
    if (view.phase === "open") s.open++;
    else s.closed++;
    if (c.state === "upheld" && c.kind === "copyright" && c.closedAt && Date.parse(c.closedAt) >= yearAgo) s.upheld++;
    byStation.set(c.stationId, s);
  }
  const stations: DeskClaimStation[] = [...byStation.values()]
    .map(({ upheld, ...s }) => ({ ...s, upheldLast12Months: upheld, standing: repeatStanding(upheld, limit) }))
    .sort((a, b) => b.upheldLast12Months - a.upheldLast12Months || b.open - a.open || (a.station.callSign ?? "").localeCompare(b.station.callSign ?? ""));
  const open = claims.filter((c) => c.phase === "open");
  const due = open.filter((c) => c.state === "open" && c.kind === "copyright" && c.daysToAnswer !== null && c.daysToAnswer <= CLAIM_ANSWER_SOON_DAYS);
  return {
    claims,
    stations,
    stats: {
      open: open.length,
      offAir: open.filter((c) => c.state === "open").length,
      answersDue: due.length,
      soonestAnswerDays: due.length ? Math.min(...due.map((c) => c.daysToAnswer!)) : null,
      carryingStations: new Set(open.flatMap((c) => c.carriers.map((k) => k.station.id))).size,
      nearRepeatLimit: stations.filter((s) => s.standing !== "good").length
    },
    rules: { repeatLimit: limit, answerDays: dates.answerDays, counterNoticeBusinessDays: dates.counterNoticeBusinessDays },
    canResolve: allowed === null
  };
}
