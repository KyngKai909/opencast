// The mock API's Settings and catalog shelf (desk-pages 04, desk-catalog 01 to 03): the team's desk
// roles, the rules registry with its versions and change log, escrow signer proposals, and the
// shelf's series, items, checks and episodes. Kept apart from the desk's main mock db, in
// localStorage ("oc-mock-desk-settings"; remove it to start again). The rules and the public-domain
// reading come from the contracts, the same code the API runs.

import {
  basisLine,
  basisOf,
  checklistFor,
  readPublicDomain,
  RULE_KEYS,
  RULES,
  ruleDef,
  SHELF_BASIS_LABELS,
  type ChangeLogEntry,
  type ChecklistLine,
  type ChecklistLineName,
  type DeskPerson,
  type DeskRoleGrant,
  type EpisodeView,
  type LineState,
  type MarketNumbering,
  type Numbering,
  type RebuildView,
  type RuleKey,
  type RuleVersion,
  type RuleView,
  type Shelf,
  type ShelfBasis,
  type ShelfItem,
  type ShelfItemRow,
  type ShelfSeries,
  type ShelfSeriesRow,
  type SignerProposal
} from "@opencast/contracts";
import { now } from "../../lib/clock";
import { personByEmail, PEOPLE, type MockPerson } from "../../mocks/people";
import { MARKETS, HD } from "./fixtures/markets";
import { U } from "./fixtures/ids";
import { getDb as deskDb, stationById } from "./db";

export const SETTINGS_DB_KEY = "oc-mock-desk-settings";
// 2: A201's rule version (DASH stream links played).
const VERSION = 2;
const CATALOG = U(111);
const FALLBACK_ID = "00000000-0000-4000-8000-000000000000";
export const DEE_ID = U(900);
export const SAMK_ID = U(901);
export const RAE_ID = U(902);
export const LEE_ID = U(903);

export interface MockRuleVersion {
  id: string;
  key: RuleKey;
  scope: string;
  value: unknown;
  effectiveFrom: string;
  setBy: string | null;
  note: string | null;
  createdAt: string;
}

export interface MockProposal {
  id: string;
  kind: SignerProposal["kind"];
  oldAddress: string | null;
  newAddress: string | null;
  signersAfter: string[];
  thresholdAfter: number;
  note: string | null;
  proposedBy: string;
  proposedAt: string;
  approvers: string[];
  decisions: Array<{ adminId: string; decision: "approve" | "refuse"; at: string; note: string | null }>;
  status: SignerProposal["status"];
  decidedAt: string | null;
}

interface Check {
  state: LineState;
  detail: string | null;
  record: string | null;
  setBy: string | null;
  setAt: string | null;
}

export interface MockItem {
  id: string;
  seriesId: string;
  title: string;
  source: string;
  workKind: "film" | "sound_recording";
  publishedYear: number | null;
  country: string;
  basis: ShelfItem["basis"];
  libraryItemId: string | null;
  contentId: string;
  durationMs: number | null;
  state: ShelfItem["state"];
  firstCheckedBy: string | null;
  firstCheckedAt: string | null;
  secondCheckedBy: string | null;
  secondCheckedAt: string | null;
  failedBy: string | null;
  failedAt: string | null;
  failedReason: string | null;
  checks: Partial<Record<ChecklistLineName, Check>>;
  evidence: Array<{ id: string; line: ChecklistLineName; fileName: string; contentType: string; bytes: number; contentId: string; uploadedBy: string; at: string }>;
}

export interface MockSeries {
  id: string;
  title: string;
  description: string | null;
  colour: string | null;
  mediaKind: "video" | "audio";
  episodeLengthMs: number | null;
  rightsBasis: ShelfBasis;
  basisNote: string | null;
  notes: string | null;
  state: "building" | "coming";
  offered: boolean;
  programId: string;
  /** The reference's numbers for what the mock doesn't hold item by item (312 items, 486 hours). */
  fixture?: { episodesReady: number; episodesTotal: number; carriers: number; markets: number; itemsPassed: number; readyMs: number };
  carriers: string[];
}

export interface MockEpisode {
  id: string;
  seriesId: string;
  number: number;
  title: string | null;
  status: EpisodeView["status"];
  version: number;
  composedAt: string | null;
  libraryItemId: string | null;
  items: Array<{ itemId: string; position: number | null; removedAt: string | null; removedReason: string | null }>;
  /** Its items changed since it was last composed: the next rebuild composes it. */
  dirty?: boolean;
}

