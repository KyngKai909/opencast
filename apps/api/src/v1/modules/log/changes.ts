// Edit mode (added 2026-09-29): a batch of changes to the log, drafted in master control and
// checked together (a dry run) or published at once, in one transaction. The same rules as a
// single edit (`add`, `update`, `remove`): rights, carriage limits, off air, 4-second segments.
//
// On air, what's airing now and anything starting within the assembler's lead (the channel is
// written that far ahead) is locked; everything else goes out on publish: an on-air station is
// told once to read its log again, and switches at the next item. Breaks follow the programs
// (they're generated from the break rule); spots already held in a break that goes move to the
// next break rather than being returned. Every published batch is recorded (`log_changes`).

import { isIdentCode } from "@opencast/contracts";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { schema } from "@opencast/db";
import { LOG_EDIT_LEAD_MS, type LogChange, type LogChangeRecord, type LogChangesResult } from "@opencast/contracts";
import type { Executor, ModuleContext } from "../../context.js";
import { conflict, HttpError } from "../../errors.js";
import { overlaps, type SpanRow } from "./blocks.js";
import { clockTime, localDate, roundUpToMinute } from "../../lib/time.js";
import { snapDate } from "../../lib/segments.js";
import { STATION_ID_MS } from "../playout/engine/fill.js";
import { partsOf } from "../playout/engine/cadence.js";
import type { OffAirSpanView } from "./offair.js";
import type { BreakSlotView, ReminderNews } from "./service.js";

type Row = typeof schema.logEntries.$inferSelect;
type Input = { kind: Row["kind"]; startsAt: string; endsAt?: string; itemId?: string; programId?: string; liveSourceId?: string; carriageAgreementId?: string; episodeTitle?: string; episodeDescription?: string; localNote?: string };
type Checked = { startsAt: Date; endsAt: Date; code: Row["code"]; programId: string | null };
type Gap = { startsAt: string; endsAt: string };

/** What the log service lends the batch: its own rules, so a batch checks exactly as single edits do. */
export interface ChangeHelpers {
  validate(stationId: string, input: Input, excludeId?: string): Promise<Checked>;
  releaseBreaks(ex: Executor, entryIds: string[]): Promise<void>;
  load(stationId: string, from: Date, to: Date): Promise<Row[]>;
  /** Titles as the log shows them ("Late Crate"), by row id. */
  titles(rows: Row[]): Promise<Map<string, string>>;
  offAirSpans(stationId: string, from: Date, to: Date): Promise<OffAirSpanView[]>;
  gapsIn(rows: Row[], from: Date, to: Date, offAir: OffAirSpanView[]): Gap[];
  ensureBreaks(stationId: string, from: Date, to: Date): Promise<BreakSlotView[]>;
  breakContexts(breakIds: string[]): Promise<Map<string, string>>;
  markEdited(stationId: string, dates: Array<string | Date>): Promise<void>;
  /** Who set reminders for each entry (by entry id). */
  remindersOn(entryIds: string[]): Promise<Map<string, Array<{ id: string; userId: string }>>>;
  /** Entries coming off the log, inside the transaction once what replaces them is on: their reminders move to the program's next airing, or are cancelled. */
  settleReminders(ex: Executor, leaving: Row[]): Promise<ReminderNews[]>;
  /** Moved entries: their reminders come again at the new start. */
  rearmReminders(ex: Executor, entryIds: string[]): Promise<void>;
  /** After the transaction: each viewer is told. */
  tellReminders(news: ReminderNews[]): void;
  /** A244: programming blocks' spans overlapping a window. */
  spans(stationId: string, from: Date, to: Date): Promise<SpanRow[]>;
}

export interface ChangeOps {
  apply(stationId: string, userId: string, body: { dryRun?: boolean; base?: { from: string; to: string; version: string }; changes: LogChange[] }): Promise<LogChangesResult>;
  history(stationId: string, limit: number): Promise<LogChangeRecord[]>;
}

const E = schema.logEntries;
const B = schema.breaks;
const LC = schema.logChanges;
const SP = schema.programBlockSpans;
/** A244: a block runs 24 hours at most. */
const MAX_SPAN_MS = 24 * 60 * 60_000;

type EntryChange = Exclude<LogChange, { op: "block_add" | "block_resize" | "block_remove" }>;
type BlockChange = Extract<LogChange, { op: "block_add" | "block_resize" | "block_remove" }>;
const isBlockChange = (c: LogChange): c is BlockChange => c.op === "block_add" || c.op === "block_resize" || c.op === "block_remove";

/** A244: a programming block's span as the batch leaves it. */
interface SpanDraft {
  index: number;
  key: string | null;
  blockId: string;
  orig: SpanRow | null;
  next: { startsAt: Date; endsAt: Date } | null;
  /** The id once published (an addition's). */
  id: string | null;
}
const MIN = 60_000;
const HOUR = 60 * MIN;
/** Where entries wait inside the transaction while the batch shuffles them (so a swap never overlaps on the way). */
export const PARK = Date.UTC(1971, 0, 1);

/**
 * A window's version: a hash of its entries (times, what airs, a live block ended early). The
 * draft keeps the one it began from; the batch is refused if the window has changed since.
 */
