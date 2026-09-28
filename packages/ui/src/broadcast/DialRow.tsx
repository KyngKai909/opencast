import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { cx } from "../lib/cx";
import { clock, type TimeInput } from "../lib/format";
import { Tag } from "../primitives/Tag";
import { Button } from "../primitives/Button";
import { TitleCard } from "./TitleCard";
import { LiveText } from "./LiveText";
import { clockAfter } from "./time";

export type DialRowVariant =
  | "web"      /* the web dial (.drow) */
  | "phone"    /* the phone dial (.prow) */
  | "preview"  /* master control's "On the dial" preview (.mini-listing) */
  | "radio"    /* home's radio band block (.rt) */
  | "band";    /* the radio band page's list (.rbr) */

export interface DialStation {
  /** "12.1", or a frequency on the radio band, "88.3". */
  channel: string;
  callSign: string;
  /** "Inland Beat". */
  name?: string;
  colour: string;
}

export interface DialNow {
  /** What's on. */
  title: string;
  /** When it ends. */
  until?: TimeInput;
  /** A live program: the Live tag (red text on the radio rows). */
  live?: boolean;
  /** A city's own stream Opencast lists but doesn't restream: the dashed Listed tag. */
  listed?: boolean;
  /** The station it's carried from: "REEL". */
  carriedFrom?: string;
  /** Signed off. `until` is then when it signs on again. */
  offAir?: boolean;
  /** Replaces the generated line under the title ("Radio band" in a thin market; an episode). */
  detail?: ReactNode;
}

export interface DialNext {
  at: TimeInput;
  title: string;
  live?: boolean;
}

export interface DialRowProps {
  station: DialStation;
  now: DialNow;
  next?: DialNext;
  variant?: DialRowVariant;
  /** The current time, so "Next" drops am/pm when it's the same half of the day. */
  at?: TimeInput;
  timeZone?: string;
  /** The station you're watching. Drawn as the tally edge where the reference draws it (the radio band list). */
  watching?: boolean;
  /** A click on the row tunes in. */
  onTune?: () => void;
  /** The ident (channel and call sign) opens the station preview. */
  onOpenStation?: () => void;
  className?: string;
}

const OFF_AIR = "Off air";

function untilLine(now: DialNow, timeZone?: string): ReactNode {
  if (now.offAir) return now.until != null ? <span>Signs on again at <span className="oc-mono">{clock(now.until, { timeZone })}</span></span> : null;
  return now.until != null ? (
    <span>
      Until <span className="oc-mono">{clock(now.until, { timeZone })}</span>
    </span>
  ) : null;
}

/**
 * One station on the dial, in channel order: what's on, when it ends, what's next. A click tunes
 * in; the ident opens the station preview. Live, Listed, Off air and carried say so in words.
 */
