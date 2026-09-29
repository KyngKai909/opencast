// The six-digit code (you 01.2): one real input, so the phone's one-time-code autofill and paste
// work, drawn as six boxes with the next one ringed.

import { useId, type Ref } from "react";
import "./OtpField.css";

export interface OtpFieldProps {
  value: string;
  onChange: (digits: string) => void;
  /** Called when the sixth digit is typed. */
  onComplete?: (digits: string) => void;
  label: string;
  error?: string | null;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}

export function OtpField({ value, onChange, onComplete, label, error, disabled, inputRef }: OtpFieldProps) {
  const id = useId();
  const digits = value.slice(0, 6).split("");
  return (
    <div className={`vw-otp${error ? " vw-otp--error" : ""}`}>
      <div className="vw-otp__boxes">
        <input
          ref={inputRef}
          id={id}
          className="vw-otp__input"
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          disabled={disabled}
          value={value}
          onChange={(e) => {
            const next = e.target.value.replace(/\D/g, "").slice(0, 6);
            onChange(next);
            if (next.length === 6) onComplete?.(next);
          }}
        />
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={`vw-otp__box${i === Math.min(digits.length, 5) && !disabled ? " vw-otp__box--cur" : ""}`} aria-hidden="true">
            {digits[i] ?? ""}
          </span>
        ))}
      </div>
      {error && (
        <p className="vw-otp__error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
