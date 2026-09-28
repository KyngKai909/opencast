// `npm run dev:mock`: signing in works with any six-digit code except 000000 (to see the error).
// The email picks who you are (src/mocks/fixtures/people.ts): kai@example.com owns BEAT,
// marcus@ operates it, jen@ hosts Beat Tape Live, sam@ runs a studio, and any other address is
// someone new with no station yet.

import { useCallback, useMemo, useState } from "react";
import { mockTokenFor } from "./mockToken";
import type { AuthAdapter } from "./types";

const KEY = "oc-mock-control-signed-in";

function stored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function persist(v: string | null) {
  try {
    if (v) localStorage.setItem(KEY, v);
    else localStorage.removeItem(KEY);
  } catch {
    /* private window */
  }
}

export function useMockAuth(): AuthAdapter {
  const [email, setEmail] = useState<string | null>(stored);
  const [pending, setPending] = useState<string | null>(null);
  const sendCode = useCallback(async (e: string) => {
    await new Promise((r) => setTimeout(r, 300));
    setPending(e.trim().toLowerCase());
  }, []);
  const verifyCode = useCallback(
    async (code: string) => {
      await new Promise((r) => setTimeout(r, 300));
      if (!/^\d{6}$/.test(code) || code === "000000") throw new Error("That code isn't right. Check the email and try again.");
      const e = pending ?? "kai@example.com";
      persist(e);
      setEmail(e);
    },
    [pending]
  );
  const as = useCallback(async (e: string) => {
    persist(e);
    setEmail(e);
  }, []);
  const oauth = useCallback(async () => as("kai@example.com"), [as]);
  const wallet = useCallback(async () => as("kai@example.com"), [as]);
  const signOut = useCallback(async () => {
    persist(null);
    setEmail(null);
  }, []);
  const getToken = useCallback(async () => {
    const e = stored();
    return e ? mockTokenFor(e) : null;
  }, []);
  return useMemo(() => ({ available: true, ready: true, signedIn: !!email, email, sendCode, verifyCode, oauth, wallet, signOut, getToken }), [email, sendCode, verifyCode, oauth, wallet, signOut, getToken]);
}
