// Dev only: the real-API runs' test sign-in (e2e/real, docs/apps/testing.md). The tests sign a
// Privy-style token with the run's throwaway key and put it in localStorage (oc-dev-token, and the
// email in oc-dev-email); this hands it to the API as Privy's would be. AuthProvider picks it only
// when `import.meta.env.DEV && VITE_DEV_TOKEN_AUTH === "true"`, so a production build never has it.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuthAdapter } from "./types";

const TOKEN = "oc-dev-token";
const EMAIL = "oc-dev-email";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Who the stored token is for: its email, or null with no token. */
function current(): string | null {
  return read(TOKEN) ? (read(EMAIL) ?? "test@example.com") : null;
}

export function useDevTokenAuth(): AuthAdapter {
  const [email, setEmail] = useState<string | null>(current);
  // The tests can put another person's token in at any time (e2e/lib/real.ts signIn): follow it.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === TOKEN || e.key === EMAIL || e.key === null) setEmail(current());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  // Every way in picks up the stored token: the sign-in page's steps work as they are.
  const pickUp = useCallback(async () => {
    const e = current();
    if (!e) throw new Error("This is the test sign-in, and there's no test token. The tests' signIn() sets one; npm run real:up prints them.");
    setEmail(e);
  }, []);
  const sendCode = useCallback(async () => {}, []);
  const signOut = useCallback(async () => {
    try {
      localStorage.removeItem(TOKEN);
      localStorage.removeItem(EMAIL);
    } catch {
      /* private window */
    }
    setEmail(null);
  }, []);
  const getToken = useCallback(async () => read(TOKEN), []);
  return useMemo(() => ({ available: true, ready: true, signedIn: email !== null, email, sendCode, verifyCode: pickUp, oauth: pickUp, wallet: pickUp, signOut, getToken }), [email, sendCode, pickUp, signOut, getToken]);
}
