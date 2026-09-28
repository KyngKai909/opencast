import type { CSSProperties, ReactNode } from "react";
import { cx } from "../lib/cx";
import { Lines } from "./Lines";

/** done: it happened (ink dot). current: where things stand now (standby dot). future: what will or may happen (quiet). */
export type TimelineState = "done" | "current" | "future";

export interface TimelineItem {
  state: TimelineState;
  /** When, as the page says it, in mono: "Oct 12, 3:10 pm", "Now", "By October 5", "If answered". Build times with clock(). */
  when: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
}

export interface TimelineProps {
  items: TimelineItem[];
  /** The width of the "when" column in px, from the frame: 120 (spots), 130 (rights). */
  whenWidth?: number;
  className?: string;
}

/**
 * What happened, where it stands and what comes next (.timeline, .tl-r): a dot, the time in mono,
 * and two lines. Done is an ink dot, current a standby dot, future rows read quieter.
 */
export function Timeline({ items, whenWidth = 120, className }: TimelineProps) {
  const style = { "--oc-timeline-when": `${whenWidth}px` } as CSSProperties;
  return (
    <ol className={cx("oc-timeline", className)} style={style}>
      {items.map((it, i) => (
        <li key={i} className={cx("oc-timeline__item", `oc-timeline__item--${it.state}`)} aria-current={it.state === "current" ? "step" : undefined}>
          <span className="oc-timeline__dot" aria-hidden="true" />
          <span className="oc-timeline__when">{it.when}</span>
          <div>
            {it.state === "done" && <span className="oc-sr-only">Done: </span>}
            {it.state === "future" && <span className="oc-sr-only">Not yet: </span>}
            <Lines title={it.title} detail={it.detail} />
          </div>
        </li>
      ))}
    </ol>
  );
}
