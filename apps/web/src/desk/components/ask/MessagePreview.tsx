// What they'll get (network-desk 03.1 .msg): the message as the creator will read it. A picture of
// the email, so it's the one boxed thing on the page. The personal note, two sentences of what
// Opencast would do, tonight's schedule built from their own titles, one link, the reminder line.

import type { ReactNode } from "react";
import { clockOfMinutes, type PreviewRow } from "../setup/recipe";
import "./MessagePreview.css";

export interface MessagePreviewProps {
  marketName: string;
  note: string;
  band: "tv" | "radio";
  /** "films" */
  noun: string;
  schedule: PreviewRow[];
  /** After sending: the permission page. Before, the button is only drawn. */
  link?: string | null;
}

export function MessagePreview({ marketName, note, band, noun, schedule, link }: MessagePreviewProps) {
  const button: ReactNode = link ? (
    <a className="nd-msg__lnk" href={link} target="_blank" rel="noopener">
      See what you'd be saying yes to
    </a>
  ) : (
    <span className="nd-msg__lnk">See what you'd be saying yes to</span>
  );
  return (
    <div className="nd-msg" aria-label="The message as they'll get it">
      <div className="nd-msg__from">From Opencast, the {marketName} dial</div>
      {note.trim() ? <p>{note}</p> : <p className="nd-msg__placeholder">Your note goes here.</p>}
      <p>
        We'd run a {band === "radio" ? "radio" : "TV"} station of your {noun} on Opencast, a local 24/7 dial, and hold everything it earns for you. It's yours to take over whenever you
        want, or to stop with one tap.
      </p>
      {schedule.length > 0 && (
        <div className="nd-msg__sch">
          <div className="nd-msg__sch-h">Your station tonight, if you say yes</div>
          <div className="nd-msg__sch-grid">
            {schedule.map((r) => (
              <span key={`${r.at}-${r.title}`} className="nd-msg__row">
                <span className="nd-msg__t">{clockOfMinutes(r.at)}</span>
                <span>{r.title}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {button}
      <p className="nd-msg__foot">If you don't answer, we'll remind you once in a week and then leave it.</p>
    </div>
  );
}
