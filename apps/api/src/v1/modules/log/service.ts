import { and, asc, desc, eq, gt, gte, inArray, lt, or, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { Airing, LogEntry } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import { badRequest, notFound, refused } from "../../errors.js";
import { addDays, localDay, localWeekday, roundUpToMinute } from "../../lib/time.js";
import type { ItemRef } from "../library/service.js";

type Row = typeof schema.logEntries.$inferSelect;

export interface AiringRef {
  id: string;
  stationId: string;
  title: string;
  startsAt: string;
  endsAt: string;
}

export interface BreakSlotView {
  id: string | null;
  startsAt: string;
  lengthMs: number;
  context: string;
  origin: "rule" | "cued_live" | "carried_barter";
  producerShareMs: number;
  filledMs: number;
  openMs: number;
  logEntryId: string | null;
}

export interface Gap {
  startsAt: string;
  endsAt: string;
}

export interface EntryInput {
  kind: "program" | "live" | "off_air";
  startsAt: string;
  endsAt?: string;
  itemId?: string;
  programId?: string;
  liveSourceId?: string;
  carriageAgreementId?: string;
  episodeTitle?: string;
  episodeDescription?: string;
  localNote?: string;
}

export interface LogService {
  airingsByIds(ids: string[]): Promise<Map<string, AiringRef>>;
  /** What's on now and next per station, for the dial. */
  nowNext(stationIds: string[], at: Date): Promise<Map<string, { now: Airing | null; next: Airing | null }>>;
  /** Every airing in a window per station, for the guide and station pages. */
  window(stationIds: string[], from: Date, to: Date): Promise<Map<string, Airing[]>>;
  upcomingForProgram(programId: string, limit: number): Promise<AiringRef[]>;
  itemUsage(itemId: string): Promise<{ upcoming: number }>;
  gaps(stationId: string, from: Date, to: Date): Promise<Gap[]>;
  /** Break slots in a window, generated from the break rule. Stored ones carry their id. */
  breaks(stationId: string, from: Date, to: Date): Promise<BreakSlotView[]>;
  /** Stores the generated breaks for a window (spots are placed into stored breaks). */
  ensureBreaks(stationId: string, from: Date, to: Date): Promise<BreakSlotView[]>;
  /** Entries within a window, for sign-on checks and playout. */
  entries(stationId: string, from: Date, to: Date): Promise<Row[]>;
  /** Takes an item off every log from now on (a rights claim). Returns what was pulled per station. */
  pullItem(itemId: string): Promise<Array<{ stationId: string; entries: number }>>;
  countCarried(input: { carrierStationId: string; agreementId: string; itemId: string; excludeEntryId?: string }): Promise<number>;
  /** When an item first aired (or airs) on a station's log. */
  firstAiring(stationId: string, itemId: string): Promise<Date | null>;
  /** Whether a station's log has the item on at a moment (live-only carriage). */
  airsAt(stationId: string, itemId: string, at: Date): Promise<boolean>;
  /** Puts carried slots on the carrier's log. */
  placeCarried(input: { agreementId: string; carrierStationId: string; programId: string; starts: Date[]; replaceExisting: boolean }): Promise<{ placed: number; replaced: number; blockedByLimit: number }>;

  log(stationId: string, from: Date, to: Date): Promise<{ from: string; to: string; entries: LogEntry[]; breaks: BreakSlotView[]; gaps: Gap[] }>;
  add(stationId: string, userId: string, input: EntryInput): Promise<LogEntry>;
  update(stationId: string, entryId: string, input: Partial<EntryInput>): Promise<LogEntry>;
  remove(stationId: string, entryId: string): Promise<void>;
  repeatDay(stationId: string, input: { day: string; pattern: "once" | "daily" | "weekly"; until: string; onto?: string }): Promise<{ created: number; skippedForConflicts: number }>;
  fill(stationId: string, userId: string, input: { with: "repeat"; startsAt: string; endsAt: string; itemIds: string[] } | { with: "sign_off"; startsAt: string; endsAt: string }): Promise<LogEntry[]>;
  deadAir(stationId: string): Promise<{ gaps: Gap[]; nextGapAt: string | null; logRunsUntil: string | null; warnings: Array<{ gapStartsAt: string; warnedAt: string; minutesBefore: 30 | 12 }> }>;
  /** The rolling dead-air check: warnings at 30 and 12 minutes before a gap. Run every minute by the scheduler. */
  checkDeadAir(stationIds: string[]): Promise<void>;
}

const E = schema.logEntries;
const B = schema.breaks;
const MIN = 60_000;
const HOUR = 60 * MIN;

export function createLogService({ deps, services }: ModuleContext): LogService {
  const { db } = deps;

  async function load(stationIds: string[], from: Date, to: Date) {
    if (!stationIds.length) return [] as Row[];
    return db
      .select()
      .from(E)
      .where(and(inArray(E.stationId, stationIds), lt(E.startsAt, to), gt(E.endsAt, from)))
      .orderBy(asc(E.startsAt));
  }

  async function context(rows: Row[]) {
    const [items, programs, agreements] = await Promise.all([
      services.library.itemsByIds(rows.map((r) => r.assetId).filter((v): v is string => Boolean(v))),
      services.library.programsByIds(rows.map((r) => r.programId).filter((v): v is string => Boolean(v))),
      services.catalog.agreementsByIds(rows.map((r) => r.carriageAgreementId).filter((v): v is string => Boolean(v)))
    ]);
    // A carried item's program is the maker's; look it up too.
    const extraPrograms = await services.library.programsByIds(
      [...items.values()].map((i) => i.programId).filter((v): v is string => Boolean(v) && !programs.has(v as string)) as string[]
    );
    for (const [id, p] of extraPrograms) programs.set(id, p);
    const makers = await services.stations.idents([...agreements.values()].map((a) => a.makerStationId));
    return { items, programs, agreements, makers };
  }

  function titleOf(row: Row, ctx: Awaited<ReturnType<typeof context>>): string {
    const item = row.assetId ? ctx.items.get(row.assetId) : undefined;
    const programId = row.programId ?? item?.programId ?? null;
    if (programId && ctx.programs.has(programId)) return ctx.programs.get(programId)!.title;
    if (item) return item.title;
    return row.kind === "off_air" ? "Off air" : row.kind === "live" ? "Live" : "Untitled";
  }

  function toAiring(row: Row, ctx: Awaited<ReturnType<typeof context>>): Airing {
    const item = row.assetId ? ctx.items.get(row.assetId) : undefined;
    const agreement = row.carriageAgreementId ? ctx.agreements.get(row.carriageAgreementId) : undefined;
    const programId = row.programId ?? item?.programId ?? null;
    const program = programId ? ctx.programs.get(programId) : undefined;
    return {
      logEntryId: row.id,
      title: titleOf(row, ctx),
      episodeTitle: row.episodeTitle ?? (program && item ? item.title : null),
      code: row.code,
      kind: row.kind,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      live: row.kind === "live",
      carriedFrom: agreement ? (ctx.makers.get(agreement.makerStationId) ?? null) : null,
      programId
    };
  }

  function toEntry(row: Row, ctx: Awaited<ReturnType<typeof context>>): LogEntry {
    const airing = toAiring(row, ctx);
    return {
      id: row.id,
      kind: row.kind,
      code: row.code,
      startsAt: airing.startsAt,
      endsAt: airing.endsAt,
      title: airing.title,
      episodeTitle: airing.episodeTitle,
      itemId: row.assetId,
      programId: airing.programId,
      liveSourceId: row.liveSourceId,
      carriedFrom: airing.carriedFrom,
      carriageAgreementId: row.carriageAgreementId,
      repeatGroupId: row.repeatGroupId,
      localNote: row.localNote
    };
  }

  function gapsIn(rows: Row[], from: Date, to: Date): Gap[] {
    const gaps: Gap[] = [];
    let cursor = from.getTime();
    for (const row of [...rows].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
      if (row.startsAt.getTime() > cursor) gaps.push({ startsAt: new Date(cursor).toISOString(), endsAt: row.startsAt.toISOString() });
      cursor = Math.max(cursor, row.endsAt.getTime());
    }
    if (cursor < to.getTime()) gaps.push({ startsAt: new Date(cursor).toISOString(), endsAt: to.toISOString() });
    return gaps.filter((g) => Date.parse(g.endsAt) > Date.parse(g.startsAt));
  }

  async function generateBreaks(stationId: string, from: Date, to: Date): Promise<Array<Omit<BreakSlotView, "id" | "filledMs" | "openMs">>> {
    const rule = await services.stations.breakRule(stationId);
    const rows = await load([stationId], new Date(from.getTime() - 6 * HOUR), to);
    const ctx = await context(rows);
    const slots: Array<Omit<BreakSlotView, "id" | "filledMs" | "openMs">> = [];
    for (const row of rows) {
      if (row.kind !== "program") continue; // Live programs cue their own; off-air has none.
      const item = row.assetId ? ctx.items.get(row.assetId) : undefined;
      const agreement = row.carriageAgreementId ? ctx.agreements.get(row.carriageAgreementId) : undefined;
      const title = titleOf(row, ctx);
      const episode = item?.episodeNumber ? `, ep. ${item.episodeNumber}` : "";
      const slotMs = row.endsAt.getTime() - row.startsAt.getTime();
      const itemMs = Math.min(item?.durationMs ?? slotMs, slotMs);
      const barterPerHour = agreement && (agreement.term === "barter" || agreement.term === "cash_plus_barter") ? (agreement.barterMakerMsPerHour ?? 0) : 0;

      // Inside the program, every N minutes (or at the maker's break points).
      if (rule.mode === "every_n_minutes" && rule.everyMinutes) {
        const points = item?.breakPointsMs?.length
          ? item.breakPointsMs
          : Array.from({ length: Math.floor(itemMs / (rule.everyMinutes * MIN)) }, (_, i) => (i + 1) * rule.everyMinutes! * MIN).filter((p) => p < itemMs);
        let shift = 0;
        for (const point of points) {
          const startsAt = new Date(row.startsAt.getTime() + point + shift);
          const perBreakShare = barterPerHour ? Math.min(rule.lengthMs, Math.round(barterPerHour / (60 / rule.everyMinutes))) : 0;
          slots.push({
            startsAt: startsAt.toISOString(),
            lengthMs: rule.lengthMs,
            context: `During ${title}${episode}`,
            origin: barterPerHour ? "carried_barter" : "rule",
            producerShareMs: perBreakShare,
            logEntryId: row.id
          });
          shift += rule.lengthMs;
        }
        const used = itemMs + shift;
        if (slotMs - used > 0) {
          slots.push({
            startsAt: new Date(row.startsAt.getTime() + used).toISOString(),
            lengthMs: slotMs - used,
            context: `After ${title}${episode}`,
            origin: "rule",
            producerShareMs: 0,
            logEntryId: row.id
          });
        }
        continue;
      }
      // After every program (and with no rule): the time between the item's end and the slot's end.
      const slack = slotMs - itemMs;
      if (slack > 0) {
        slots.push({
          startsAt: new Date(row.startsAt.getTime() + itemMs).toISOString(),
          lengthMs: slack,
          context: `After ${title}${episode}`,
          origin: barterPerHour ? "carried_barter" : "rule",
          producerShareMs: barterPerHour ? Math.min(slack, Math.round((barterPerHour * slotMs) / HOUR)) : 0,
          logEntryId: row.id
        });
      }
    }
    return slots.filter((s) => Date.parse(s.startsAt) >= from.getTime() && Date.parse(s.startsAt) < to.getTime());
  }

  async function withStored(stationId: string, generated: Awaited<ReturnType<typeof generateBreaks>>, from: Date, to: Date): Promise<BreakSlotView[]> {
    const stored = await db
      .select()
      .from(B)
      .where(and(eq(B.stationId, stationId), gte(B.startsAt, from), lt(B.startsAt, to)));
    const byTime = new Map(stored.map((b) => [b.startsAt.toISOString(), b]));
    const filled = await services.spots.filledMsByBreak(stored.map((b) => b.id));
    return generated.map((slot) => {
      const row = byTime.get(slot.startsAt);
      const filledMs = row ? (filled.get(row.id) ?? 0) : 0;
      return { ...slot, id: row?.id ?? null, filledMs, openMs: Math.max(0, slot.lengthMs - slot.producerShareMs - filledMs) };
    });
  }

  async function stationTz(stationId: string) {
    return services.stations.timezoneOf(stationId);
  }

  async function validate(stationId: string, input: EntryInput, excludeId?: string) {
    const startsAt = new Date(input.startsAt);
    let endsAt = input.endsAt ? new Date(input.endsAt) : null;
    let code: Row["code"] = "PGM";
    let programId = input.programId ?? null;

    if (input.kind === "program") {
      if (!input.itemId) throw badRequest("Choose what airs.", { itemId: "Required" });
      const item = (await services.library.itemsByIds([input.itemId])).get(input.itemId);
      if (!item || item.archived) throw notFound("That item");
      if (!item.rightsConfirmed) throw refused("rights_unconfirmed", "Confirm the rights to air it first.");
      if (item.stationId !== stationId) {
        if (!input.carriageAgreementId) throw refused("needs_agreement", "Another station's program needs a carriage agreement.");
        await services.catalog.checkAiring({ agreementId: input.carriageAgreementId, carrierStationId: stationId, itemId: item.id, startsAt, excludeEntryId: excludeId });
      }
      code = item.code;
      programId = programId ?? item.programId;
      endsAt = endsAt ?? new Date(startsAt.getTime() + roundUpToMinute(item.durationMs ?? 30 * MIN));
      if (item.durationMs && endsAt.getTime() - startsAt.getTime() < item.durationMs - 1000) {
        throw badRequest("The slot is shorter than the item.", { endsAt: "Too short" });
      }
    } else if (input.kind === "live") {
      if (!input.liveSourceId) throw badRequest("Choose a live source.", { liveSourceId: "Required" });
      if (!(await services.stations.liveSourceBelongs(stationId, input.liveSourceId))) throw notFound("That live source");
      if (!endsAt) throw badRequest("Say when the live block ends.", { endsAt: "Required" });
    } else {
      code = "OPEN";
      if (!endsAt) throw badRequest("Say when you're back on air.", { endsAt: "Required" });
    }
    if (endsAt <= startsAt) throw badRequest("It has to end after it starts.", { endsAt: "Before the start" });
    return { startsAt, endsAt, code, programId };
  }

  const service: LogService = {
    async airingsByIds(ids) {
      if (!ids.length) return new Map();
      const rows = await db.select().from(E).where(inArray(E.id, ids));
      const ctx = await context(rows);
      return new Map(
        rows.map((r) => [r.id, { id: r.id, stationId: r.stationId, title: titleOf(r, ctx), startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString() }])
      );
    },

    async nowNext(stationIds, at) {
      const rows = await load(stationIds, at, new Date(at.getTime() + 24 * HOUR));
      const ctx = await context(rows);
      const result = new Map<string, { now: Airing | null; next: Airing | null }>();
      for (const id of stationIds) {
        const mine = rows.filter((r) => r.stationId === id);
        const now = mine.find((r) => r.startsAt <= at && r.endsAt > at) ?? null;
        const next = mine.find((r) => r.startsAt > at) ?? null;
        result.set(id, { now: now ? toAiring(now, ctx) : null, next: next ? toAiring(next, ctx) : null });
      }
      return result;
    },

    async window(stationIds, from, to) {
      const rows = await load(stationIds, from, to);
      const ctx = await context(rows);
      const result = new Map<string, Airing[]>(stationIds.map((id) => [id, []]));
      for (const row of rows) result.get(row.stationId)!.push(toAiring(row, ctx));
      return result;
    },

    async upcomingForProgram(programId, limit) {
      const episodes = await services.library.episodes(programId);
      const itemIds = episodes.map((e) => e.id);
      const now = deps.clock.now();
      const rows = await db
        .select()
        .from(E)
        .where(and(gte(E.startsAt, now), or(eq(E.programId, programId), itemIds.length ? inArray(E.assetId, itemIds) : sql`false`)))
        .orderBy(asc(E.startsAt))
        .limit(limit);
      const ctx = await context(rows);
      return rows.map((r) => ({ id: r.id, stationId: r.stationId, title: titleOf(r, ctx), startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString() }));
    },

    async itemUsage(itemId) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(E)
        .where(and(eq(E.assetId, itemId), gt(E.endsAt, deps.clock.now())));
      return { upcoming: row.n };
    },

    async gaps(stationId, from, to) {
      return gapsIn(await load([stationId], from, to), from, to);
    },

    async breaks(stationId, from, to) {
      return withStored(stationId, await generateBreaks(stationId, from, to), from, to);
    },

    async ensureBreaks(stationId, from, to) {
      const generated = await generateBreaks(stationId, from, to);
      const stored = await db
        .select()
        .from(B)
        .where(and(eq(B.stationId, stationId), gte(B.startsAt, from), lt(B.startsAt, to)));
      const wanted = new Set(generated.map((g) => g.startsAt));
      const filled = await services.spots.filledMsByBreak(stored.map((b) => b.id));
      // Stale breaks with nothing placed in them go; ones with airings stay (those airings are paid for).
      const stale = stored.filter((b) => !wanted.has(b.startsAt.toISOString()) && !filled.get(b.id));
      if (stale.length) await db.delete(B).where(inArray(B.id, stale.map((b) => b.id)));
      const have = new Set(stored.map((b) => b.startsAt.toISOString()));
      const missing = generated.filter((g) => !have.has(g.startsAt));
      if (missing.length) {
        await db.insert(B).values(
          missing.map((g) => ({
            stationId,
            startsAt: new Date(g.startsAt),
            lengthMs: g.lengthMs,
            logEntryId: g.logEntryId,
            origin: g.origin,
            producerShareMs: g.producerShareMs
          }))
        );
      }
      return withStored(stationId, generated, from, to);
    },

    async entries(stationId, from, to) {
      return load([stationId], from, to);
    },

    async pullItem(itemId) {
      const now = deps.clock.now();
      const pulled = await db
        .delete(E)
        .where(and(eq(E.assetId, itemId), gt(E.startsAt, now)))
        .returning({ stationId: E.stationId });
      const counts = new Map<string, number>();
      for (const p of pulled) counts.set(p.stationId, (counts.get(p.stationId) ?? 0) + 1);
      return [...counts].map(([stationId, entries]) => ({ stationId, entries }));
    },

    async countCarried({ carrierStationId, agreementId, itemId, excludeEntryId }) {
      const rows = await db
        .select({ id: E.id })
        .from(E)
        .where(and(eq(E.stationId, carrierStationId), eq(E.carriageAgreementId, agreementId), eq(E.assetId, itemId)));
      return rows.filter((r) => r.id !== excludeEntryId).length;
    },

    async firstAiring(stationId, itemId) {
      const [row] = await db
        .select({ startsAt: E.startsAt })
        .from(E)
        .where(and(eq(E.stationId, stationId), eq(E.assetId, itemId)))
        .orderBy(asc(E.startsAt))
        .limit(1);
      return row?.startsAt ?? null;
    },

    async airsAt(stationId, itemId, at) {
      const [row] = await db
        .select({ id: E.id })
        .from(E)
        .where(and(eq(E.stationId, stationId), eq(E.assetId, itemId), sql`${E.startsAt} <= ${at}`, gt(E.endsAt, at)))
        .limit(1);
      return Boolean(row);
    },

    async placeCarried({ agreementId, carrierStationId, programId, starts, replaceExisting }) {
      const episodes = (await services.library.episodes(programId)).filter((e) => e.rightsConfirmed && !e.archived);
      if (!episodes.length) throw refused("no_episodes", "The program has no episodes ready to carry yet.");
      // Next unaired, in order.
      const aired = await db
        .select({ assetId: E.assetId })
        .from(E)
        .where(and(eq(E.stationId, carrierStationId), eq(E.carriageAgreementId, agreementId)));
      const airedSet = new Set(aired.map((a) => a.assetId));
      let index = Math.max(0, episodes.findIndex((e) => !airedSet.has(e.id)));
      let placed = 0;
      let replaced = 0;
      let blockedByLimit = 0;
      for (const start of starts) {
        const episode = episodes[index % episodes.length];
        // Carried slots run to the next half hour, which leaves the break time barter splits.
        const endsAt = new Date(start.getTime() + Math.ceil((episode.durationMs ?? 30 * MIN) / (30 * MIN)) * 30 * MIN);
        try {
          await services.catalog.checkAiring({ agreementId, carrierStationId, itemId: episode.id, startsAt: start });
        } catch {
          blockedByLimit++;
          continue;
        }
        await db.transaction(async (tx) => {
          if (replaceExisting) {
            const removed = await tx
              .delete(E)
              .where(and(eq(E.stationId, carrierStationId), lt(E.startsAt, endsAt), gt(E.endsAt, start)))
              .returning({ id: E.id });
            replaced += removed.length;
          }
          await tx.insert(E).values({
            stationId: carrierStationId,
            startsAt: start,
            endsAt,
            kind: "program",
            code: "PGM",
            assetId: episode.id,
            programId,
            carriageAgreementId: agreementId
          });
        }).then(
          () => {
            placed++;
            index++;
          },
          () => {
            blockedByLimit++;
          }
        );
      }
      return { placed, replaced, blockedByLimit };
    },

    async log(stationId, from, to) {
      if (to.getTime() - from.getTime() > 8 * 24 * HOUR) throw badRequest("Ask for a week at most.");
      const rows = await load([stationId], from, to);
      const ctx = await context(rows);
      return {
        from: from.toISOString(),
        to: to.toISOString(),
        entries: rows.map((r) => toEntry(r, ctx)),
        breaks: await service.breaks(stationId, from, to),
        gaps: gapsIn(rows, from, to)
      };
    },

    async add(stationId, userId, input) {
      const checked = await validate(stationId, input);
      const [row] = await db
        .insert(E)
        .values({
          stationId,
          startsAt: checked.startsAt,
          endsAt: checked.endsAt,
          kind: input.kind,
          code: checked.code,
          assetId: input.itemId ?? null,
          programId: checked.programId,
          liveSourceId: input.liveSourceId ?? null,
          carriageAgreementId: input.carriageAgreementId ?? null,
          episodeTitle: input.episodeTitle ?? null,
          episodeDescription: input.episodeDescription ?? null,
          localNote: input.localNote ?? null,
          createdBy: userId
        })
        .returning();
      return toEntry(row, await context([row]));
    },

    async update(stationId, entryId, input) {
      const [current] = await db.select().from(E).where(and(eq(E.id, entryId), eq(E.stationId, stationId)));
      if (!current) throw notFound("That log entry");
      const merged: EntryInput = {
        kind: input.kind ?? current.kind,
        startsAt: input.startsAt ?? current.startsAt.toISOString(),
        endsAt: input.endsAt ?? (input.startsAt || input.itemId ? undefined : current.endsAt.toISOString()),
        itemId: input.itemId ?? current.assetId ?? undefined,
        programId: input.programId ?? current.programId ?? undefined,
        liveSourceId: input.liveSourceId ?? current.liveSourceId ?? undefined,
        carriageAgreementId: input.carriageAgreementId ?? current.carriageAgreementId ?? undefined
      };
      if (input.startsAt && !input.endsAt) {
        merged.endsAt = new Date(Date.parse(input.startsAt) + (current.endsAt.getTime() - current.startsAt.getTime())).toISOString();
      }
      const checked = await validate(stationId, merged, entryId);
      const [row] = await db
        .update(E)
        .set({
          startsAt: checked.startsAt,
          endsAt: checked.endsAt,
          kind: merged.kind,
          code: checked.code,
          assetId: merged.itemId ?? null,
          programId: checked.programId,
          liveSourceId: merged.liveSourceId ?? null,
          carriageAgreementId: merged.carriageAgreementId ?? null,
          ...(input.episodeTitle !== undefined ? { episodeTitle: input.episodeTitle } : {}),
          ...(input.episodeDescription !== undefined ? { episodeDescription: input.episodeDescription } : {}),
          ...(input.localNote !== undefined ? { localNote: input.localNote } : {})
        })
        .where(eq(E.id, entryId))
        .returning();
      return toEntry(row, await context([row]));
    },

    async remove(stationId, entryId) {
      const removed = await db.delete(E).where(and(eq(E.id, entryId), eq(E.stationId, stationId))).returning({ id: E.id });
      if (!removed.length) throw notFound("That log entry");
    },

    async repeatDay(stationId, input) {
      const tz = await stationTz(stationId);
      const { from, to } = localDay(input.day, tz);
      const source = await load([stationId], from, to);
      const days: string[] = [];
      if (input.pattern === "once") {
        if (!input.onto) throw badRequest("Choose the day to copy to.", { onto: "Required" });
        days.push(input.onto);
      } else {
        const weekday = localWeekday(from, tz);
        for (let d = addDays(input.day, 1); d <= input.until; d = addDays(d, 1)) {
          if (input.pattern === "daily" || localWeekday(localDay(d, tz).from, tz) === weekday) days.push(d);
        }
      }
      if (days.length > 120) throw badRequest("Repeat for at most 120 days at a time.");
      const [group] = await db
        .insert(schema.repeatGroups)
        .values({
          stationId,
          pattern: input.pattern,
          weekday: input.pattern === "weekly" ? localWeekday(from, tz) : null,
          startTime: "00:00",
          startsOn: input.day,
          endsOn: input.pattern === "once" ? input.onto! : input.until
        })
        .returning();
      let created = 0;
      let skippedForConflicts = 0;
      for (const day of days) {
        const target = localDay(day, tz).from;
        for (const row of source) {
          const offset = row.startsAt.getTime() - from.getTime();
          const startsAt = new Date(target.getTime() + offset);
          const endsAt = new Date(startsAt.getTime() + (row.endsAt.getTime() - row.startsAt.getTime()));
          try {
            await db.insert(E).values({
              stationId,
              startsAt,
              endsAt,
              kind: row.kind,
              code: row.code,
              assetId: row.assetId,
              programId: row.programId,
              liveSourceId: row.liveSourceId,
              carriageAgreementId: row.carriageAgreementId,
              repeatGroupId: group.id,
              localNote: row.localNote
            });
            created++;
          } catch {
            // Overlaps something already there, or breaks a carriage limit: leave the existing log alone.
            skippedForConflicts++;
          }
        }
      }
      return { created, skippedForConflicts };
    },

    async fill(stationId, userId, input) {
      const startsAt = new Date(input.startsAt);
      const endsAt = new Date(input.endsAt);
      if (endsAt <= startsAt) throw badRequest("It has to end after it starts.");
      if (input.with === "sign_off") {
        return [await service.add(stationId, userId, { kind: "off_air", startsAt: input.startsAt, endsAt: input.endsAt })];
      }
      const items = await services.library.itemsByIds(input.itemIds);
      const ordered = input.itemIds.map((id) => items.get(id)).filter((i): i is ItemRef => Boolean(i?.durationMs && i.rightsConfirmed));
      if (!ordered.length) throw refused("nothing_to_repeat", "Choose items with confirmed rights to repeat.");
      const added: LogEntry[] = [];
      let cursor = startsAt.getTime();
      for (let i = 0; ; i++) {
        const item = ordered[i % ordered.length];
        const length = roundUpToMinute(item.durationMs!);
        if (cursor + length > endsAt.getTime()) break;
        added.push(
          await service.add(stationId, userId, {
            kind: "program",
            startsAt: new Date(cursor).toISOString(),
            endsAt: new Date(cursor + length).toISOString(),
            itemId: item.id
          })
        );
        cursor += length;
        if (i > 500) break;
      }
      return added;
    },

    async deadAir(stationId) {
      const now = deps.clock.now();
      const until = new Date(now.getTime() + 24 * HOUR);
      const rows = await load([stationId], now, until);
      const gaps = gapsIn(rows, now, until);
      const [last] = await db.select({ endsAt: E.endsAt }).from(E).where(eq(E.stationId, stationId)).orderBy(desc(E.endsAt)).limit(1);
      const events = await db
        .select()
        .from(schema.deadAirEvents)
        .where(and(eq(schema.deadAirEvents.stationId, stationId), gte(schema.deadAirEvents.gapStartsAt, new Date(now.getTime() - HOUR))));
      const warnings = events.flatMap((e) => [
        ...(e.warned30At ? [{ gapStartsAt: e.gapStartsAt.toISOString(), warnedAt: e.warned30At.toISOString(), minutesBefore: 30 as const }] : []),
        ...(e.warned12At ? [{ gapStartsAt: e.gapStartsAt.toISOString(), warnedAt: e.warned12At.toISOString(), minutesBefore: 12 as const }] : [])
      ]);
      return {
        gaps,
        nextGapAt: gaps[0]?.startsAt ?? null,
        logRunsUntil: last && last.endsAt > now ? last.endsAt.toISOString() : null,
        warnings
      };
    },

    async checkDeadAir(stationIds) {
      const now = deps.clock.now();
      for (const stationId of stationIds) {
        const gaps = gapsIn(await load([stationId], now, new Date(now.getTime() + 31 * MIN)), now, new Date(now.getTime() + 31 * MIN));
        for (const gap of gaps) {
          const gapStart = new Date(gap.startsAt);
          const minutesAway = (gapStart.getTime() - now.getTime()) / MIN;
          if (minutesAway <= 0) continue;
          let [event] = await db
            .select()
            .from(schema.deadAirEvents)
            .where(and(eq(schema.deadAirEvents.stationId, stationId), eq(schema.deadAirEvents.gapStartsAt, gapStart)));
          if (!event) {
            [event] = await db
              .insert(schema.deadAirEvents)
              .values({ stationId, gapStartsAt: gapStart, gapEndsAt: new Date(gap.endsAt) })
              .returning();
          }
          if (minutesAway <= 30 && !event.warned30At) {
            await db.update(schema.deadAirEvents).set({ warned30At: now }).where(eq(schema.deadAirEvents.id, event.id));
            deps.bus.emit("station.dead_air_warning", { stationId, gapStartsAt: gap.startsAt, minutesBefore: 30 });
          }
          if (minutesAway <= 12 && !event.warned12At) {
            await db.update(schema.deadAirEvents).set({ warned12At: now }).where(eq(schema.deadAirEvents.id, event.id));
            deps.bus.emit("station.dead_air_warning", { stationId, gapStartsAt: gap.startsAt, minutesBefore: 12 });
          }
        }
      }
    }
  };
  return service;
}

