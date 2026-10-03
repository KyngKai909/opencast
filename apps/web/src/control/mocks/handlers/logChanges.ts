// Edit mode's batch (`applyLogChanges`) and the log's history (`listLogChanges`) on the mocks, as
// the API answers them: every change checked together (a dry run) or published at once; one
// problem refuses the whole batch; a draft from before someone else's change is refused (409
// `log_changed`); on air, what's airing and anything starting within the lead is locked. The
// mock's breaks sit between programs: each follows the program it comes after (or is inside), and a
// break with spots whose program comes off hands them to the next break. Published batches are
// kept with who and when, newest first.

import { http } from "msw";
import { LOG_EDIT_LEAD_MS, logApi, type LogChange, type LogChangeRecord, type LogChangesResult } from "@opencast/contracts";
import { clock, snapTime } from "@opencast/ui";
import { STATION_TZ, now } from "../../../lib/clock";
import { DAY_SHORT, localParts } from "../../components/onair/time";
import { getDb, saveDb, stationBreaks, stationLog } from "../db";
import type { DbLogEntry } from "../fixtures/evening";
import { saveOnAirState } from "../fixtures/onair";
import { fail, path, reply } from "../respond";
import { markEdited, offAirFor, removeWithBreaks } from "../schedule";
import { roleOn } from "./log";
import { checkBlockChanges, isBlockChange, spansOf } from "../blocks";

const MIN = 60_000;

/** The mock's history of published batches (kept in the shared db, so a reset clears it). */
interface MockLogChange extends LogChangeRecord {
  stationId: string;
}

function history(): MockLogChange[] {
  const db = getDb() as ReturnType<typeof getDb> & { logChanges?: MockLogChange[] };
  db.logChanges ??= [];
  return db.logChanges;
}

/** A window's version: a hash of its entries, as the API's (another hash, the same idea). */
export function mockLogVersion(stationId: string, from: string, to: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (const e of stationLog(stationId, from, to)) {
    for (const ch of `${e.id}|${e.startsAt}|${e.endsAt}|${e.kind}|${e.itemId ?? ""}|${e.liveSourceId ?? ""}|${e.carriageAgreementId ?? ""}|${e.endedEarlyAt ?? ""}\n`) {
      h1 = Math.imul(h1 ^ ch.charCodeAt(0), 16777619) >>> 0;
      h2 = Math.imul(h2 ^ ch.charCodeAt(0), 2246822519) >>> 0;
    }
  }
  // A244: its programming blocks' spans too.
  for (const sp of spansOf(stationId).filter((x) => x.startsAt < to && x.endsAt > from)) {
    for (const ch of `block|${sp.id}|${sp.blockId}|${sp.startsAt}|${sp.endsAt}\n`) {
      h1 = Math.imul(h1 ^ ch.charCodeAt(0), 16777619) >>> 0;
      h2 = Math.imul(h2 ^ ch.charCodeAt(0), 2246822519) >>> 0;
    }
  }
  return (h1.toString(36) + h2.toString(36)).padStart(16, "0").slice(-16);
}

const clockOf = (t: string | number) => clock(t, { timeZone: STATION_TZ });
const when = (t: string, beside: string) => {
  const a = localParts(t);
  const b = localParts(beside);
  return a.day === b.day && a.month === b.month ? clockOf(t) : `${DAY_SHORT[a.weekday]} ${clockOf(t)}`;
};
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

interface Draft {
  orig: DbLogEntry;
  next: DbLogEntry;
  removed: boolean;
  changed: boolean;
  /** G18: its "Keep at this time" mark was set or cleared (nothing about what airs changes). */
  marked: boolean;
  index: number;
}

