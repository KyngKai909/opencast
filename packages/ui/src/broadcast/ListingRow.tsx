import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { type TimeInput } from "../lib/format";
import { shortClock, stationStyle } from "./time";

interface ListingProps {
  variant?: "listing";
  /** The station: its thumb, channel and call sign. */
  station: { channel: string; callSign: string; colour: string };
  /** Signs after the call sign: <Tag variant="live">Live</Tag>, External. */
  tags?: ReactNode;
  /** What's on now. */
  title: ReactNode;
  /** How long it runs, or where it's carried from: "Until 9:30 pm, with questions from the room". */
  meta?: ReactNode;
  /** What's next. */
  next?: { at: TimeInput; title: ReactNode };
  timeZone?: string;
  className?: string;
}

interface LineProps {
  variant: "line";
  /** The label column: "On now", "Next", "Later". */
  label: ReactNode;
  /** A time under the label, in mono ("9:30"). */
  at?: TimeInput;
  title: ReactNode;
  /** The line under the title. */
  detail?: ReactNode;
  timeZone?: string;
  className?: string;
}

export type ListingRowProps = ListingProps | LineProps;

/**
 * One listing. "listing" is the style guide's row: one station, what's on now, how long it runs
 * and what's next. "line" is the station preview's row: a label column, then the program.
 */
export function ListingRow(props: ListingRowProps) {
  if (props.variant === "line") {
    const { label, at, title, detail, timeZone, className } = props;
    return (
      <div className={cx("oc-lst", className)}>
        <span className="oc-lst__lbl">
          {label}
          {at != null && <span className="oc-lst__at oc-mono">{shortClock(at, timeZone)}</span>}
        </span>
        <div>
          <b className="oc-lst__title">{title}</b>
          {detail != null && <small className="oc-lst__detail">{detail}</small>}
        </div>
      </div>
    );
  }
  const { station, tags, title, meta, next, timeZone, className } = props;
  return (
    <div className={cx("oc-listing", className)}>
      <div className="oc-listing__thumb" style={stationStyle(station.colour)} aria-hidden="true">
        {station.callSign}
      </div>
      <div>
        <div className="oc-listing__top">
          <span className="oc-listing__ch oc-ch">{station.channel}</span>
          <span className="oc-listing__cs oc-cs">{station.callSign}</span>
          {tags}
        </div>
        <div className="oc-listing__now">{title}</div>
        {meta != null && <p className="oc-listing__meta">{meta}</p>}
        {next && (
          <p className="oc-listing__next">
            Next <span className="oc-mono">{shortClock(next.at, timeZone)}</span> {next.title}
          </p>
        )}
      </div>
    </div>
  );
}
