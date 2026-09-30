// An external station's checks (network-desk 05.1 .ok-t, reworked in follow-up Phase 6): a tick in
// ink-70 when it's fine, the warning sign in standby when someone needs to look, a dot for the
// stream right now (up, or down in live red while it's off the dial). Words always, never colour
// alone.
import type { ReactNode } from "react";
import { Icon, Lines } from "@opencast/ui";
import type { ListedSource } from "@opencast/contracts";
import { nowWords, PLAYS_LABELS, playsDetail, playsOf, scheduleWords, sourceDetail, type NowTone, type Tone } from "./external";
import "./SourceStatus.css";

export function Ok({ children, detail, warn }: { children: ReactNode; detail?: string; warn?: boolean }) {
  return (
    <span className={`nd-ok${warn ? " nd-ok--warn" : ""}`}>
      <Icon name={warn ? "warn" : "check"} size={14} />
      <span>
        {children}
        {detail && <small className="nd-ok__small">{detail}</small>}
      </span>
    </span>
  );
}

/** The stream right now: a dot and the words (.dot-up, .dot-down). */
export function Dot({ tone, children, detail }: { tone: "up" | "down"; children: ReactNode; detail?: string }) {
  return (
    <span className={`nd-ok nd-ok--${tone}`}>
      <span className={`nd-dot nd-dot--${tone}`} aria-hidden="true" />
      <span>
        {children}
        {detail && <small className="nd-ok__small">{detail}</small>}
      </span>
    </span>
  );
}

/** The Channel column: "9.1 RDLS" while its evidence holds (on the dial, or off it only while it's down), or "Not on the dial". */
export function channelText(s: ListedSource): string | null {
  return s.listingState === "listed" && s.station.channel ? `${s.station.channel} ${s.station.callSign ?? ""}`.trim() : null;
}

export function sourceCell(s: ListedSource) {
  return <Lines title={s.name} detail={sourceDetail(s)} />;
}

export function channelCell(s: ListedSource) {
  const ch = channelText(s);
  return ch ? <span className="nd-mono nd-listed__ch">{ch}</span> : <span className="nd-ok__quiet">Not on the dial</span>;
}

/** How it plays (.tier): "Official embed" or "Stream link", and why it may, or what it waits for. */
export function playsCell(s: ListedSource, timeZone: string) {
  return <Lines className="nd-tier" title={PLAYS_LABELS[playsOf(s)]} detail={playsDetail(s, timeZone) || null} />;
}

function toned(w: { text: string; detail?: string; tone: Tone | NowTone }) {
  if (w.tone === "quiet") return <span className="nd-ok__quiet">{w.text}</span>;
  if (w.tone === "up" || w.tone === "down") return <Dot tone={w.tone} detail={w.detail}>{w.text}</Dot>;
  return (
    <Ok warn={w.tone === "warn"} detail={w.detail}>
      {w.text}
    </Ok>
  );
}

/** What's on: their calendar or feed, guide data, or no schedule (the banner shows name and Live). */
export function scheduleCell(s: ListedSource) {
  return toned(scheduleWords(s));
}

/** Right now: Up, Down 14 min (still on the dial, or hidden from it), Not checked yet, or Not on the dial. */
export function nowCell(s: ListedSource, now: Date) {
  return toned(nowWords(s, now));
}
