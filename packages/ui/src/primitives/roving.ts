// Keyboard movement shared by the primitives that hold one choice in a row or a list
// (Segmented, ChipRow, Tabs, ChoiceList, AmountPicker, Menu). Not exported from the package.

import type { KeyboardEvent } from "react";

const NEXT = new Set(["ArrowRight", "ArrowDown"]);
const PREV = new Set(["ArrowLeft", "ArrowUp"]);

/**
 * The index an arrow, Home or End key moves to, wrapping at the ends and skipping disabled
 * items. Null when the key isn't a movement key or nothing can take the focus.
 */
export function moveIndex(current: number, key: string, count: number, isDisabled: (i: number) => boolean = () => false): number | null {
  if (count <= 0) return null;
  let step: number;
  let from: number;
  if (NEXT.has(key)) {
    step = 1;
    from = current;
  } else if (PREV.has(key)) {
    step = -1;
    from = current;
  } else if (key === "Home") {
    step = 1;
    from = -1;
  } else if (key === "End") {
    step = -1;
    from = count;
  } else return null;
  for (let n = 1; n <= count; n++) {
    const i = (((from + step * n) % count) + count) % count;
    if (!isDisabled(i)) return i;
  }
  return null;
}

/** Moves focus between the buttons of a group and hands back the new index. */
export function onRovingKey(
  event: KeyboardEvent<HTMLElement>,
  current: number,
  count: number,
  isDisabled: (i: number) => boolean,
  focusAt: (i: number) => void
): number | null {
  const next = moveIndex(current, event.key, count, isDisabled);
  if (next === null) return null;
  event.preventDefault();
  focusAt(next);
  return next;
}
