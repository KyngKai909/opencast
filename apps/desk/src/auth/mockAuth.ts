// `npm run dev:mock`: signing in works with any six-digit code except 000000 (to see the error).
// The email picks who you are (src/mocks/fixtures/people.ts): dee@opencast.example is Dee A., on
// the Opencast team; any other address signs in but isn't on the team (the "not for you" page).

import { useCallback, useMemo, useState } from "react";
import { mockTokenFor } from "./mockToken";
import type { AuthAdapter } from "./types";

export const MOCK_SIGNED_IN_KEY = "oc-mock-desk-signed-in";
export const MOCK_ADMIN_EMAIL = "dee@opencast.example";

function stored(): string | null {
  try {
    return localStorage.getItem(MOCK_SIGNED_IN_KEY);
  } catch {
    return null;
  }
}

function persist(v: string | null) {
  try {
    if (v) localStorage.setItem(MOCK_SIGNED_IN_KEY, v);
    else localStorage.removeItem(MOCK_SIGNED_IN_KEY);
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
      const e = pending ?? MOCK_ADMIN_EMAIL;
      persist(e);
      setEmail(e);
    },
    [pending]
  );
  const oauth = useCallback(async () => {
    persist(MOCK_ADMIN_EMAIL);
    setEmail(MOCK_ADMIN_EMAIL);
  }, []);
  const signOut = useCallback(async () => {
    persist(null);
    setEmail(null);
  }, []);
  const getToken = useCallback(async () => {
    const e = stored();
    return e ? mockTokenFor(e) : null;
  }, []);
  return useMemo(() => ({ available: true, ready: true, signedIn: !!email, email, sendCode, verifyCode, oauth, signOut, getToken }), [email, sendCode, verifyCode, oauth, signOut, getToken]);
}
