import type { Command, CommandSource } from "../types";

export type Dispatch = (command: Command, source: CommandSource) => void;

/** One input: it turns its own events into commands. */
export interface InputAdapter {
  readonly name: string;
  /** Starts listening; returns a function that stops. */
  start(dispatch: Dispatch): () => void;
  /** The hint row: where the controls are ("Playing from Kai's phone"), or key hints. */
  hints?(): Hint[];
}

/** A key hint ("OK Guide"; `hold`: "Hold OK Back to live"), or a chip saying where the controls are. */
export type Hint = { kind: "key"; key: string; label: string; end?: boolean; hold?: boolean } | { kind: "chip"; label: string; detail?: string };

/** Combines inputs into one command stream. */
export function startInputs(adapters: InputAdapter[], dispatch: Dispatch): () => void {
  const stops = adapters.map((a) => a.start(dispatch));
  return () => stops.forEach((s) => s());
}
