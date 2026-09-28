// `npm run dev:mock`: signing in works with any six-digit code except 000000 (to see the error).

import { useCallback, useMemo, useState } from "react";
import { MOCK_TOKEN } from "../mocks/respond";
import type { AuthAdapter } from "./types";

const KEY = "oc-mock-signed-in";

function stored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function useMockAuth(): AuthAdapter {
  const [email, setEmail] = useState<string | null>(stored);
  const [pending, setPending] = useState<string | null>(null);
  const persist = (v: string | null) => {
    try {
      if (v) localStorage.setItem(KEY, v);
      else localStorage.removeItem(KEY);
    } catch {
      /* private window */
    }
  };
  const sendCode = useCallback(async (e: string) => {
    await new Promise((r) => setTimeout(r, 300));
    setPending(e);
  }, []);
  const verifyCode = useCallback(
    async (code: string) => {
      await new Promise((r) => setTimeout(r, 300));
      if (!/^\d{6}$/.test(code) || code === "000000") throw new Error("That code didn't work. Check it, or send a new one.");
      const e = pending ?? "kai@example.com";
      persist(e);
      setEmail(e);
    },
    [pending]
  );
  const oauth = useCallback(async () => {
    persist("kai@example.com");
    setEmail("kai@example.com");
  }, []);
  const signOut = useCallback(async () => {
    persist(null);
    setEmail(null);
  }, []);
  const getToken = useCallback(async () => (stored() ? MOCK_TOKEN : null), []);
  return useMemo(() => ({ available: true, ready: true, signedIn: !!email, email, sendCode, verifyCode, oauth, signOut, getToken }), [email, sendCode, verifyCode, oauth, signOut, getToken]);
}