export interface MockLibraryItem {
  libraryItemId: string;
  title: string;
  contentId: string;
  lengthMs: number;
  mediaKind: "video" | "audio";
}

export interface SettingsDb {
  version: number;
  admins: string[];
  roles: Array<{ personId: string; role: "rights_reviewer" | "market_lead"; marketId: string | null }>;
  rules: MockRuleVersion[];
  log: Array<Omit<ChangeLogEntry, "by"> & { by: string | null }>;
  proposals: MockProposal[];
  signers: { source: "contract" | "config" | "none"; list: string[]; threshold: number | null };
  series: MockSeries[];
  items: MockItem[];
  episodes: MockEpisode[];
  rebuilds: Array<Omit<RebuildView, "by"> & { by: string | null; seriesId: string }>;
  library: MockLibraryItem[];
  seq: number;
}

/** A content ID for the mock's files: CIDv1 raw's shape, one per number. */
const cid = (n: number) => `bafkrei${[...String(n)].map((d) => "bcdefghijk"[Number(d)]).join("").padStart(52, "a")}`;
const min = (m: number, s = 0) => (m * 60 + s) * 1000;

function seedShelf() {
  const series: MockSeries[] = [
    { id: U(7101), title: "Nights at the observatory", description: "2 hr episodes. NASA footage", colour: "#1F3A5F", mediaKind: "video", episodeLengthMs: min(120), rightsBasis: "us_government", basisNote: "Public domain by law", notes: null, state: "building", offered: true, programId: U(7201), fixture: { episodesReady: 12, episodesTotal: 12, carriers: 14, markets: 3, itemsPassed: 36, readyMs: min(24 * 60) }, carriers: [] },
    { id: U(7102), title: "Cartoons, 1928 to 1936", description: "30 min episodes, 3 or 4 shorts each", colour: "#9A5412", mediaKind: "video", episodeLengthMs: min(30), rightsBasis: "mixed", basisNote: "Before 1931, or not renewed", notes: "Built from original prints held by the Internet Archive and the Library of Congress.", state: "building", offered: true, programId: U(7202), fixture: { episodesReady: 39, episodesTotal: 39, carriers: 12, markets: 3, itemsPassed: 135, readyMs: min(39 * 30) }, carriers: [] },
    { id: U(7103), title: "National parks on film", description: "60 min episodes. National Park Service", colour: "#2E6B5A", mediaKind: "video", episodeLengthMs: min(60), rightsBasis: "us_government", basisNote: "Public domain by law", notes: null, state: "building", offered: true, programId: U(7203), fixture: { episodesReady: 18, episodesTotal: 18, carriers: 8, markets: 2, itemsPassed: 41, readyMs: min(18 * 60) }, carriers: [] },
    { id: U(7104), title: "Newsreels, 1930 to 1950", description: "60 min episodes", colour: "#525C73", mediaKind: "video", episodeLengthMs: min(60), rightsBasis: "mixed", basisNote: "Not renewed, or archive grant", notes: null, state: "building", offered: true, programId: U(7204), fixture: { episodesReady: 26, episodesTotal: 26, carriers: 5, markets: 2, itemsPassed: 52, readyMs: min(26 * 60) }, carriers: [] },
    { id: U(7105), title: "The mystery hour", description: "30 min radio dramas, 1940s", colour: "#33507A", mediaKind: "audio", episodeLengthMs: min(30), rightsBasis: "sound_recording", basisNote: "Old radio rights vary by series", notes: null, state: "building", offered: true, programId: U(7205), fixture: { episodesReady: 44, episodesTotal: 60, carriers: 6, markets: 2, itemsPassed: 44, readyMs: min(44 * 30) }, carriers: [] },
    { id: U(7106), title: "Licensed catalogs", description: "Revenue share with rights holders", colour: "#26345A", mediaKind: "video", episodeLengthMs: null, rightsBasis: "licence", basisNote: "Terms not set", notes: null, state: "coming", offered: false, programId: U(7206), fixture: { episodesReady: 0, episodesTotal: 0, carriers: 0, markets: 0, itemsPassed: 0, readyMs: 0 }, carriers: [] }
  ];
  const checked = (at: string, basis: ShelfItem["basis"]) => ({ basis, state: "passed" as const, firstCheckedBy: DEE_ID, firstCheckedAt: at, secondCheckedBy: RAE_ID, secondCheckedAt: at, failedBy: null, failedAt: null, failedReason: null });
  const allOk = (by: string, at: string, renewal: "ok" | "not_needed"): MockItem["checks"] => ({
    source: { state: "ok", detail: "Scan of the original print", record: "Archive record checked", setBy: by, setAt: at },
    published: { state: "ok", detail: "Title card shows the year", record: "Title card", setBy: by, setAt: at },
    renewal: renewal === "ok" ? { state: "ok", detail: "Copyright Office renewal records searched: none found", record: "Renewal search", setBy: by, setAt: at } : { state: "not_needed", detail: "Published before 1931: no renewal search needed", record: null, setBy: null, setAt: at },
    soundtrack: { state: "ok", detail: "Original score, published with the film", record: "Cue notes", setBy: by, setAt: at },
    trademarks: { state: "ok", detail: "None shown", record: "Noted", setBy: by, setAt: at }
  });
  const base = { seriesId: U(7102), workKind: "film" as const, country: "US", libraryItemId: null, evidence: [] };
  const items: MockItem[] = [
    { ...base, id: U(7301), title: "River Rhythms", source: "1929, original print, Internet Archive", publishedYear: 1929, contentId: cid(1), durationMs: min(6, 40), ...checked("2026-09-14T17:00:00.000Z", "published_before_cutoff"), checks: allOk(DEE_ID, "2026-09-14T17:00:00.000Z", "not_needed") },
    { ...base, id: U(7302), title: "The Paddle Wheel Parade", source: "1933, original print, Library of Congress", publishedYear: 1933, contentId: cid(2), durationMs: min(7, 5), ...checked("2026-09-14T17:00:00.000Z", "not_renewed"), checks: allOk(DEE_ID, "2026-09-14T17:00:00.000Z", "ok") },
    { ...base, id: U(7303), title: "Steam and Song", source: "1930, original print, Internet Archive", publishedYear: 1930, contentId: cid(3), durationMs: min(6, 55), ...checked("2026-09-14T17:00:00.000Z", "published_before_cutoff"), checks: allOk(DEE_ID, "2026-09-14T17:00:00.000Z", "not_needed") },
    {
      ...base,
      id: U(7304),
      title: "Down the River",
      source: "1934, original print, Library of Congress",
      publishedYear: 1934,
      contentId: cid(4),
      durationMs: min(7, 20),
      ...checked("2026-09-10T17:00:00.000Z", "not_renewed"),
      state: "failed",
      failedBy: DEE_ID,
      failedAt: "2026-09-21T16:00:00.000Z",
      failedReason: "Renewal found in 1962",
      checks: allOk(DEE_ID, "2026-09-10T17:00:00.000Z", "ok")
    },
    { ...base, id: U(7305), title: "Harbor Lights Frolic", source: "1932, original print, Library of Congress", publishedYear: 1932, contentId: cid(5), durationMs: min(6, 10), ...checked("2026-09-21T18:00:00.000Z", "not_renewed"), checks: allOk(DEE_ID, "2026-09-21T18:00:00.000Z", "ok") }
  ];
  const episodes: MockEpisode[] = [
    {
      id: U(7401),
      seriesId: U(7102),
      number: 14,
      title: "River boats and paddle wheels",
      status: "ready",
      version: 2,
      composedAt: "2026-09-21T18:30:00.000Z",
      libraryItemId: U(7501),
      items: [
        { itemId: U(7301), position: 1, removedAt: null, removedReason: null },
        { itemId: U(7302), position: 2, removedAt: null, removedReason: null },
        { itemId: U(7303), position: 3, removedAt: null, removedReason: null },
        { itemId: U(7304), position: null, removedAt: "2026-09-21T16:00:00.000Z", removedReason: "Renewal found in 1962" },
        { itemId: U(7305), position: 4, removedAt: null, removedReason: null }
      ]
    }
  ];
  const rebuilds: SettingsDb["rebuilds"] = [
    { id: U(7601), seriesId: U(7102), at: "2026-09-21T16:00:00.000Z", by: DEE_ID, reason: "Renewal found in 1962", item: { id: U(7304), title: "Down the River" }, episodes: [{ episodeId: U(7401), number: 14, fromVersion: 1, toVersion: 2, status: "ready" }], unchanged: 38 }
  ];
  const library: MockLibraryItem[] = [
    { libraryItemId: U(7701), title: "Ferry Boat Follies", contentId: cid(11), lengthMs: min(6, 45), mediaKind: "video" },
    { libraryItemId: U(7702), title: "Mill Pond Serenade", contentId: cid(12), lengthMs: min(7, 2), mediaKind: "video" },
    { libraryItemId: U(7703), title: "Tugboat Tango", contentId: cid(13), lengthMs: min(6, 30), mediaKind: "video" },
    { libraryItemId: U(7704), title: "The Midnight Caller, episode 12", contentId: cid(14), lengthMs: min(29, 30), mediaKind: "audio" }
  ];
  return { series, items, episodes, rebuilds, library };
}

