// Sign-in (you 01): asked for when someone saves, reminds or pledges, and named for it ("To save
// CIVC 7.1 as a preset"). Email first with a six-digit code, then Apple and Google (no wallet for
// viewers: open question A4). A first sign-in asks two skippable questions; then the button that
// names the action finishes it and goes straight back. A Modal on the web; full screens on the phone.
//
// Closing sign-in before signing in keeps a preset or reminder on this device instead (the toast
// says so and can undo it): "Presets and reminders made before signing in are kept on the device
// and offered to the account afterwards."

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { accountsApi } from "@opencast/contracts";
import { Button, Checkbox, Field, Lockup, Modal, useToast } from "@opencast/ui";
import { call } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import type { SignInReasonX } from "../../data/viewer";
import { getDevice, setDevice } from "../../device/store";
import { useIsPhone } from "../../layout/shell";
import { OtpField } from "../you/OtpField";
import { PhoneScreen } from "../you/PhoneScreen";
import { asksAnything, completeFirstSignIn, firstSignInQuestions, introLine, keepLine, looksLikeEmail, type Held, type Questions } from "../you/signInFlow";
import "./SignInModal.css";

export default function SignInModal() {
  const auth = useAuth();
  if (!auth.signIn.open) return null;
  return <SignInFlow />;
}

type Step = "email" | "code" | "first";

