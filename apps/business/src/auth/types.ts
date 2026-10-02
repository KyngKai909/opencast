/** One way to sign in: Privy, or the mock in `npm run dev:mock`. */
export interface AuthAdapter {
  /** Whether signing in is set up at all (a Privy app id, or mock mode). */
  available: boolean;
  ready: boolean;
  signedIn: boolean;
  email: string | null;
  sendCode(email: string): Promise<void>;
  verifyCode(code: string): Promise<void>;
  oauth(provider: "apple" | "google"): Promise<void>;
  signOut(): Promise<void>;
  getToken(): Promise<string | null>;
}