function seed(): SettingsDb {
  const epoch = "1970-01-01T00:00:00.000Z";
  const rules: MockRuleVersion[] = RULE_KEYS.map((key, i) => ({ id: U(7000 + i), key, scope: "", value: RULES[key].fallback, effectiveFrom: epoch, setBy: null, note: "The value in effect before the registry", createdAt: "2026-09-29T19:00:00.000Z" }));
  // High Desert grows into its numbers: TV 2 to 36 for now.
  rules.push({ id: U(7050), key: "numbering.channels", scope: HD.id, value: { tv: { firstMajor: 2, lastMajor: 36 }, radio: { firstTenths: 882, lastTenths: 1078 } }, effectiveFrom: "2026-09-01T00:00:00.000Z", setBy: DEE_ID, note: "Room to grow later", createdAt: "2026-08-30T17:00:00.000Z" });
  // Catalog sponsors (desk-pages 03): the catalog's credit priced from August.
  // A201: DASH stream links played (decided 2026-09-30; the API gets the same version as a row).
  rules.push({ id: U(7092), key: "external.dash_stream_links", scope: "", value: { played: true }, effectiveFrom: "2026-09-26T07:00:00.000Z", setBy: DEE_ID, note: "A201: played in Opencast's player (dash.js, loaded only when a DASH station is tuned)", createdAt: "2026-09-26T07:00:00.000Z" });
  rules.push({ id: U(7091), key: "catalog.sponsor_prices", scope: "", value: { seriesMonthlyMicros: 150_000_000, everySeriesMonthlyMicros: 400_000_000 }, effectiveFrom: "2026-08-01T00:00:00.000Z", setBy: DEE_ID, note: "Launch prices", createdAt: "2026-07-30T17:00:00.000Z" });
  const log: SettingsDb["log"] = [
    { id: U(7060), at: "2026-08-30T17:00:00.000Z", by: DEE_ID, kind: "rule", subject: "numbering.channels", scope: HD.id, summary: "Channel numbering (High Desert): TV 2 to 69, radio 88.2 to 107.8 to TV 2 to 36, radio 88.2 to 107.8", before: null, after: null, effectiveFrom: "2026-09-01T00:00:00.000Z", note: "Room to grow later" },
    { id: U(7062), at: "2026-09-26T07:00:00.000Z", by: DEE_ID, kind: "rule", subject: "external.dash_stream_links", scope: "", summary: "DASH stream links: Not played yet to Played", before: { played: false }, after: { played: true }, effectiveFrom: "2026-09-26T07:00:00.000Z", note: "A201: played in Opencast's player (dash.js, loaded only when a DASH station is tuned)" },
    { id: U(7061), at: "2026-08-12T17:00:00.000Z", by: DEE_ID, kind: "role", subject: RAE_ID, scope: "", summary: "Made Rae T. a rights reviewer", before: null, after: null, effectiveFrom: null, note: null }
  ];
  return {
    version: VERSION,
    admins: PEOPLE.filter((p) => p.isAdmin).map((p) => p.id),
    roles: [
      { personId: RAE_ID, role: "rights_reviewer", marketId: null },
      { personId: LEE_ID, role: "market_lead", marketId: HD.id }
    ],
    rules,
    log,
    proposals: [],
    signers: { source: "config", list: ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8", "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", "0x90F79bf6EB2c4f870365E785982E1f101E93b906"], threshold: 2 },
    ...seedShelf(),
    seq: 0
  };
}

let db: SettingsDb | null = null;

export function settingsDb(): SettingsDb {
  if (db) return db;
  try {
    const raw = localStorage.getItem(SETTINGS_DB_KEY);
    const saved = raw ? (JSON.parse(raw) as SettingsDb) : null;
    db = saved && saved.version === VERSION ? saved : seed();
  } catch {
    db = seed();
  }
  return db;
}

export function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_DB_KEY, JSON.stringify(settingsDb()));
  } catch {
    // Private windows: kept for this visit only.
  }
}

