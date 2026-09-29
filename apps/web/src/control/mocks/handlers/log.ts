// log and playout: tonight's log with its breaks and dead air, the status the tally reads,
// sign-on and its checks, sign off, cue a break. The On air area owns this file. Everything
// here reads and writes the shared db (fixtures/evening.ts): a break the spot market fills shows
// in the log, on the Monitor's rundown and on the rail's badge at once. Off air hours and day
// templates (G8, G9) are kept in ../schedule.ts; their own endpoints are in templates.ts.
// Planned off air isn't dead air: gaps leave it out, so nothing warns about it or fills it.

import { http } from "msw";
import { logApi, playoutApi, type BreakSlot, type LogEntry } from "@opencast/contracts";
import { clock, stationColourPasses } from "@opencast/ui";
import { buildRundown, currentIndex, type RundownRow } from "../../components/onair/rundown";
import { addDays, broadcastDay, isoDate, timeOn } from "../../components/onair/time";
import { now, STATION_TZ } from "../../../lib/clock";
import { dbStation, getDb, membership, saveDb, stationBreaks, stationLog, type DbStation } from "../db";
import { breakSlot, type DbBreak, type DbFill, type DbLogEntry } from "../fixtures/evening";
import { DEFAULT_BREAK_MS, MOCK_STREAMS, PREVIEW_CARDS, TEST_SIGNAL, coverageUntil, deadAirWarnings, onAirState, placeRepeat, rowsOfBreak, saveOnAirState } from "../fixtures/onair";
import { fail, needsUser, path, reply } from "../respond";
import { createTemplate, generateWindow, logDays, markEdited, offAirFor, offAirNext, removeTemplate, removeWithBreaks, templateById, templatesOf, templateView, TemplateInputError } from "../schedule";

const HOUR = 3_600_000;
const uuid = () => crypto.randomUUID();

/**
 * Time with nothing on the log, between `from` and `to`, outside planned off air (off air hours
 * and sign-offs aren't dead air). Shorter than five minutes between programs is a break.
 */
export function gapsIn(stationId: string, from: string, to: string) {
  const gaps: { startsAt: string; endsAt: string }[] = [];
  let cursor = from;
  const blocks = [...stationLog(stationId, from, to), ...offAirFor(stationId, from, to)].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  for (const e of blocks) {
    if (e.startsAt > cursor) gaps.push({ startsAt: cursor, endsAt: e.startsAt });
    if (e.endsAt > cursor) cursor = e.endsAt;
  }
  const real = gaps.filter((g) => Date.parse(g.endsAt) - Date.parse(g.startsAt) >= 5 * 60_000);
  if (cursor < to) real.push({ startsAt: cursor, endsAt: to });
  return real;
}

/** A break with its rows, as the contract's BreakSlot plus G1. */
function slotWithRows(b: DbBreak): BreakSlot {
  return { ...breakSlot(b), rows: rowsOfBreak(b) };
}

/** The station's rundown between two times, to the second, with its planned off air. */
export function rundownOf(stationId: string, from: string, to: string): RundownRow[] {
  return buildRundown(stationLog(stationId, from, to), stationBreaks(stationId, new Date(Date.parse(from) - 3 * HOUR).toISOString(), to).map(slotWithRows), undefined, offAirFor(stationId, from, to));
}

/** How far the log runs from `from` without dead air: planned off air counts as covered. */
function runsUntil(stationId: string, from: string) {
  const log = stationLog(stationId);
  const off = offAirFor(stationId, from, new Date(Date.parse(from) + 8 * 24 * HOUR).toISOString());
  return coverageUntil([...log, ...off], from);
}

function slug(st: DbStation) {
  return (st.ident.callSign ?? st.ident.handle ?? st.ident.id).toLowerCase();
}

function outputUrl(st: DbStation) {
  return MOCK_STREAMS.includes(slug(st)) ? `/mock-hls/${slug(st)}/master.m3u8` : null;
}

