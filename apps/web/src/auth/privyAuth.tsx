// Privy, headless: our own screens (the reference's: the viewer's sign-in modal, master control's
// and the desk's sign-in pages), Privy's email code and OAuth underneath, and Privy's own wallet
// connector for master control's "Connect a wallet" (viewers aren't offered wallets:
// docs/apps/open-questions.md, #4). Opencast's own Privy app (VITE_PRIVY_APP_ID), never Clear's.
// Privy makes no embedded wallet at sign-in; a creator's is made when they claim (creatorWallet).
// Signing in only proves who you are; the API decides what you may do (memberships, isAdmin).

import { useCallback, useMemo, type ReactNode } from "react";
import { PrivyProvider, useCreateWallet, useLogin, useLoginWithEmail, useLoginWithOAuth, usePrivy, type User } from "@privy-io/react-auth";
import type { AuthAdapter } from "./types";

export function PrivyRoot({ appId, children }: { appId: string; children: ReactNode }) {
  return (
    <PrivyProvider appId={appId} config={{ loginMethods: ["email", "apple", "google", "wallet"], appearance: { theme: "dark" }, embeddedWallets: { ethereum: { createOnLogin: "off" } } }}>
      {children}
    </PrivyProvider>
  );
}

/** The Ethereum wallet a person already has in Privy: one they signed in with or linked, or an embedded one made before. */
export function existingWallet(user: Pick<User, "linkedAccounts"> | null): string | null {
  for (const a of user?.linkedAccounts ?? []) if (a.type === "wallet" && a.chainType === "ethereum" && a.address) return a.address;
  return null;
}

export function usePrivyAuth(): AuthAdapter {
  const { ready, authenticated, user, logout, getAccessToken } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { sendCode: send, loginWithCode } = useLoginWithEmail();
  const { initOAuth } = useLoginWithOAuth();
  const { login } = useLogin();
  const sendCode = useCallback(async (email: string) => send({ email }), [send]);
  const verifyCode = useCallback(
    async (code: string) => {
      await loginWithCode({ code });
    },
    [loginWithCode]
  );
  const oauth = useCallback(async (provider: "apple" | "google") => initOAuth({ provider }), [initOAuth]);
  const wallet = useCallback(async () => login({ loginMethods: ["wallet"] }), [login]);
  // Creators only, when they claim: everyone else signs in without a wallet (createOnLogin is off).
  const creatorWallet = useCallback(async () => existingWallet(user) ?? (await createWallet()).address, [user, createWallet]);
  return useMemo(
    () => ({ available: true, ready, signedIn: authenticated, email: user?.email?.address ?? null, sendCode, verifyCode, oauth, wallet, creatorWallet, signOut: logout, getToken: getAccessToken }),
    [ready, authenticated, user, sendCode, verifyCode, oauth, wallet, creatorWallet, logout, getAccessToken]
  );
}