export function resetSettings() {
  db = seed();
  saveSettings();
}

if (typeof window !== "undefined")
  window.addEventListener("storage", (e) => {
    if (e.key === SETTINGS_DB_KEY || e.key === null) db = null;
  });

export function nextId(): string {
  const d = settingsDb();
  d.seq += 1;
  return U(800_000 + d.seq);
}

// ---- People and roles ----

const personById = (id: string): MockPerson | undefined => PEOPLE.find((p) => p.id === id);
export const nameOf = (id: string) => personById(id)?.displayName ?? personById(id)?.email ?? "Someone on the team";
export const personOf = (id: string | null): DeskPerson | null => (id ? { userId: id, name: nameOf(id) } : null);

export function isAdminNow(p: MockPerson): boolean {
  return settingsDb().admins.includes(p.id);
}

export function rolesOf(p: MockPerson): DeskRoleGrant[] {
  const d = settingsDb();
  const grants: DeskRoleGrant[] = isAdminNow(p) ? [{ role: "admin", market: null }] : [];
  for (const r of d.roles.filter((x) => x.personId === p.id)) grants.push({ role: r.role, market: r.marketId ? (MARKETS.find((m) => m.id === r.marketId) ?? null) : null });
  return grants;
}

export function onTeam(p: MockPerson): boolean {
  return rolesOf(p).length > 0;
}

