// `npm run dev:mock`: one sign-in for the whole app. Any six-digit code works except 000000 (to see
// the error). The email picks who you are (src/mocks/people.ts): kai@example.com is Kai M., who
// watches (the viewer's You) and owns BEAT (master control); marcus@ operates BEAT, jen@ hosts Beat
// Tape Live, sam@example.com runs a studio; dee@opencast.example is Dee A., on the Opencast team
// (Network desk). Any other address is someone new, with no station yet.

import { useCallback, useMemo, useState } from "react";
import { areaOf } from "../areas";
import { mockTokenFor } from "./mockToken";
import type { AuthAdapter } from "./types";

export const MOCK_SIGNED_IN_KEY = "oc-mock-signed-in";
export const MOCK_ADMIN_EMAIL = "dee@opencast.example";
const MOCK_PERSON = "kai@example.com";

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

/** Where sign-in happened: the desk's page signs in its admin, the rest the reference's Kai. */
function area() {
  return typeof window === "undefined" ? "viewer" : areaOf(window.location.pathname);
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
      if (!/^\d{6}$/.test(code) || code === "000000")
        // Each screen's own words for it: the viewer's sign-in modal, and the sign-in pages.
        throw new Error(area() === "viewer" ? "That code didn't work. Check it, or send a new one." : "That code isn't right. Check the email and try again.");
      const e = pending ?? (area() === "desk" ? MOCK_ADMIN_EMAIL : MOCK_PERSON);
      persist(e);
      setEmail(e);
    },
    [pending]
  );
  const as = useCallback(async (e: string) => {
    persist(e);
    setEmail(e);
  }, []);
  const oauth = useCallback(async () => as(area() === "desk" ? MOCK_ADMIN_EMAIL : MOCK_PERSON), [as]);
  const wallet = useCallback(async () => as(MOCK_PERSON), [as]);
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
