import type { ReactNode } from "react";
import { Icon, ProgressBar, Tag, Tally, Kbd, clock, cx } from "@opencast/ui";
import type { Channel } from "../types";
import type { Hint } from "../input/types";

export interface BannerProps {
  channel: Channel;
  size: "web" | "tv";
  /** The clock's time, and the market's time zone. */
  now: Date;
  timeZone?: string;
  /** The hint row (TV): key hints, or where the controls are when casting or mirroring. */
  hints?: Hint[];
  /** Where Back goes: "Last channel, CIVC 7.1". */
  backTo?: string | null;
  /** The tally lights only when this screen is really showing the station on air. */
  onAirHere: boolean;
}

function ident(c: Channel) {
  return [c.station.callSign, c.station.channel].filter(Boolean).join(" ");
}

/**
 * The banner on every channel change: who you're watching, what's on and how far in, what's
 * next, the clock and the tally. It covers the station's bug while it's up (it carries the same
 * ident) and hides after five seconds. A progress bar, never a scrub bar.
 */
export function Banner({ channel: c, size, now, timeZone, hints = [], backTo, onAirHere }: BannerProps) {
  const air = c.now;
  const next = c.next;
  // An external station (follow-up Phase 6): the "External" tag, Live and whose stream it is. With
  // nothing scheduled, the station's name and no progress bar: never a made-up title.
  const external = c.station.kind === "listed" ? (c.external ?? null) : null;
  const source: ReactNode =
    c.station.kind === "listed" ? (
      <ExternalFrom source={external?.source ?? null} />
    ) : air?.carriedFrom ? (
      `Carried from ${[air.carriedFrom.callSign, air.carriedFrom.channel].filter(Boolean).join(" ")}`
    ) : air?.live ? (
      size === "tv" ? (
        <LiveFrom note={(air as { note?: string | null }).note} />
      ) : (
        "Live"
      )
    ) : null;
  const title = air ? air.title : c.station.kind === "listed" && c.onAir ? c.station.name : "Off air";
  // A244: a programming block's member: "Late Crate Nights · Saturday Reel" (the block lighter). The
  // Next line names the block only when the next program enters another one.
  const block = air && air.kind !== "off_air" ? (air.block ?? null) : null;
  const nextBlock = next?.block && next.block.id !== block?.id ? next.block : null;
  // Casting or mirroring, the hint row says where the controls are, and Back isn't a key there.
  // Casting and mirroring show only a chip: the phone has the controls, so there's no Back hint.
  // The TV app keeps its key hints beside a phone's chip, and Back still works there.
  const chip = hints.some((h) => h.kind === "chip") && !hints.some((h) => h.kind !== "chip");
  return (
    // Dark glass on both grounds: its words and the progress bar take the dark ground's ink (on the
    // light ground they drew dark on dark, axe color-contrast on the web's radio page).
    <div className={cx("oc-banner", `oc-banner--${size}`)} data-theme="dark" role="status" aria-live="polite" aria-label={`${ident(c)}, ${c.station.name}${air ? `: ${air.title}` : ""}`}>
      <div className="oc-banner__id">
        <span className="oc-banner__ch oc-mono">{c.station.channel}</span>
        <span className="oc-banner__cs oc-cs">{c.station.callSign ?? c.station.handle}</span>
        <small>{c.station.name}</small>
      </div>
      <div className="oc-banner__now">
        {source && <span className="oc-banner__src">{source}</span>}
        <h3 aria-label={block ? `${block.name} · ${title}` : undefined}>
          {block && (
            <span className="oc-banner__blk">
              {block.name}
              <span aria-hidden="true"> · </span>
            </span>
          )}
          {title}
        </h3>
        {air && air.kind !== "off_air" && <ProgressBar start={air.startsAt} end={air.endsAt} now={now} timeZone={timeZone} size={size === "tv" ? "tv" : "sm"} />}
        {next && (
          <div className="oc-banner__nx">
            Next at <span className="oc-mono">{clock(next.startsAt, { timeZone, suffix: false })}</span>
            <b>
              {next.title}
              {nextBlock && <span className="oc-banner__nxb"> · {nextBlock.name}</span>}
            </b>
            {next.live && <Tag variant="live">Live</Tag>}
          </div>
        )}
      </div>
      <div className="oc-banner__side">
        <span className="oc-banner__clock oc-mono">{clock(now, { timeZone })}</span>
        <Tally state={onAirHere ? "lit" : "unlit"} size={size === "tv" ? "tv" : "sm"} on="picture" flicker={false} />
      </div>
      {(hints.length > 0 || (backTo && !chip)) && (
        <div className="oc-banner__hints">
          {hints.map((h, i) =>
            h.kind === "key" ? (
              <span key={i}>
                {h.hold && "Hold"}
                <Kbd size={size === "tv" ? "tv" : "app"}>{h.key}</Kbd>
                {h.label}
              </span>
            ) : (
              <span key={i} className="oc-banner__chip">
                <Icon name={h.label.startsWith("Mirrored") ? "phone" : "cast"} size={size === "tv" ? 30 : 18} />
                {h.label}
              </span>
            )
          )}
          {hints.map((h, i) => h.kind === "chip" && h.detail && (
            <span key={`d${i}`} className="oc-banner__end">
              {h.detail}
            </span>
          ))}
          {backTo && !chip && (
            <span className="oc-banner__end">
              <Kbd size={size === "tv" ? "tv" : "app"}>Back</Kbd>
              {backTo}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** An external station's line: the dashed "External" tag, then "Live from City of Colton" (the source's own stream). */
function ExternalFrom({ source }: { source: string | null }) {
  return (
    <>
      <Tag variant="listed" onPicture>
        External
      </Tag>{" "}
      <span className="oc-banner__live">Live</span>
      {source ? ` from ${source}` : null}
    </>
  );
}

/** TV (06.1): "Live" in the live colour, then where from, when the airing's note says (S4: "Live from Redlands City Hall"). */
function LiveFrom({ note }: { note?: string | null }) {
  const rest = note && /^live\b/i.test(note) ? note.slice(4) : "";
  return (
    <>
      <span className="oc-banner__live">Live</span>
      {rest}
    </>
  );
}