/** Signed on, and not in planned off air (a sign-off, or the off air hours). */
function isOnAirNow(st: DbStation, t: string) {
  const entry = stationLog(st.ident.id).find((e) => e.startsAt <= t && t < e.endsAt);
  const planned = offAirFor(st.ident.id, t, new Date(Date.parse(t) + 1000).toISOString()).length > 0;
  return st.onAir && entry?.kind !== "off_air" && !planned;
}

function status(st: DbStation) {
  const t = now();
  const iso = t.toISOString();
  const rows = rundownOf(st.ident.id, new Date(t.getTime() - 4 * HOUR).toISOString(), new Date(t.getTime() + 12 * HOUR).toISOString());
  const onAir = isOnAirNow(st, iso);
  const cur = rows[currentIndex(rows, t.getTime())];
  // The preview monitor shows the next thing with a picture: open time holds on the slate.
  const next = rows.find((r) => Date.parse(r.at) > t.getTime() && r.kind !== "gap" && r.code !== "OPEN") ?? null;
  const nextBreak = stationBreaks(st.ident.id).find((b) => b.startsAt > iso) ?? null;
  // Whose break time the next row is: the maker's, under barter, reads "from REEL's break time".
  let producer: string | null = null;
  if (next?.kind === "break") {
    const b = stationBreaks(st.ident.id).find((x) => next.breakId === x.id);
    const fill = b?.fills.find((f) => f.title === next.title);
    if (b && fill?.kind === "producer") producer = stationLog(st.ident.id).find((e) => e.startsAt <= b.startsAt && b.startsAt < e.endsAt)?.carriedFrom?.callSign ?? null;
  }
  const card = next ? PREVIEW_CARDS[next.title] : undefined;
  const nextEntry = next?.entryId ? stationLog(st.ident.id).find((e) => e.id === next.entryId) : undefined;
  // Planned off air on now, or the next within 24 hours ("Signs off at 2:00 am"); while signed on.
  const off = st.onAir ? offAirNext(st.ident.id, 24 * HOUR) : null;
  return {
    onAir,
    now: onAir && cur && cur.kind !== "gap" ? { title: cur.title, code: cur.code, startedAt: cur.at, itemId: cur.entryId ? (stationLog(st.ident.id).find((e) => e.id === cur.entryId)?.itemId ?? null) : null } : null,
    lastError: null,
    output: { livepeerEnabled: false, playbackUrl: onAir ? outputUrl(st) : null, bitrateKbps: onAir ? TEST_SIGNAL.bitrateKbps : null },
    nextBreakAt: onAir ? (nextBreak?.startsAt ?? null) : null,
    onAirSince: st.onAir ? st.onAirSince : null,
    next:
      onAir && next && next.kind !== "gap"
        ? {
            title: next.title,
            detail: card?.detail ?? nextEntry?.localNote ?? null,
            code: next.code,
            startsAt: next.at,
            producer,
            colour: card?.colour ?? nextEntry?.carriedFrom?.colour ?? st.ident.colour,
            pictureUrl: null
          }
        : null,
    offAir: off ? { ...off, now: Date.parse(off.startsAt) <= t.getTime() } : null
  };
}

/** The person's role on a station, or the response to return. */
export function roleOn(request: Request, stationId: string, allowed: Array<"owner" | "operator" | "host">) {
  const p = needsUser(request);
  if (p instanceof Response) return p;
  const st = dbStation(stationId);
  if (!st) return fail(404, "not_found", "That station wasn't found.");
  const m = membership(stationId, p.id);
  if (!m || !allowed.includes(m.role)) return fail(403, "forbidden", "Your role on this station can't do that.");
  return { person: p, station: st, role: m.role };
}

function overlaps(stationId: string, startsAt: string, endsAt: string, except?: string) {
  return stationLog(stationId).find((e) => e.id !== except && e.startsAt < endsAt && startsAt < e.endsAt);
}

