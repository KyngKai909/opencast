// Sign in on your phone (tv 05.3, B2): the TV gets a code, shows it with a QR, and asks every
// couple of seconds whether a phone has approved it. Approved: the TV keeps its session and goes
// to the picture. Run out: a new code, said so. The rules are here; useTvCode runs them.

import { useEffect, useRef, useState } from "react";
import type { TvCode, TvCodeStatus } from "../../api/ext/signIn";

export type CodeState =
  | { kind: "loading" }
  | { kind: "waiting"; code: TvCode; renewed: boolean }
  | { kind: "error"; message: string }
  | { kind: "approved" };

/** "K7Q4MP" as the TV shows it: "K7Q 4MP". */
export function formatCode(code: string): string {
  const c = code.replace(/\s/g, "").toUpperCase();
  return c.length === 6 ? `${c.slice(0, 3)} ${c.slice(3)}` : c;
}

/** What to do after a poll: keep asking, get a new code, or sign in. A code past its time is renewed even if the server hasn't said so. */
export function afterPoll(status: TvCodeStatus | null, code: TvCode, nowMs: number): { next: "poll" } | { next: "renew" } | { next: "approved"; token: string; signedInAs: string | null } {
  if (status?.status === "approved") return { next: "approved", token: status.token, signedInAs: status.signedInAs };
  if (status?.status === "expired" || nowMs >= Date.parse(code.expiresAt)) return { next: "renew" };
  return { next: "poll" };
}

/** How long to wait before asking again: what the server asks for, 2 seconds otherwise, never under one. */
export function pollDelayMs(code: TvCode): number {
  return Math.max(1, code.pollSeconds ?? 2) * 1000;
}

/** "useopencast.org/tv": the address to type, from the server, or from where the QR goes. */
export function enterAt(code: TvCode): string {
  if (code.enterAt) return code.enterAt;
  try {
    const u = new URL(code.qrUrl);
    return `${u.host}${u.pathname}`;
  } catch {
    return code.qrUrl;
  }
}

export const RETRY_MS = 10_000;

export interface CodeDeps {
  create: () => Promise<TvCode>;
  poll: (pollToken: string) => Promise<TvCodeStatus>;
  now: () => number;
  onApproved: (token: string, signedInAs: string | null) => void;
}

/**
 * Runs the code sign-in while `active`: create, poll, renew, approve. A failed poll is asked again
 * (the network drops); a failed create shows the API's message and tries again after 10 seconds.
 */
export function useTvCode(deps: CodeDeps, active = true): CodeState {
  const [state, setState] = useState<CodeState>({ kind: "loading" });
  const d = useRef(deps);
  d.current = deps;
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = (fn: () => void, ms: number) => {
      if (!stopped) timer = setTimeout(fn, ms);
    };
    const create = async (renewed: boolean) => {
      try {
        const code = await d.current.create();
        if (stopped) return;
        setState({ kind: "waiting", code, renewed });
        later(() => void poll(code), pollDelayMs(code));
      } catch (e) {
        if (stopped) return;
        setState({ kind: "error", message: (e as Error).message });
        later(() => void create(renewed), RETRY_MS);
      }
    };
    const poll = async (code: TvCode) => {
      let status: TvCodeStatus | null = null;
      try {
        status = await d.current.poll(code.pollToken);
      } catch {
        status = null;
      }
      if (stopped) return;
      const next = afterPoll(status, code, d.current.now());
      if (next.next === "approved") {
        setState({ kind: "approved" });
        d.current.onApproved(next.token, next.signedInAs);
      } else if (next.next === "renew") void create(true);
      else later(() => void poll(code), pollDelayMs(code));
    };
    // A tick later, so React's development double mount doesn't ask for two codes.
    later(() => void create(false), 0);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [active]);
  return state;
}
