// Privy, headless: our own screens (the reference's), Privy's email code and OAuth underneath.
// Email first; then Apple and Google. No wallet for viewers (docs/apps/open-questions.md, #4).

import { useCallback, useMemo, type ReactNode } from "react";
import { PrivyProvider, useLoginWithEmail, useLoginWithOAuth, usePrivy } from "@privy-io/react-auth";
import type { AuthAdapter } from "./types";

export function PrivyRoot({ appId, children }: { appId: string; children: ReactNode }) {
  return (
    <PrivyProvider appId={appId} config={{ loginMethods: ["email", "apple", "google"], appearance: { theme: "dark" }, embeddedWallets: { ethereum: { createOnLogin: "off" } } }}>
      {children}
    </PrivyProvider>
  );
}

export function usePrivyAuth(): AuthAdapter {
  const { ready, authenticated, user, logout, getAccessToken } = usePrivy();
  const { sendCode: send, loginWithCode } = useLoginWithEmail();
  const { initOAuth } = useLoginWithOAuth();
  const sendCode = useCallback(async (email: string) => send({ email }), [send]);
  const verifyCode = useCallback(async (code: string) => {
    await loginWithCode({ code });
  }, [loginWithCode]);
  const oauth = useCallback(async (provider: "apple" | "google") => initOAuth({ provider }), [initOAuth]);
  return useMemo(
    () => ({ available: true, ready, signedIn: authenticated, email: user?.email?.address ?? null, sendCode, verifyCode, oauth, signOut: logout, getToken: getAccessToken }),
    [ready, authenticated, user, sendCode, verifyCode, oauth, logout, getAccessToken]
  );
}
