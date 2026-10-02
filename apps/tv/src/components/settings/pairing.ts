// Remote and phones (tv-update 04.1's "pairing a phone"): a guest's phone pairs with this TV by a
// 4-digit code the TV shows (createPairCode, 5 minutes, a new one replacing the last); phones
// signed in to the account need no code and appear once they connect. The rules are here;
// usePairCode runs them.

import { useEffect, useRef, useState } from "react";
import type { RemotePairCode, RemotePhone } from "@opencast/contracts";

/** "app.useopencast.org/tv": where to go on the phone, from the viewer app's address. */
export function viewerAddress(viewerUrl: string, path = "/tv"): string {
  try {
    return `${new URL(viewerUrl).host}${path}`;
  } catch {
    return `useopencast.org${path}`;
  }
}

/** "4821" as the TV shows it, spaced so it reads from the sofa: "4 8 2 1". */
export function spacedCode(code: string): string {
  return code.split("").join(" ");
}

/** "Changes in 4 minutes": how long the code on screen lasts (renewed when it runs out). */
export function codeLasts(expiresAt: string, nowMs: number): string {
  const ms = Date.parse(expiresAt) - nowMs;
  if (!(ms >= 60_000)) return "Changes in under a minute";
  const min = Math.floor(ms / 60_000);
  return `Changes in ${min} ${min === 1 ? "minute" : "minutes"}`;
}

/** The line under a phone's name: how it can drive this TV, and whether it's connected now. */
export function phoneLine(p: Pick<RemotePhone, "kind" | "connected">): string {
  const how = p.kind === "account" ? "Signed in to your account" : "Paired with a code";
  return p.connected ? `${how}, connected now` : how;
}

/** Connected phones first, then the rest, each in the order they were paired. */
export function phoneOrder(phones: RemotePhone[]): RemotePhone[] {
  return [...phones].sort((a, b) => Number(b.connected) - Number(a.connected) || a.pairedAt.localeCompare(b.pairedAt));
}

/** A guest phone paired since the code went up: the code has done its job. */
export function pairedSince(phones: RemotePhone[] | null, sinceIso: string | null): RemotePhone | null {
  if (!phones || !sinceIso) return null;
  return phones.find((p) => p.kind === "guest" && p.pairedAt >= sinceIso) ?? null;
}

export type PairState = { kind: "off" } | { kind: "loading" } | { kind: "showing"; code: RemotePairCode; since: string } | { kind: "error"; message: string };

export const PAIR_RETRY_MS = 10_000;

export interface PairDeps {
  create: () => Promise<RemotePairCode>;
  now: () => number;
}

/**
 * While `active`, shows a pair code and replaces it the moment it runs out. A failed request
 * shows the API's message and tries again after 10 seconds. `since` is when the first code went
 * up (on the server's clock as the TV sees it), for noticing a phone that has paired.
 */
export function usePairCode(deps: PairDeps, active: boolean): PairState {
  const [state, setState] = useState<PairState>({ kind: "off" });
  const d = useRef(deps);
  d.current = deps;
  useEffect(() => {
    if (!active) {
      setState({ kind: "off" });
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const since = new Date(d.current.now()).toISOString();
    const later = (fn: () => void, ms: number) => {
      if (!stopped) timer = setTimeout(fn, Math.max(0, ms));
    };
    const create = async () => {
      try {
        const code = await d.current.create();
        if (stopped) return;
        setState({ kind: "showing", code, since });
        later(() => void create(), Date.parse(code.expiresAt) - d.current.now());
      } catch (e) {
        if (stopped) return;
        setState({ kind: "error", message: (e as Error).message });
        later(() => void create(), PAIR_RETRY_MS);
      }
    };
    setState({ kind: "loading" });
    later(() => void create(), 0);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [active]);
  return state;
}
