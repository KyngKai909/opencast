// The station's graphics over the picture, from the playlist's DATERANGE tags (engine.onScreen):
// the bug, a lower third, and a spot's code with its QR in its last seconds. Placed as the
// reference frames draw them, inside the style guide's safe areas (brand Ch. 11): the bug bottom
// right at 3.5% and 7% (tv: 5% and 6%), at 78% unless the tag says otherwise; the lower third at
// 5% and 8%; the code bottom left at 6% and 7% (business/opencast-biz-spots.html, "What will air").

import { useMemo } from "react";
import { encode } from "uqr";
import { Bug, LowerThird, cx } from "@opencast/ui";
import type { OnScreen } from "../engine/timeline";
import type { Channel } from "../types";

export interface GraphicsInput {
  onScreen: OnScreen | null;
  /** The picture is showing (playing or paused), not tuning, off air or radio. */
  showing: boolean;
  /** The banner is up: it covers the bottom of the picture and carries the same ident as the bug. */
  banner: boolean;
}

/** Which graphics to draw: the rules for how they share the picture. */
export function visibleGraphics({ onScreen: os, showing, banner }: GraphicsInput): Pick<OnScreen, "bug" | "lowerThird" | "code"> {
  if (!os || !showing || banner) return { bug: null, lowerThird: null, code: null };
  const code = os.code;
  // The code sits where the lower third does (bottom left); for its few seconds, it wins.
  const lowerThird = code ? null : os.lowerThird;
  // The bug never covers a lower third (style guide): a bottom-left bug steps aside for one.
  const bug = os.bug && os.bug.position === "bottom_left" && (lowerThird || code) ? null : os.bug;
  return { bug, lowerThird, code };
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
}

export function Overlays({ channel, size, ...input }: OverlaysProps) {
  const { bug, lowerThird, code } = visibleGraphics(input);
  if (!bug && !lowerThird && !code) return null;
  const callSign = bug?.callSign ?? channel?.station.callSign ?? null;
  const ch = bug?.channel ?? channel?.station.channel ?? null;
  return (
    // On the picture, the dark ground's values whatever the page's ground (the QR's dark modules).
    <div className={cx("oc-ovl", `oc-ovl--${size}`)} data-theme="dark" data-testid="player-graphics">
      {lowerThird && <LowerThird className="oc-ovl__l3" name={lowerThird.name} title={lowerThird.title ?? undefined} />}
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
        <div className="oc-ovl__code">
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
