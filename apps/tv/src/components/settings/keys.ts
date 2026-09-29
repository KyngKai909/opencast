// What the remote does in TV settings (tv-update 04.1: "Left and right change a value"). Sections
// on the left (the rail), rows on the right (the pane). ▲ ▼ move within the side that has focus.
//
// On a row with options: ◀ ▶ step through them (stopping at the ends), OK steps forward and goes
// round. On any other row, ◀ goes back to the sections. On a section, ▶ or OK goes into its rows.
// Back from the rows returns to the sections; Back from the sections closes settings (to the menu,
// where Settings opened from).

import type { Command } from "@opencast/player";

export type Zone = "rail" | "pane";
export type RowKind = "step" | "action";

export type SettingsAction = { do: "step"; dir: -1 | 1; wrap: boolean } | { do: "rail" } | { do: "pane" } | { do: "close" } | { do: "nothing" };

/** null: not settings' to handle (▲ ▼ move focus, OK presses, channel keys reach the player). */
export function settingsCommand(c: Command, at: { zone: Zone | null; row: RowKind | null }): SettingsAction | null {
  const inPane = at.zone === "pane";
  const stepper = inPane && at.row === "step";
  switch (c.type) {
    case "back":
      return inPane ? { do: "rail" } : { do: "close" };
    case "focus":
      if (c.dir === "left") return stepper ? { do: "step", dir: -1, wrap: false } : inPane ? { do: "rail" } : { do: "nothing" };
      if (c.dir === "right") return stepper ? { do: "step", dir: 1, wrap: false } : inPane ? { do: "nothing" } : { do: "pane" };
      return null;
    case "select":
      if (stepper) return { do: "step", dir: 1, wrap: true };
      return at.zone === "rail" ? { do: "pane" } : null;
    default:
      return null;
  }
}
