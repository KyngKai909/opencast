// Sign-in appears only when someone saves, reminds or pledges, names what it's for, and finishes
// that action afterwards (viewer/opencast-you.html 01). There's no sign-in wall.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { setTokenSource } from "../api/client";
import { config } from "../config";
import { useMockAuth } from "./mockAuth";
import { PrivyRoot, usePrivyAuth } from "./privyAuth";
import type { AuthAdapter, SignInReason } from "./types";

function useNoAuth(): AuthAdapter {
  const fail = async () => {
    throw new Error("Signing in isn't set up here.");
  };
  return { available: false, ready: true, signedIn: false, email: null, sendCode: fail, verifyCode: fail, oauth: fail, signOut: async () => {}, getToken: async () => null };
}

// Chosen once, at start: hooks must be called the same way on every render.
const useAdapter = config.mock ? useMockAuth : config.privyAppId ? usePrivyAuth : useNoAuth;

interface AuthState extends AuthAdapter {
  /** Sign-in is open, and why. */
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

  useEffect(() => setTokenSource(adapter.getToken), [adapter.getToken]);
  // Signing in or out changes what every "me" query answers.
  useEffect(() => {
    void qc.invalidateQueries();
  }, [adapter.signedIn, qc]);

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
  if (!config.mock && config.privyAppId)
    return (
      <PrivyRoot appId={config.privyAppId}>
        <AuthState>{children}</AuthState>
      </PrivyRoot>
    );
  return <AuthState>{children}</AuthState>;
}

export function useAuth(): AuthState {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth needs an AuthProvider above it");
  return c;
}