function libraryItem(id: string) {
  return getDb().library.items.find((i) => i.id === id);
}

const MIN = 60_000;
const ceilMinute = (t: number) => Math.ceil(t / MIN) * MIN;

/** A break after a program, as the rule places it: its bumper, then the station ID last. */
function ruleBreak(stationId: string, startsAt: string, lengthMs: number, context: string, origin: DbBreak["origin"] = "rule"): DbBreak {
  const lib = getDb().library.items.filter((i) => i.stationId === stationId && i.status === "ready" && i.rights);
  const sid = lib.find((i) => i.code === "SID");
  const bmp = lib.find((i) => i.code === "BMP");
  const fill = (kind: DbFill["kind"], it: { id: string; title: string; durationMs: number | null }): DbFill => ({ id: uuid(), kind, title: it.title, lengthMs: it.durationMs ?? 0, itemId: it.id });
  return { id: uuid(), stationId, startsAt, lengthMs, context, origin, producerShareMs: 0, fills: [...(bmp ? [fill("bumper", bmp)] : []), ...(sid ? [fill("station_id", sid)] : [])] };
}

function entry(stationId: string, o: Partial<LogEntry> & Pick<LogEntry, "startsAt" | "endsAt" | "title">): DbLogEntry {
  return { id: uuid(), stationId, kind: "program", code: "PGM", episodeTitle: null, itemId: null, programId: null, liveSourceId: null, carriedFrom: null, carriageAgreementId: null, repeatGroupId: null, localNote: null, ...o };
}

// ---- Sign-on checks (A.6) ----

