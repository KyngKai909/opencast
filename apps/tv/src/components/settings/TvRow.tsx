// One row of TV settings (tv-update 04.1 .trow): a title, a line under it, and its value on the
// right. The focused row shows ◀ value ▶ when it has options; a switch shows as a switch. Rows
// with nothing to change aren't focusable (they're read, not chosen).

import type { ReactNode } from "react";
import { cx } from "@opencast/ui";
import { useTvFocusable } from "../../tv/focus";
import "./TvRow.css";

export type RowControl =
  | { type: "step"; label: string; first: boolean; last: boolean }
  | { type: "switch"; checked: boolean }
  | { type: "value"; label: string }
  | { type: "none" };

export interface TvRowProps {
  /** Its focus key; leave it out for a row that's only read. */
  fk?: string;
  title: ReactNode;
  help?: ReactNode;
  /** Under the help (the caption preview). */
  extra?: ReactNode;
  control: RowControl;
  onSelect?: () => void;
  onFocus?: () => void;
}

export function TvRow({ fk, title, help, extra, control, onSelect, onFocus }: TvRowProps) {
  const f = useTvFocusable({ focusKey: fk, focusable: !!fk, onSelect, onFocus });
  const on = !!fk && f.focused;
  const valueText = control.type === "step" || control.type === "value" ? control.label : control.type === "switch" ? (control.checked ? "On" : "Off") : undefined;
  return (
    <div
      ref={f.ref}
      className={cx("tvs-row", on && "tvs-row--focus")}
      tabIndex={fk ? -1 : undefined}
      role={control.type === "switch" ? "switch" : fk ? "button" : undefined}
      aria-checked={control.type === "switch" ? control.checked : undefined}
      aria-label={fk && typeof title === "string" ? (valueText ? `${title}: ${valueText}` : title) : undefined}
      onClick={fk ? () => (f.focusSelf(), onSelect?.()) : undefined}
    >
      <div className="tvs-row__words">
        <b className="tvs-row__title">{title}</b>
        {help && <small className="tvs-row__help">{help}</small>}
        {extra}
      </div>
      {control.type === "step" && (
        <span className="tvs-row__val">
          {on && (
            <span className={cx("tvs-row__arr", control.first && "tvs-row__arr--end")} aria-hidden="true">
              &#9664;
            </span>
          )}
          {control.label}
          {on && (
            <span className={cx("tvs-row__arr", control.last && "tvs-row__arr--end")} aria-hidden="true">
              &#9654;
            </span>
          )}
        </span>
      )}
      {control.type === "value" && <span className="tvs-row__val">{control.label}</span>}
      {control.type === "switch" && <span className={cx("tvs-switch", !control.checked && "tvs-switch--off")} aria-hidden="true" />}
    </div>
  );
}
