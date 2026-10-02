// The iPhone side of mirroring (tv-update 02): the one-time guide (02.1), and "Mirroring stopped"
// after a lock (02.3). Both are sheets over the phone's picture; the remote while mirroring (02.2)
// is the remote itself.

import type { ReactNode } from "react";
import { Button, Sheet } from "@opencast/ui";
import { PlayerSurface } from "@opencast/player";
import { MARKET_TZ, now } from "../../../lib/clock";
import "./mirror.css";

/** The phone's picture behind the sheet, as the tuned-in page shows it (the player draws the bug). */
export function PictureBehind() {
  return (
    <div className="vw-mir-pic">
      <PlayerSurface timeZone={MARKET_TZ} clock={now} />
    </div>
  );
}

/** A small drawing of Control Center with Screen Mirroring highlighted (02.1). */
export function ControlCenterDrawing() {
  return (
    <div className="vw-mir-cc" aria-hidden="true">
      <span>Wi-Fi</span>
      <span className="vw-mir-cc--on">
        Screen
        <br />
        Mirroring
      </span>
      <span>Music</span>
    </div>
  );
}

export function HowTo({ steps }: { steps: ReactNode[] }) {
  return (
    <ol className="vw-mir-howto">
      {steps.map((s, i) => (
        <li key={i}>
          <span className="vw-mir-howto__n" aria-hidden="true">
            {i + 1}
          </span>
          <div>{s}</div>
        </li>
      ))}
    </ol>
  );
}

export function MirrorGuideSheet({ tvName, onClose, onHide }: { tvName: string; onClose: () => void; onHide: () => void }) {
  return (
    <Sheet
      open
      onClose={onClose}
      title={`Watch on ${tvName}`}
      subtitle="An AirPlay TV. Turn on Screen Mirroring and Opencast does the rest."
      className="vw-mir-sheet"
      footer={
        <Button block onClick={onHide}>
          Don't show this again
        </Button>
      }
    >
      <ControlCenterDrawing />
      <HowTo
        steps={[
          <>
            Swipe down from the <b>top-right corner</b> to open Control Center.
          </>,
          <>
            Tap <b>Screen Mirroring</b> and choose <b>{tvName}</b>.
          </>,
          <>Come back here. The TV switches to Opencast and this phone becomes the remote.</>
        ]}
      />
      <p className="vw-mir-note">Your phone needs to stay unlocked with Opencast open while you watch.</p>
    </Sheet>
  );
}

export function MirrorStoppedSheet({ tvName, lockedAt, station, onWatchHere, onClose }: { tvName: string; lockedAt: string; station: { callSign: string; channel: string } | null; onWatchHere: () => void; onClose: () => void }) {
  const cs = station?.callSign ?? "Opencast";
  return (
    <Sheet
      open
      onClose={onClose}
      title="Mirroring stopped"
      subtitle={`Your phone locked at ${lockedAt}, so ${tvName} stopped showing Opencast.${station ? ` ${cs} is still on here.` : ""}`}
      className="vw-mir-sheet"
      footer={
        <Button block onClick={onWatchHere}>
          Watch on this phone
        </Button>
      }
    >
      <HowTo
        steps={[
          <>
            Open Control Center and tap <b>Screen Mirroring</b>.
          </>,
          <>
            Choose <b>{tvName}</b>.{station ? ` You'll be back on ${station.callSign} ${station.channel}.` : ""}
          </>
        ]}
      />
      <p className="vw-mir-note">To stop this happening, keep Opencast open. It already stops the screen dimming on its own.</p>
    </Sheet>
  );
}
