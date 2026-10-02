// The station's graphics over the picture, from the playlist's DATERANGE tags (engine.onScreen):
// the bug, a lower third, a spot's code with its QR in its last seconds, and (A243) up next's
// title over an up-next bumper ("Up next" or "Next at 9:00 pm", then the title and episode). Placed as the
// reference frames draw them, inside the style guide's safe areas (brand Ch. 11): the bug bottom
// right at 3.5% and 7% (tv: 5% and 6%), at 78% unless the tag says otherwise; the lower third at
// 5% and 8%; the code bottom left at 6% and 7% (business/opencast-biz-spots.html, "What will air").
//
// Decided (docs/apps/open-questions.md): the banner covers the bug and the lower third, but not a
// spot's code (paid, and only for its last 10 seconds): the code stays, lifted clear of the banner.
// A code takes the lower third's place while it shows. In the TV guide's window only the bug is
// drawn, small, as tv 03.1 draws it.

import { useMemo } from "react";
import { encode } from "uqr";
import { Bug, LowerThird, UpNextCard, clock, cx } from "@opencast/ui";
import type { OnScreen } from "../engine/timeline";
import type { Channel } from "../types";

export interface GraphicsInput {
  onScreen: OnScreen | null;
  /** The picture is showing (playing or paused), not tuning, off air or radio. */
  showing: boolean;
  /** The banner is up: it covers the bottom of the picture and carries the same ident as the bug. */
  banner: boolean;
}

/** Which graphics to draw: the rules for how they share the picture. `only: "bug"` is the TV guide's window. */
export function visibleGraphics({ onScreen: os, showing, banner }: GraphicsInput, only?: "bug"): Pick<OnScreen, "bug" | "lowerThird" | "code"> & { upNext: OnScreen["upNext"] } {
  if (!os || !showing) return { bug: null, lowerThird: null, code: null, upNext: null };
  if (only === "bug") return { bug: os.bug, lowerThird: null, code: null, upNext: null };
  const code = os.code;
  // The banner carries the bug's ident and covers the lower third and up next (its own "Next at"
  // line says the same); the code stays, above it.
  if (banner) return { bug: null, lowerThird: null, code, upNext: null };
  // The code sits where the lower third does (bottom left); for its few seconds, it wins. A243: up
  // next shares the lower third's place, over a bumper (no lower third, no code there).
  const upNext = code ? null : (os.upNext ?? null);
  const lowerThird = code || upNext ? null : os.lowerThird;
  // The bug never covers a lower third (style guide): a bottom-left bug steps aside for one.
  const bug = os.bug && os.bug.position === "bottom_left" && (lowerThird || code || upNext) ? null : os.bug;
  return { bug, lowerThird, code, upNext };
}

/** A243: up next's kicker: "Up next" when it follows this break, else "Next at 9:00 pm" (the market's time). */
export function upNextKicker(upNext: NonNullable<OnScreen["upNext"]>, timeZone?: string): string {
  return upNext.immediate ? "Up next" : `Next at ${clock(upNext.startsAt, { timeZone })}`;
}

/** A QR code, dark modules on white with its quiet zone, so a phone camera reads it from the picture. */
function Qr({ value, label }: { value: string; label: string }) {
  const { d, n } = useMemo(() => {
    const qr = encode(value, { ecc: "M", border: 2 });
    let p = "";
    qr.data.forEach((row, y) => row.forEach((on, x) => on && (p += `M${x} ${y}h1v1h-1z`)));
    return { d: p, n: qr.size };
  }, [value]);
  return (
    <svg className="oc-ovl__qr" role="img" aria-label={label} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges">
      <path d={d} />
    </svg>
  );
}

export interface OverlaysProps extends GraphicsInput {
  channel: Channel | undefined;
  size: "web" | "tv";
  /** "bug": the bug alone, sized for the TV guide's window (tv 03.1). */
  only?: "bug";
  /** While the banner is up: how far the banner reaches up from the bottom (px), for the code to sit above. */
  codeLift?: number | null;
  /** The market's time zone, for up next's "Next at 9:00 pm" (A243). */
  timeZone?: string;
}

export function Overlays({ channel, size, only, codeLift, timeZone, ...input }: OverlaysProps) {
  const { bug, lowerThird, code, upNext } = visibleGraphics(input, only);
  if (!bug && !lowerThird && !code && !upNext) return null;
  const callSign = bug?.callSign ?? channel?.station.callSign ?? null;
  const ch = bug?.channel ?? channel?.station.channel ?? null;
  return (
    // On the picture, the dark ground's values whatever the page's ground (the QR's dark modules).
    <div className={cx("oc-ovl", `oc-ovl--${size}`, only === "bug" && "oc-ovl--window")} data-theme="dark" data-testid="player-graphics">
      {lowerThird && <LowerThird className="oc-ovl__l3" name={lowerThird.name} title={lowerThird.title ?? undefined} />}
      {upNext && <UpNextCard className="oc-ovl__upnext" kicker={upNextKicker(upNext, timeZone)} title={upNext.title} detail={upNext.blockName ?? upNext.episodeTitle ?? undefined} />}
      {bug && (
        <div className="oc-ovl__bug" data-position={bug.position} data-mode={bug.mode} style={{ ["--bug-opacity" as string]: String(bug.opacity / 100) }}>
          {bug.mode === "logo" && bug.logoUrl ? (
            <img className="oc-ovl__logo" src={bug.logoUrl} alt="" aria-hidden="true" />
          ) : callSign && ch ? (
            <Bug callSign={callSign} channel={ch} />
          ) : null}
        </div>
      )}
      {code && (
        <div className="oc-ovl__code" style={input.banner && codeLift ? { bottom: `calc(${codeLift}px + 2%)` } : undefined}>
          <Qr value={code.qrUrl} label={`QR code for ${code.code}`} />
          <div>
            <b className="oc-ovl__code-c">{code.code}</b>
            <small className="oc-ovl__code-o">{code.offer}</small>
          </div>
        </div>
      )}
    </div>
  );
}