export function mayRights(p: MockPerson): boolean {
  return isAdminNow(p) || settingsDb().roles.some((r) => r.personId === p.id && r.role === "rights_reviewer");
}

export function findPerson(email: string): MockPerson | undefined {
  const e = email.trim().toLowerCase();
  return PEOPLE.find((p) => p.email === e) ?? (e.includes("@") ? personByEmail(e) : undefined);
}

export function logChange(entry: Omit<SettingsDb["log"][number], "id" | "at" | "scope" | "before" | "after" | "effectiveFrom" | "note"> & Partial<SettingsDb["log"][number]>) {
  settingsDb().log.unshift({ id: nextId(), at: now().toISOString(), scope: "", before: null, after: null, effectiveFrom: null, note: null, ...entry });
}

// ---- Rules ----

function versionAt(key: RuleKey, at: Date, scope = ""): MockRuleVersion | null {
  const scopes = ruleDef(key).scoped && scope ? [scope, ""] : [""];
  for (const s of scopes) {
    const found = settingsDb()
      .rules.filter((r) => r.key === key && r.scope === s && Date.parse(r.effectiveFrom) <= at.getTime())
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.createdAt.localeCompare(a.createdAt))[0];
    if (found) return found;
  }
  return null;
}

export function valueAt<K extends RuleKey>(key: K, at = now(), scope = ""): unknown {
  return versionAt(key, at, scope)?.value ?? RULES[key].fallback;
}

function versionView(key: RuleKey, r: MockRuleVersion | null, at: Date): RuleVersion {
  const d = ruleDef(key);
  const value = r ? r.value : d.fallback;
  const shownAt = r && Date.parse(r.effectiveFrom) > at.getTime() ? new Date(r.effectiveFrom) : at;
  return {
    id: r?.id ?? FALLBACK_ID,
    value,
    display: d.display(value, shownAt),
    set: d.isSet ? d.isSet(value) : true,
    effectiveFrom: r?.effectiveFrom ?? "1970-01-01T00:00:00.000Z",
    setBy: personOf(r?.setBy ?? null),
    note: r?.note ?? null,
    createdAt: r?.createdAt ?? "1970-01-01T00:00:00.000Z"
  };
}

export function ruleView(key: RuleKey, at = now(), scope = ""): RuleView {
  const d = ruleDef(key);
  const s = d.scoped ? scope : "";
  const current = versionAt(key, at, s);
  const next = settingsDb()
    .rules.filter((r) => r.key === key && r.scope === s && Date.parse(r.effectiveFrom) > at.getTime())
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
  const value = current ? current.value : d.fallback;
  return {
    key,
    scope: s,
    group: d.group,
    title: d.title,
    detail: typeof d.detail === "function" ? d.detail(value) : d.detail,
    current: versionView(key, current, at),
    next: next ? versionView(key, next, at) : null,
    valueSchema: {}
  };
}

