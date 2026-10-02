// The phone remote through the API's relay, for the TV app (Android TV and Fire TV have no Cast):
// one more input beside the remote's keys. While TV mode runs as the TV app, it keeps the TV's
// event stream open (GET /tv/remote/events, read with fetch since EventSource can't send
// Authorization) and reconnects with a growing wait when it drops. Phones' commands go into the
// same command stream as the remote, with who sent them, so the banner can say who changed it.
//
// Who may change the channel is the TV's rule, as on the Cast receiver: with "Who on the Wi-Fi
// can change the channel" set to the phone that started, only the phone that sent the first
// command this session drives the TV; the others are ignored.
//
// The hint row: the TV app has its own remote, so its key hints stay. "Playing from Kai's phone"
// joins them only while a phone has sent a command in the last few minutes.

import { TvRemoteEvents, type RemotePhone } from "@opencast/contracts";
import { parseCastCommand, type Command, type Dispatch, type Hint, type InputAdapter } from "@opencast/player";
import { backoffMs, readSse, type SseEvent, type SseParser } from "../api/sse";

/** How long after a phone's last command the hint row names it. */
export const CHIP_MS = 5 * 60_000;

export interface RelayOptions {
  /** Opens the TV's stream (the device's token), aborted with `signal`. */
  open(signal: AbortSignal): Promise<Response>;
  /** "Who on the Wi-Fi can change the channel": any phone (true), or only the one that started. */
  othersCanChange(): boolean;
  /** The phones that can drive this TV (on open, and whenever the list changes). */
  onPhones?(phones: RemotePhone[]): void;
  /** The account signed this TV out from "Your TVs". */
  onSignedOut?(): void;
  /** The stream opened (true) or dropped (false). */
  onConnection?(open: boolean): void;
  now?(): number;
  /** The wait before reconnecting, after this many failures in a row. */
  backoff?(failures: number): number;
  /** Waits, ending early when aborted (tests replace it). */
  wait?(ms: number, signal: AbortSignal): Promise<void>;
}

export interface RelayInput extends InputAdapter {
  /** A new session (the sleep timer ended Opencast, the TV signed out): the next phone to send a command starts it. */
  reset(): void;
  /** The phone that sent the last command, and when. */
  lastPhone(): { name: string; at: number } | null;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

function json(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

export function relayInput(o: RelayOptions): RelayInput {
  const now = o.now ?? Date.now;
  const wait = o.wait ?? sleep;
  const backoff = o.backoff ?? ((n: number) => backoffMs(n));
  /** The phone that sent the first command this session. */
  let owner: string | null = null;
  let last: { name: string; at: number } | null = null;

  const handle = (e: SseEvent, dispatch: Dispatch) => {
    const data = json(e.data);
    if (e.event === "command") {
      const m = TvRemoteEvents.command.safeParse(data);
      const cmd = m.success ? parseCastCommand(m.data.command) : null;
      if (!m.success || !cmd) return;
      const { phoneId, name } = m.data.from;
      owner ??= phoneId;
      if (phoneId !== owner && !o.othersCanChange()) return;
      last = { name, at: now() };
      const { from: _from, ...command } = cmd as Command & { from?: string };
      dispatch(command as Command, { input: "relay", who: name });
    } else if (e.event === "phones") {
      const m = TvRemoteEvents.phones.safeParse(data);
      if (!m.success) return;
      // The phone that started was removed: the next one to send a command starts again.
      if (owner && !m.data.phones.some((p) => p.id === owner)) owner = null;
      o.onPhones?.(m.data.phones);
    } else if (e.event === "signed_out") {
      o.onSignedOut?.();
    }
  };

  const run = async (dispatch: Dispatch, signal: AbortSignal) => {
    let failures = 0;
    while (!signal.aborted) {
      let opened = false;
      let parser: SseParser | null = null;
      try {
        const res = await o.open(signal);
        if (res.ok && res.body) {
          opened = true;
          failures = 0;
          o.onConnection?.(true);
          await readSse(res, (e) => handle(e, dispatch), { parser: (p) => (parser = p) });
        } else {
          await res.body?.cancel().catch(() => undefined);
        }
      } catch {
        // The network dropped, or the stream was closed on purpose (aborted).
      }
      if (opened) o.onConnection?.(false);
      if (signal.aborted) return;
      failures++;
      // A stream that was open comes back after the server's `retry:` (3 s); failures wait longer each time.
      const asked = (parser as SseParser | null)?.retryMs() ?? null;
      await wait(failures === 1 && asked !== null ? asked : backoff(failures), signal);
    }
  };

  return {
    name: "relay",
    start(dispatch) {
      const ctl = new AbortController();
      void run(dispatch, ctl.signal);
      return () => ctl.abort();
    },
    hints(): Hint[] {
      return last && now() - last.at < CHIP_MS ? [{ kind: "chip", label: `Playing from ${last.name}` }] : [];
    },
    reset() {
      owner = null;
    },
    lastPhone: () => last
  };
}
