// The preset key rules (you 03): six keys, and as many more as you want. The same rules run on the
// account (the mock API) and on this device (signed out), so they live here, with no React.
//
// - A new preset takes the lowest free key 1 to 6; with all six taken it asks which one to move.
// - Saving never deletes: a station replaced on its key moves to More presets, at the top.
// - Keys come first, in key order, then More presets in their own order.
// - Dragging moves a station to another key's place; the ones between shift along.

export interface KeyedPreset {
  stationId: string;
  /** 1 to 6, or null for More presets. */
  key: number | null;
}

export const KEYS = [1, 2, 3, 4, 5, 6] as const;

/** The lowest free key, or null when all six are taken. */
export function lowestFreeKey(list: ReadonlyArray<KeyedPreset>): number | null {
  const taken = new Set(list.map((p) => p.key).filter((k): k is number => k !== null));
  return KEYS.find((k) => !taken.has(k)) ?? null;
}

/** Keys first in key order, then More presets in the order given. */
export function normalise<T extends KeyedPreset>(list: ReadonlyArray<T>): T[] {
  const keyed = list.filter((p) => p.key !== null).sort((a, b) => a.key! - b.key!);
  const more = list.filter((p) => p.key === null);
  return [...keyed, ...more];
}

/**
 * Saves a station to a key (or to More presets with null). A station already on that key moves to
 * the top of More presets. Saving a station that's already a preset moves it.
 */
export function placePreset(list: ReadonlyArray<KeyedPreset>, stationId: string, key: number | null): KeyedPreset[] {
  const rest = list.filter((p) => p.stationId !== stationId).map((p) => ({ ...p }));
  const displaced = key === null ? undefined : rest.find((p) => p.key === key);
  const others = rest.filter((p) => p !== displaced);
  const keyed = others.filter((p) => p.key !== null);
  const more = others.filter((p) => p.key === null);
  const moved = displaced ? [{ ...displaced, key: null }] : [];
  const self = { stationId, key };
  return normalise(key === null ? [...keyed, ...moved, ...more, self] : [...keyed, self, ...moved, ...more]);
}

/** Saves with the lowest free key. Returns null when all six are taken (the replace dialog asks). */
export function addPreset(list: ReadonlyArray<KeyedPreset>, stationId: string): KeyedPreset[] | null {
  if (list.some((p) => p.stationId === stationId)) return list.map((p) => ({ ...p }));
  const key = lowestFreeKey(list);
  return key === null ? null : placePreset(list, stationId, key);
}

export function removePresetFrom(list: ReadonlyArray<KeyedPreset>, stationId: string): KeyedPreset[] {
  return list.filter((p) => p.stationId !== stationId).map((p) => ({ ...p }));
}

/** The six keys as slots: index 0 is key 1. */
export function slots(list: ReadonlyArray<KeyedPreset>): Array<string | null> {
  return KEYS.map((k) => list.find((p) => p.key === k)?.stationId ?? null);
}

/**
 * Drags the station on key `from` to key `to`. The ones between shift one place toward `from`,
 * empty keys included, like moving a card in a row. Returns the list unchanged for a no-op.
 */
export function moveKey(list: ReadonlyArray<KeyedPreset>, from: number, to: number): KeyedPreset[] {
  if (from === to || from < 1 || from > 6 || to < 1 || to > 6) return list.map((p) => ({ ...p }));
  const row = slots(list);
  const [item] = row.splice(from - 1, 1);
  row.splice(to - 1, 0, item!);
  const keyed = row.flatMap((id, i) => (id ? [{ stationId: id, key: i + 1 }] : []));
  const more = list.filter((p) => p.key === null).map((p) => ({ ...p }));
  return [...keyed, ...more];
}

/** What a replace would do, for the dialog's lines: which station moves off which key. */
export function replaceOutcome(list: ReadonlyArray<KeyedPreset>, key: number | null): { key: number; stationId: string } | null {
  if (key === null) return null;
  const on = list.find((p) => p.key === key);
  return on ? { key, stationId: on.stationId } : null;
}
