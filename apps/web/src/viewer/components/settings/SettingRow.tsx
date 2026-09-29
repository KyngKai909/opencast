// A settings row (you 05.1 .set-pane .row, 06.3 .p-list .row): what it is, a line on what it does,
// and the control at the end. Groups have a quiet ruled head (.grp; the phone's .p-sec-h).

import { useId, type ReactNode } from "react";
import "./Settings.css";

export function SettingGroup({ children }: { children: ReactNode }) {
  return <h4 className="vw-set-grp">{children}</h4>;
}

export interface SettingRowProps {
  title: ReactNode;
  help?: ReactNode;
  /** The control, or a quiet value ("30 minutes"). Gets the row's words as its name. */
  control?: (ids: { labelId: string; helpId: string }) => ReactNode;
  value?: ReactNode;
  children?: ReactNode;
}

export function SettingRow({ title, help, control, value, children }: SettingRowProps) {
  const labelId = useId();
  const helpId = `${labelId}-help`;
  return (
    <div className="vw-set-row">
      <div className="vw-set-row__w">
        <b id={labelId}>{title}</b>
        {help && <small id={helpId}>{help}</small>}
        {children}
      </div>
      {control && <div className="vw-set-row__end">{control({ labelId, helpId })}</div>}
      {value !== undefined && <span className="vw-set-row__val">{value}</span>}
    </div>
  );
}