export function signOnChecks(st: DbStation) {
  const id = st.ident.id;
  const t = now();
  const from = t.toISOString();
  const to = new Date(t.getTime() + 24 * HOUR).toISOString();
  const entries = stationLog(id, from, to);
  const breaks = stationBreaks(id, from, to);
  const lib = getDb().library.items.filter((i) => i.stationId === id);
  const checks: Array<{ key: "log_covers_24h" | "station_id_hourly" | "rights_confirmed" | "listings_complete" | "live_sources_connected" | "channel_chosen" | "call_sign_chosen" | "output" | "off_air_hours"; label: string; passed: boolean; blocking: boolean; detail: string | null; watchUrl?: string | null }> = [];

  if (!st.ident.callSign) checks.push({ key: "call_sign_chosen", label: "Choose a call sign", passed: false, blocking: true, detail: "Three to five capital letters, on the Your station step" });
  if (!st.ident.channel) checks.push({ key: "channel_chosen", label: "Choose a channel", passed: false, blocking: true, detail: "On the Your station step" });

  // The log covers the next 24 hours: nothing but breaks shorter than five minutes.
  const gaps = gapsIn(id, from, to).filter((g) => Date.parse(g.endsAt) - Date.parse(g.startsAt) >= 5 * MIN);
  const until = runsUntil(id, from);
  checks.push(
    gaps.length
      ? { key: "log_covers_24h", label: "The log covers the next 24 hours", passed: false, blocking: true, detail: `Dead air from ${timeOn(gaps[0].startsAt, from)} to ${timeOn(gaps[0].endsAt, gaps[0].startsAt)}` }
      : { key: "log_covers_24h", label: "The log covers the next 24 hours", passed: true, blocking: true, detail: until ? `Through ${timeOn(until, from)}` : null }
  );

  // A station ID at least once an hour: in every break, and a break every hour.
  const ids = breaks.reduce((a, b) => a + b.fills.filter((f) => f.kind === "station_id").length, 0);
  const everyBreak = breaks.length > 0 && breaks.every((b) => b.fills.some((f) => f.kind === "station_id"));
  let hourly = everyBreak;
  const plannedOff = offAirFor(id, from, to);
  for (let h = t.getTime(); hourly && h < t.getTime() + 24 * HOUR - HOUR; h += HOUR) {
    const a = new Date(h).toISOString();
    const z = new Date(h + HOUR).toISOString();
    // Time off air doesn't need a station ID.
    const offAir = stationLog(id, a, z).every((e) => e.kind === "off_air") || plannedOff.some((o) => o.startsAt <= a && o.endsAt >= z);
    if (!offAir && !breaks.some((b) => b.startsAt >= a && b.startsAt < z)) hourly = false;
  }
  const hasSid = lib.some((i) => i.code === "SID" && i.status === "ready" && i.rights);
  checks.push(
    hasSid && hourly
      ? { key: "station_id_hourly", label: "A station ID airs at least once an hour", passed: true, blocking: true, detail: `In every break, ${ids} times a day` }
      : { key: "station_id_hourly", label: "A station ID airs at least once an hour", passed: false, blocking: true, detail: hasSid ? "Some hours have no break with a station ID" : "Add a station ID to your library" }
  );

  // Rights confirmed for everything on the log.
  const used = new Set<string>([...entries.map((e) => e.itemId), ...breaks.flatMap((b) => b.fills.map((f) => f.itemId))].filter((x): x is string => !!x));
  const items = [...used].map(libraryItem).filter((i): i is NonNullable<typeof i> => !!i);
  const confirmed = items.filter((i) => i.rights).length;
  const unconfirmed = items.find((i) => !i.rights);
  checks.push({ key: "rights_confirmed", label: "Rights confirmed for everything in the log", passed: !unconfirmed, blocking: true, detail: unconfirmed ? `${unconfirmed.title} needs its rights confirmed` : `${confirmed} of ${items.length} items` });

  // The test signal.
  const url = MOCK_STREAMS.includes(slug(st)) ? `/mock-hls/${slug(st)}/master.m3u8` : null;
  checks.push({ key: "output", label: "Test signal received", passed: true, blocking: false, detail: TEST_SIGNAL.detail, watchUrl: url });

  // Live blocks without a source: a slate airs in their place (a warning).
  for (const e of entries.filter((x) => x.kind === "live")) {
    const src = getDb().liveSources.find((s) => s.id === e.liveSourceId);
    if (!src || src.signal !== "receiving") {
      checks.push({ key: "live_sources_connected", label: `${e.title} has no source yet`, passed: false, blocking: false, detail: `It starts at ${timeOn(e.startsAt, from)}. Until a source connects, a slate will air in its place.` });
    }
  }

  // Listings: programs on the log that still need a description (a warning).
  const programs = getDb().library.programs.filter((p) => p.station.id === id && p.listingStatus === "needs_description" && entries.some((e) => e.programId === p.id));
  for (const p of programs) checks.push({ key: "listings_complete", label: `${p.title} needs a description`, passed: false, blocking: false, detail: "Viewers see the series description until it has one" });

  // Planned off air isn't a gap: say so, so nobody wonders (informational, never blocking).
  const firstOff = plannedOff[0];
  if (firstOff) {
    checks.push({ key: "off_air_hours", label: "Off air hours planned", passed: true, blocking: false, detail: `Off air from ${clock(firstOff.startsAt, { timeZone: STATION_TZ })}, back at ${clock(firstOff.backAt, { timeZone: STATION_TZ })}. Not dead air: no warnings, nothing fills it` });
  }

  return { ready: checks.every((c) => c.passed || !c.blocking), checks };
}

// ---- Handlers ----