export function logVersion(rows: Row[], spans: Array<{ id: string; blockId: string; startsAt: Date; endsAt: Date }> = []): string {
  const hash = createHash("sha1");
  for (const r of [...rows].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id))) {
    hash.update([r.id, r.startsAt.toISOString(), r.endsAt.toISOString(), r.kind, r.assetId ?? "", r.liveSourceId ?? "", r.carriageAgreementId ?? "", r.endedEarlyAt?.toISOString() ?? ""].join("|"));
    hash.update("\n");
  }
  // A244: programming blocks' spans (a window without any hashes as before).
  for (const sp of [...spans].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id))) {
    hash.update(["block", sp.id, sp.blockId, sp.startsAt.toISOString(), sp.endsAt.toISOString()].join("|"));
    hash.update("\n");
  }
  return hash.digest("base64url").slice(0, 16);
}

/** One entry as the batch leaves it. */
interface Draft {
  orig: Row;
  next: Row;
  removed: boolean;
  moved: boolean;
  resized: boolean;
  newItem: boolean;
  /** The last change about it (where its problems point). */
  index: number;
}

interface Insert {
  index: number;
  key: string | null;
  input: Input;
  row: Row;
}

export function createChangeOps(ctx: ModuleContext, h: ChangeHelpers): ChangeOps {
  const { deps, services } = ctx;
  const { db } = deps;

  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  const ops: ChangeOps = {
    async apply(stationId, userId, body) {
      const now = deps.clock.now();
      const t = now.getTime();
      const tz = await services.stations.timezoneOf(stationId);
      const onAir = (await services.playout.statusFor([stationId])).get(stationId)?.onAir ?? false;
      // The channel is written this far ahead: on air, nothing sooner can change.
      const boundary = t + (onAir ? LOG_EDIT_LEAD_MS : 0);
      const clock = (d: Date) => clockTime(d, tz);
      /** "9:10 pm", or "Sun 9:10 pm" on another day than `beside`. */
      const when = (d: Date, beside: Date) => {
        if (localDate(d, tz) === localDate(beside, tz)) return clock(d);
        const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
        return `${day} ${clock(d)}`;
      };

      // Someone changed the log where the draft began: the operator reloads.
      if (body.base) {
        const [rows, spans] = await Promise.all([h.load(stationId, new Date(body.base.from), new Date(body.base.to)), h.spans(stationId, new Date(body.base.from), new Date(body.base.to))]);
        if (logVersion(rows, spans) !== body.base.version) {
          throw conflict("log_changed", "The log changed since you started editing. Reload it to see what changed, then make your changes again.");
        }
      }

      const changes = body.changes;
      const entryIds = [...new Set(changes.flatMap((c) => (c.op === "insert" || isBlockChange(c) ? [] : [c.entryId])))];
      const current = entryIds.length ? await db.select().from(E).where(and(eq(E.stationId, stationId), inArray(E.id, entryIds))) : [];
      const byId = new Map(current.map((r) => [r.id, r]));
      // What goes on, and what airs now where an item is replaced (whether its breaks move).
      const itemIds = [
        ...new Set([
          ...changes.flatMap((c) => (c.op === "replace" ? [c.itemId] : c.op === "insert" && c.entry.itemId ? [c.entry.itemId] : [])),
          ...current.flatMap((r) => (r.assetId ? [r.assetId] : []))
        ])
      ];
      const items = await services.library.itemsByIds(itemIds);

      const problems: LogChangesResult["problems"] = [];
      const warnings: LogChangesResult["warnings"] = [];
      const drafts = new Map<string, Draft>();
      const inserts: Insert[] = [];
      /** Per change: the entry it's about (a draft's id, or an insert). */
      const about: Array<{ entryId: string | null; insert: Insert | null }> = [];

      /** Why an entry can't change now, or null. */
      const lockOf = (row: Row): string | null => {
        const start = row.startsAt.getTime();
        if (start >= boundary) return null;
        if (row.endsAt.getTime() <= t) return "It has already aired.";
        if (start <= t) return onAir ? "On air now, too late to change." : "It has already started.";
        return `Airs in ${Math.max(1, Math.ceil((start - t) / 1000))} s, too late to change.`;
      };
      const tooSoon = onAir ? `That's too soon: the channel is already set for the next ${LOG_EDIT_LEAD_MS / 1000} seconds.` : "That's in the past.";

      for (const [index, c] of changes.entries()) {
        // A244: programming blocks' spans are checked on their own, below.
        if (isBlockChange(c)) {
          about.push({ entryId: null, insert: null });
          continue;
        }
        if (c.op === "insert") {
          const input: Input = { ...c.entry };
          const startsAt = snapDate(new Date(input.startsAt));
          const row = pseudoRow(stationId, input, startsAt);
          const insert = { index, key: c.key ?? null, input, row };
          inserts.push(insert);
          about.push({ entryId: null, insert });
          continue;
        }
        about.push({ entryId: c.entryId, insert: null });
        const orig = byId.get(c.entryId);
        if (!orig) {
          problems.push({ index, code: "not_found", message: "That entry isn't on the log any more." });
          continue;
        }
        const d = drafts.get(orig.id) ?? { orig, next: { ...orig }, removed: false, moved: false, resized: false, newItem: false, index };
        drafts.set(orig.id, d);
        d.index = index;
        if (d.removed) {
          problems.push({ index, code: "removed", message: "It's already coming off the log." });
          continue;
        }
        const lock = lockOf(orig);
        if (lock) {
          problems.push({ index, code: "locked", message: lock });
          continue;
        }
        if (c.op === "move") {
          const startsAt = snapDate(new Date(c.startsAt));
          const length = d.next.endsAt.getTime() - d.next.startsAt.getTime();
          d.next = { ...d.next, startsAt, endsAt: new Date(startsAt.getTime() + length) };
          d.moved = true;
        } else if (c.op === "resize") {
          d.next = { ...d.next, endsAt: snapDate(new Date(c.endsAt)) };
          d.resized = true;
        } else if (c.op === "replace") {
          if (orig.kind !== "program") {
            problems.push({ index, code: "not_a_program", message: "Only a program's item can be replaced." });
            continue;
          }
          const item = items.get(c.itemId);
          if (item && isIdentCode(item.code)) {
            problems.push({ index, code: "not_for_the_log", message: "Openers, closers and off-air cards air at sign-off and sign-on, not from the log." });
            continue;
          }
          // A new item's slot is its length in whole minutes, as `update` makes it.
          const length = roundUpToMinute(item?.durationMs ?? 30 * MIN);
          d.next = { ...d.next, assetId: c.itemId, carriageAgreementId: c.carriageAgreementId ?? null, programId: item?.programId ?? null, code: item?.code ?? d.next.code, endsAt: new Date(d.next.startsAt.getTime() + length) };
          d.newItem = true;
        } else {
          d.removed = true;
        }
      }

      // Each entry as the batch leaves it, and each insert, by the single edits' own rules.
      const live = [...drafts.values()].filter((d) => !d.removed && (d.moved || d.resized || d.newItem));
      for (const d of live) {
        if (problems.some((p) => p.index !== null && about[p.index]?.entryId === d.orig.id)) continue;
        if (d.next.startsAt.getTime() < boundary) {
          problems.push({ index: d.index, code: "too_soon", message: tooSoon });
          continue;
        }
        try {
          const checked = await h.validate(stationId, inputOf(d.next), d.orig.id);
          d.next = { ...d.next, startsAt: checked.startsAt, endsAt: checked.endsAt, code: checked.code, programId: checked.programId };
        } catch (error) {
          problems.push(problemOf(d.index, error));
        }
      }
      for (const ins of inserts) {
        if (ins.row.startsAt.getTime() < boundary) {
          problems.push({ index: ins.index, code: "too_soon", message: tooSoon });
          continue;
        }
        try {
          const checked = await h.validate(stationId, ins.input);
          ins.row = { ...ins.row, startsAt: checked.startsAt, endsAt: checked.endsAt, code: checked.code, programId: checked.programId };
        } catch (error) {
          problems.push(problemOf(ins.index, error));
        }
      }

      // A244: programming blocks' spans: added, moved, or taken off.
      const blocks = await draftSpans();

      // Carriage limits across the batch: each change is checked against the log as it is, so two
      // airings of the same carried episode the batch adds are counted against each other here.
      await batchCarriage();

      // The stretch the batch touches, before and after.
      const touched = [
        ...[...drafts.values()].flatMap((d) => [d.orig.startsAt, d.orig.endsAt, d.next.startsAt, d.next.endsAt]),
        ...inserts.flatMap((i) => [i.row.startsAt, i.row.endsAt])
      ].map((d) => d.getTime());
      // Nothing found to change (every entry gone): the stretch is now.
      const lo = new Date(touched.length ? Math.min(...touched) : t);
      const hi = new Date(touched.length ? Math.max(...touched) : t + 1);
      const around = await h.load(stationId, new Date(lo.getTime() - 6 * HOUR), new Date(hi.getTime() + 6 * HOUR));
      const gone = new Set([...drafts.values()].map((d) => d.orig.id));
      const after: Row[] = [
        ...around.filter((r) => !gone.has(r.id)),
        ...[...drafts.values()].filter((d) => !d.removed).map((d) => d.next),
        ...inserts.map((i) => i.row)
      ].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

      // Titles as the log has them now, and as the batch leaves them (a replaced item's is new).
      const [titlesNow, titlesNext] = await Promise.all([h.titles([...current, ...around]), h.titles([...[...drafts.values()].map((d) => d.next), ...inserts.map((i) => i.row)])]);
      const titleOf = (r: Row) => titlesNow.get(r.id) ?? titlesNext.get(r.id) ?? "Untitled";
      const titleAfter = (r: Row) => titlesNext.get(r.id) ?? titlesNow.get(r.id) ?? "Untitled";

      // Overlaps: a changed or inserted entry against anything else on the log after the batch.
      const mine = new Map<string, number>([...[...drafts.values()].filter((d) => !d.removed).map((d) => [d.orig.id, d.index] as const), ...inserts.map((i) => [i.row.id, i.index] as const)]);
      const reported = new Set<string>();
      // An entry with a problem already (locked, too soon, its rights) isn't also said to overlap.
      const troubled = new Set(problems.map((p) => p.index));
      for (const [id, index] of mine) if (troubled.has(index)) mine.delete(id);
      for (let i = 0; i < after.length; i++) {
        for (let j = i + 1; j < after.length && after[j].startsAt < after[i].endsAt; j++) {
          const [a, b] = [after[i], after[j]];
          if (!mine.has(a.id) && !mine.has(b.id)) continue;
          const pair = [a.id, b.id].sort().join(":");
          if (reported.has(pair)) continue;
          reported.add(pair);
          const [changed, other] = mine.has(b.id) ? [b, a] : [a, b];
          problems.push({ index: mine.get(changed.id)!, code: "overlap", message: `${titleAfter(changed)} would overlap ${mine.has(other.id) ? titleAfter(other) : titleOf(other)} at ${clock(changed.startsAt > other.startsAt ? changed.startsAt : other.startsAt)}.` });
        }
      }

      // Dead air the batch leaves (planned off air isn't).
      const offAir = await h.offAirSpans(stationId, lo, hi);
      const before = h.gapsIn(around, lo, hi, offAir);
      const known = new Set(before.map((g) => `${g.startsAt}/${g.endsAt}`));
      const gaps = h.gapsIn(after, lo, hi, offAir).filter((g) => Date.parse(g.endsAt) > t);
      for (const g of gaps.filter((x) => !known.has(`${x.startsAt}/${x.endsAt}`))) {
        const ms = Date.parse(g.endsAt) - Date.parse(g.startsAt);
        const length = ms >= MIN ? plural(Math.round(ms / MIN), "min", "min") : plural(Math.round(ms / 1000), "s", "s");
        warnings.push({ index: null, code: "dead_air", message: `Dead air from ${clock(new Date(g.startsAt))} to ${clock(new Date(g.endsAt))} (${length}).` });
      }

      // Spots already held in a break that goes (its program moves, changes item or comes off).
      const shifting = [...drafts.values()].filter((d) => d.removed || (d.moved && d.next.startsAt.getTime() !== d.orig.startsAt.getTime()) || (d.newItem && itemLength(d.next.assetId) !== itemLength(d.orig.assetId)));
      const stored = shifting.length
        ? await db
            .select({ id: B.id, startsAt: B.startsAt, logEntryId: B.logEntryId, origin: B.origin })
            .from(B)
            .where(inArray(B.logEntryId, shifting.map((d) => d.orig.id)))
        : [];
      const placed = await services.spots.breakAirings(stored.filter((b) => b.origin !== "cued_live").map((b) => b.id));
      const held = stored.filter((b) => (placed.get(b.id)?.length ?? 0) > 0);
      const contexts = await h.breakContexts(held.map((b) => b.id));
      for (const b of held) {
        const d = drafts.get(b.logEntryId!)!;
        const list = placed.get(b.id)!;
        const station = list.filter((a) => !a.carriageAgreementId).length;
        const barter = list.length - station;
        const where = (contexts.get(b.id) ?? "a break").replace(/^(During|After)/, (w) => w.toLowerCase());
        if (station) warnings.push({ index: d.index, code: "held_spots", message: `${plural(station, "held spot")} in the break ${where} ${station === 1 ? "moves" : "move"} to the next break.` });
        if (barter) {
          warnings.push(
            d.removed
              ? { index: d.index, code: "held_spots_kept", message: `${plural(barter, "barter spot")} in the break ${where} ${barter === 1 ? "is" : "are"} returned if ${barter === 1 ? "it doesn't" : "they don't"} air.` }
              : { index: d.index, code: "held_spots", message: `${plural(barter, "barter spot")} in the break ${where} ${barter === 1 ? "moves" : "move"} with it.` }
          );
        }
      }

      // Viewers who set reminders for an entry coming off: they're told (moved to the next airing, or cancelled).
      const removing = [...drafts.values()].filter((d) => d.removed);
      const reminded = removing.length ? await h.remindersOn(removing.map((d) => d.orig.id)) : new Map<string, Array<{ id: string; userId: string }>>();
      for (const d of removing) {
        const n = new Set((reminded.get(d.orig.id) ?? []).map((r) => r.userId)).size;
        if (n) warnings.push({ index: d.index, code: "reminders", message: `${plural(n, "viewer")} set ${n === 1 ? "a reminder" : "reminders"} for this; they'll be told.` });
      }

      // What each change says.
      const lines = changes.map((c, index) => {
        if (isBlockChange(c)) return blocks.lineOf(index);
        const a = about[index];
        if (a.insert) return `${titleAfter(a.insert.row)} goes on at ${when(a.insert.row.startsAt, now)}`;
        const d = a.entryId ? drafts.get(a.entryId) : undefined;
        if (!d) return "An entry that isn't on the log any more";
        const title = titleOf(d.orig);
        if (c.op === "move") return `${title} moves to ${when(d.next.startsAt, d.orig.startsAt)}`;
        if (c.op === "resize") return `${title} now ends at ${when(d.next.endsAt, d.orig.endsAt)}`;
        if (c.op === "replace") return `${titleAfter(d.next)} replaces ${title} at ${clock(d.next.startsAt)}`;
        return `${title} at ${clock(d.orig.startsAt)} comes off the log`;
      });
      const summary = summaryOf(lines);
      // In the batch's order: the batch as a whole first.
      problems.sort((a, b) => (a.index ?? -1) - (b.index ?? -1));
      const result = (applied: boolean, version: string | undefined, replanned: boolean, record: LogChangeRecord | null, insertedIds = new Map<Insert, string>()): LogChangesResult => ({
        applied,
        ...(version ? { version } : {}),
        summary,
        changes: changes.map((c, index) => {
          const a = about[index];
          if (isBlockChange(c)) {
            const sd = blocks.byIndex.get(index);
            return {
              index,
              op: c.op,
              entryId: null,
              key: sd?.key ?? null,
              line: lines[index],
              spanId: sd?.id ?? sd?.orig?.id ?? null,
              startsAt: sd?.next ? sd.next.startsAt.toISOString() : null,
              endsAt: sd?.next ? sd.next.endsAt.toISOString() : null
            };
          }
          const d = a.entryId ? drafts.get(a.entryId) : undefined;
          const row = a.insert ? a.insert.row : d && !d.removed ? d.next : null;
          return {
            index,
            op: c.op,
            entryId: a.insert ? (insertedIds.get(a.insert) ?? null) : (a.entryId ?? null),
            key: a.insert?.key ?? null,
            line: lines[index],
            startsAt: row && !(c.op === "remove") ? row.startsAt.toISOString() : null,
            endsAt: row && !(c.op === "remove") ? row.endsAt.toISOString() : null
          };
        }),
        problems,
        warnings,
        gaps,
        replanned,
        record
      });

      if (body.dryRun) return result(false, body.base?.version, false, null);
      if (problems.length) {
        const first = problems[0];
        throw new HttpError(422, "log_changes_refused", first.message, Object.fromEntries(problems.map((p) => [p.index === null ? "changes" : `changes.${p.index}`, p.message])));
      }

      // Publish: everything at once, or nothing.
      const removed = [...drafts.values()].filter((d) => d.removed);
      const updated = live;
      const insertedIds = new Map<Insert, string>();
      let news: ReminderNews[] = [];
      const recordRow = await db.transaction(async (tx) => {
        await h.releaseBreaks(tx, removed.map((d) => d.orig.id));
        // Out of the way first, so entries trading places never overlap on the way. Entries coming
        // off wait there too, until their reminders have gone to what the batch leaves on the log.
        for (const [i, d] of [...updated, ...removed].entries()) {
          await tx.update(E).set({ startsAt: new Date(PARK + i * 2 * MIN), endsAt: new Date(PARK + i * 2 * MIN + MIN) }).where(eq(E.id, d.orig.id));
        }
        for (const d of updated) {
          await tx
            .update(E)
            .set({ startsAt: d.next.startsAt, endsAt: d.next.endsAt, code: d.next.code, assetId: d.next.assetId, programId: d.next.programId, carriageAgreementId: d.next.carriageAgreementId })
            .where(eq(E.id, d.orig.id));
        }
        for (const ins of inserts) {
          const [row] = await tx
            .insert(E)
            .values({
              stationId,
              startsAt: ins.row.startsAt,
              endsAt: ins.row.endsAt,
              kind: ins.input.kind,
              code: ins.row.code,
              assetId: ins.input.itemId ?? null,
              programId: ins.row.programId,
              liveSourceId: ins.input.liveSourceId ?? null,
              carriageAgreementId: ins.input.carriageAgreementId ?? null,
              episodeTitle: ins.input.episodeTitle ?? null,
              episodeDescription: ins.input.episodeDescription ?? null,
              localNote: ins.input.localNote ?? null,
              createdBy: userId
            })
            .returning({ id: E.id });
          insertedIds.set(ins, row.id);
        }
        // Reminders: an entry that moved is reminded at its new start; one coming off moves to the
        // program's next airing (one the batch puts on counts) or is cancelled. Then it goes.
        await h.rearmReminders(tx, updated.filter((d) => d.next.startsAt.getTime() !== d.orig.startsAt.getTime()).map((d) => d.orig.id));
        news = await h.settleReminders(tx, removed.map((d) => d.orig));
        if (removed.length) await tx.delete(E).where(inArray(E.id, removed.map((d) => d.orig.id)));
        // A244: programming blocks' spans (taken off first, so a moved one never meets itself).
        for (const sd of blocks.list.filter((x) => x.orig && !x.next)) await tx.delete(SP).where(eq(SP.id, sd.orig!.id));
        for (const [i, sd] of blocks.list.filter((x) => x.orig && x.next).entries()) await tx.update(SP).set({ startsAt: new Date(PARK + i * 2 * MIN), endsAt: new Date(PARK + i * 2 * MIN + MIN) }).where(eq(SP.id, sd.orig!.id));
        for (const sd of blocks.list.filter((x) => x.orig && x.next)) await tx.update(SP).set({ startsAt: sd.next!.startsAt, endsAt: sd.next!.endsAt, repeatGroupId: null, templateDate: null }).where(eq(SP.id, sd.orig!.id));
        for (const sd of blocks.list.filter((x) => !x.orig && x.next)) {
          const [row] = await tx.insert(SP).values({ stationId, blockId: sd.blockId, startsAt: sd.next!.startsAt, endsAt: sd.next!.endsAt, createdBy: userId }).returning({ id: SP.id });
          sd.id = row.id;
        }
        const [rec] = await tx.insert(LC).values({ stationId, userId, summary, lines, changes, createdAt: now }).returning();
        return rec;
      });

      h.tellReminders(news);

      // Dates day templates made are exceptions now, as with a single edit.
      await h.markEdited(stationId, [
        ...removed.map((d) => d.orig.templateDate ?? d.orig.startsAt),
        ...updated.flatMap((d) => [d.orig.templateDate ?? d.orig.startsAt, d.next.startsAt]),
        ...inserts.map((i) => i.row.startsAt),
        // A244: a block's span marks its days (both, when it crosses 6:00 am).
        ...blocks.list.flatMap((sd) => [
          ...(sd.orig ? [sd.orig.templateDate ?? sd.orig.startsAt, new Date(sd.orig.endsAt.getTime() - 1)] : []),
          ...(sd.next ? [sd.next.startsAt, new Date(sd.next.endsAt.getTime() - 1)] : [])
        ])
      ]);

      // Held spots from breaks that went move to the next break (after the new layout is stored).
      const moved = await moveHeld(stationId, held.map((b) => ({ id: b.id, startsAt: b.startsAt })), boundary);
      if (moved.kept) {
        warnings.push({ index: null, code: "held_spots_kept", message: `${plural(moved.kept, "held spot")} couldn't move to another break and ${moved.kept === 1 ? "is" : "are"} returned if ${moved.kept === 1 ? "it doesn't" : "they don't"} air.` });
      }

      // An on-air station reads its log again, once, when the batch reaches the next half hour.
      const times = [...touched, ...moved.times, ...blocks.times];
      const soon = times.some((x) => x < t + 30 * MIN);
      if (soon) await services.playout.replan(stationId);

      const version = body.base ? logVersion(await h.load(stationId, new Date(body.base.from), new Date(body.base.to)), await h.spans(stationId, new Date(body.base.from), new Date(body.base.to))) : undefined;
      const names = await services.accounts.displayNames([userId]);
      return result(true, version, soon && onAir, recordOf(recordRow, names), insertedIds);

      function itemLength(itemId: string | null) {
        return itemId ? (items.get(itemId)?.durationMs ?? null) : null;
      }

      /**
       * Each carried episode the batch leaves on the log, counted with the batch's own: what's on
       * the log now (less the entries the batch changes) plus, in the batch's order, each entry
       * carrying it after the batch. One that puts it on past the agreement's airings per episode
       * is a problem (an entry that already carried it only counts).
       */
      /**
       * A244: the batch's programming block changes, checked: the block is the station's (and not
       * archived), a span runs up to 24 hours (it may cross 6:00 am), one on air can only change its
       * end (and not to sooner than the channel is set), and blocks never overlap.
       */
      async function draftSpans() {
        const list: SpanDraft[] = [];
        const byIndex = new Map<number, SpanDraft>();
        const blockChanges = changes.map((c, index) => ({ c, index })).filter((x): x is { c: BlockChange; index: number } => isBlockChange(x.c));
        const times: number[] = [];
        if (!blockChanges.length) return { list, byIndex, times, lineOf: () => "" };
        const spanIds = blockChanges.flatMap(({ c }) => (c.op === "block_add" ? [] : [c.spanId]));
        const current = spanIds.length ? await db.select().from(SP).where(and(eq(SP.stationId, stationId), inArray(SP.id, spanIds))) : [];
        const refs = await services.library.blocks.refs([...blockChanges.flatMap(({ c }) => (c.op === "block_add" ? [c.blockId] : [])), ...current.map((sp) => sp.blockId)]);
        const nameOf = (blockId: string) => refs.get(blockId)?.name ?? "The block";
        const day = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
        const lines = new Map<number, string>();
        const spanDrafts = new Map<string, SpanDraft>();
        for (const { c, index } of blockChanges) {
          if (c.op === "block_add") {
            const ref = refs.get(c.blockId);
            const sd: SpanDraft = { index, key: c.key ?? null, blockId: c.blockId, orig: null, next: { startsAt: snapDate(new Date(c.startsAt)), endsAt: snapDate(new Date(c.endsAt)) }, id: null };
            list.push(sd);
            byIndex.set(index, sd);
            lines.set(index, `${ref?.name ?? "A block"} added, ${day(sd.next!.startsAt)} ${clock(sd.next!.startsAt)} to ${clock(sd.next!.endsAt)}`);
            if (!ref || ref.stationId !== stationId) problems.push({ index, code: "not_found", message: "That block isn't this station's." });
            else if (ref.archived) problems.push({ index, code: "block_archived", message: `${ref.name} is archived.` });
            else if (sd.next!.startsAt.getTime() < boundary) problems.push({ index, code: "too_soon", message: tooSoon });
            continue;
          }
          const orig = current.find((sp) => sp.id === c.spanId);
          if (!orig) {
            lines.set(index, "A block that isn't on the log any more");
            problems.push({ index, code: "not_found", message: "That block isn't on the log any more." });
            continue;
          }
          const sd = spanDrafts.get(orig.id) ?? { index, key: null, blockId: orig.blockId, orig, next: { startsAt: orig.startsAt, endsAt: orig.endsAt }, id: orig.id };
          if (!spanDrafts.has(orig.id)) list.push(sd);
          spanDrafts.set(orig.id, sd);
          sd.index = index;
          byIndex.set(index, sd);
          const name = nameOf(orig.blockId);
          const onAir = orig.startsAt.getTime() < boundary;
          if (!sd.next) {
            lines.set(index, `${name} comes off the log`);
            problems.push({ index, code: "removed", message: "It's already coming off the log." });
            continue;
          }
          if (c.op === "block_remove") {
            lines.set(index, `${name} comes off the log`);
            if (orig.endsAt.getTime() <= t) problems.push({ index, code: "block_locked", message: "It has already aired." });
            else if (onAir) problems.push({ index, code: "block_locked", message: `${name} is on air. Change it after ${clock(orig.endsAt)}.` });
            else sd.next = null;
            continue;
          }
          const startsAt = c.startsAt ? snapDate(new Date(c.startsAt)) : sd.next.startsAt;
          const endsAt = c.endsAt ? snapDate(new Date(c.endsAt)) : sd.next.endsAt;
          const startMoves = startsAt.getTime() !== sd.next.startsAt.getTime();
          const endMoves = endsAt.getTime() !== sd.next.endsAt.getTime();
          lines.set(index, startMoves && endMoves ? `${name} now runs ${clock(startsAt)} to ${clock(endsAt)}` : startMoves ? `${name} now starts at ${clock(startsAt)}` : `${name} now ends at ${clock(endsAt)}`);
          if (orig.endsAt.getTime() <= t) problems.push({ index, code: "block_locked", message: "It has already aired." });
          // On air: only its end, and not sooner than the channel is set.
          else if (onAir && (startMoves || endsAt.getTime() < boundary)) problems.push({ index, code: "block_locked", message: `${name} is on air. Change it after ${clock(orig.endsAt)}.` });
          else if (!onAir && startsAt.getTime() < boundary) problems.push({ index, code: "too_soon", message: tooSoon });
          sd.next = { startsAt, endsAt };
        }
        // Lengths, then overlaps with every other span after the batch.
        for (const sd of list) {
          if (!sd.next || problems.some((p) => p.index === sd.index)) continue;
          const ms = sd.next.endsAt.getTime() - sd.next.startsAt.getTime();
          if (ms <= 0) problems.push({ index: sd.index, code: "bad_request", message: "It has to end after it starts." });
          else if (ms > MAX_SPAN_MS) problems.push({ index: sd.index, code: "bad_request", message: "A block runs 24 hours at most." });
        }
        const placed = list.filter((sd) => sd.next);
        if (placed.length) {
          const lo = new Date(Math.min(...placed.map((sd) => sd.next!.startsAt.getTime())) - MAX_SPAN_MS);
          const hi = new Date(Math.max(...placed.map((sd) => sd.next!.endsAt.getTime())) + MAX_SPAN_MS);
          const others = (await h.spans(stationId, lo, hi)).filter((sp) => !spanDrafts.has(sp.id));
          const otherRefs = await services.library.blocks.refs(others.map((sp) => sp.blockId));
          const all = [...others.map((sp) => ({ id: sp.id, blockId: sp.blockId, startsAt: sp.startsAt, endsAt: sp.endsAt, draft: null as SpanDraft | null })), ...placed.map((sd) => ({ id: sd.orig?.id ?? `new:${sd.index}`, blockId: sd.blockId, ...sd.next!, draft: sd }))];
          const said = new Set<number>();
          for (const sd of placed) {
            if (said.has(sd.index) || problems.some((p) => p.index === sd.index)) continue;
            const other = all.find((x) => x.draft !== sd && overlaps(x, sd.next!));
            if (other) {
              said.add(sd.index);
              problems.push({ index: sd.index, code: "block_overlap", message: `Blocks can't overlap: ${otherRefs.get(other.blockId)?.name ?? refs.get(other.blockId)?.name ?? "another block"} is on until ${clock(other.endsAt)}.` });
            }
          }
        }
        for (const sd of list) times.push(...[sd.orig?.startsAt, sd.next?.startsAt].filter((d): d is Date => Boolean(d)).map((d) => d.getTime()));
        return { list, byIndex, times, lineOf: (index: number) => lines.get(index) ?? "" };
      }

      async function batchCarriage() {
        const keyOf = (r: Row) => (r.carriageAgreementId && r.assetId ? `${r.carriageAgreementId}:${r.assetId}` : null);
        const after = [
          ...[...drafts.values()].filter((d) => !d.removed).map((d) => ({ index: d.index, key: keyOf(d.next), had: keyOf(d.next) === keyOf(d.orig) })),
          ...inserts.map((i) => ({ index: i.index, key: keyOf(i.row), had: false }))
        ].filter((x): x is { index: number; key: string; had: boolean } => x.key !== null);
        const adding = after.filter((x) => !x.had);
        if (!adding.length) return;
        const agreements = await services.catalog.agreementsByIds([...new Set(adding.map((x) => x.key.split(":")[0]))]);
        for (const key of new Set(adding.map((x) => x.key))) {
          const [agreementId, itemId] = key.split(":");
          const limit = agreements.get(agreementId)?.airingsPerEpisode;
          if (!limit) continue;
          const onLog = await db
            .select({ id: E.id })
            .from(E)
            .where(and(eq(E.stationId, stationId), eq(E.carriageAgreementId, agreementId), eq(E.assetId, itemId)));
          let count = onLog.filter((r) => !drafts.has(r.id)).length;
          for (const x of after.filter((a) => a.key === key).sort((a, b) => a.index - b.index)) {
            count++;
            if (x.had || count <= limit || problems.some((p) => p.index === x.index)) continue;
            problems.push({ index: x.index, code: "airing_limit", message: `The agreement allows ${limit} ${limit === 1 ? "airing" : "airings"} of each episode.` });
          }
        }
      }
    },

    async history(stationId, limit) {
      const rows = await db.select().from(LC).where(eq(LC.stationId, stationId)).orderBy(desc(LC.createdAt)).limit(limit);
      const names = await services.accounts.displayNames([...new Set(rows.map((r) => r.userId).filter((v): v is string => Boolean(v)))]);
      return rows.map((r) => recordOf(r, names));
    }
  };

  /**
   * Spots held in breaks the batch took away: each moves to the next break from where it was (and
   * not sooner than the channel can change) with room for it. A station's spot goes to a break
   * spots air in; the maker's barter spot to its own program's next break. A break a spot moves
   * into is marked filled (the rotation doesn't fill it again). One that finds no room within 12
   * hours stays where it was and is returned if it doesn't air, as before.
   */
  async function moveHeld(stationId: string, breaks: Array<{ id: string; startsAt: Date }>, boundary: number): Promise<{ moved: number; kept: number; times: number[] }> {
    if (!breaks.length) return { moved: 0, kept: 0, times: [] };
    const from = new Date(Math.max(boundary, Math.min(...breaks.map((b) => b.startsAt.getTime()))));
    const slots = (await h.ensureBreaks(stationId, from, new Date(from.getTime() + 12 * HOUR))).filter((s) => s.id);
    const still = new Set(slots.map((s) => s.id));
    const leaving = breaks.filter((b) => !still.has(b.id));
    if (!leaving.length) return { moved: 0, kept: 0, times: [] };
    const [airings, inSlots, entries] = await Promise.all([
      services.spots.breakAirings(leaving.map((b) => b.id)),
      services.spots.breakAirings(slots.map((s) => s.id!)),
      slots.length ? db.select({ id: E.id, agreementId: E.carriageAgreementId }).from(E).where(inArray(E.id, [...new Set(slots.map((s) => s.logEntryId).filter((v): v is string => Boolean(v)))])) : Promise.resolve([])
    ]);
    const agreementOf = new Map(entries.map((e) => [e.id, e.agreementId]));
    // What each break already holds: the station's time and the maker's.
    const used = new Map(slots.map((s) => [s.id!, { station: 0, barter: 0 }]));
    for (const [id, list] of inSlots) {
      const u = used.get(id);
      if (!u) continue;
      for (const a of list) u[a.carriageAgreementId ? "barter" : "station"] += a.lengthSec * 1000;
    }
    let moved = 0;
    let kept = 0;
    const times: number[] = [];
    for (const b of leaving) {
      const list = airings.get(b.id) ?? [];
      let left = list.length;
      for (const a of list) {
        const ms = a.lengthSec * 1000;
        const after = Math.max(b.startsAt.getTime(), boundary);
        const target = slots.find((s) => {
          if (Date.parse(s.startsAt) < after) return false;
          const u = used.get(s.id!)!;
          if (a.carriageAgreementId) return s.logEntryId !== null && agreementOf.get(s.logEntryId) === a.carriageAgreementId && u.barter + ms <= s.producerShareMs;
          const parts = partsOf(s);
          const room = s.lengthMs - s.producerShareMs - (parts.stationId ? STATION_ID_MS : 0);
          return parts.spots && u.station + ms <= room;
        });
        if (!target) {
          kept++;
          continue;
        }
        const u = used.get(target.id!)!;
        const offset = u.station + u.barter;
        // Filled first, so the rotation never fills it again on top of what moves in.
        if (!target.filledAt) await db.update(B).set({ filledAt: deps.clock.now() }).where(eq(B.id, target.id!));
        await services.spots.moveAiring(a.airingId, target.id!, new Date(Date.parse(target.startsAt) + offset));
        target.filledAt = target.filledAt ?? deps.clock.now().toISOString();
        u[a.carriageAgreementId ? "barter" : "station"] += ms;
        times.push(Date.parse(target.startsAt));
        moved++;
        left--;
      }
      // Emptied: the break that went goes too.
      if (!left) await db.delete(B).where(eq(B.id, b.id));
    }
    return { moved, kept, times };
  }

  return ops;
}

