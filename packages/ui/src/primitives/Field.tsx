import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cx } from "../lib/cx";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/glyphs";

interface FieldCommon {
  /** The label above the box (13px, semibold). Without one, pass aria-label. */
  label?: ReactNode;
  /** Quiet words after the label: "Everyone sees this", "Stations see this". */
  labelAside?: ReactNode;
  /** A quiet line under the box. */
  help?: ReactNode;
  /** A confirming line in signal with a check: "BEAT is free". */
  ok?: ReactNode;
  /** What's wrong, in standby amber with the warning sign. Wins over `ok`. */
  error?: ReactNode;
  /** Amounts, codes and times: IBM Plex Mono at 17px. */
  mono?: boolean;
  /** md is 44px; sm is 36px (a field inside a row or an option). */
  size?: "md" | "sm";
  /** An icon before the value. */
  icon?: IconName;
  /** Something at the end of the box: a text button ("Change"), a unit. */
  end?: ReactNode;
  className?: string;
  id?: string;
}

function useFieldIds(id: string | undefined, { help, ok, error }: Pick<FieldCommon, "help" | "ok" | "error">) {
  const auto = useId();
  const inputId = id ?? `oc-field-${auto}`;
  const helpId = help ? `${inputId}-help` : undefined;
  const stateId = error || ok ? `${inputId}-state` : undefined;
  const describedBy = [helpId, stateId].filter(Boolean).join(" ") || undefined;
  return { inputId, helpId, stateId, describedBy };
}

function FieldFrame({
  common,
  ids,
  boxClass,
  children
}: {
  common: FieldCommon & { disabled?: boolean };
  ids: ReturnType<typeof useFieldIds>;
  boxClass?: string;
  children: ReactNode;
}) {
  const { label, labelAside, help, ok, error, mono, size = "md", icon, end, className, disabled } = common;
  return (
    <div className={cx("oc-field", error ? "oc-field--error" : undefined, disabled && "oc-field--disabled", className)}>
      {label && (
        <label className="oc-field__label" htmlFor={ids.inputId}>
          {label}
          {labelAside && <span className="oc-field__aside"> {labelAside}</span>}
        </label>
      )}
      <div className={cx("oc-field__box", mono && "oc-field__box--mono", size === "sm" && "oc-field__box--sm", boxClass)}>
        {icon && <Icon name={icon} />}
        {children}
        {end}
      </div>
      {help && (
        <div className="oc-field__help" id={ids.helpId}>
          {help}
        </div>
      )}
      {error ? (
        <div className="oc-field__error" id={ids.stateId}>
          <Icon name="warn" size={15} />
          {error}
        </div>
      ) : ok ? (
        <div className="oc-field__ok" id={ids.stateId}>
          <Icon name="check" size={15} />
          {ok}
        </div>
      ) : null}
    </div>
  );
}

export type FieldProps = FieldCommon & Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "className" | "id">;

/** A text field: a real input in the reference's raised box, with its label and lines under it. */
export function Field({ label, labelAside, help, ok, error, mono, size, icon, end, className, id, ...input }: FieldProps) {
  const ids = useFieldIds(id, { help, ok, error });
  return (
    <FieldFrame common={{ label, labelAside, help, ok, error, mono, size, icon, end, className, disabled: input.disabled }} ids={ids}>
      <input
        id={ids.inputId}
        className="oc-field__input"
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
        {...input}
      />
    </FieldFrame>
  );
}

export type TextAreaFieldProps = Omit<FieldCommon, "size" | "icon" | "end"> & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className" | "id">;

/** A longer answer: "What it's about", "Anything to add". The box grows from 74px. */
export function TextAreaField({ label, labelAside, help, ok, error, mono, className, id, rows = 2, ...area }: TextAreaFieldProps) {
  const ids = useFieldIds(id, { help, ok, error });
  return (
    <FieldFrame common={{ label, labelAside, help, ok, error, mono, className, disabled: area.disabled }} ids={ids} boxClass="oc-field__box--area">
      <textarea
        id={ids.inputId}
        className="oc-field__input"
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
        {...area}
      />
    </FieldFrame>
  );
}

export type SelectFieldProps = Omit<FieldCommon, "end"> & Omit<SelectHTMLAttributes<HTMLSelectElement>, "size" | "className" | "id">;

/** A choice from a list that looks like the other fields, with the chevron at the end. A real select. */
export function SelectField({ label, labelAside, help, ok, error, mono, size, icon, className, id, children, ...select }: SelectFieldProps) {
  const ids = useFieldIds(id, { help, ok, error });
  return (
    <FieldFrame
      common={{ label, labelAside, help, ok, error, mono, size, icon, className, disabled: select.disabled }}
      ids={ids}
      boxClass="oc-field__box--select"
    >
      <select
        id={ids.inputId}
        className="oc-field__input"
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
        {...select}
      >
        {children}
      </select>
      <Icon name="down" className="oc-field__chev" />
    </FieldFrame>
  );
}
