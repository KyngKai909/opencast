// A241 (2026-10-01): a schedule entered by hand, as the List a source / Change form edits it. The
// rules are the API's (the contracts' `manualScheduleProblems`): days, 5-minute times, a title,
// no two slots on at once; and where it was checked, with the day. Pure, so it's tested alone.

import { manualScheduleProblems, sortedSlots, slotText, WEEKDAYS, type ListedSource, type ManualScheduleInput, type Weekday } from "@opencast/contracts";

export interface SlotDraft {
  /** A key for the row (React's), never sent. */
  key: string;
  days: Weekday[];
  start: string;
  end: string;
  title: string;
  description: string;
  /** A season set before (through the API): kept as it was, not edited here. */
  from: string | null;
  until: string | null;
}

export interface ManualDraft {
  slots: SlotDraft[];
  checkedAgainst: string;
  checkedOn: string;
  skipDates: string[];
}

let next = 0;
const key = () => `slot-${++next}`;

/** A new, empty row: 6:00 to 7:00 pm (the commonest meeting time), no days or title yet. */
export function emptySlot(): SlotDraft {
  return { key: key(), days: [], start: "18:00", end: "19:00", title: "", description: "", from: null, until: null };
}

/** The editor's draft for a listing (its schedule entered by hand, if it has one), or a fresh one. */
export function manualDraftOf(s?: ListedSource, checkedAgainst = ""): ManualDraft {
  const sc = s?.schedule;
  if (sc?.source !== "manual") return { slots: [emptySlot()], checkedAgainst, checkedOn: "", skipDates: [] };
  return {
    slots: (sc.slots ?? []).map((x) => ({ key: key(), days: [...x.days], start: x.start, end: x.end, title: x.title, description: x.description ?? "", from: x.from ?? null, until: x.until ?? null })),
    checkedAgainst: sc.checkedAgainst ?? "",
    checkedOn: sc.checkedOn ?? "",
    skipDates: [...(sc.skipDates ?? [])]
  };
}

/** What the API takes (`schedule: { source: "manual", … }`). */
export function manualInput(d: ManualDraft): ManualScheduleInput {
  return {
    source: "manual",
    slots: d.slots.map((x) => ({
      days: WEEKDAYS.filter((day) => x.days.includes(day)),
      start: x.start,
      end: x.end,
      title: x.title.trim(),
      description: x.description.trim() || null,
      ...(x.from ? { from: x.from } : {}),
      ...(x.until ? { until: x.until } : {})
    })),
    checkedAgainst: d.checkedAgainst.trim(),
    checkedOn: d.checkedOn.trim(),
    skipDates: [...d.skipDates].sort()
  };
}

const isLink = (s: string) => /^https?:\/\/\S+\.\S+/i.test(s.trim());
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s.trim());

/**
 * What's wrong with the draft, by field (`slots.1.title`, `checkedAgainst`), in the API's words.
 * Empty when it can be saved.
 */
export function manualProblems(d: ManualDraft): Record<string, string> {
  const errs: Record<string, string> = {};
  for (const p of manualScheduleProblems(d.slots)) {
    const k = p.slot === null ? "slots" : `slots.${p.slot}.${p.field}`;
    errs[k] ??= p.message;
  }
  if (!isLink(d.checkedAgainst)) errs.checkedAgainst = "Paste the link to their published schedule.";
  if (!isDate(d.checkedOn)) errs.checkedOn = "The day you checked it.";
  return errs;
}

/** Whether the draft differs from the listing's schedule entered by hand (what Change sends). */
export function manualChanged(d: ManualDraft, s: ListedSource): boolean {
  const was = manualDraftOf(s);
  if (s.schedule?.source !== "manual") return true;
  const line = (x: ManualDraft) => JSON.stringify([manualInput(x).slots, x.checkedAgainst.trim(), x.checkedOn.trim(), [...x.skipDates].sort()]);
  return line(d) !== line(was);
}

/** The week, one slot a line, for a listing's details: "Mon–Fri 6:00–9:00 pm: City Council". */
export function weekLines(s: ListedSource): Array<{ text: string; description: string | null }> {
  const sc = s.schedule;
  if (sc?.source !== "manual") return [];
  return sortedSlots(sc.slots ?? []).map((x) => ({ text: slotText(x), description: x.description ?? null }));
}
