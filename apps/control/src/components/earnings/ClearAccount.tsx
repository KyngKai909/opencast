// The station's Clear account (earnings 02.1, 04.2): where its money settles, what's available now,
// and, on the web, the owner's Move to bank beside Statements.

import type { ReactNode } from "react";
import { money } from "@opencast/ui";
import "./ClearAccount.css";

export interface ClearAccountProps {
  /** "BEAT", "Inland Sound Lab". */
  name: string;
  availableMicros: number;
  /** "Available now. $1,472.78 has been paid out this month." or "Pays out Monday". */
  line: ReactNode;
  actions?: ReactNode;
  /** The phone's smaller box. */
  compact?: boolean;
}

export function ClearAccount({ name, availableMicros, line, actions, compact }: ClearAccountProps) {
  return (
    <div className={`cc-clear${compact ? " cc-clear--compact" : ""}`}>
      <span className="cc-clear__tag">
        <i aria-hidden="true" />
        {name}'s Clear account
      </span>
      <div className="cc-clear__v">{money(availableMicros)}</div>
      <small className="cc-clear__line">{line}</small>
      {actions && <div className="cc-clear__acts">{actions}</div>}
    </div>
  );
}
