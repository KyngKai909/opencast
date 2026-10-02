// Signing in to Opencast for business: the reference's sign-in (viewer/you 01.1, 01.2). Email
// first, then Apple and Google.

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
    <main className="bz-signin">
      <div className="bz-signin__card">
        <p className="bz-signin__kicker">For business</p>
        <h1 className="bz-signin__h">Sign in to Opencast</h1>
        {!auth.available && <p className="bz-signin__note">Signing in isn't set up here.</p>}
        {sent ? (
          <>
            <p className="bz-signin__p">We sent a code to {sent}.</p>
            <OtpField label="Code" value={code} onChange={setCode} onComplete={verify} error={error} disabled={busy} inputRef={codeRef} />
            <div className="bz-signin__row">
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
              <Button className="bz-signin__send" variant="primary" type="submit" disabled={busy || !auth.available}>
                Email me a code
              </Button>
            </form>
            <p className="bz-signin__or">or</p>
            <div className="bz-signin__opts">
              <Button variant="ghost" onClick={() => void run(() => auth.oauth("apple"))} disabled={busy || !auth.available}>
                Continue with Apple
              </Button>
              <Button variant="ghost" onClick={() => void run(() => auth.oauth("google"))} disabled={busy || !auth.available}>
                Continue with Google
              </Button>
            </div>
          </>
        )}
        <p className="bz-signin__foot">Local spots on local stations, paid for only when they air.</p>
      </div>
    </main>
  );
}
