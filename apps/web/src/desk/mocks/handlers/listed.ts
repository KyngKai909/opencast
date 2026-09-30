// External stations (follow-up Phase 6; were "listed sources"): the source's official embed or its
// stream link, each with its evidence, on the dial only once the evidence is complete. The rules
// are the API's (apps/api/src/v1/modules/network/external.ts): an embed needs its terms allowing
// embedding, the terms page and the day it was checked; a stream link needs their written
// permission (recorded once, never edited) or a clearly public basis; a DASH-only stream and a
// source outside the market wait unless Settings allows them; a stream down 5 minutes is hidden.
// The same channel and call sign rules as full stations, with subchannels (9.2, 9.3) only beside
// other external stations. The mock "finds" a feed whose address ends in .ics, .rss, .xml or .json.
//
// IPTV lists: a pasted list is read here (../iptv.ts); an iptv-org address answers a canned list,
// never fetched. Channels become pipeline leads with their stream noted, never listings.

import { http, type HttpHandler } from "msw";
import { callSignRefusal, networkApi, type CallSignRules, type ListedSource, type StationIdent } from "@opencast/contracts";
import { now } from "../../../lib/clock";
import type { DbCreator } from "../fixtures/creators";
import type { DbListed } from "../fixtures/listed";
import { callSignTaken, creatorById, creatorView, getDb, marketById, newId, saveDb, stationById, tenthsOf } from "../db";
import { advanceHealth } from "../external";
import { isIptvOrgAddress, parseIptvList, SAMPLE_LIST } from "../iptv";
import { bodyOf, fail, needsAdmin, needsDesk, path, reply } from "../respond";
import { valueAt } from "../settingsDb";
import { channelOnBand } from "./creators";

type Waiting = NonNullable<ListedSource["waiting"]>;

/** The Open rules (A200, A201), as Settings has them now. */
function rules() {
  return { otherMarkets: (valueAt("external.other_markets") as { allowed: boolean }).allowed, dash: (valueAt("external.dash_stream_links") as { played: boolean }).played };
}