function SignInFlow() {
  const auth = useAuth();
  const phone = useIsPhone();
  const toast = useToast();
  const reason = (auth.signIn.reason ?? { kind: "general" }) as SignInReasonX;
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState(auth.email ?? "");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The first sign-in's questions.
  const [held, setHeld] = useState<Held>({ presets: [], reminders: [] });
  const [questions, setQuestions] = useState<Questions>({ keep: false, nameMissing: false });
  const [keep, setKeep] = useState(true);
  const [name, setName] = useState("");
  const [currentName, setCurrentName] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  // The code box keeps focus through a wrong code and a new code (it's disabled while checking).
  useEffect(() => {
    if (step === "code" && !busy) codeRef.current?.focus();
  }, [step, busy]);

  const eyebrow = reason.label ? `To ${reason.label}` : undefined;
  const finishLabel = reason.finish ?? "Done";
  const device = phone ? "phone" : "device";

  /** Runs the action that opened sign-in; if it fails now, the toast gives the API's words. */
  const finish = async () => {
    try {
      await auth.finishSignIn();
    } catch (e) {
      toast.show({ message: (e as Error).message });
    }
  };

  /** Signed in: ask the first sign-in's questions, or go straight back. */
  const afterSignedIn = async () => {
    const me = await call(accountsApi.getMe).catch(() => null);
    const d = getDevice();
    const h = { presets: d.presets, reminders: d.reminders };
    const q = firstSignInQuestions(h, me);
    if (!asksAnything(q)) return finish();
    setHeld(h);
    setQuestions(q);
    setName(me?.displayName ?? "");
    setCurrentName(me?.displayName ?? null);
    setError(null);
    setStep("first");
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sendCode = (e?: FormEvent) => {
    e?.preventDefault();
    if (!looksLikeEmail(email)) {
      setError("Enter your email address, like name@example.com.");
      return;
    }
    void run(async () => {
      await auth.sendCode(email.trim());
      setCode("");
      setNote(null);
      setStep("code");
    });
  };

  const verify = (digits: string) =>
    run(async () => {
      try {
        await auth.verifyCode(digits);
      } catch (err) {
        setCode("");
        throw err;
      }
      await afterSignedIn();
    });

  const resend = () =>
    run(async () => {
      await auth.sendCode(email.trim());
      setCode("");
      setNote(`We sent a new code to ${email.trim()}.`);
    });

  const oauth = (provider: "apple" | "google") =>
    run(async () => {
      await auth.oauth(provider);
      await afterSignedIn();
    });

  const goBack = () =>
    run(() =>
      completeFirstSignIn(
        { keep: questions.keep && keep, held, name, currentName },
        {
          mergeDevice: async (h) => {
            await call(accountsApi.mergeDevice, {
              body: {
                presets: h.presets.map((p) => ({ stationId: p.stationId, key: p.key })),
                reminders: h.reminders.map((r) => ({ logEntryId: r.logEntryId, listedAiringId: r.listedAiringId, switchMeOver: r.switchMeOver }))
              }
            });
          },
          clearDevice: () => setDevice({ presets: [], reminders: [] }),
          updateName: async (n) => {
            await call(accountsApi.updateMe, { body: { displayName: n } });
          },
          finish
        }
      )
    );

  /** Closing: before signing in it keeps the action on this device where it can; after, it skips the questions. */
  const close = () => {
    if (step === "first") void finish();
    else auth.cancelSignIn({ keepOnDevice: auth.canKeepOnDevice });
  };

  // ---------- The steps' bodies ----------

  const emailBody = (
    <form className="vw-signin" onSubmit={sendCode} noValidate>
      <Field
        type="email"
        icon="mail"
        aria-label="Email"
        placeholder="Email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={error ?? undefined}
        data-autofocus
        autoFocus={!phone}
      />
      <Button variant="primary" block type="submit" className="vw-signin__send" disabled={busy}>
        Email me a code
      </Button>
      <div className="vw-signin__or">or</div>
      <div className="vw-signin__opts">
        <Button variant="ghost" onClick={() => void oauth("apple")} disabled={busy}>
          <span className="vw-signin__lg" aria-hidden="true">
            A
          </span>
          Continue with Apple
        </Button>
        <Button variant="ghost" onClick={() => void oauth("google")} disabled={busy}>
          <span className="vw-signin__lg" aria-hidden="true">
            G
          </span>
          Continue with Google
        </Button>
      </div>
      <p className="vw-signin__why">Watching never needs an account. Signing in keeps your presets, reminders and pledges on every device and TV.</p>
    </form>
  );

  const codeBody = (
    <div className="vw-signin vw-signin--code">
      <p className="vw-signin__lede">
        We sent a six-digit code to <b>{email.trim()}</b>. It works for 10 minutes.
      </p>
      <OtpField inputRef={codeRef} label="Six-digit code" value={code} onChange={setCode} onComplete={(d) => void verify(d)} error={error} disabled={busy} />
      <p className="vw-signin__hint" aria-live="polite">
        {note ?? "It fills in by itself if your phone offers it."}
      </p>
      <Button variant="ghost" block className="vw-signin__resend" onClick={() => void resend()} disabled={busy}>
        Send a new code
      </Button>
      <p className="vw-signin__change">
        Wrong address?{" "}
        <button type="button" className="vw-signin__link" onClick={() => (setError(null), setStep("email"))}>
          Change it
        </button>
      </p>
    </div>
  );

  const firstQuestions = (
    <div className="vw-signin__qs">
      {questions.keep && (
        <Checkbox className="vw-signin__keep" ruled={false} checked={keep} onChange={setKeep} label={`Keep what's on this ${device}`} helper={keepLine(held)} />
      )}
      <div className="vw-signin__name">
        <Field label="What stations call you" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" help="Only used if you ask to be credited on air when you pledge." />
      </div>
      {error && (
        <p className="vw-signin__err" role="alert">
          {error}
        </p>
      )}
    </div>
  );
  const goBackButton = (
    <Button variant="primary" block onClick={() => void goBack()} disabled={busy}>
      {finishLabel}
    </Button>
  );

  // ---------- Phone: full screens ----------

  if (phone) {
    let screen: ReactNode;
    if (step === "email")
      screen = (
        <PhoneScreen label="Sign in to Opencast" title="Sign in to Opencast" onBack={close} onClose={close}>
          {eyebrow && <p className="vw-signin__lede vw-signin__reason">{eyebrow}</p>}
          {emailBody}
        </PhoneScreen>
      );
    else if (step === "code")
      screen = (
        <PhoneScreen label="Check your email" title="Check your email" onBack={() => (setError(null), setStep("email"))} onClose={close}>
          {codeBody}
        </PhoneScreen>
      );
    else
      screen = (
        <PhoneScreen label="You're signed in." onClose={close}>
          <Lockup size="phone" className="vw-signin__lockup" />
          <h2 className="vw-signin__h" data-autofocus tabIndex={-1}>
            You're signed in.
          </h2>
          <p className="vw-signin__lede">{introLine(questions, reason.backTo)}</p>
          {firstQuestions}
          <div className="vw-signin__bottom">{goBackButton}</div>
        </PhoneScreen>
      );
    return screen;
  }

  // ---------- Web: one modal ----------

  if (step === "first")
    return (
      <Modal open onClose={close} width={440} title="You're signed in." subtitle={introLine(questions, reason.backTo)} footer={goBackButton}>
        {firstQuestions}
      </Modal>
    );
  return (
    <Modal open onClose={close} width={440} eyebrow={eyebrow} title={step === "email" ? "Sign in to Opencast" : "Check your email"}>
      {step === "email" ? emailBody : codeBody}
    </Modal>
  );
}
