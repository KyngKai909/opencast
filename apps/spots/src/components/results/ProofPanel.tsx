// The proof beside an airing (biz-results 02.1): the frame captured as it aired, with the station's
// bug on it, and the as-run log entry behind it: exact start and end, tuned in averaged over the
// spot, the cost worked out as stations see it, and code scans in the hour after.

import { KeyValueList, PictureFrame, clock } from "@opencast/ui";
import type { ResultsAiringX } from "../../api/ext/results";
import { MARKET_TZ } from "../../lib/clock";
import { airedWords, proofHeading, tenths } from "./format";
import { Section } from "./Section";
import "./ProofPanel.css";

export function ProofPanel({ airing, now }: { airing: ResultsAiringX; now: Date }) {
  const cs = airing.station.callSign ?? airing.station.name;
  const ended = airing.inFull ? `${tenths(airing.endedAt)}, in full` : `${tenths(airing.endedAt)}, ${airedWords(airing.airedMs, airing.spot.lengthSec)}`;
  return (
    <Section title={proofHeading(airing.startedAt, cs, now)} className="bz-proof">
      {airing.proofFrameUrl ? (
        <PictureFrame className="bz-proof__still" label={`Frame captured during the airing of ${airing.spot.title} on ${cs}`}>
          <img src={airing.proofFrameUrl} alt="" />
        </PictureFrame>
      ) : (
        <PictureFrame className="bz-proof__still" />
      )}
      <p className="bz-proof__cap">
        {airing.proofFrameUrl
          ? airing.proofCapturedAt
            ? `Frame captured at ${clock(airing.proofCapturedAt, { timeZone: MARKET_TZ, seconds: true })}, with ${cs}'s bug on it.`
            : `With ${cs}'s bug on it.`
          : "No frame was captured for this airing. The log entry below is the record."}
      </p>
      <KeyValueList
        className="bz-proof__kv"
        items={[
          { label: "Started", value: tenths(airing.startedAt) },
          { label: "Ended", value: ended },
          { label: "Tuned in", value: `${airing.tunedIn.toLocaleString("en-US")}, averaged over the spot` },
          { label: "Cost", value: airing.working },
          { label: "Code scans in the next hour", value: airing.scansNextHour.toLocaleString("en-US") }
        ]}
      />
    </Section>
  );
}