export function ruleVersions(key: RuleKey, scope = ""): RuleVersion[] {
  const at = now();
  return settingsDb()
    .rules.filter((r) => r.key === key && r.scope === (ruleDef(key).scoped ? scope : ""))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.createdAt.localeCompare(a.createdAt))
    .map((r) => versionView(key, r, at));
}

export function numberingView(): MarketNumbering[] {
  const at = now();
  return MARKETS.map((market) => {
    const r = versionAt("numbering.channels", at, market.id);
    const n = (r?.value ?? RULES["numbering.channels"].fallback) as Numbering;
    const next = settingsDb()
      .rules.filter((x) => x.key === "numbering.channels" && (x.scope === market.id || (x.scope === "" && r?.scope !== market.id)) && Date.parse(x.effectiveFrom) > at.getTime())
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
    return {
      market,
      numbering: n,
      tvLine: `TV ${n.tv.firstMajor} to ${n.tv.lastMajor}, with subchannels`,
      radioLine: `Radio ${(n.radio.firstTenths / 10).toFixed(1)} to ${(n.radio.lastTenths / 10).toFixed(1)}, even tenths`,
      own: r?.scope === market.id,
      effectiveFrom: r?.effectiveFrom ?? "1970-01-01T00:00:00.000Z",
      next: next ? { numbering: next.value as Numbering, effectiveFrom: next.effectiveFrom } : null
    };
  });
}

// ---- Signers ----

export function proposalView(p: MockProposal, viewer: MockPerson | null): SignerProposal {
  return {
    id: p.id,
    kind: p.kind,
    oldAddress: p.oldAddress,
    newAddress: p.newAddress,
    signersAfter: p.signersAfter,
    thresholdAfter: p.thresholdAfter,
    note: p.note,
    proposedBy: personOf(p.proposedBy)!,
    proposedAt: p.proposedAt,
    status: p.status,
    approvals: p.approvers.map((a) => {
      const d = p.decisions.find((x) => x.adminId === a);
      return { admin: personOf(a)!, decision: d?.decision ?? null, at: d?.at ?? null, note: d?.note ?? null };
    }),
    decidedAt: p.decidedAt,
    canDecide: !!viewer && p.status === "open" && p.approvers.includes(viewer.id) && !p.decisions.some((d) => d.adminId === viewer.id),
    canWithdraw: !!viewer && p.status === "open" && p.proposedBy === viewer.id
  };
}

// ---- The shelf ----

const ruleSet = (at: Date) => ({ works: valueAt("rights.public_domain_us", at) as never, sound: valueAt("rights.sound_recordings_us", at) as never });
const factsOf = (i: MockItem) => ({ workKind: i.workKind, publishedYear: i.publishedYear, country: i.country, usGovernment: i.basis === "us_government" });
const readingOf = (i: MockItem, at = now()) => readPublicDomain(factsOf(i), ruleSet(at), at);

export function itemRow(i: MockItem): ShelfItemRow {
  const reading = readingOf(i);
  return {
    id: i.id,
    title: i.title,
    source: i.source,
    workKind: i.workKind,
    publishedYear: i.publishedYear,
    basisLine: i.state === "passed" || i.state === "second_check" ? basisLine(i.basis, i.publishedYear, reading) : i.state === "failed" ? (i.failedReason ?? "Failed its check") : reading.line,
    lengthMs: i.durationMs,
    state: i.state,
    firstCheck: i.firstCheckedBy && i.firstCheckedAt ? { by: personOf(i.firstCheckedBy)!, at: i.firstCheckedAt } : null,
    secondCheck: i.secondCheckedBy && i.secondCheckedAt ? { by: personOf(i.secondCheckedBy)!, at: i.secondCheckedAt } : null,
    failed: i.failedAt ? { by: personOf(i.failedBy), at: i.failedAt, reason: i.failedReason ?? "" } : null
  };
}

export function checklistOf(i: MockItem): ChecklistLine[] {
  const reading = readingOf(i);
  return checklistFor(factsOf(i), reading).map((t) => {
    const row = i.checks[t.line];
    return {
      line: t.line,
      title: t.title,
      help: t.help,
      state: row?.state ?? t.prefill?.state ?? "todo",
      detail: row?.detail ?? t.prefill?.detail ?? null,
      record: row?.record ?? null,
      evidence: i.evidence
        .filter((e) => e.line === t.line)
        .map((e) => ({ id: e.id, fileName: e.fileName, contentType: e.contentType, bytes: e.bytes, contentId: e.contentId, url: `/objects/${e.contentId}`, uploadedBy: personOf(e.uploadedBy)!, at: e.at })),
      prefilled: !!row && row.setBy === null && row.state !== "todo",
      setBy: personOf(row?.setBy ?? null),
      setAt: row?.setAt ?? null
    };
  });
}

