/** Why sign-in opened: the frame's title names it ("To save CIVC 7.1 as a preset"). */
export interface SignInReason {
  kind: "preset" | "remind" | "pledge" | "general";
  /** The words after "To", e.g. "save CIVC 7.1 as a preset". */
  label?: string;
  /** The button that finishes it ("Save CIVC 7.1 and go back"). */
  finish?: string;
  /** Where "go back" returns to: "One thing before you go back to CIVC." */
  backTo?: string;
}

/** One way to sign in: Privy, the mock in `npm run dev:mock`, or the real-API runs' test sign-in. */
export interface AuthAdapter {
  /** Whether signing in is set up at all (a Privy app id, or mock mode). */
  available: boolean;
  ready: boolean;
  signedIn: boolean;
  email: string | null;
  sendCode(email: string): Promise<void>;
  verifyCode(code: string): Promise<void>;
  oauth(provider: "apple" | "google"): Promise<void>;
  /** Master control's "Connect a wallet" (docs/apps/open-questions.md, #4). The viewer doesn't offer wallets. */
  wallet(): Promise<void>;
  signOut(): Promise<void>;
  getToken(): Promise<string | null>;
}
