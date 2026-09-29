// The third Cast sender: the API's remote relay (B2), for the Opencast app on Android TV and Fire TV,
// which have no Cast. The same commands and state as the Cast receiver: the phone's events stream
// brings the TV's `state` (and `ended`), and each command is a request (`sendRemoteCommand`) with
// the phone's name. A phone signed in to the TV's account drives it as itself; a guest's phone
// uses the token it got pairing with the TV's 4-digit code (pairings.ts).
//
// How the stream and commands travel is a `RelayLink`: the API (relayApi.ts), or dev:mock's bridge
// to TV mode (mockRelay.ts, never in a production build). Reconnecting after a dropped stream is
// the sender's, so it works the same over either.

import type { RemoteState } from "@opencast/contracts";
import { forgetPairing, pairingFor } from "./pairings";
import { offlineLine } from "./targets";
import type { CastSender, CastTarget, ReceiverState, RemoteCommand } from "./types";

/** Who the phone is to the relay: the account (its sign-in token), or a guest's pairing. */
export type RelayAuth = { kind: "account" } | { kind: "paired"; phoneToken: string };

/** An event on the phone's stream (PhoneRemoteEvents). */
export type PhoneEvent = { event: "state"; data: RemoteState } | { event: "ended"; data: { reason: EndedReason } };
export type EndedReason = "tv_ended" | "unpaired" | "signed_out";

/** A refusal from the relay, in the API's words (ApiError has this shape). */
export interface RelayRefusal {
  status: number;
  code: string;
  message: string;
}

export function isRefusal(e: unknown): e is RelayRefusal {
  return !!e && typeof e === "object" && typeof (e as RelayRefusal).status === "number" && typeof (e as RelayRefusal).code === "string";
}

export interface RelayHandlers {
  event(e: PhoneEvent): void;
  /** The stream closed without `ended` (the network, a server restart). `retryMs` is the server's suggestion, if it made one. */
  drop(retryMs?: number): void;
}

export interface RelayLink {
  /** Opens the phone's stream for a TV. Resolves once it's open with a way to close it; rejects with a RelayRefusal when refused. `name` is the phone's ("Kai's phone"). */
  open(tvId: string, auth: RelayAuth, on: RelayHandlers, name: string): Promise<() => void>;
  /** Sends a command; rejects with a RelayRefusal (409 `tv_not_connected` when the TV isn't listening). */
  send(tvId: string, auth: RelayAuth, command: RemoteCommand, name: string): Promise<void>;
}

/** Waits after a dropped stream: 1 s, 2 s, 4 s, 8 s, then every 15 s (or the server's `retry` if longer). */
export function reconnectDelay(attempt: number, retryMs?: number): number {
  return Math.max(retryMs ?? 0, Math.min(15_000, 1000 * 2 ** attempt));
}

/** What the phone says when the relay ends its remote. The TV ending it (its sleep timer) says nothing, as on Cast. */
export function endedLine(reason: EndedReason, tvName: string): string | undefined {
  if (reason === "unpaired") return `${tvName} unpaired this phone. Use a code from the TV to pair again.`;
  if (reason === "signed_out") return `${tvName} was signed out.`;
  return undefined;
}

const UNREACHABLE = "Couldn't reach the TV. Check the connection and try again.";

export function createRelaySender(link: RelayLink, options: { timers?: { set: typeof setTimeout; clear: typeof clearTimeout } } = {}): CastSender {
  const timers = options.timers ?? { set: setTimeout, clear: clearTimeout };
  const stateListeners = new Set<(s: ReceiverState) => void>();
  const endedListeners = new Set<(message?: string) => void>();
  let current: CastTarget | null = null;
  let name = "a phone";
  let auth: RelayAuth = { kind: "account" };
  let close: (() => void) | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  /** Each connection's number: events from an older stream are ignored. */
  let gen = 0;

  const stop = () => {
    gen++;
    if (retry) timers.clear(retry);
    retry = null;
    close?.();
    close = null;
    current = null;
  };

  /** The remote is over from the other side: stop, and tell the session (with words, if there are any). */
  const end = (message?: string) => {
    stop();
    endedListeners.forEach((l) => l(message));
  };

  /** A refusal means the phone can't drive this TV now; which words to show, forgetting a pairing that's gone. */
  const refused = (e: RelayRefusal, tv: CastTarget): string => {
    if (e.code === "tv_not_connected") return offlineLine(tv.name);
    if (e.status === 401 && auth.kind === "paired") forgetPairing(tv.id);
    return e.message;
  };

  const handlers = (g: number, tv: CastTarget, attempt: { n: number }): RelayHandlers => ({
    event(e) {
      if (g !== gen) return;
      attempt.n = 0;
      if (e.event === "state") return stateListeners.forEach((l) => l(e.data));
      if (e.data.reason === "unpaired") forgetPairing(tv.id);
      end(endedLine(e.data.reason, tv.name));
    },
    drop(retryMs) {
      if (g !== gen) return;
      close = null;
      retry = timers.set(() => {
        retry = null;
        if (g !== gen) return;
        link.open(tv.id, auth, handlers(g, tv, attempt), name).then(
          (c) => {
            if (g !== gen) return c();
            attempt.n = 0;
            close = c;
          },
          (e) => {
            if (g !== gen) return;
            // Refused now (unpaired, signed out while away): the remote is over. Otherwise keep trying.
            if (isRefusal(e) && e.status >= 400 && e.status < 500) return end(refused(e, tv));
            attempt.n++;
            handlers(g, tv, attempt).drop();
          }
        );
      }, reconnectDelay(attempt.n, retryMs));
    }
  });

  return {
    kind: "relay",
    async targets() {
      // The account's TVs and this phone's pairings are listed by "Watch on" itself (useCast.ts).
      return [];
    },
    async connect(target, intro) {
      stop();
      if (target.online === false) throw new Error(offlineLine(target.name));
      const pairing = pairingFor(target.id);
      auth = target.paired && pairing ? { kind: "paired", phoneToken: pairing.phoneToken } : { kind: "account" };
      name = intro.from;
      const g = gen;
      try {
        const c = await link.open(target.id, auth, handlers(g, target, { n: 0 }), name);
        if (g !== gen) {
          c();
          throw new Error("Casting didn't start.");
        }
        close = c;
      } catch (e) {
        if (isRefusal(e)) throw new Error(refused(e, target));
        throw e instanceof Error && e.message !== "Failed to fetch" ? e : new Error(UNREACHABLE);
      }
      current = target;
      return target;
    },
    send(command) {
      const tv = current;
      if (!tv) return;
      const g = gen;
      link.send(tv.id, auth, command, name).catch((e) => {
        if (g !== gen || !isRefusal(e)) return;
        // The TV closed the app, or this phone may no longer drive it: the remote ends and says why.
        if (e.code === "tv_not_connected" || e.status === 401 || e.status === 403 || e.status === 404) end(refused(e, tv));
      });
    },
    onState(l) {
      stateListeners.add(l);
      return () => stateListeners.delete(l);
    },
    onEnded(l) {
      endedListeners.add(l);
      return () => endedListeners.delete(l);
    },
    disconnect() {
      // Closing the stream is the phone leaving: the TV keeps playing.
      stop();
    },
    connected: () => current
  };
}
