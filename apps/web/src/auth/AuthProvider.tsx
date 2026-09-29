// One session for the whole app: one Privy root, one adapter, one token source for the API client.
// A viewer who starts a station, or a station owner who wants to watch, never signs in twice.
//
// Each area asks for sign-in its own way, on top of this:
//   - the viewer: no sign-in wall. Sign-in appears only when someone saves, reminds or pledges,
//     names what it's for, and finishes that action afterwards (requireSignIn, viewer/opencast-you.html 01);
//   - master control: its own sign-in page, for every page but claiming a station (control/routes.tsx);
//   - Network desk: its sign-in page, then the admin gate on Me.isAdmin (desk/auth/gate.ts).
// Roles are the API's to check, on every request: these only choose which screen to show.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { setTokenSource } from "../api/client";
import { config } from "../config";
import { useDevTokenAuth } from "./devTokenAuth";
import { useMockAuth } from "./mockAuth";
import { PrivyRoot, usePrivyAuth } from "./privyAuth";
import type { AuthAdapter, SignInReason } from "./types";

function useNoAuth(): AuthAdapter {
  const fail = async () => {
    throw new Error("Signing in isn't set up here.");
  };
  return { available: false, ready: true, signedIn: false, email: null, sendCode: fail, verifyCode: fail, oauth: fail, wallet: fail, signOut: async () => {}, getToken: async () => null };
}

// Chosen once, at start: hooks must be called the same way on every render.
// The real-API runs' test sign-in (devTokenAuth.ts) comes first, in the dev server only: the env
// itself, so a production build drops it. Mock mode's sign-in likewise: the env, so a production
// build drops it with the mocks (Vitest's tests set it through config instead).
const devToken = import.meta.env.DEV && import.meta.env.VITE_DEV_TOKEN_AUTH === "true";
const mock = import.meta.env.MODE === "test" ? config.mock : import.meta.env.VITE_MOCK === "true";
const useAdapter = devToken ? useDevTokenAuth : mock ? useMockAuth : config.privyAppId ? usePrivyAuth : useNoAuth;

export interface AuthState extends AuthAdapter {
  /** The viewer's sign-in is open, and why. */
  signIn: { open: boolean; reason: SignInReason | null };
  /**
   * Runs `action` now when signed in; otherwise opens sign-in for `reason` and runs it once
   * signing in finishes. Returns whether it ran now.
   */
  requireSignIn(reason: SignInReason, action: () => void | Promise<void>, onDevice?: () => void): boolean;
  /** Opens sign-in from the header (no pending action). */
  openSignIn(reason?: SignInReason): void;
  /** Sign-in's last step calls this: runs the pending action, closes sign-in. */
  finishSignIn(): Promise<void>;
  /** Closes sign-in. `keepOnDevice` runs the on-device fallback, where the action has one. */
  cancelSignIn(opts?: { keepOnDevice?: boolean }): void;
  /** Whether the pending action can be kept on this device instead. */
  canKeepOnDevice: boolean;
}

const Ctx = createContext<AuthState | null>(null);

function AuthState({ children }: { children: ReactNode }) {
  const adapter = useAdapter();
  const qc = useQueryClient();
  const [signIn, setSignIn] = useState<AuthState["signIn"]>({ open: false, reason: null });
  const pending = useRef<(() => void | Promise<void>) | null>(null);
  const fallback = useRef<(() => void) | null>(null);

  // During render, not in an effect: the pages' first queries start in their own effects, which
  // run before this provider's, and would go out without the token.
  setTokenSource(adapter.getToken);

  // Signing in, out, or as someone else changes every answer. Signing out or switching person
  // starts the cache again, so nobody sees the last person's data: reset, not clear, because
  // clear() drops a query already in flight without an answer (the sign-in gates would wait on it
  // forever); reset refetches whatever is on screen. Signing in from signed out refreshes what's
  // there instead, so the page (and the viewer's player) stays put while the action finishes.
  const who = useRef(adapter.email);
  useEffect(() => {
    const before = who.current;
    if (before === adapter.email) return;
    who.current = adapter.email;
    void (before === null ? qc.invalidateQueries() : qc.resetQueries());
  }, [adapter.email, qc]);

  const requireSignIn = useCallback(
    (reason: SignInReason, action: () => void | Promise<void>, onDevice?: () => void) => {
      if (adapter.signedIn) {
        void action();
        return true;
      }
      pending.current = action;
      fallback.current = onDevice ?? null;
      setSignIn({ open: true, reason });
      return false;
    },
    [adapter.signedIn]
  );
  const openSignIn = useCallback((reason?: SignInReason) => {
    pending.current = null;
    fallback.current = null;
    setSignIn({ open: true, reason: reason ?? { kind: "general" } });
  }, []);
  const finishSignIn = useCallback(async () => {
    const run = pending.current;
    pending.current = null;
    fallback.current = null;
    setSignIn({ open: false, reason: null });
    await qc.invalidateQueries();
    if (run) await run();
  }, [qc]);
  const cancelSignIn = useCallback((opts?: { keepOnDevice?: boolean }) => {
    if (opts?.keepOnDevice) fallback.current?.();
    pending.current = null;
    fallback.current = null;
    setSignIn({ open: false, reason: null });
  }, []);

  const canKeepOnDevice = signIn.open && fallback.current !== null;
  const value = useMemo<AuthState>(() => ({ ...adapter, signIn, requireSignIn, openSignIn, finishSignIn, cancelSignIn, canKeepOnDevice }), [adapter, signIn, requireSignIn, openSignIn, finishSignIn, cancelSignIn, canKeepOnDevice]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const inner = <AuthState>{children}</AuthState>;
  return !devToken && !mock && config.privyAppId ? <PrivyRoot appId={config.privyAppId}>{inner}</PrivyRoot> : inner;
}

export function useAuth(): AuthState {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth needs an AuthProvider above it");
  return c;
}
