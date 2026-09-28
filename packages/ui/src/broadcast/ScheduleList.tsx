import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import type { TimeInput } from "../lib/format";
import { IconButton } from "../primitives/Button";
import { clockColumn, ms, shortClock } from "./time";

export interface ScheduleItem {
  id: string;
  start: TimeInput;
  /** When it ends. Defaults to the next item's start. */
  end?: TimeInput;
  title: ReactNode;
  /** The line under it. Compose Live with <LiveText />: "Live, from the Redlands studio". */
  subtitle?: ReactNode;
}

export type ScheduleStatus = "past" | "now" | "next";

export interface ScheduleListProps {
  items: ScheduleItem[];
  /** The current time: past rows fade, the row on now gets the tally edge. */
  now?: TimeInput;
  /** tonight: the tuned-in rail (.sch). week: the station page (.sch2), with am/pm where it changes. week-phone: the phone's station page. */
  variant?: "tonight" | "week" | "week-phone";
  /** A heading above the rows: "On BEAT tonight". */
  heading?: ReactNode;
  /** Future rows get a bell (week): remind me about this one. */
  onRemind?: (item: ScheduleItem) => void;
  timeZone?: string;
  className?: string;
}

/** Past, now or next for each row, from the time. */
export function scheduleStatus(items: ScheduleItem[], now?: TimeInput): ScheduleStatus[] {
  if (now == null) return items.map(() => "next");
  const t = ms(now);
  return items.map((it, i) => {
    const s = ms(it.start);
    const e = it.end != null ? ms(it.end) : i + 1 < items.length ? ms(items[i + 1].start) : Infinity;
    if (t >= e) return "past";
    if (t >= s) return "now";
    return "next";
  });
}

/** A station's schedule, with the tally edge on the program on now. */
export function ScheduleList({ items, now, variant = "tonight", heading, onRemind, timeZone, className }: ScheduleListProps) {
  const status = scheduleStatus(items, now);
  const week = variant !== "tonight";
  const times = week ? clockColumn(items.map((i) => i.start), timeZone) : items.map((i) => shortClock(i.start, timeZone));
  const row = week ? "oc-sch2" : "oc-sch";
  return (
    <div className={cx("oc-schedule", `oc-schedule--${variant}`, className)}>
      {heading != null && <h4 className="oc-schedule__h">{heading}</h4>}
      <div role="list">
        {items.map((it, i) => {
          const st = status[i];
          return (
            <div key={it.id} role="listitem" className={cx(row, st !== "next" && `${row}--${st}`)} aria-current={st === "now" ? "true" : undefined}>
              <span className="oc-mono">{times[i]}</span>
              <div>
                <b>
                  {st === "now" && <span className="oc-sr-only">On now: </span>}
                  {it.title}
                </b>
                {it.subtitle != null && <small>{it.subtitle}</small>}
              </div>
              {variant === "week" &&
                (st === "next" && onRemind ? <IconButton icon="bell" label="Remind me" bare onClick={() => onRemind(it)} /> : <span />)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
