// The sleep timer's choices (tv-update 05.1): each says the clock time it ends, so nobody has to
// do the maths half asleep. "End of this program" comes first because it's what people mean.

export type SleepChoice = "end_of_program" | 30 | 60 | 90 | "off";

export interface SleepOption {
  choice: SleepChoice;
  label: string;
  /** When it would turn off (ms), or null for Off. */
  endsAt: number | null;
}

/** The options at `now`; "End of this program" only when the program has an end still to come. */
export function sleepOptions(now: number, programEndsAt: string | null | undefined): SleepOption[] {
  const end = programEndsAt ? Date.parse(programEndsAt) : NaN;
  const list: SleepOption[] = [];
  if (end > now) list.push({ choice: "end_of_program", label: "End of this program", endsAt: end });
  for (const m of [30, 60, 90] as const) list.push({ choice: m, label: `${m} min`, endsAt: now + m * 60_000 });
  list.push({ choice: "off", label: "Off", endsAt: null });
  return list;
}

/** What the player's sleep command takes for a choice. */
export function sleepCommand(choice: SleepChoice): "end_of_program" | number | null {
  return choice === "off" ? null : choice;
}
