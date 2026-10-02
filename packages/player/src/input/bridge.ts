// The iPhone bridge: when Screen Mirroring connects, the native plugin (Phase 8) draws TV mode on
// the external display and passes the phone remote's commands to it as messages. The same
// commands as Cast, so TV mode can't tell them apart.

import type { Dispatch, Hint, InputAdapter } from "./types";
import { parseCastCommand } from "./cast";

export interface BridgeOptions {
  /** Where messages arrive: the external display's window. */
  source?: Pick<Window, "addEventListener" | "removeEventListener">;
  /** Only messages from these origins count (the app's own). */
  origins?: string[];
  /** The phone's name, built from the account ("Kai's iPhone"). */
  device?: () => string | null;
}

export function bridgeInput(o: BridgeOptions = {}): InputAdapter {
  return {
    name: "bridge",
    start(dispatch: Dispatch) {
      const source = o.source ?? window;
      const onMessage = (e: Event) => {
        const m = e as MessageEvent;
        if (o.origins && !o.origins.includes(m.origin)) return;
        const data = m.data as { opencast?: string; command?: unknown } | null;
        if (!data || data.opencast !== "command") return;
        const cmd = parseCastCommand(data.command);
        if (cmd) {
          const { from: _from, ...command } = cmd as typeof cmd & { from?: string };
          dispatch(command, { input: "bridge", who: o.device?.() ?? undefined });
        }
      };
      source.addEventListener("message", onMessage);
      return () => source.removeEventListener("message", onMessage);
    },
    hints(): Hint[] {
      const who = o.device?.();
      return [{ kind: "chip", label: who ? `Mirrored from ${who}` : "Mirrored from an iPhone", detail: "Keep Opencast open on your iPhone" }];
    }
  };
}