export function DialRow({ station, now, next, variant = "web", at, timeZone, watching, onTune, onOpenStation, className }: DialRowProps) {
  const title = now.offAir ? OFF_AIR : now.title;
  const where = `${station.callSign} ${station.channel}`;
  const tuneLabel = `Tune in to ${where}`;
  const identLabel = `${where}${station.name ? `, ${station.name}` : ""}: station preview`;
  const nextAt = (t: TimeInput) => (at != null ? clockAfter(t, at, timeZone) : clock(t, { timeZone, suffix: false }));

  const onRowClick = () => onTune?.();
  const onIdentClick = (e: MouseEvent) => {
    e.stopPropagation();
    onOpenStation?.();
  };
  const onIdentKey = (e: KeyboardEvent) => e.stopPropagation();

  const classes = cx(
    "oc-dial-row",
    `oc-dial-row--${variant}`,
    now.offAir && "oc-dial-row--off",
    watching && variant === "band" && "oc-dial-row--watching",
    onTune && "oc-dial-row--tunes",
    className
  );
  const rowProps = { className: classes, onClick: onRowClick, "aria-current": watching ? ("true" as const) : undefined };

  const ident = (children: ReactNode, cls: string) =>
    onOpenStation ? (
      <button type="button" className={cx("oc-dial-row__ident", cls)} onClick={onIdentClick} onKeyDown={onIdentKey} aria-label={identLabel}>
        {children}
      </button>
    ) : (
      <span className={cls}>{children}</span>
    );

  // The program title is the row's keyboard control for tuning; its click bubbles to the row.
  const tune = (children: ReactNode, cls: string) =>
    onTune ? (
      <button type="button" className={cx("oc-dial-row__tune", cls)} aria-label={`${tuneLabel}: ${title}`}>
        {children}
      </button>
    ) : (
      <span className={cls}>{children}</span>
    );

  if (variant === "web") {
    return (
      <div {...rowProps}>
        <TitleCard colour={station.colour} title={title} size="dial" decorative />
        {ident(
          <>
            <span className="oc-dial-row__ch oc-ch">{station.channel}</span>
            <span className="oc-dial-row__stn">
              <span className="oc-cs">{station.callSign}</span>
              {station.name && <small>{station.name}</small>}
            </span>
          </>,
          "oc-dial-row__who"
        )}
        {tune(
          <>
            <b className="oc-clamp1">{title}</b>
            <small>
              {now.detail ?? (
                <>
                  {now.live && <Tag variant="live">Live</Tag>}
                  {now.listed && <Tag variant="listed">Listed</Tag>}
                  {now.carriedFrom && <span>Carried from {now.carriedFrom}</span>}
                  {untilLine(now, timeZone)}
                </>
              )}
            </small>
          </>,
          "oc-dial-row__now"
        )}
        <span className="oc-dial-row__nx">
          {next && (
            <>
              <span className="oc-mono">{nextAt(next.at)}</span>
              {next.title}
              {next.live && (
                <>
                  {" "}
                  <LiveText />
                </>
              )}
            </>
          )}
        </span>
      </div>
    );
  }

  if (variant === "phone" || variant === "preview") {
    const line =
      now.detail ??
      (now.offAir
        ? untilLine(now, timeZone)
        : now.until != null
          ? `${now.carriedFrom ? `From ${now.carriedFrom}, until` : "Until"} ${clock(now.until, { timeZone })}`
          : now.carriedFrom
            ? `From ${now.carriedFrom}`
            : null);
    return (
      <div {...rowProps}>
        {ident(<span className="oc-dial-row__ch oc-ch">{station.channel}</span>, "oc-dial-row__who")}
        {tune(
          <>
            <span className="oc-dial-row__top">
              <span className="oc-cs">{station.callSign}</span>
              {now.live && <Tag variant="live">Live</Tag>}
              {now.listed && <Tag variant="listed">Listed</Tag>}
            </span>
            <b className={variant === "phone" ? "oc-clamp1" : undefined}>{title}</b>
            {line != null && <small>{line}</small>}
          </>,
          "oc-dial-row__w"
        )}
        <TitleCard colour={station.colour} title={station.callSign} size="row" decorative />
      </div>
    );
  }

  if (variant === "radio") {
    return (
      <div {...rowProps}>
        {ident(<span className="oc-dial-row__f">{station.channel}</span>, "oc-dial-row__who")}
        {tune(
          <>
            <span className="oc-cs">{station.callSign}</span>
            <small className="oc-clamp1">
              {now.live && (
                <>
                  <LiveText />{" "}
                </>
              )}
              {title}
            </small>
          </>,
          "oc-dial-row__w"
        )}
      </div>
    );
  }

  // band: the radio band page's list, with the tally edge on the station you're on.
  return (
    <div {...rowProps}>
      {ident(<span className="oc-dial-row__f">{station.channel}</span>, "oc-dial-row__who")}
      <span className="oc-dial-row__cs oc-cs">{station.callSign}</span>
      <div className="oc-dial-row__w">
        <b>{title}</b>
        {now.detail != null ? <small>{now.detail}</small> : now.live ? <small><LiveText /></small> : null}
      </div>
      <span className="oc-dial-row__nx">
        {next && (
          <>
            Next at <span className="oc-mono">{nextAt(next.at)}</span> {next.title}
          </>
        )}
      </span>
      <span className="oc-dial-row__end">
        {watching ? (
          <Tag>You're here</Tag>
        ) : onTune ? (
          <Button size="sm" aria-label={tuneLabel}>
            Tune in
          </Button>
        ) : null}
      </span>
    </div>
  );
}