export function cantSendBecause(i: MockItem): string | null {
  if (i.state !== "checking") return null;
  const reading = readingOf(i);
  const lines = checklistOf(i);
  for (const l of lines) {
    if (l.state === "fail") return `"${l.title}" says it isn't free to air.`;
    if (!["ok", "warn", "not_needed"].includes(l.state)) return `"${l.title}" isn't answered yet.`;
    if (l.state !== "not_needed" && !l.evidence.length && !l.record?.trim()) return `"${l.title}" has no evidence: attach a file or write down the record.`;
  }
  const renewal = lines.find((l) => l.line === "renewal")?.state ?? "todo";
  if (i.basis !== "us_government" && !basisOf(reading, renewal)) return `The rules don't make it public domain: ${reading.line}.`;
  return null;
}

export function sendBasis(i: MockItem): ShelfItem["basis"] {
  const renewal = checklistOf(i).find((l) => l.line === "renewal")?.state ?? "todo";
  return i.basis === "us_government" ? "us_government" : basisOf(readingOf(i), renewal);
}

export function itemView(i: MockItem, viewer: MockPerson): ShelfItem {
  const d = settingsDb();
  const series = d.series.find((s) => s.id === i.seriesId)!;
  const may = mayRights(viewer);
  return {
    ...itemRow(i),
    seriesId: series.id,
    seriesTitle: series.title,
    country: i.country,
    basis: i.basis,
    contentId: i.contentId,
    libraryItemId: i.libraryItemId,
    checklist: checklistOf(i),
    publicDomain: readingOf(i),
    cantSendBecause: cantSendBecause(i),
    canSecondCheck: i.state === "second_check" && may && i.firstCheckedBy !== viewer.id,
    canEdit: may,
    episodes: d.episodes.filter((e) => e.items.some((x) => x.itemId === i.id)).map((e) => ({ episodeId: e.id, number: e.number, removed: e.items.find((x) => x.itemId === i.id)!.removedAt !== null }))
  };
}

export function prefillChecks(i: MockItem) {
  const reading = readingOf(i);
  for (const t of checklistFor(factsOf(i), reading)) i.checks[t.line] = { state: t.prefill?.state ?? "todo", detail: t.prefill?.detail ?? null, record: null, setBy: null, setAt: t.prefill ? now().toISOString() : null };
}

function episodeView(e: MockEpisode): EpisodeView {
  const d = settingsDb();
  const rows = [...e.items]
    .sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9))
    .flatMap((x) => {
      const i = d.items.find((y) => y.id === x.itemId);
      if (!i) return [];
      return [
        {
          itemId: i.id,
          title: i.title,
          source: i.source,
          publishedYear: i.publishedYear,
          basisLine: x.removedAt ? (i.failedReason ?? "Taken out") : basisLine(i.basis, i.publishedYear, readingOf(i)),
          lengthMs: i.durationMs,
          position: x.position,
          removedAt: x.removedAt,
          removedReason: x.removedReason,
          checkedBy: [i.firstCheckedBy, i.secondCheckedBy].flatMap((id) => (id ? [nameOf(id)] : []))
        }
      ];
    });
  return {
    id: e.id,
    number: e.number,
    title: e.title,
    status: e.status,
    version: e.version,
    lengthMs: rows.filter((r) => r.position !== null).reduce((s, r) => s + (r.lengthMs ?? 0), 0),
    error: null,
    composedAt: e.composedAt,
    libraryItemId: e.libraryItemId,
    items: rows
  };
}

