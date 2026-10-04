// A246 (decision 7, opencast-schedule 06): a day template's rundown, edited with the Log's own rows,
// drawer and handles. The template keeps wall-clock times ("21:00"); here they're placed on one
// date it makes (its next), so the rundown, the moves (reorder.ts) and the block handles work on
// instants as the day does, and go back to wall-clock times to save. Templates have no breaks, no
// dead air and no dry run: what the changes do is worked out here, in the tray's words, and checked
// for overlaps (and a block ending by 6:00 am) before `updateTemplate` replaces the entries and
// blocks in one go.

import type { BreakSlot, DayTemplate, DayTemplateEntryInput, LogChange, StationIdent } from "@opencast/contracts";
import { clock } from "@opencast/ui";
import { STATION_TZ } from "../../../lib/clock";
import { isMember } from "./blockHandles";
import { isBlockChange, type DraftEntry, type DraftSpan } from "./logEdit";
import { localParts, localTime } from "./time";

const MIN = 60_000;
const t = (s: string) => Date.parse(s);
const iso = (n: number) => new Date(n).toISOString();
const pad = (n: number) => String(n).padStart(2, "0");

/** The words for a block that would run past 6:00 am in a template (the API's, `BLOCK_CROSSES_DAY`). */
export const BLOCK_CROSSES_DAY = "A block in a day template ends by 6:00 am, when the next broadcast day starts. Make it two blocks, or place it on the date.";

/** "21:00" on a broadcast date: before 6:00 am is the calendar day after. */
export function placeOn(startTime: string, date: string, tz = STATION_TZ): string {
  const [h, m] = startTime.split(":").map(Number);
  const [year, month, day] = date.split("-").map(Number);
  return localTime({ year, month, day }, h < 6 ? h + 24 : h, m, tz);
}

/** Where a broadcast date ends: 6:00 am the calendar day after (a template's blocks end by then). */
export function dayEndOf(date: string, tz = STATION_TZ): string {
  return iso(t(placeOn("05:59", date, tz)) + MIN);
}

