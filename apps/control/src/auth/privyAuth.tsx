// Privy, headless for email and OAuth (our own sign-in page, the reference's), and Privy's own
// wallet connector for "Connect a wallet". Master control keeps wallets; viewers don't.

import { useCallback, useMemo, type ReactNode } from "react";
import { PrivyProvider, useLogin, useLoginWithEmail, useLoginWithOAuth, usePrivy } from "@privy-io/react-auth";
import type { AuthAdapter } from "./types";

export function PrivyRoot({ appId, children }: { appId: string; children: ReactNode }) {
  return (
    <PrivyProvider appId={appId} config={{ loginMethods: ["email", "apple", "google", "wallet"], appearance: { theme: "dark" }, embeddedWallets: { ethereum: { createOnLogin: "off" } } }}>
      {children}
    </PrivyProvider>
  );
}

export function usePrivyAuth(): AuthAdapter {
  const { ready, authenticated, user, logout, getAccessToken } = usePrivy();
  const { sendCode: send, loginWithCode } = useLoginWithEmail();
  const { initOAuth } = useLoginWithOAuth();
  const { login } = useLogin();
  const sendCode = useCallback(async (email: string) => send({ email }), [send]);
  const verifyCode = useCallback(async (code: string) => {
    await loginWithCode({ code });
  }, [loginWithCode]);
  const oauth = useCallback(async (provider: "apple" | "google") => initOAuth({ provider }), [initOAuth]);
  const wallet = useCallback(async () => login({ loginMethods: ["wallet"] }), [login]);
  return useMemo(
    () => ({ available: true, ready, signedIn: authenticated, email: user?.email?.address ?? null, sendCode, verifyCode, oauth, wallet, signOut: logout, getToken: getAccessToken }),
    [ready, authenticated, user, sendCode, verifyCode, oauth, wallet, logout, getAccessToken]
  );
}