export function seriesRowView(s: MockSeries): ShelfSeriesRow {
  const d = settingsDb();
  const station = stationById(CATALOG)?.ident ?? deskDb().stations[0]!.ident;
  const mine = d.episodes.filter((e) => e.seriesId === s.id);
  const inReview = d.items.filter((i) => i.seriesId === s.id && i.state === "second_check").length + (s.id === U(7105) ? 7 : 0);
  return {
    id: s.id,
    title: s.title,
    description: s.description,
    colour: s.colour,
    mediaKind: s.mediaKind,
    episodeLengthMs: s.episodeLengthMs,
    rightsBasis: s.rightsBasis,
    basisLabel: s.rightsBasis === "mixed" ? (s.title.startsWith("Newsreels") ? "Mixed, per reel" : "Mixed, per short") : s.rightsBasis === "sound_recording" ? "Per show, still checking" : SHELF_BASIS_LABELS[s.rightsBasis],
    basisNote: s.basisNote,
    episodesReady: (s.fixture?.episodesReady ?? 0) + mine.filter((e) => e.status === "ready").length,
    episodesTotal: (s.fixture?.episodesTotal ?? 0) + mine.length,
    carriers: s.fixture?.carriers ?? s.carriers.length,
    state: s.state === "coming" ? "coming" : inReview ? "in_review" : s.offered ? "offered" : "building",
    inReview,
    station,
    programId: s.programId
  };
}

export function seriesView(s: MockSeries, viewer: MockPerson): ShelfSeries {
  const d = settingsDb();
  const row = seriesRowView(s);
  const catalog = stationById(CATALOG);
  return {
    ...row,
    notes: s.notes,
    episodes: d.episodes.filter((e) => e.seriesId === s.id).sort((a, b) => a.number - b.number).map(episodeView),
    items: d.items.filter((i) => i.seriesId === s.id).map(itemRow),
    offer: {
      offered: s.offered,
      carriers: catalog && row.carriers ? [{ station: catalog.ident, market: MARKETS[0]!, via: "home" as const }] : [],
      carrierMarkets: s.fixture?.markets ?? 0
    },
    rebuilds: d.rebuilds
      .filter((r) => r.seriesId === s.id)
      .map((r) => ({ id: r.id, at: r.at, by: personOf(r.by), reason: r.reason, item: r.item, episodes: r.episodes, unchanged: r.unchanged })),
    canEdit: mayRights(viewer)
  };
}

export function shelfView(viewer: MockPerson): Shelf {
  const d = settingsDb();
  const rows = d.series.map(seriesRowView);
  const at = now();
  const reading = readPublicDomain({ workKind: "film", publishedYear: null, country: "US", usGovernment: false }, ruleSet(at), at);
  const catalog = stationById(CATALOG);
  const readyReal = d.episodes.filter((e) => e.status === "ready").reduce((sum, e) => sum + episodeView(e).lengthMs, 0);
  return {
    stats: {
      itemsPassed: d.series.reduce((sum, x) => sum + (x.fixture?.itemsPassed ?? 0), 0) + d.items.filter((i) => i.state === "passed").length,
      readyMs: d.series.reduce((sum, x) => sum + (x.fixture?.readyMs ?? 0), 0) + readyReal,
      // The reference's: carriers are counted across series, each station once.
      carrierStations: 21,
      carrierMarkets: 3,
      awaitingSecondCheck: rows.reduce((sum, r) => sum + r.inReview, 0)
    },
    series: rows,
    catalogStations: catalog ? [catalog.ident] : [],
    publicDomain: { asOf: at.toISOString(), cutoffYear: reading.cutoffYear, soundRecordingsCutoffYear: reading.soundRecordingsCutoffYear },
    canEdit: mayRights(viewer)
  };
}

/** Composes the episodes whose items changed (the mock doesn't compose files: a new version, at once). */
export function rebuildSeries(s: MockSeries, by: MockPerson, reason: string, itemId: string | null): RebuildView {
  const d = settingsDb();
  const changed: RebuildView["episodes"] = [];
  let unchanged = s.fixture?.episodesTotal ?? 0;
  for (const e of d.episodes.filter((x) => x.seriesId === s.id)) {
    if (!e.dirty && e.status !== "draft") {
      unchanged += 1;
      continue;
    }
    changed.push({ episodeId: e.id, number: e.number, fromVersion: e.version, toVersion: e.version + 1, status: "ready" });
    e.version += 1;
    e.status = "ready";
    e.dirty = false;
    e.composedAt = now().toISOString();
    e.libraryItemId ??= nextId();
  }
  const view: RebuildView = { id: nextId(), at: now().toISOString(), by: personOf(by.id), reason, item: itemId ? { id: itemId, title: d.items.find((i) => i.id === itemId)?.title ?? "" } : null, episodes: changed, unchanged };
  if (changed.length) d.rebuilds.unshift({ ...view, by: by.id, seriesId: s.id });
  return view;
}