export const logHandlers = [
  http.get(path(playoutApi.getStatus), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const st = dbStation(String(params.stationId));
    if (!st) return fail(404, "not_found", "That station wasn't found.");
    return reply(playoutApi.getStatus.response, status(st));
  }),

  http.get(path(logApi.getLog), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const q = new URL(request.url).searchParams;
    const from = q.get("from");
    const to = q.get("to");
    if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return fail(400, "bad_request", "The log needs a from and a to.");
    const first = broadcastDay(from);
    const last = broadcastDay(new Date(Date.parse(to) - 1).toISOString());
    const days = new Set<string>();
    for (let d = first; isoDate(d) <= isoDate(last); d = addDays(d, 1)) days.add(isoDate(d));
    // G8: the dates in the window that templates cover are made first, as the API does.
    generateWindow(id, from, to);
    saveDb();
    const toCome = (groupId: string) => getDb().log.filter((e) => e.stationId === id && e.repeatGroupId === groupId && e.startsAt >= from).length;
    // G7: one-time copies, with their entries still to come (a day in the window counts too);
    // then the day templates still repeating, except weekdays ones (listTemplates only).
    const copies = onAirState()
      .repeats.filter((r) => r.stationId === id)
      .map((r) => ({ id: r.id, day: r.day, pattern: r.pattern, until: r.until, entries: toCome(r.id), template: false }))
      .filter((r) => r.entries > 0 || days.has(r.day));
    const templates = templatesOf(id)
      .map(templateView)
      .filter((t): t is typeof t & { pattern: "once" | "daily" | "weekly" } => t.pattern !== "weekdays")
      .map((t) => ({ id: t.id, day: t.fromDay, pattern: t.pattern, until: t.until, entries: toCome(t.id), template: true, weekday: t.weekday, label: t.label }));
    return reply(logApi.getLog.response, {
      from,
      to,
      entries: stationLog(id, from, to),
      breaks: stationBreaks(id, from, to).map(slotWithRows),
      gaps: gapsIn(id, from, to),
      repeats: [...copies, ...templates],
      offAir: offAirFor(id, from, to),
      // G11: which template made each broadcast day in the window, today and past days too.
      days: logDays(id, from, to)
    });
  }),

  http.post(path(logApi.addEntry), async ({ request, params }) => {
    const r = roleOn(request, String(params.stationId), ["owner", "operator"]);
    if (r instanceof Response) return r;
    const body = logApi.addEntry.body!.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, "bad_request", "That entry isn't complete.");
    const b = body.data;
    const id = r.station.ident.id;
    let title = "Program";
    let endsAt = b.endsAt;
    let o: Partial<LogEntry> = {};
    if (b.itemId) {
      const it = libraryItem(b.itemId);
      if (!it || it.stationId !== id) return fail(404, "not_found", "That item isn't in your library.");
      if (!it.rights) return fail(409, "rights_unconfirmed", "Confirm its rights before it goes on the log.");
      title = it.title;
      endsAt ??= new Date(Date.parse(b.startsAt) + ceilMinute(it.durationMs ?? MIN)).toISOString();
      o = { itemId: it.id, programId: it.programId, episodeTitle: it.episodeNumber ? `ep. ${it.episodeNumber}` : null };
    } else if (b.carriageAgreementId) {
      const same = stationLog(id).find((e) => e.carriageAgreementId === b.carriageAgreementId);
      title = same?.title ?? title;
      o = { carriageAgreementId: b.carriageAgreementId, carriedFrom: same?.carriedFrom ?? null, programId: b.programId ?? same?.programId ?? null };
    } else if (b.kind === "live") {
      const pr = getDb().library.programs.find((x) => x.id === b.programId);
      title = pr?.title ?? "Live";
      o = { kind: "live", programId: b.programId ?? null, liveSourceId: b.liveSourceId ?? null };
    } else if (b.kind === "off_air") {
      title = "Off air";
      o = { kind: "off_air", code: "OPEN" };
    }
    if (!endsAt) return fail(400, "bad_request", "Say when it ends.");
    if (endsAt <= b.startsAt) return fail(400, "bad_request", "It has to end after it starts.");
    const clash = overlaps(id, b.startsAt, endsAt);
    if (clash) return fail(409, "conflict", `That time already has ${clash.title} on the log.`);
    const e = entry(id, { startsAt: b.startsAt, endsAt, title, episodeTitle: b.episodeTitle ?? o.episodeTitle ?? null, localNote: b.localNote ?? null, ...o, kind: o.kind ?? b.kind });
    getDb().log.push(e);
    markEdited(id, [e.startsAt]);
    saveDb();
    return reply(logApi.addEntry.response, e, 201);
  }),

  http.patch(path(logApi.updateEntry), async ({ request, params }) => {
    const r = roleOn(request, String(params.stationId), ["owner", "operator"]);
    if (r instanceof Response) return r;
    const e = getDb().log.find((x) => x.id === String(params.entryId) && x.stationId === r.station.ident.id);
    if (!e) return fail(404, "not_found", "That entry isn't on the log.");
    const body = logApi.updateEntry.body!.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, "bad_request", "That change isn't complete.");
    const b = body.data;
    const startsAt = b.startsAt ?? e.startsAt;
    const endsAt = b.endsAt ?? e.endsAt;
    if (endsAt <= startsAt) return fail(400, "bad_request", "It has to end after it starts.");
    const clash = overlaps(e.stationId, startsAt, endsAt, e.id);
    if (clash) return fail(409, "conflict", `That time already has ${clash.title} on the log.`);
    markEdited(e.stationId, [e.startsAt, startsAt]);
    Object.assign(e, { startsAt, endsAt }, b.episodeTitle !== undefined ? { episodeTitle: b.episodeTitle } : {}, b.localNote !== undefined ? { localNote: b.localNote } : {});
    saveDb();
    return reply(logApi.updateEntry.response, e);
  }),

  http.delete(path(logApi.removeEntry), ({ request, params }) => {
    const r = roleOn(request, String(params.stationId), ["owner", "operator"]);
    if (r instanceof Response) return r;
    const e = getDb().log.find((x) => x.id === String(params.entryId) && x.stationId === r.station.ident.id);
    if (!e) return fail(404, "not_found", "That entry isn't on the log.");
    markEdited(e.stationId, [e.startsAt]);
    removeWithBreaks(e.id);
    saveDb();
    saveOnAirState();
    return reply(logApi.removeEntry.response, { ok: true });
  }),

  // Since G8 "Repeat this day" makes a day template running until `until` (see ../schedule.ts).
  http.post(path(logApi.repeatDay), async ({ request, params }) => {
    const r = roleOn(request, String(params.stationId), ["owner", "operator"]);
    if (r instanceof Response) return r;
    const body = logApi.repeatDay.body!.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, "bad_request", "Say which day and how it repeats.");
    const { day, pattern, until, onto } = body.data;
    try {
      const made = createTemplate(r.station.ident.id, { fromDay: day, pattern, until: pattern === "once" ? null : until, onto });
      saveDb();
      saveOnAirState();
      return reply(logApi.repeatDay.response, { created: made.generated.created, skippedForConflicts: made.generated.skippedForConflicts, templateId: made.template.id });
    } catch (e) {
      if (e instanceof TemplateInputError) return fail(400, "bad_request", e.message, e.fields);
      throw e;
    }
  }),

  // G7: take a repeat's entries off the log from now on; a day template stops repeating.
  http.delete(path(logApi.removeRepeat), ({ request, params }) => {
    const r = roleOn(request, String(params.stationId), ["owner", "operator"]);
    if (r instanceof Response) return r;
    const id = r.station.ident.id;
    const template = templateById(id, String(params.repeatId));
    if (template) {
      const removed = removeTemplate(template);
      saveDb();
      saveOnAirState();
      return reply(logApi.removeRepeat.response, { removed });
    }
    const st = onAirState();
    const rep = st.repeats.find((x) => x.stationId === id && x.id === String(params.repeatId));
    if (!rep) return fail(404, "not_found", "That repeat wasn't found.");
    const t = now().toISOString();
    const gone = getDb().log.filter((e) => e.stationId === id && e.repeatGroupId === rep.id && e.startsAt > t);
    for (const e of gone) removeWithBreaks(e.id);
    st.repeats = st.repeats.filter((x) => x !== rep);
    saveDb();
    saveOnAirState();
    return reply(logApi.removeRepeat.response, { removed: gone.length });
  }),

  http.post(path(logApi.fillGap), async ({ request, params }) => {
    const r = roleOn(request, String(params.stationId), ["owner", "operator"]);
    if (r instanceof Response) return r;
    const body = logApi.fillGap.body!.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, "bad_request", "Say how to fill the gap.");
    const b = body.data;
    const id = r.station.ident.id;
    if (b.endsAt <= b.startsAt) return fail(400, "bad_request", "The gap has to end after it starts.");
    const clash = overlaps(id, b.startsAt, b.endsAt);
    if (clash) return fail(409, "conflict", `That time already has ${clash.title} on the log.`);
    const made: DbLogEntry[] = [];
    if (b.with === "sign_off") {
      made.push(entry(id, { kind: "off_air", code: "OPEN", title: "Off air", startsAt: b.startsAt, endsAt: b.endsAt }));
    } else {
      const items = b.itemIds.map(libraryItem);
      if (items.some((i) => !i || i.stationId !== id)) return fail(404, "not_found", "One of those items isn't in your library.");
      const blocked = items.find((i) => !i!.rights);
      if (blocked) return fail(409, "rights_unconfirmed", `Confirm the rights to ${blocked.title} before it goes on the log.`);
      // With a program right after the gap, the last one is cut where it starts.
      const closed = stationLog(id).some((e) => e.startsAt >= b.endsAt && Date.parse(e.startsAt) - Date.parse(b.endsAt) < 5 * MIN);
      const placed = placeRepeat(items as NonNullable<(typeof items)[number]>[], b.startsAt, b.endsAt, DEFAULT_BREAK_MS, closed);
      const st = onAirState();
      placed.entries.forEach((pe) => {
        const e = entry(id, { ...pe, localNote: "Repeat" });
        made.push(e);
        const pb = placed.breaks.find((x) => x.startsAt === pe.endsAt);
        if (pb && !getDb().breaks.some((x) => x.stationId === id && x.startsAt === pb.startsAt)) {
          const brk = ruleBreak(id, pb.startsAt, pb.lengthMs, pb.context);
          getDb().breaks.push(brk);
          st.placedBreaks.push({ breakId: brk.id, entryId: e.id });
        }
      });
      saveOnAirState();
    }
    getDb().log.push(...made);
    markEdited(id, [b.startsAt]);
    saveDb();
    return reply(logApi.fillGap.response, made);
  }),

  http.get(path(logApi.getDeadAir), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.stationId);
    const t = now();
    const from = t.toISOString();
    const to = new Date(t.getTime() + 24 * HOUR).toISOString();
    const gaps = gapsIn(id, from, to);
    const next = gaps[0] ?? null;
    // Warnings go out 30 and 12 minutes before a gap (P.2); never for planned off air.
    const warnings = next ? deadAirWarnings(next.startsAt, t.getTime()) : [];
    return reply(logApi.getDeadAir.response, { gaps, nextGapAt: next?.startsAt ?? null, logRunsUntil: runsUntil(id, from), warnings, offAir: offAirFor(id, from, to) });
  }),

  // ---- playout ----

  http.get(path(playoutApi.getSignOnChecks), ({ request, params }) => {
    const r = roleOn(request, String(params.stationId), ["owner", "operator"]);
    if (r instanceof Response) return r;
    return reply(playoutApi.getSignOnChecks.response, signOnChecks(r.station));
  }),

  http.post(path(playoutApi.signOn), ({ request, params }) => {
    const r = roleOn(request, String(params.stationId), ["owner"]);
    if (r instanceof Response) return r;
    const st = r.station;
    if (st.ident.colour && !stationColourPasses(st.ident.colour)) return fail(409, "colour", "The station colour needs 4.5:1 against white before it can go out.");
    const checks = signOnChecks(st);
    const blocker = checks.checks.find((c) => c.blocking && !c.passed);
    if (blocker) return fail(409, "check_failed", `${blocker.label}: ${blocker.detail ?? "not yet"}.`);
    const t = now().toISOString();
    st.onAir = true;
    st.onAirSince = t;
    st.setup = { ...st.setup, status: "on_air", fixed: true, firstSignedOnAt: st.setup.firstSignedOnAt ?? t };
    saveDb();
    return reply(playoutApi.getStatus.response, status(st), 202);
  }),

  http.post(path(playoutApi.signOff), async ({ request, params }) => {
    // Signing off is owner-only (the team frame; open question A5).
    const r = roleOn(request, String(params.stationId), ["owner"]);
    if (r instanceof Response) return r;
    const body = (await request.json().catch(() => ({}))) as { permanently?: boolean };
    const st = r.station;
    st.onAir = false;
    st.onAirSince = null;
    st.setup = { ...st.setup, status: body.permanently ? "signed_off" : "off_air" };
    saveDb();
    return reply(playoutApi.getStatus.response, status(st), 202);
  }),

  http.post(path(playoutApi.cueBreak), ({ request, params }) => {
    const r = roleOn(request, String(params.stationId), ["owner", "operator", "host"]);
    if (r instanceof Response) return r;
    const id = r.station.ident.id;
    const t = new Date(Math.floor(now().getTime() / 1000) * 1000).toISOString();
    const live = stationLog(id).find((e) => e.kind === "live" && e.startsAt <= t && t < e.endsAt);
    if (!r.station.onAir || !live) return fail(409, "not_live", "A break can be cued during a live program.");
    const m = membership(id, r.person.id);
    if (m?.role === "host" && !(live.programId && m.hostProgramIds.includes(live.programId))) return fail(403, "forbidden", "Hosts cue breaks on their own live blocks.");
    if (stationBreaks(id).some((b) => b.startsAt <= t && t < new Date(Date.parse(b.startsAt) + b.lengthMs).toISOString())) return fail(409, "in_break", "A break is airing now.");
    // The host's planned break moves to now; without one, a break of the rule's length is placed.
    const planned = stationBreaks(id, t, live.endsAt).find((b) => b.origin === "cued_live");
    if (planned) planned.startsAt = t;
    else getDb().breaks.push(ruleBreak(id, t, DEFAULT_BREAK_MS, `During ${live.title}`, "cued_live"));
    saveDb();
    return reply(playoutApi.cueBreak.response, { ok: true }, 202);
  }),

  http.get(path(playoutApi.getAsRun), ({ request, params }) => {
    const r = roleOn(request, String(params.stationId), ["owner", "operator"]);
    if (r instanceof Response) return r;
    const q = new URL(request.url).searchParams;
    const from = q.get("from") ?? new Date(now().getTime() - 6 * HOUR).toISOString();
    const to = q.get("to") ?? now().toISOString();
    const t = now().getTime();
    // Nothing is recorded for the dark time off air.
    const rows = rundownOf(r.station.ident.id, from, to).filter((x) => Date.parse(x.at) < t && x.kind !== "gap" && x.kind !== "off_air");
    return reply(
      playoutApi.getAsRun.response,
      rows.map((x) => ({
        id: uuid(),
        code: x.code,
        title: x.title,
        startedAt: x.at,
        endedAt: new Date(Math.min(t, Date.parse(x.at) + x.lengthMs)).toISOString(),
        reason: x.kind === "program" ? (x.source === "Live source" ? "live" : "planned") : x.code === "OPEN" ? "station_id_fill" : "rotation",
        itemId: null,
        airingId: null
      }))
    );
  })
];

export { status as playoutStatus };
