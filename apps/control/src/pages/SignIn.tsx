// Signing in to master control: the reference's sign-in (viewer/you 01.1, 01.2), with wallets
// kept for master control (open-questions #4). Email first, then Apple, Google and a wallet.

import { useRef, useState, type FormEvent } from "react";
import { Button, Field } from "@opencast/ui";
import { useAuth } from "../auth/AuthProvider";
import { OtpField } from "../components/signin/OtpField";
import "./SignIn.css";

export default function SignIn() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError((e as Error).message || "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const send = (e: FormEvent) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter your email address, like name@example.com.");
    void run(async () => {
      await auth.sendCode(email.trim());
      setSent(email.trim());
      setTimeout(() => codeRef.current?.focus(), 0);
    });
  };

  const verify = (digits: string) => void run(() => auth.verifyCode(digits));

  return (
    <main className="cc-signin">
      <div className="cc-signin__card">
        <p className="cc-signin__kicker">Master control</p>
        <h1 className="cc-signin__h">Sign in to Opencast</h1>
        {!auth.available && <p className="cc-signin__note">Signing in isn't set up here.</p>}
        {sent ? (
          <>
            <p className="cc-signin__p">We sent a code to {sent}.</p>
            <OtpField label="Code" value={code} onChange={setCode} onComplete={verify} error={error} disabled={busy} inputRef={codeRef} />
            <div className="cc-signin__row">
              <Button variant="ghost" size="sm" onClick={() => void run(() => auth.sendCode(sent))} disabled={busy}>
                Send a new code
              </Button>
              <Button variant="ghost" size="sm" onClick={() => (setSent(null), setCode(""), setError(null))} disabled={busy}>
                Wrong address? Change it
              </Button>
            </div>
          </>
        ) : (
          <>
            <form onSubmit={send} noValidate>
              <Field label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={error} disabled={busy || !auth.available} />
              <Button className="cc-signin__send" variant="primary" type="submit" disabled={busy || !auth.available}>
                Email me a code
              </Button>
            </form>
            <p className="cc-signin__or">or</p>
            <div className="cc-signin__opts">
              <Button variant="ghost" onClick={() => void run(() => auth.oauth("apple"))} disabled={busy || !auth.available}>
                Continue with Apple
              </Button>
              <Button variant="ghost" onClick={() => void run(() => auth.oauth("google"))} disabled={busy || !auth.available}>
                Continue with Google
              </Button>
              <Button variant="ghost" onClick={() => void run(() => auth.wallet())} disabled={busy || !auth.available}>
                Connect a wallet
              </Button>
            </div>
          </>
        )}
        <p className="cc-signin__foot">Master control is where stations run their dial. Watching never needs an account.</p>
      </div>
    </main>
  );
}
