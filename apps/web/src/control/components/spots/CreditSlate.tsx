// The generated thank-you credit (sponsorships 05.1 as it airs; the small preview in 03.1 and 06.1):
// title safe, in the station's colour, business names in Archivo, the line in Public Sans, the
// station's call sign and channel as the bug. It scales with its width, so one component draws
// the preview and the full screen. The worker renders the on-air one for playout; this is the
// app's copy of the same layout (packages/ui should own one CreditSlate, see the report).

import type { CSSProperties } from "react";
import "./CreditSlate.css";

export interface CreditSlateProps {
  /** The station's colour: the slate's ground. White words hold 4.5:1 on it. */
  colour: string;
  /** "Beat Tape Live is made possible by" */
  lead: string;
  /** The businesses, in order. */
  sponsors: { name: string; line: string }[];
  /** "members of Inland Beat", or null when no member asked to be named. */
  members?: string | null;
  callSign: string;
  channel: string;
  /** preview: the small slate in master control (members as a quiet line); air: full screen, as it airs. */
  variant?: "preview" | "air";
  className?: string;
}

export function CreditSlate({ colour, lead, sponsors, members, callSign, channel, variant = "preview", className }: CreditSlateProps) {
  const words = [lead, ...sponsors.map((s) => `${s.name}. ${s.line}`), members ? (variant === "air" ? `and ${members}` : `And by ${members}`) : null, `${callSign} ${channel}`].filter(Boolean).join(" ");
  return (
    <div className={["cc-slate", `cc-slate--${variant}`, className].filter(Boolean).join(" ")} style={{ "--cc-slate": colour } as CSSProperties} role="img" aria-label={words}>
      <div className="cc-slate__body" aria-hidden="true">
        <span className="cc-slate__lead">{lead}</span>
        {sponsors.map((s) => (
          <span key={s.name} className="cc-slate__sponsor">
            <span className="cc-slate__who">{s.name}</span>
            <span className="cc-slate__line">{s.line}</span>
          </span>
        ))}
        {members && variant === "air" && <span className="cc-slate__members">and {members}</span>}
      </div>
      {members && variant === "preview" && (
        <span className="cc-slate__also" aria-hidden="true">
          And by {members}
        </span>
      )}
      <span className="cc-slate__bug" aria-hidden="true">
        <span className="cc-slate__cs">{callSign}</span>
        <span className="cc-slate__ch">{channel}</span>
      </span>
    </div>
  );
}
