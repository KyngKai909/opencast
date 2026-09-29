// Network desk needs someone signed in, and on the Opencast team: every page sits behind the
// sign-in page and the admin gate (auth/gate.ts). Privy in production, the mock in `dev:mock`.

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { setTokenSource } from "../api/client";
import { config } from "../config";
import { useMockAuth } from "./mockAuth";
import { PrivyRoot, usePrivyAuth } from "./privyAuth";
import type { AuthAdapter } from "./types";

function useNoAuth(): AuthAdapter {
  const fail = async () => {
    throw new Error("Signing in isn't set up here.");
  };
  return { available: false, ready: true, signedIn: false, email: null, sendCode: fail, verifyCode: fail, oauth: fail, signOut: async () => {}, getToken: async () => null };
}

// Chosen once, at start: hooks must be called the same way on every render. The env itself, so a
// production build drops the mock sign-in.
const useAdapter = import.meta.env.VITE_MOCK === "true" ? useMockAuth : config.privyAppId ? usePrivyAuth : useNoAuth;

const Ctx = createContext<AuthAdapter | null>(null);

function AuthState({ children }: { children: ReactNode }) {
  const adapter = useAdapter();
  const qc = useQueryClient();
  // During render, not in an effect: the pages' first queries start in their own effects, which
  // run before this provider's, and would go out without the token.
  setTokenSource(adapter.getToken);
  // Signing in or out (or as someone else) changes every answer: start the cache again.
  const who = useRef(adapter.email);
  useEffect(() => {
    if (who.current === adapter.email) return;
    who.current = adapter.email;
    qc.clear();
  }, [adapter.email, qc]);
  return <Ctx.Provider value={adapter}>{children}</Ctx.Provider>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const inner = <AuthState>{children}</AuthState>;
  return import.meta.env.VITE_MOCK !== "true" && config.privyAppId ? <PrivyRoot appId={config.privyAppId}>{inner}</PrivyRoot> : inner;
}

export function useAuth(): AuthAdapter {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth needs an AuthProvider above it");
  return ctx;
}
