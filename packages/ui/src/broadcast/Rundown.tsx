import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { clock, duration, type TimeInput } from "../lib/format";
import { LogCode, type LogCodeName } from "./LogCode";

export interface RundownItem {
  id: string;
  /** When it airs, to the second. */
  at: TimeInput;
  /** Its log code; OPEN for unsold time that holds on the station ID slate. */
  code: LogCodeName;
  title: ReactNode;
  /** The line under the title: "Carried from REEL 24.1", "REEL's break time, barter". */
  source?: ReactNode;
  /** Milliseconds. */
  length: number;
}

export interface RundownProps {
  items: RundownItem[];
  /** The item on air: the tally edge. */
  nowId?: string;
  /** full: the Monitor's rundown. compact: master control on the phone (title only, smaller). */
  variant?: "full" | "compact";
  timeZone?: string;
  className?: string;
}

/** The Monitor's to-the-second list of what airs next (master control A5, P). */
export function Rundown({ items, nowId, variant = "full", timeZone, className }: RundownProps) {
  return (
    <div className={cx("oc-rundown", variant === "compact" && "oc-rundown--compact", className)} role="list">
      {items.map((it) => {
        const now = it.id === nowId;
        return (
          <div key={it.id} role="listitem" className={cx("oc-rd", now && "oc-rd--now")} aria-current={now ? "true" : undefined}>
            <span className="oc-rd__t">
              {now && <span className="oc-sr-only">On air: </span>}
              {clock(it.at, { timeZone, seconds: true, suffix: false })}
            </span>
            <span>
              <LogCode code={it.code} />
            </span>
            {variant === "compact" ? (
              <div className="oc-clamp1">{it.title}</div>
            ) : (
              <div>
                <b className="oc-rd__title">{it.title}</b>
                {it.source != null && <small>{it.source}</small>}
              </div>
            )}
            <span className="oc-rd__d">{duration(it.length)}</span>
          </div>
        );
      })}
    </div>
  );
}
