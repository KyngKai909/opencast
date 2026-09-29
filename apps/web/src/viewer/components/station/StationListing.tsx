// A future program's listing, opened from the station page's schedule: when and where, what it
// is, "Switch me over", Remind me, and Tune in. The guide's listing's words (home 05.1); a modal on
// the web, a sheet on the phone.

import { useState } from "react";
import { Button, LiveText, Modal, Sheet, Toggle, clock, clockRange } from "@opencast/ui";
import type { AiringX, StationIdentX } from "../../api/ext";
import { useViewerActions } from "../../data/viewer";
import { useIsPhone } from "../../layout/shell";
import { MARKET_TZ } from "../../../lib/clock";
import { useTuneIn } from "./actions";
import "./StationListing.css";

export interface StationListingProps {
  airing: AiringX | null;
  station: StationIdentX;
  /** The program's own description, when the page knows it. */
  description?: string | null;
  onClose: () => void;
}

/** "Live from the Redlands studio. Producers play …": the airing's note (Live in red), then the program's description. */
function Subtitle({ airing, description: full }: { airing: AiringX; description?: string | null }) {
  const note = airing.note ?? airing.episodeTitle;
  // The note leads, so it isn't said twice when the description ends with it too.
  const description = note && full ? full.replace(`${note}.`, "").replace(/\s+$/, "") || null : full;
  const live = airing.live && note?.startsWith("Live ");
  return (
    <>
      {live ? (
        <>
          <LiveText /> {note!.slice(5)}
        </>
      ) : (
        note
      )}
      {note && description ? ". " : null}
      {description}
    </>
  );
}

export function StationListing({ airing, station, description, onClose }: StationListingProps) {
  const phone = useIsPhone();
  const { remind } = useViewerActions();
  const tuneIn = useTuneIn();
  const [switchOver, setSwitchOver] = useState(false);
  if (!airing) return null;
  const cs = station.callSign ?? station.name;
  const at = clock(airing.startsAt, { timeZone: MARKET_TZ, suffix: false });
  const content = {
    eyebrow: (
      <>
        <span className="oc-mono">{clockRange(airing.startsAt, airing.endsAt, { timeZone: MARKET_TZ, separator: "–" })}</span>, {[cs, station.channel].filter(Boolean).join(" ")}
      </>
    ),
    title: airing.title,
    subtitle: <Subtitle airing={airing} description={description} />,
    footer: (
      <>
        <Button
          variant="primary"
          icon="bell"
          onClick={() => {
            remind({ airing, station }, switchOver);
            onClose();
          }}
        >
          Remind me
        </Button>
        <Button variant="ghost" onClick={() => tuneIn(station)}>
          Tune in to {cs}
        </Button>
      </>
    ),
    children: (
      <div className="vw-listing__switch">
        <div>
          <b>Switch me over at {at}</b>
          <small>If I'm watching something else on Opencast</small>
        </div>
        <Toggle checked={switchOver} onChange={setSwitchOver} label={`Switch me over at ${at}`} />
      </div>
    )
  };
  return phone ? <Sheet open onClose={onClose} {...content} /> : <Modal open onClose={onClose} width={360} {...content} />;
}
