import type { DialRow } from "@opencast/contracts";

/** A station the player can tune: a dial row, with what's on and where its picture comes from. */
export type Channel = DialRow;

/** Commands every input produces: a TV remote, the phone remote over Cast, the iPhone bridge, the keyboard, the lock screen. */
export type Command =
  | { type: "channel"; dir: "up" | "down" }
  | { type: "digit"; digit: number }
  | { type: "dot" }
  | { type: "tune"; channel: string }
  | { type: "preset"; key: number }
  | { type: "savePreset"; key: number }
  | { type: "last" }
  | { type: "info" }
  | { type: "guide" }
  | { type: "presets" }
  | { type: "menu" }
  | { type: "back" }
  | { type: "select" }
  | { type: "focus"; dir: "up" | "down" | "left" | "right" }
  | { type: "pause" }
  | { type: "play" }
  | { type: "togglePlay" }
  | { type: "backToLive" }
  | { type: "sleep"; until: "end_of_program" | number | null };

export type CommandType = Command["type"];

export interface CommandSource {
  /** Which input sent it: "remote", "cast", "bridge", "keyboard", "media-session". */
  input: string;
  /** Who, where the input knows it: the sender's name on Cast ("Kai's phone"). */
  who?: string;
}
