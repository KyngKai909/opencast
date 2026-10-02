import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { waitlistApi } from "@opencast/contracts";
import { Button, Field, Icon, Segmented, Tally } from "@opencast/ui";
import { ApiError, NetworkError, call } from "../api/client";
import {
  COPY,
  ROLES,
  cleanCallSign,
  cleanZip,
  confirmation,
  fieldErrorsFrom,
  isCallSign,
  toBody,
  validate,
  type FieldErrors,
  type FieldName,
  type Joined,
  type Role
} from "../lib/waitlist";

const IDS: Record<FieldName, string> = { email: "st-em", zip: "st-zip", callSign: "st-cs" };
const ORDER: FieldName[] = ["email", "zip", "callSign"];

/** The value after `ms` without a change. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

export interface WaitlistProps {
  role: Role;
  onRoleChange(role: Role): void;
}

/** S.10 and S.11: the waitlist form, posting `waitlist.join`, and what it says once you're on. */
export function Waitlist({ role, onRoleChange }: WaitlistProps) {
  const [email, setEmail] = useState("");
  const [zip, setZip] = useState("");
  const [callSign, setCallSign] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [joined, setJoined] = useState<Joined | null>(null);
  const doneHeading = useRef<HTMLHeadingElement>(null);

  // The live check under the call sign: once it's three to five letters and has settled.
  const settledSign = useSettled(callSign, 300);
  const checkable = role === "station" && isCallSign(settledSign) && settledSign === callSign;
  const check = useQuery({
    queryKey: ["call-sign", settledSign],
    queryFn: ({ signal }) => call(waitlistApi.checkCallSign, { params: { callSign: settledSign }, signal }),
    enabled: checkable,
    staleTime: 30_000,
    retry: false
  });
  const checked = checkable && check.data?.callSign === callSign ? check.data : null;
  // Refused names say why (2026-09-29); a name someone else asked for can still be asked for.
  const liveError = !checked
    ? undefined
    : !checked.valid
      ? COPY.callSignShort
      : checked.refusal
        ? COPY.callSignRefused(checked.refusal.reason, checked.suggestions)
        : !checked.available && !checked.reservable
          ? COPY.callSignTaken(callSign)
          : undefined;
  const liveOk = checked && checked.valid && !checked.refusal ? (checked.available ? COPY.callSignFree(callSign) : checked.reservable ? COPY.callSignAlsoAsked(callSign) : undefined) : undefined;

  const join = useMutation({
    mutationFn: (body: ReturnType<typeof toBody>) => call(waitlistApi.join, { body }),
    onSuccess: (r) => setJoined(r),
    onError: (e) => {
      if (e instanceof NetworkError) return setFormError(COPY.offline);
      if (e instanceof ApiError) {
        if (e.code === "call_sign_taken" || e.code === "call_sign_refused") return showErrors({ callSign: e.message });
        const { fields, rest } = fieldErrorsFrom(e.fields);
        if (Object.keys(fields).length) showErrors(fields);
        setFormError(Object.keys(fields).length ? (rest[0] ?? null) : e.message);
        return;
      }
      setFormError("Something went wrong. Try again.");
    }
  });

  useEffect(() => {
    if (joined) doneHeading.current?.focus();
  }, [joined]);

  function showErrors(next: FieldErrors) {
    setErrors(next);
    const first = ORDER.find((f) => next[f]);
    if (first) document.getElementById(IDS[first])?.focus();
  }

  function clearError(f: FieldName) {
    if (errors[f]) setErrors((e) => ({ ...e, [f]: undefined }));
    setFormError(null);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (join.isPending) return;
    const draft = { role, email, zip, callSign };
    const found = validate(draft);
    if (role === "station" && liveError) found.callSign = found.callSign ?? liveError;
    setFormError(null);
    if (Object.keys(found).length) return showErrors(found);
    setErrors({});
    join.mutate(toBody(draft));
  }

  if (joined) {
    const { heading, paragraph } = confirmation(joined);
    return (
      <div className="st-done" role="status">
        <Tally state="lit" size="md" />
        <h3 ref={doneHeading} tabIndex={-1}>{heading}</h3>
        <p className="oc-muted">{paragraph}</p>
      </div>
    );
  }

  return (
    <form className="st-form" noValidate onSubmit={submit} aria-busy={join.isPending || undefined}>
      <div className="st-fl">
        <span className="st-fl__lb" aria-hidden="true">I'm joining as</span>
        <Segmented className="st-roles" label="I'm joining as" options={ROLES} value={role} onChange={(r) => { onRoleChange(r); clearError("callSign"); }} />
      </div>
      <Field
        className="st-fl"
        id={IDS.email}
        label="Email"
        type="email"
        placeholder="you@example.com"
        autoComplete="email"
        required
        value={email}
        error={errors.email}
        onChange={(e) => { setEmail(e.target.value); clearError("email"); }}
      />
      <Field
        className="st-fl"
        id={IDS.zip}
        label="ZIP code"
        inputMode="numeric"
        placeholder="92373"
        autoComplete="postal-code"
        required
        value={zip}
        error={errors.zip}
        onChange={(e) => { setZip(cleanZip(e.target.value)); clearError("zip"); }}
      />
      {role === "station" && (
        <Field
          className="st-fl st-fl--cs"
          id={IDS.callSign}
          label="Call sign you'd like"
          placeholder="BEAT"
          maxLength={5}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={callSign}
          help="Three to five letters. We'll hold it until your market opens."
          error={errors.callSign ?? liveError}
          ok={liveOk}
          onChange={(e) => { setCallSign(cleanCallSign(e.target.value)); clearError("callSign"); }}
        />
      )}
      {formError && (
        <p className="st-form__error" role="alert">
          <Icon name="warn" size={15} />
          {formError}
        </p>
      )}
      <Button variant="primary" block type="submit" className="st-btn" disabled={join.isPending}>
        Join the waitlist
      </Button>
      <p className="st-form__fine">Your ZIP decides your market. We don't share your email.</p>
    </form>
  );
}