const streamFormatOf = (url: string): "hls" | "dash" => (/\.mpd($|[?#])/i.test(url) ? "dash" : "hls");

/** Why it may play the way it does, from what's recorded; null until the evidence is complete. */
export function basisOf(l: DbListed): "embed_terms" | "written_permission" | "public_source" | null {
  if (l.plays === "embed") return l.embedTerms === "allowed" && l.termsUrl && l.termsCheckedOn ? "embed_terms" : null;
  if (l.permission) return "written_permission";
  return l.publicBasis ? "public_source" : null;
}

/** Why it isn't on the dial, or null when it is: the evidence, then the Open rules, then its stream. */
/** Its evidence holds: on the dial, or off it only while its stream is down. */
function onByEvidence(l: DbListed): boolean {
  const w = waitingOf(l);
  return w === null || w === "down";
}

export function waitingOf(l: DbListed, rule = rules()): Waiting | null {
  const basis = basisOf(l);
  if (l.plays === "embed") {
    if (l.embedTerms !== "allowed") return "terms_unclear";
    if (!basis) return "needs_terms";
  } else {
    if (!basis) return "needs_permission";
    if (streamFormatOf(l.streamUrl) === "dash" && !rule.dash) return "dash_not_played";
  }
  if (l.outsideMarket && !rule.otherMarkets) return "other_market";
  if (l.health.state === "hidden") return "down";
  return null;
}

export function listedView(l: DbListed): ListedSource | null {
  const s = stationById(l.stationId);
  if (!s) return null;
  const waiting = waitingOf(l);
  return {
    id: l.id,
    station: s.ident,
    name: l.name,
    description: l.description,
    streamUrl: l.streamUrl,
    embedTerms: l.embedTerms,
    calendarUrl: l.calendarUrl,
    calendarSync: l.calendarSync,
    // "listed" while its evidence holds (on the dial, or off it only while it's down).
    listingState: waiting === null || waiting === "down" ? "listed" : "checking",
    lastSyncedAt: l.lastSyncedAt,
    upcoming: l.upcoming,
    plays: l.plays,
    streamFormat: l.plays === "stream_link" ? streamFormatOf(l.streamUrl) : null,
    evidence: { basis: basisOf(l), termsUrl: l.termsUrl, termsCheckedOn: l.termsCheckedOn, publicBasis: l.publicBasis, permission: l.permission, note: l.note },
    schedule: { source: l.schedule.source, format: l.schedule.format, url: l.calendarUrl, checkedAgainst: l.schedule.checkedAgainst, checkedOn: l.schedule.checkedOn },
    onDial: waiting === null,
    waiting,
    health: l.health,
    outages: l.outages.slice(0, 5),
    creatorId: l.creatorId
  };
}

/** A feed's format from its address, when the desk didn't say. */
function formatOf(url: string, guide: boolean): DbListed["schedule"]["format"] {
  if (/\.ics($|\?)/i.test(url)) return "ical";
  if (/\.rss($|\?)/i.test(url)) return "rss";
  if (/\.json($|\?)/i.test(url)) return "json";
  if (/\.xml($|\?)/i.test(url)) return guide ? "xmltv" : "rss";
  return null;
}

function sync(l: DbListed) {
  if (!l.calendarUrl) return;
  if (/\.(ics|rss|xml|json)($|\?)/i.test(l.calendarUrl)) {
    l.calendarSync = "synced";
    l.lastSyncedAt = now().toISOString();
    l.upcoming = Math.max(l.upcoming, 3);
  } else l.calendarSync = "calendar_not_found";
}

/** The same channel rules as a full station, with room for more external stations in one major. */
function channelProblem(marketId: string, band: "tv" | "radio", channel: string): Response | null {
  if (!channelOnBand(band, channel)) return fail(400, "bad_channel", band === "tv" ? "TV channels run from 2.1 to 69.9." : "Radio runs from 88.2 to 107.8, in even tenths.", { channel: "Out of range" });
  const d = getDb();
  const t = tenthsOf(channel);
  const major = (x: number) => (band === "tv" ? Math.floor(x / 10) : x);
  const sameMajor = d.stations.filter((s) => s.marketId === marketId && s.ident.band === band && s.ident.channel && major(tenthsOf(s.ident.channel)) === major(t));
  const held = d.reservations.some((r) => r.marketId === marketId && r.band === band && r.channel && major(tenthsOf(r.channel)) === major(t));
  if (held || sameMajor.some((s) => s.ident.channel === channel || s.ident.kind !== "listed")) return fail(409, "channel_taken", `${channel} is taken. Pick another.`, { channel: "taken" });
  // A station gets X.1; a subchannel only beside other external stations.
  if (band === "tv" && t % 10 !== 1 && !sameMajor.length) return fail(400, "invalid", `Start at ${major(t)}.1. Subchannels go beside other external stations.`, { channel: "Use X.1" });
  return null;
}

function callSignProblem(callSign: string): Response | null {
  const refusal = callSignRefusal(callSign, valueAt("call_signs.refused") as CallSignRules);
  if (refusal) return fail(422, "call_sign_refused", `${callSign} isn't allowed. ${refusal.reason}`, { callSign: "refused" });
  if (callSignTaken(callSign)) return fail(409, "call_sign_taken", `${callSign} is taken or held. Try another.`, { callSign: "taken" });
  return null;
}

/** Written permission and a public basis are for stream links only. */
function evidenceProblem(plays: DbListed["plays"], e: { permission?: unknown; publicBasis?: string } | undefined): Response | null {
  if (e?.permission && plays !== "stream_link") return fail(400, "invalid", "Written permission is for stream links. An embed needs its terms page.", { permission: "Stream links only" });
  if (e?.publicBasis && plays !== "stream_link") return fail(400, "invalid", "A public basis is for stream links. An embed needs its terms page.", { publicBasis: "Stream links only" });
  return null;
}

function permissionRecord(who: string, streamUrl: string, creatorId: string | null, p: { grantedBy: string; grantedOn: string; evidence: string; documentUrl?: string }) {
  return { id: newId(), grantedBy: p.grantedBy.trim(), grantedOn: p.grantedOn, evidence: p.evidence.trim(), documentUrl: p.documentUrl ?? null, streamUrl, recordedAt: now().toISOString(), recordedBy: who, creatorId };
}

/** Field errors by the field's own name ("termsUrl", not "evidence.termsUrl"), as the form names them. */
const fieldsOf = (issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>) =>
  Object.fromEntries(issues.map((i) => [String([...i.path].reverse().find((k) => typeof k === "string") ?? i.path[0]), i.message]));

/** Only a listing whose evidence holds is checked. */
const checked = (l: DbListed) => {
  const w = waitingOf(l);
  return w === null || w === "down";
};

/** Stream addresses already on the desk: leads' and external stations'. */
function knownStreams() {
  const d = getDb();
  return {
    leads: new Set(d.creators.flatMap((c) => (c.lead ? [c.lead.streamUrl, c.sourceUrl] : [c.sourceUrl]))),
    external: new Set(d.listed.map((l) => l.streamUrl))
  };
}

export const listedHandlers: HttpHandler[] = [
  http.get(path(networkApi.listListedSources), ({ request }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    advanceHealth(now(), checked);
    const marketId = new URL(request.url).searchParams.get("marketId");
    const d = getDb();
    const rows = d.listed.filter((l) => !marketId || stationById(l.stationId)?.marketId === marketId).sort((a, b) => a.name.localeCompare(b.name));
    return reply(networkApi.listListedSources.response, rows.map(listedView).filter((x): x is ListedSource => !!x));
  }),

  http.post(path(networkApi.addListedSource), async ({ request }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const parsed = networkApi.addListedSource.body.safeParse(await bodyOf(request));
    if (!parsed.success) return fail(400, "invalid", "Check the highlighted fields.", fieldsOf(parsed.error.issues));
    const b = parsed.data;
    const plays = b.plays ?? "embed";
    if (plays === "embed" && !b.embedTerms) return fail(400, "invalid", "Say whether their terms allow embedding.", { embedTerms: "Required for an embed" });
    const bad = evidenceProblem(plays, b.evidence);
    if (bad) return bad;
    if (b.guideData && !b.calendarUrl) return fail(400, "invalid", "Guide data needs its address as well as the schedule it was checked against.", { calendarUrl: "Required with guide data" });
    const d = getDb();
    const creator = b.creatorId ? creatorById(b.creatorId) : null;
    if (b.creatorId && !creator) return fail(404, "not_found", "That lead wasn't found.");
    if (creator && d.listed.some((l) => l.creatorId === creator.id)) return fail(409, "already_external", `${creator.displayName} is already an external station.`);
    const market = marketById(b.marketId);
    if (!market) return fail(404, "not_found", "That market wasn't found.");
    const channel = channelProblem(b.marketId, b.band, b.channel);
    if (channel) return channel;
    const callSign = callSignProblem(b.callSign);
    if (callSign) return callSign;
    const at = now().toISOString();
    const ident: StationIdent = { id: newId(), kind: "listed", callSign: b.callSign, handle: b.callSign.toLowerCase(), name: b.name, colour: null, band: b.band, channel: b.channel, marketSlug: market.slug, homeCity: null };
    d.stations.push({ ident, marketId: market.id, public: true, firstSignedOnAt: at, escrowId: null, signOnAt: null });
    const e = b.evidence;
    const l: DbListed = {
      id: newId(),
      stationId: ident.id,
      name: b.name,
      description: b.description ?? null,
      streamUrl: b.streamUrl,
      embedTerms: plays === "embed" ? b.embedTerms! : "unclear",
      calendarUrl: b.calendarUrl ?? null,
      calendarSync: "not_set",
      lastSyncedAt: null,
      upcoming: 0,
      plays,
      termsUrl: e?.termsUrl ?? null,
      termsCheckedOn: e?.termsCheckedOn ?? null,
      publicBasis: plays === "stream_link" ? (e?.publicBasis?.trim() ?? null) : null,
      permission: plays === "stream_link" && e?.permission ? permissionRecord(p.displayName ?? p.email, b.streamUrl, creator?.id ?? null, e.permission) : null,
      note: e?.note || null,
      schedule: {
        source: b.guideData ? "guide_data" : b.calendarUrl ? "feed" : "none",
        format: b.calendarFormat ?? (b.calendarUrl ? formatOf(b.calendarUrl, !!b.guideData) : null),
        checkedAgainst: b.guideData?.checkedAgainst ?? null,
        checkedOn: b.guideData?.checkedOn ?? null
      },
      outsideMarket: b.outsideMarket ?? false,
      health: { state: "unchecked", since: null, lastCheckedAt: null, detail: null },
      outages: [],
      creatorId: creator?.id ?? null,
      addedAt: at
    };
    sync(l);
    d.listed.push(l);
    // The lead became this external station: On air once its evidence holds (as the API does).
    if (creator) Object.assign(creator, { stationId: ident.id, ...(onByEvidence(l) ? { stage: "on_air" as const } : {}), nextAction: null, nextActionDue: null, listedSourceId: l.id } satisfies Partial<DbCreator>);
    saveDb();
    return reply(networkApi.addListedSource.response, listedView(l)!, 201);
  }),

  http.post(path(networkApi.recordListedEvidence), async ({ request, params }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const l = getDb().listed.find((x) => x.id === String(params.sourceId));
    if (!l) return fail(404, "not_found", "That external station wasn't found.");
    const parsed = networkApi.recordListedEvidence.body.safeParse(await bodyOf(request));
    if (!parsed.success) return fail(400, "invalid", "Check the highlighted fields.", fieldsOf(parsed.error.issues));
    const b = parsed.data;
    const bad = evidenceProblem(l.plays, b);
    if (bad) return bad;
    if (b.permission && l.permission) return fail(409, "permission_recorded", "Their written permission is already recorded. It's never edited.");
    if (b.permission) l.permission = permissionRecord(p.displayName ?? p.email, l.streamUrl, l.creatorId, b.permission);
    if (l.plays === "embed" && b.embedTerms) l.embedTerms = b.embedTerms;
    if (b.termsUrl) l.termsUrl = b.termsUrl;
    if (b.termsCheckedOn) l.termsCheckedOn = b.termsCheckedOn;
    if (b.publicBasis) l.publicBasis = b.publicBasis.trim();
    if (b.note !== undefined) l.note = b.note || null;
    // Checked from the next minute, like a new listing.
    if (l.health.state === "unchecked") l.addedAt = now().toISOString();
    // Its lead is On air once the evidence holds.
    const lead = l.creatorId ? getDb().creators.find((c) => c.id === l.creatorId) : undefined;
    if (lead && onByEvidence(l)) lead.stage = "on_air";
    saveDb();
    return reply(networkApi.recordListedEvidence.response, listedView(l)!);
  }),

  http.get(path(networkApi.listExternalOutages), ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const l = getDb().listed.find((x) => x.id === String(params.sourceId));
    if (!l) return fail(404, "not_found", "That external station wasn't found.");
    const since = now().getTime() - 90 * 86_400_000;
    return reply(networkApi.listExternalOutages.response, l.outages.filter((o) => !o.backAt || Date.parse(o.downSince) >= since));
  }),

  http.post(path(networkApi.syncListedSource), ({ request, params }) => {
    const p = needsAdmin(request);
    if (p instanceof Response) return p;
    const l = getDb().listed.find((x) => x.id === String(params.sourceId));
    if (!l) return fail(404, "not_found", "That listed source wasn't found.");
    if (!l.calendarUrl) return fail(422, "no_calendar", "Add the source's agenda calendar first.");
    sync(l);
    saveDb();
    return reply(networkApi.syncListedSource.response, listedView(l)!);
  }),

  http.post(path(networkApi.previewIptvList), async ({ request }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const parsed = networkApi.previewIptvList.body.safeParse(await bodyOf(request));
    if (!parsed.success) return fail(400, "invalid", "Paste a list or give its address.", { m3u: "Paste a list or give its address" });
    const b = parsed.data;
    if (b.url && !isIptvOrgAddress(b.url)) return fail(400, "invalid", "Use a list from iptv-org (iptv-org.github.io), or paste the list itself.", { url: "iptv-org lists only" });
    // The mock never fetches: an iptv-org address answers the canned list.
    const { channels, skipped } = parseIptvList(b.url ? SAMPLE_LIST : (b.m3u ?? ""));
    if (!channels.length) return fail(422, "no_channels", "No channels with a stream address were found in that list.");
    const known = knownStreams();
    return reply(networkApi.previewIptvList.response, {
      listUrl: b.url ?? null,
      channels: channels.map((c) => ({ ...c, already: known.external.has(c.streamUrl) ? ("external" as const) : known.leads.has(c.streamUrl) ? ("lead" as const) : null })),
      skipped
    });
  }),

  http.post(path(networkApi.importIptvLeads), async ({ request }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const parsed = networkApi.importIptvLeads.body.safeParse(await bodyOf(request));
    if (!parsed.success) return fail(400, "invalid", "Pick between 1 and 100 channels to import.");
    const b = parsed.data;
    if (!marketById(b.marketId)) return fail(404, "not_found", "That market wasn't found.");
    const known = knownStreams();
    const urls = b.channels.map((c) => c.streamUrl);
    const fresh = b.channels.filter((c, i) => !known.leads.has(c.streamUrl) && !known.external.has(c.streamUrl) && urls.indexOf(c.streamUrl) === i);
    const at = now().toISOString();
    const made: DbCreator[] = fresh.map((c) => ({
      id: newId(),
      marketId: b.marketId,
      displayName: c.name,
      personName: null,
      description: null,
      // Noted, never played or checked from here: a lead isn't a listing.
      sourcePlatform: "other",
      sourceUrl: c.streamUrl,
      contactEmail: null,
      stage: "found",
      proposedOptions: null,
      nextAction: "Ask for permission, or confirm it's public",
      nextActionDue: null,
      doNotAsk: false,
      stationId: null,
      askedAt: null,
      remindedAt: null,
      answeredAt: null,
      claimInviteSentAt: null,
      claimLinkSentAt: null,
      claimedAt: null,
      licenceName: null,
      pronoun: "they",
      createdAt: at,
      setup: null,
      lead: { from: "iptv_list", streamUrl: c.streamUrl, listUrl: b.listUrl ?? null, tvgId: c.tvgId, group: c.group, country: c.country, logoUrl: c.logoUrl },
      listedSourceId: null
    }));
    getDb().creators.push(...made);
    saveDb();
    return reply(networkApi.importIptvLeads.response, { imported: made.map(creatorView), skipped: b.channels.length - fresh.length }, 201);
  })
];
