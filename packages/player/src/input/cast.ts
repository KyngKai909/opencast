// The Cast receiver's input: the phone remote sends commands as JSON on Opencast's custom
// namespace, and the receiver tells every connected phone what's on (so any phone on the Wi-Fi
// can pick the remote back up, and the chip can name whoever changed it last).

import type { Command } from "../types";
import type { Dispatch, Hint, InputAdapter } from "./types";

export const CAST_NAMESPACE = "urn:x-cast:org.useopencast.tv";

/** The bits of CAF's CastReceiverContext this uses (so tests and the bridge can stand in). */
export interface CastContextLike {
  addCustomMessageListener(namespace: string, listener: (event: { senderId: string; data: unknown }) => void): void;
  removeCustomMessageListener?(namespace: string, listener: (event: { senderId: string; data: unknown }) => void): void;
  sendCustomMessage(namespace: string, senderId: string | undefined, message: unknown): void;
  getSenders?(): Array<{ id: string; userAgent?: string }>;
  /** Ends the Cast session (CAF's CastReceiverContext.stop): the TV goes back to its own screen. */
  stop?(): void;
}

const KINDS = new Set(["channel", "digit", "dot", "tune", "preset", "savePreset", "last", "info", "guide", "presets", "menu", "back", "select", "focus", "pause", "play", "togglePlay", "backToLive", "sleep"]);

/** Validates a message from a phone; anything else is ignored. */
export function parseCastCommand(data: unknown): (Command & { from?: string }) | null {
  const m = typeof data === "string" ? safeJson(data) : data;
  if (!m || typeof m !== "object" || !("type" in m) || !KINDS.has(String((m as { type: unknown }).type))) return null;
  const c = m as Record<string, unknown>;
  switch (c.type) {
    case "channel":
      return c.dir === "up" || c.dir === "down" ? { type: "channel", dir: c.dir, from: str(c.from) } : null;
    case "digit":
      return Number.isInteger(c.digit) && (c.digit as number) >= 0 && (c.digit as number) <= 9 ? { type: "digit", digit: c.digit as number } : null;
    case "tune":
      return typeof c.channel === "string" && /^\d{1,3}\.\d$/.test(c.channel) ? { type: "tune", channel: c.channel, from: str(c.from) } : null;
    case "preset":
    case "savePreset":
      return Number.isInteger(c.key) && (c.key as number) >= 1 && (c.key as number) <= 6 ? { type: c.type, key: c.key as number } : null;
    case "focus":
      return ["up", "down", "left", "right"].includes(String(c.dir)) ? { type: "focus", dir: c.dir as "up" } : null;
    case "sleep":
      return c.until === null || c.until === "end_of_program" || (typeof c.until === "number" && c.until > 0 && c.until <= 240) ? { type: "sleep", until: c.until as number } : null;
    default:
      return { type: c.type as "info" };
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length <= 60 ? v : undefined;
}

export interface CastInputOptions {
  context: CastContextLike;
  /** Whether phones other than the one that started casting may change the channel. */
  othersCanChange?: () => boolean;
  /** The name of the phone that's casting ("Kai's phone"), for the hint row. */
  castingFrom?: () => string | null;
}

export function castInput(o: CastInputOptions): InputAdapter & { broadcast(state: unknown): void } {
  let owner: string | null = null;
  return {
    name: "cast",
    start(dispatch: Dispatch) {
      const listener = (event: { senderId: string; data: unknown }) => {
        const cmd = parseCastCommand(event.data);
        if (!cmd) return;
        owner ??= event.senderId;
        if (event.senderId !== owner && o.othersCanChange && !o.othersCanChange()) return;
        const { from, ...command } = cmd as Command & { from?: string };
        dispatch(command as Command, { input: "cast", who: from });
      };
      o.context.addCustomMessageListener(CAST_NAMESPACE, listener);
      return () => o.context.removeCustomMessageListener?.(CAST_NAMESPACE, listener);
    },
    /** Tells every phone what's on now. */
    broadcast(state: unknown) {
      o.context.sendCustomMessage(CAST_NAMESPACE, undefined, { type: "state", ...(state as object) });
    },
    hints(): Hint[] {
      const who = o.castingFrom?.();
      return [{ kind: "chip", label: who ? `Playing from ${who}` : "Playing from a phone", detail: "Change channel on your phone" }];
    }
  };
}