function summaryOf(lines: string[]): string {
  const n = lines.length;
  const shown = lines.slice(0, 4);
  const more = n - shown.length;
  return `${n} ${n === 1 ? "change" : "changes"}: ${shown.join(", ")}${more ? `, and ${more} more` : ""}`;
}

function recordOf(r: typeof schema.logChanges.$inferSelect, names: Map<string, string | null>): LogChangeRecord {
  return {
    id: r.id,
    at: r.createdAt.toISOString(),
    by: { userId: r.userId, name: r.userId ? (names.get(r.userId) ?? null) : null },
    summary: r.summary,
    lines: r.lines,
    count: r.lines.length
  };
}

function problemOf(index: number, error: unknown): LogChangesResult["problems"][number] {
  if (error instanceof HttpError) return { index, code: error.code, message: error.message };
  throw error;
}

function inputOf(row: Row): Input {
  return {
    kind: row.kind,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    itemId: row.assetId ?? undefined,
    programId: row.programId ?? undefined,
    liveSourceId: row.liveSourceId ?? undefined,
    carriageAgreementId: row.carriageAgreementId ?? undefined
  };
}

/** An insert as a row, for titles and overlaps before it exists (its length settled by `validate`). */
function pseudoRow(stationId: string, input: Input, startsAt: Date): Row {
  const endsAt = input.endsAt ? snapDate(new Date(input.endsAt)) : new Date(startsAt.getTime() + 30 * MIN);
  return {
    id: `insert:${Math.random().toString(36).slice(2)}`,
    stationId,
    startsAt,
    endsAt,
    kind: input.kind,
    code: input.kind === "off_air" ? "OPEN" : "PGM",
    assetId: input.itemId ?? null,
    programId: input.programId ?? null,
    carriageAgreementId: input.carriageAgreementId ?? null,
    liveSourceId: input.liveSourceId ?? null,
    repeatGroupId: null,
    localNote: input.localNote ?? null,
    episodeTitle: input.episodeTitle ?? null,
    episodeDescription: input.episodeDescription ?? null,
    endedEarlyAt: null,
    templateDate: null,
    createdBy: null,
    createdAt: new Date(0)
  };
}