export function applyChanges(stationId: string, onAir: boolean, body: { dryRun: boolean; base?: { from: string; to: string; version: string }; changes: LogChange[] }, by: { id: string; name: string | null }): LogChangesResult | Response {
  const t = now().getTime();
  const boundary = t + (onAir ? LOG_EDIT_LEAD_MS : 0);
  if (body.base && mockLogVersion(stationId, body.base.from, body.base.to) !== body.base.version) {
    return fail(409, "log_changed", "The log changed since you started editing. Reload it to see what changed, then make your changes again.");
  }
  const log = stationLog(stationId);
  const byId = new Map(log.map((e) => [e.id, e]));
  const items = getDb().library.items;
  const problems: LogChangesResult["problems"] = [];
  const warnings: LogChangesResult["warnings"] = [];
  const drafts = new Map<string, Draft>();
  const inserts: Array<{ index: number; key: string | null; row: DbLogEntry }> = [];
  const about: Array<{ id: string | null; insert: (typeof inserts)[number] | null }> = [];

  const lockOf = (e: DbLogEntry) => {
    const start = Date.parse(e.startsAt);
    if (start >= boundary) return null;
    if (Date.parse(e.endsAt) <= t) return "It has already aired.";
    if (start <= t) return onAir ? "On air now, too late to change." : "It has already started.";
    return `Airs in ${Math.max(1, Math.ceil((start - t) / 1000))} s, too late to change.`;
  };
  const tooSoon = onAir ? `That's too soon: the channel is already set for the next ${LOG_EDIT_LEAD_MS / 1000} seconds.` : "That's in the past.";
  const itemFor = (itemId: string) => {
    const it = items.find((i) => i.id === itemId);
    if (!it || it.stationId !== stationId) return { problem: { code: "not_found", message: "That item wasn't found." } };
    if (it.identCode) return { problem: { code: "not_for_the_log", message: "Openers, closers and off-air cards air at sign-off and sign-on, not from the log." } };
    if (!it.rights) return { problem: { code: "rights_unconfirmed", message: "Confirm the rights to air it first." } };
    return { item: it };
  };
  const lengthOf = (ms: number | null) => Math.ceil((ms ?? 30 * MIN) / MIN) * MIN;

  for (const [index, c] of body.changes.entries()) {
    // A244: programming blocks' spans, checked below.
    if (isBlockChange(c)) {
      about.push({ id: null, insert: null });
      continue;
    }
    if (c.op === "insert") {
      const startsAt = snapTime(c.entry.startsAt);
      const row: DbLogEntry = {
        id: `insert-${index}`,
        stationId,
        kind: c.entry.kind,
        code: c.entry.kind === "off_air" ? "OPEN" : "PGM",
        startsAt,
        endsAt: c.entry.endsAt ? snapTime(c.entry.endsAt) : new Date(Date.parse(startsAt) + 30 * MIN).toISOString(),
        title: "Program",
        episodeTitle: null,
        itemId: c.entry.itemId ?? null,
        programId: c.entry.programId ?? null,
        liveSourceId: c.entry.liveSourceId ?? null,
        carriedFrom: null,
        carriageAgreementId: c.entry.carriageAgreementId ?? null,
        repeatGroupId: null,
        localNote: c.entry.localNote ?? null,
        ...(c.entry.keepTime ? { keepTime: true } : {})
      };
      if (c.entry.carriageAgreementId) {
        const same = log.find((e) => e.carriageAgreementId === c.entry.carriageAgreementId);
        row.title = same?.title ?? "Program";
        row.carriedFrom = same?.carriedFrom ?? null;
        if (!c.entry.endsAt) row.endsAt = new Date(Date.parse(startsAt) + 30 * MIN).toISOString();
      } else if (c.entry.itemId) {
        const found = itemFor(c.entry.itemId);
        if (found.problem) problems.push({ index, ...found.problem });
        else {
          row.title = found.item.title;
          row.programId = found.item.programId;
          if (!c.entry.endsAt) row.endsAt = new Date(Date.parse(startsAt) + lengthOf(found.item.durationMs)).toISOString();
        }
      }
      if (Date.parse(startsAt) < boundary) problems.push({ index, code: "too_soon", message: tooSoon });
      const ins = { index, key: c.key ?? null, row };
      inserts.push(ins);
      about.push({ id: null, insert: ins });
      continue;
    }
    about.push({ id: c.entryId, insert: null });
    const orig = byId.get(c.entryId);
    if (!orig) {
      problems.push({ index, code: "not_found", message: "That entry isn't on the log any more." });
      continue;
    }
    const d = drafts.get(orig.id) ?? { orig, next: { ...orig }, removed: false, changed: false, marked: false, index };
    drafts.set(orig.id, d);
    // A mark isn't where its entry's problems point (as the API's).
    if (c.op !== "keep") d.index = index;
    if (d.removed) {
      problems.push({ index, code: "removed", message: "It's already coming off the log." });
      continue;
    }
    const lock = lockOf(orig);
    if (lock) {
      problems.push({ index, code: "locked", message: lock });
      continue;
    }
    if (c.op === "keep") {
      // G18: "Keep at this time".
      d.next = { ...d.next, keepTime: c.keep };
      d.marked = true;
      continue;
    }
    if (c.op === "move" && d.next.keepTime) {
      problems.push({ index, code: "kept", message: `${orig.title} is kept at its time. Turn off Keep at this time to move it.` });
      continue;
    }
    if (c.op === "move") {
      const startsAt = snapTime(c.startsAt);
      const length = Date.parse(d.next.endsAt) - Date.parse(d.next.startsAt);
      d.next = { ...d.next, startsAt, endsAt: new Date(Date.parse(startsAt) + length).toISOString() };
      d.changed = true;
    } else if (c.op === "resize") {
      d.next = { ...d.next, endsAt: snapTime(c.endsAt) };
      d.changed = true;
    } else if (c.op === "replace") {
      if (orig.kind !== "program") {
        problems.push({ index, code: "not_a_program", message: "Only a program's item can be replaced." });
        continue;
      }
      const found = itemFor(c.itemId);
      if (found.problem) {
        problems.push({ index, ...found.problem });
        continue;
      }
      d.next = { ...d.next, itemId: found.item.id, title: found.item.title, programId: found.item.programId, episodeTitle: null, endsAt: new Date(Date.parse(d.next.startsAt) + lengthOf(found.item.durationMs)).toISOString() };
      d.changed = true;
    } else d.removed = true;
    if (!d.removed && Date.parse(d.next.startsAt) < boundary) problems.push({ index, code: "too_soon", message: tooSoon });
    if (!d.removed && d.next.endsAt <= d.next.startsAt) problems.push({ index, code: "bad_request", message: "It has to end after it starts." });
  }

  // Overlaps, against everything else on the log after the batch.
  const gone = new Set(drafts.keys());
  const after = [...log.filter((e) => !gone.has(e.id)), ...[...drafts.values()].filter((d) => !d.removed).map((d) => d.next), ...inserts.map((i) => i.row)].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const troubled = new Set(problems.map((p) => p.index));
  const mine = new Map<string, number>([...[...drafts.values()].filter((d) => !d.removed && d.changed && !troubled.has(d.index)).map((d) => [d.orig.id, d.index] as const), ...inserts.filter((i) => !troubled.has(i.index)).map((i) => [i.row.id, i.index] as const)]);
  const seen = new Set<string>();
  for (let i = 0; i < after.length; i++) {
    for (let j = i + 1; j < after.length && after[j].startsAt < after[i].endsAt; j++) {
      const [a, b] = [after[i], after[j]];
      if (!mine.has(a.id) && !mine.has(b.id)) continue;
      const pair = [a.id, b.id].sort().join(":");
      if (seen.has(pair)) continue;
      seen.add(pair);
      const [changed, other] = mine.has(b.id) ? [b, a] : [a, b];
      problems.push({ index: mine.get(changed.id)!, code: "overlap", message: `${changed.title} would overlap ${other.title} at ${clockOf(changed.startsAt > other.startsAt ? changed.startsAt : other.startsAt)}.` });
    }
  }
  const blocks = checkBlockChanges(stationId, body.changes, { t, boundary, tooSoon });
  problems.push(...blocks.problems);
  problems.sort((a, b) => (a.index ?? -1) - (b.index ?? -1));

  // Dead air the batch leaves in the stretch it touches (planned off air and breaks aren't).
  const touched = [...[...drafts.values()].flatMap((d) => [d.orig.startsAt, d.orig.endsAt, d.next.startsAt, d.next.endsAt]), ...inserts.flatMap((i) => [i.row.startsAt, i.row.endsAt])].sort();
  const gaps: LogChangesResult["gaps"] = [];
  if (touched.length) {
    const lo = touched[0];
    const hi = touched[touched.length - 1];
    const gapsOf = (rows: DbLogEntry[]) => {
      const out: Array<{ startsAt: string; endsAt: string }> = [];
      let cursor = lo;
      for (const b of [...rows, ...offAirFor(stationId, lo, hi)].sort((x, y) => x.startsAt.localeCompare(y.startsAt))) {
        if (b.startsAt > cursor && b.startsAt <= hi) out.push({ startsAt: cursor, endsAt: b.startsAt });
        if (b.endsAt > cursor) cursor = b.endsAt;
      }
      if (cursor < hi) out.push({ startsAt: cursor, endsAt: hi });
      return out.filter((g) => Date.parse(g.endsAt) - Date.parse(g.startsAt) >= 5 * MIN);
    };
    const before = new Set(gapsOf(log).map((g) => `${g.startsAt}/${g.endsAt}`));
    for (const g of gapsOf(after)) {
      if (Date.parse(g.endsAt) <= t) continue;
      gaps.push(g);
      if (!before.has(`${g.startsAt}/${g.endsAt}`)) warnings.push({ index: null, code: "dead_air", message: `Dead air from ${clockOf(g.startsAt)} to ${clockOf(g.endsAt)} (${Math.round((Date.parse(g.endsAt) - Date.parse(g.startsAt)) / MIN)} min).` });
    }
  }

  // A break follows the program it's after (or inside); one with spots whose program comes off hands them on.
  const breaksOf = (e: DbLogEntry) => stationBreaks(stationId).filter((b) => b.startsAt >= e.startsAt && b.startsAt <= e.endsAt && b.origin !== "cued_live");
  for (const d of drafts.values()) {
    if (!d.removed && d.next.startsAt === d.orig.startsAt && d.next.itemId === d.orig.itemId) continue;
    for (const b of breaksOf(d.orig)) {
      const spots = b.fills.filter((f) => f.kind === "spot").length;
      if (!spots) continue;
      const where = b.context.replace(/^(During|After)/, (w) => w.toLowerCase());
      warnings.push({ index: d.index, code: "held_spots", message: `${plural(spots, "held spot")} in the break ${where} ${spots === 1 ? "moves" : "move"} to the next break.` });
    }
  }

  const lines = body.changes.map((c, index) => {
    if (isBlockChange(c)) return blocks.lines.get(index) ?? "";
    const a = about[index];
    if (a.insert) return `${a.insert.row.title} goes on at ${when(a.insert.row.startsAt, now().toISOString())}`;
    const d = a.id ? drafts.get(a.id) : undefined;
    if (!d) return "An entry that isn't on the log any more";
    if (c.op === "move") return `${d.orig.title} moves to ${when(d.next.startsAt, d.orig.startsAt)}`;
    if (c.op === "resize") return `${d.orig.title} now ends at ${when(d.next.endsAt, d.orig.endsAt)}`;
    if (c.op === "replace") return `${d.next.title} replaces ${d.orig.title} at ${clockOf(d.next.startsAt)}`;
    if (c.op === "keep") return c.keep ? `${d.orig.title} keeps its time` : `${d.orig.title} no longer keeps its time`;
    return `${d.orig.title} at ${clockOf(d.orig.startsAt)} comes off the log`;
  });
  const shown = lines.slice(0, 4);
  const summary = `${plural(lines.length, "change")}: ${shown.join(", ")}${lines.length > shown.length ? `, and ${lines.length - shown.length} more` : ""}`;
  const result = (applied: boolean, record: LogChangeRecord | null, ids = new Map<number, string>()): LogChangesResult => ({
    applied,
    ...(body.base ? { version: applied ? mockLogVersion(stationId, body.base.from, body.base.to) : body.base.version } : {}),
    summary,
    changes: body.changes.map((c, index) => {
      const a = about[index];
      if (isBlockChange(c)) {
        const r = blocks.results.get(index);
        return { index, op: c.op, entryId: null, key: r?.key ?? null, spanId: r?.spanId ?? null, line: lines[index], startsAt: r?.startsAt ?? null, endsAt: r?.endsAt ?? null };
      }
      const d = a.id ? drafts.get(a.id) : undefined;
      const row = a.insert ? a.insert.row : d && !d.removed ? d.next : null;
      return { index, op: c.op, entryId: a.insert ? (ids.get(index) ?? null) : a.id, key: a.insert?.key ?? null, line: lines[index], startsAt: row && c.op !== "remove" ? row.startsAt : null, endsAt: row && c.op !== "remove" ? row.endsAt : null };
    }),
    problems,
    warnings,
    gaps,
    replanned: false,
    record
  });

  if (body.dryRun) return result(false, null);
  if (problems.length) return fail(422, "log_changes_refused", problems[0].message, Object.fromEntries(problems.map((p) => [p.index === null ? "changes" : `changes.${p.index}`, p.message])));

  // Publish, all at once.
  const db = getDb();
  const times: string[] = [];
  for (const d of drafts.values()) {
    times.push(d.orig.startsAt);
    if (d.removed) {
      // Spots in its breaks go to the next break after it.
      const held = breaksOf(d.orig).flatMap((b) => b.fills.filter((f) => f.kind === "spot"));
      removeWithBreaks(d.orig.id);
      db.breaks = db.breaks.filter((b) => !(b.stationId === stationId && b.startsAt >= d.orig.startsAt && b.startsAt <= d.orig.endsAt && b.origin !== "cued_live"));
      const next = stationBreaks(stationId).find((b) => b.startsAt > d.orig.startsAt && !b.noSpots);
      if (next && held.length) next.fills.push(...held);
      continue;
    }
    if (d.marked) {
      const row = db.log.find((e) => e.id === d.orig.id)!;
      if (d.next.keepTime) row.keepTime = true;
      else delete row.keepTime;
      times.push(d.orig.startsAt);
    }
    if (!d.changed) continue;
    const shift = Date.parse(d.next.startsAt) - Date.parse(d.orig.startsAt);
    for (const b of breaksOf(d.orig)) b.startsAt = new Date(Date.parse(b.startsAt) + shift).toISOString();
    const row = db.log.find((e) => e.id === d.orig.id)!;
    Object.assign(row, { startsAt: d.next.startsAt, endsAt: d.next.endsAt, itemId: d.next.itemId, title: d.next.title, programId: d.next.programId, episodeTitle: d.next.episodeTitle });
    times.push(d.next.startsAt);
  }
  const ids = new Map<number, string>();
  for (const ins of inserts) {
    const row: DbLogEntry = { ...ins.row, id: crypto.randomUUID() };
    db.log.push(row);
    ids.set(ins.index, row.id);
    times.push(row.startsAt);
  }
  blocks.publish();
  times.push(...blocks.times);
  markEdited(stationId, times);
  const record: MockLogChange = { stationId, id: crypto.randomUUID(), at: now().toISOString(), by: { userId: by.id, name: by.name }, summary, lines, count: lines.length };
  history().unshift(record);
  saveDb();
  saveOnAirState();
  const { stationId: _omit, ...view } = record;
  void _omit;
  return { ...result(true, view, ids), replanned: onAir && times.some((x) => Date.parse(x) < t + 30 * MIN) };
}

export const logChangeHandlers = [
  http.post(path(logApi.applyLogChanges), async ({ request, params }) => {
    const r = roleOn(request, String(params.stationId), ["owner", "operator"]);
    if (r instanceof Response) return r;
    const body = logApi.applyLogChanges.body!.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, "bad_request", "Those changes aren't complete.");
    const out = applyChanges(r.station.ident.id, r.station.onAir, body.data, { id: r.person.id, name: r.person.displayName });
    if (out instanceof Response) return out;
    return reply(logApi.applyLogChanges.response, out);
  }),

  http.get(path(logApi.listLogChanges), ({ request, params }) => {
    const r = roleOn(request, String(params.stationId), ["owner", "operator"]);
    if (r instanceof Response) return r;
    const limit = Math.min(50, Number(new URL(request.url).searchParams.get("limit") ?? 10) || 10);
    const changes = history()
      .filter((c) => c.stationId === r.station.ident.id)
      .slice(0, limit)
      .map(({ stationId: _s, ...c }) => (void _s, c));
    return reply(logApi.listLogChanges.response, { changes });
  })
];