/** An instant as a template's wall-clock time, to the nearest minute ("21:00"). */
export function wallClockOf(at: string, tz = STATION_TZ): string {
  const p = localParts(Math.round(t(at) / MIN) * MIN, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** A template's entries as the rundown's, on `date`. A carried one's maker comes from the day's log (`carriedFrom`, by agreement). */
export function templateEntries(tpl: Pick<DayTemplate, "entries">, date: string, carriedFrom: (agreementId: string) => StationIdent | null = () => null): DraftEntry[] {
  return tpl.entries
    .map((e): DraftEntry => {
      const startsAt = placeOn(e.startTime, date);
      return {
        id: e.id,
        kind: e.kind,
        code: e.code,
        startsAt,
        endsAt: iso(t(startsAt) + e.lengthMs),
        title: e.kind === "off_air" ? "Off air" : e.title,
        episodeTitle: e.episodeTitle,
        itemId: e.itemId,
        programId: e.programId,
        liveSourceId: e.liveSourceId,
        carriedFrom: e.carriageAgreementId ? carriedFrom(e.carriageAgreementId) : null,
        carriageAgreementId: e.carriageAgreementId,
        repeatGroupId: null,
        localNote: e.localNote,
        ...(e.keepTime ? { keepTime: true } : {})
      };
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** A template's blocks as spans on `date`. */
export function templateSpans(tpl: Pick<DayTemplate, "blocks">, date: string): DraftSpan[] {
  return (tpl.blocks ?? []).map((b) => {
    const startsAt = placeOn(b.startTime, date);
    return { id: b.id, blockId: b.blockId, name: b.name, colour: b.colour ?? null, startsAt, endsAt: iso(t(startsAt) + b.lengthMs) };
  });
}

/**
 * Where the row after each entry can start in a template: the next whole minute (a template keeps
 * whole minutes, and the time a program leaves before it is where its break goes). Given to the
 * moves as their breaks, so a dropped row lands on a minute.
 */
export function minuteBreaks(entries: Array<Pick<DraftEntry, "endsAt">>): BreakSlot[] {
  return entries.flatMap((e) => {
    const end = t(e.endsAt);
    const next = Math.ceil(end / MIN) * MIN;
    return next > end ? [{ id: null, startsAt: e.endsAt, lengthMs: next - end, context: "", origin: "rule", producerShareMs: 0, filledMs: 0, openMs: 0 } as BreakSlot] : [];
  });
}

/** The draft's entries as `updateTemplate.entries`, keeping what each had (its episode, note). */
export function entriesInput(entries: DraftEntry[], tpl: Pick<DayTemplate, "entries">): DayTemplateEntryInput[] {
  return [...entries]
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .map((e) => {
      const was = tpl.entries.find((x) => x.id === e.id);
      const startTime = wallClockOf(e.startsAt);
      const lengthMs = Math.max(MIN, t(e.endsAt) - t(e.startsAt));
      return {
        startTime,
        lengthMs,
        kind: e.kind,
        ...(e.itemId ? { itemId: e.itemId } : {}),
        ...(e.programId ? { programId: e.programId } : {}),
        ...(e.liveSourceId ? { liveSourceId: e.liveSourceId } : {}),
        ...(e.carriageAgreementId ? { carriageAgreementId: e.carriageAgreementId } : {}),
        ...((was?.episodeTitle ?? e.episodeTitle) ? { episodeTitle: (was?.episodeTitle ?? e.episodeTitle)! } : {}),
        ...(was?.episodeDescription ? { episodeDescription: was.episodeDescription } : {}),
        ...((was?.localNote ?? e.localNote) ? { localNote: (was?.localNote ?? e.localNote)! } : {}),
        ...(e.keepTime ? { keepTime: true } : {})
      };
    });
}

/** The draft's spans as `updateTemplate.blocks`. */
export function blocksInput(spans: DraftSpan[]): Array<{ blockId: string; startTime: string; lengthMs: number }> {
  return spans.map((s) => ({ blockId: s.blockId, startTime: wallClockOf(s.startsAt), lengthMs: Math.round((t(s.endsAt) - t(s.startsAt)) / MIN) * MIN }));
}

export interface TemplateCheck {
  lines: Array<{ index: number; line: string }>;
  problems: Array<{ index: number | null; message: string }>;
}

/**
 * The template's own check (it has no dry run): each change in the tray's words, as the API says
 * a day's ("Late Crate, ep. 15 moves to 10:10 pm"; a block's with who joins or leaves it), and what
 * blocks saving: two entries overlapping, two blocks overlapping, a block past 6:00 am.
 */
export function checkTemplate(o: { changes: LogChange[]; before: DraftEntry[]; after: DraftEntry[]; spansBefore: DraftSpan[]; spansAfter: DraftSpan[]; dayEnd: string }, tz = STATION_TZ): TemplateCheck {
  const at = (s: string) => clock(s, { timeZone: tz });
  const titleOf = (id: string) => o.after.find((e) => e.id === id)?.title ?? o.before.find((e) => e.id === id)?.title ?? "A program";
  const lines: TemplateCheck["lines"] = [];
  const problems: TemplateCheck["problems"] = [];
  const names = (list: DraftEntry[]) => {
    const titles = list.map((e) => e.title);
    return titles.length > 1 ? `${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}` : titles[0];
  };
  o.changes.forEach((c, index) => {
    if (isBlockChange(c)) {
      if (c.op === "block_add") {
        const span = o.spansAfter.find((s) => s.key === c.key);
        lines.push({ index, line: `${span?.name ?? "A block"} added, ${at(c.startsAt)} to ${at(c.endsAt)}` });
        return;
      }
      const was = o.spansBefore.find((s) => s.id === c.spanId);
      const now = o.spansAfter.find((s) => s.id === c.spanId);
      const name = was?.name ?? now?.name ?? "The block";
      if (c.op === "block_remove" || !now || !was) return lines.push({ index, line: `${name} comes off the template` });
      const starts = now.startsAt !== was.startsAt;
      const ends = now.endsAt !== was.endsAt;
      const head = starts && ends ? `${name} now runs ${at(now.startsAt)} to ${at(now.endsAt)}` : starts ? `${name} now starts at ${at(now.startsAt)}, was ${at(was.startsAt)}` : `${name} now ends at ${at(now.endsAt)}, was ${at(was.endsAt)}`;
      const before = o.before.filter((e) => isMember(was, e));
      const after = o.after.filter((e) => isMember(now, e));
      const joins = after.filter((e) => !before.some((b) => b.id === e.id));
      const leaves = before.filter((e) => !after.some((a) => a.id === e.id));
      const words = [joins.length ? `${names(joins)} ${joins.length === 1 ? "joins" : "join"} it` : null, leaves.length ? `${names(leaves)} ${leaves.length === 1 ? "is" : "are"} no longer part of it` : null].filter(Boolean);
      return lines.push({ index, line: [head, ...words].join(". ") });
    }
    if (c.op === "insert") {
      const e = o.after.find((x) => x.key === c.key);
      return lines.push({ index, line: `${e?.title ?? "A program"} goes on at ${at(e?.startsAt ?? c.entry.startsAt)}` });
    }
    const title = titleOf(c.entryId);
    const e = o.after.find((x) => x.id === c.entryId);
    if (c.op === "move") return lines.push({ index, line: `${title} moves to ${at(c.startsAt)}` });
    if (c.op === "resize") return lines.push({ index, line: `${title} now ends at ${at(c.endsAt)}` });
    if (c.op === "keep") return lines.push({ index, line: c.keep ? `${title} keeps its time` : `${title} no longer keeps its time` });
    if (c.op === "replace") return lines.push({ index, line: `${e?.title ?? "Something else"} replaces ${o.before.find((x) => x.id === c.entryId)?.title ?? title}` });
    return lines.push({ index, line: `${title} comes off the template` });
  });

  // What blocks saving.
  const indexOf = (id: string) => {
    for (let i = o.changes.length - 1; i >= 0; i--) {
      const c = o.changes[i];
      if (isBlockChange(c)) continue;
      if ((c.op === "insert" ? `new:${c.key}` : c.entryId) === id) return i;
    }
    return null;
  };
  const sorted = [...o.after].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  for (let i = 1; i < sorted.length; i++) {
    const [a, b] = [sorted[i - 1], sorted[i]];
    if (b.startsAt < a.endsAt) problems.push({ index: indexOf(b.id) ?? indexOf(a.id), message: `${b.title} would overlap ${a.title} at ${at(b.startsAt)}.` });
  }
  const spans = [...o.spansAfter].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const spanIndex = (s: DraftSpan) => {
    const i = o.changes.findIndex((c) => isBlockChange(c) && (c.op === "block_add" ? c.key === s.key : c.spanId === s.id));
    return i < 0 ? null : i;
  };
  for (let i = 0; i < spans.length; i++) {
    if (spans[i].endsAt > o.dayEnd) problems.push({ index: spanIndex(spans[i]), message: BLOCK_CROSSES_DAY });
    if (i && spans[i].startsAt < spans[i - 1].endsAt) problems.push({ index: spanIndex(spans[i]), message: `Blocks can't overlap: ${spans[i - 1].name} is on until ${at(spans[i - 1].endsAt)}.` });
  }
  return { lines, problems };
}
