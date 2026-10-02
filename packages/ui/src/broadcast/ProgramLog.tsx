import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { clock, duration, type TimeInput } from "../lib/format";
import { LogCode, type LogCodeName } from "./LogCode";

export interface LogLine {
  id: string;
  /** When it airs. */
  at: TimeInput;
  code: LogCodeName;
  title: ReactNode;
  /** Where it comes from: "From your library", "Spot market, per view". */
  source?: ReactNode;
  /** How long it runs, in milliseconds. */
  length: number;
}

export interface ProgramLogProps {
  lines: LogLine[];
  /** The line on air now: it carries the tally edge. */
  airingId?: string;
  timeZone?: string;
  className?: string;
}

/** The program log, to the second (style guide, Program log). The line on air carries a tally edge. */
export function ProgramLog({ lines, airingId, timeZone, className }: ProgramLogProps) {
  return (
    <table className={cx("oc-log", className)}>
      <thead>
        <tr>
          <th scope="col">Airs</th>
          <th scope="col">Code</th>
          <th scope="col">Item</th>
          <th scope="col" className="oc-log__d">
            Runs
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => {
          const airing = l.id === airingId;
          return (
            <tr key={l.id} className={cx(airing && "oc-log__airing")} aria-current={airing ? "true" : undefined}>
              <td className="oc-log__t">
                {airing && <span className="oc-sr-only">On air: </span>}
                {clock(l.at, { timeZone, seconds: true, suffix: false })}
              </td>
              <td>
                <LogCode code={l.code} size="guide" />
              </td>
              <td>
                {l.title}
                {l.source != null && <span className="oc-log__src">{l.source}</span>}
              </td>
              <td className="oc-log__d">{duration(l.length)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
