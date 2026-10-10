// Programming Phase 3: what airs from a day template's program slot, in master control's words.
// This episode (the item, every date, as before), Next episode (the next episode of its program, or
// of a mix, in an order, one step each date it airs), Fill the slot (as many next episodes as fit),
// Same as earlier slot (a same-day rerun of what an earlier slot aired). The template editor keeps
// each entry's setting beside the rundown's changes (a slot isn't a log change), sends it with the
// entry's slot id when it saves, and shows the API's preview line under it ("Next 4 Saturdays: ep.
// 13, 14, 15, 16"). On the log, an entry a Next episode or Fill the slot slot made has a small "Next
// episode" mark, and its details say which slot and template.

import { PLAYBACK_ORDER_WORDS, WHAT_AIRS_WORDS, type AtProgramEnd, type DayTemplate, type DayTemplateEntry, type DayTemplateEntryInput, type LogEntry, type PlaybackOrder, type WhatAirs } from "@opencast/contracts";

export type { AtProgramEnd, PlaybackOrder, WhatAirs };

/** A slot's What airs, as the editor keeps it. */
export interface SlotSetting {
  whatAirs: WhatAirs;
  /** The programs it walks (Next episode, Fill the slot): one, or a mix. */
  programIds: string[];
  order: PlaybackOrder;
  atEnd: AtProgramEnd;
  /** Same as earlier slot: the slot it repeats. */
  sameAsSlotId: string | null;
}

/** The four, in the control's order. */
export const WHAT_AIRS_OPTIONS: Array<{ value: WhatAirs; label: string }> = (["this_episode", "next_episode", "fill", "same_as"] as const).map((value) => ({ value, label: WHAT_AIRS_WORDS[value].label }));

export const AT_END_OPTIONS: Array<{ value: AtProgramEnd; label: string }> = [
  { value: "start_over", label: "Start over" },
  { value: "stop", label: "Stop" }
];

/** The orders a slot can take: Marathon only for a mix (for one program it's In order; the user's decision on Phase 2). */
export function orderOptions(programs: number): Array<{ value: PlaybackOrder; label: string; meaning: string }> {
  return (["in_order", "newest_first", "shuffle", "shuffle_shows", "marathon"] as const)
    .filter((o) => programs > 1 || (o !== "marathon" && o !== "shuffle_shows"))
    .map((value) => ({ value, ...PLAYBACK_ORDER_WORDS[value] }));
}

/** A template entry's setting as saved (This episode when it says nothing). */
export function settingOf(e: Pick<DayTemplateEntry, "whatAirs" | "programIds" | "order" | "atEnd" | "sameAsSlotId" | "programId">): SlotSetting {
  return {
    whatAirs: e.whatAirs ?? "this_episode",
    programIds: e.programIds?.length ? e.programIds : e.programId ? [e.programId] : [],
    order: e.order ?? "in_order",
    atEnd: e.atEnd ?? "start_over",
    sameAsSlotId: e.sameAsSlotId ?? null
  };
}

/** Whether two settings air the same way (what the editor counts as a change). */
export function sameSetting(a: SlotSetting, b: SlotSetting): boolean {
  if (a.whatAirs !== b.whatAirs) return false;
  if (a.whatAirs === "this_episode") return true;
  if (a.whatAirs === "same_as") return a.sameAsSlotId === b.sameAsSlotId;
  return a.order === b.order && a.atEnd === b.atEnd && a.programIds.join() === b.programIds.join();
}

/** A setting changed to another kind: what it needs, filled in (the entry's program; In order; start over). */
export function withWhatAirs(s: SlotSetting, whatAirs: WhatAirs, programId: string | null): SlotSetting {
  const programIds = s.programIds.length ? s.programIds : programId ? [programId] : [];
  const order = s.order === "marathon" && programIds.length < 2 ? "in_order" : s.order;
  return { ...s, whatAirs, programIds, order };
}

/** The setting as `updateTemplate` (and `previewTemplateSlot`) take it, on an entry's input. */
export function settingInput(s: SlotSetting, slotId: string | null | undefined): Partial<DayTemplateEntryInput> {
  const id = slotId ? { slotId } : {};
  if (s.whatAirs === "this_episode") return id;
  if (s.whatAirs === "same_as") return { ...id, whatAirs: "same_as", ...(s.sameAsSlotId ? { sameAsSlotId: s.sameAsSlotId } : {}) };
  return { ...id, whatAirs: s.whatAirs, programIds: s.programIds, order: s.order, atEnd: s.atEnd };
}

/** What the setting misses before it can be saved: a program to walk, a slot to repeat. */
export function settingProblem(s: SlotSetting): string | null {
  if ((s.whatAirs === "next_episode" || s.whatAirs === "fill") && !s.programIds.length) return "Choose the program it airs the next episode of.";
  if (s.whatAirs === "same_as" && !s.sameAsSlotId) return "Choose the earlier slot it repeats.";
  return null;
}

/** "Late Crate airs the next episode each date, in order": the tray's line for a changed setting. */
export function settingLine(title: string, s: SlotSetting, programTitle: (id: string) => string | undefined = () => undefined, slotTitle: (slotId: string) => string | undefined = () => undefined): string {
  const order = PLAYBACK_ORDER_WORDS[s.order].label.toLowerCase();
  const names = s.programIds.map((id) => programTitle(id)).filter((v): v is string => !!v);
  const from = names.length > 1 ? `, from ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : "";
  const stop = s.atEnd === "stop" ? ", and stops at the end" : "";
  if (s.whatAirs === "next_episode") return `${title} airs the next episode each date${from}, ${order}${stop}`;
  if (s.whatAirs === "fill") return `${title} fills its slot with next episodes${from}, ${order}${stop}`;
  if (s.whatAirs === "same_as") return `${title} airs again what ${(s.sameAsSlotId && slotTitle(s.sameAsSlotId)) || "an earlier slot"} aired`;
  return `${title} airs the same episode every date`;
}

/** The earlier program slots an entry can repeat (same as earlier slot): saved ones that air episodes, before it. */
export function earlierSlots(entries: DayTemplate["entries"], startTime: string): Array<{ slotId: string; label: string }> {
  const order = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return ((h < 6 ? h + 24 : h) * 60 + m) as number;
  };
  return entries
    .filter((e) => e.kind === "program" && e.slotId && e.whatAirs !== "same_as" && order(e.startTime) < order(startTime))
    .map((e) => ({ slotId: e.slotId!, label: `${e.title}, ${wallClockWords(e.startTime)}` }));
}

/** "20:00" as "8:00 pm". */
export function wallClockWords(startTime: string): string {
  const [h, m] = startTime.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

type Slot = NonNullable<LogEntry["templateSlot"]>;

/** An entry a Next episode or Fill the slot slot made: it has the small "Next episode" mark. */
export function nextEpisodeMark(e: Pick<LogEntry, "templateSlot">): boolean {
  return e.templateSlot?.whatAirs === "next_episode" || e.templateSlot?.whatAirs === "fill";
}

/** "Next episode, from the 8:00 pm slot of Every Saturday": an entry's details. A named template: "After work (Every Saturday)". */
export function slotDetail(s: Slot): string {
  const template = s.templateName?.trim() ? `${s.templateName.trim()} (${s.label})` : s.label;
  const kind = s.whatAirs === "this_episode" ? "" : `${WHAT_AIRS_WORDS[s.whatAirs].label}, from `;
  const lead = kind ? kind : "From ";
  return `${lead}the ${wallClockWords(s.startTime)} slot of ${template}`;
}
