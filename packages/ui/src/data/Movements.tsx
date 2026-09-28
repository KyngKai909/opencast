import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { clock, money, type TimeInput } from "../lib/format";
import { Lines } from "./Lines";
import { Table, type Column } from "./Table";

/** hold: committed for a scheduled airing (standby). in: money arriving. out: money spent or taken out. */
export type MovementKind = "hold" | "in" | "out";

export interface Movement {
  id: string;
  /** The day as the page says it ("Tonight", "Friday", "Sept 1"). */
  day: ReactNode;
  /** When on that day; left off for whole-day lines such as a bank transfer. */
  at?: TimeInput;
  title: ReactNode;
  detail?: ReactNode;
  /** Micros. Out is negative, in and hold positive. */
  amount: number;
  kind: MovementKind;
}

export interface MovementsProps {
  items: Movement[];
  /** The market's time zone for the times. */
  timeZone?: string;
  /** The list's accessible name. Default "Every movement". */
  label?: string;
  className?: string;
}

const columns = (timeZone?: string): Column<Movement>[] => [
  {
    key: "when",
    header: "When",
    width: "110px",
    className: "oc-moves__when",
    cell: (m) => (
      <>
        {m.day}
        {m.at !== undefined && (
          <>
            <br />
            {clock(m.at, { timeZone })}
          </>
        )}
      </>
    )
  },
  { key: "what", header: "What", cell: (m) => <Lines title={m.title} detail={m.detail} /> },
  {
    key: "amount",
    header: "Amount",
    width: "120px",
    align: "end",
    cell: (m) => (
      <span className={cx("oc-moves__m", `oc-moves__m--${m.kind}`)}>
        {money(m.amount, { sign: m.kind === "in" })}
        {m.kind === "hold" && <small> held</small>}
      </span>
    )
  }
];

/**
 * Every movement on a balance (.act): the day and time, what happened, and the amount. Held money
 * reads in standby with "held" after it; money in gets a "+"; money out reads quieter with a minus.
 */
export function Movements({ items, timeZone, label = "Every movement", className }: MovementsProps) {
  return (
    <Table<Movement>
      className={cx("oc-moves", className)}
      label={label}
      columns={columns(timeZone)}
      rows={items}
      rowKey={(m) => m.id}
      header="hidden"
      rowPadding={10}
      gap={14}
    />
  );
}
