// The thank-you credit as it will air (sponsorships 02.1 "As it will air"): generated in the
// station's colour, the business's name in Archivo, its line in Public Sans, the members' credit
// under it and the station's bug. The business app's copy of master control's slate (control
// components/spots/CreditSlate); packages/ui should own one.

import type { CSSProperties } from "react";
import "./CreditSlate.css";

export interface CreditSlateProps {
  /** The station's colour: white words hold 4.5:1 on it. */
  colour: string;
  /** "Beat Tape Live is made possible by". */
  lead: string;
  name: string;
  line: string;
  /** "members of Inland Beat" (P17), or null. */
  members?: string | null;
  callSign: string;
  channel: string | null;
}

export function CreditSlate({ colour, lead, name, line, members, callSign, channel }: CreditSlateProps) {
  const words = [lead, name, line, members ? `And by ${members}` : null, [callSign, channel].filter(Boolean).join(" ")].filter(Boolean).join(". ");
  return (
    <div className="bz-slate" style={{ "--bz-slate": colour } as CSSProperties} role="img" aria-label={words}>
      <span className="bz-slate__body" aria-hidden="true">
        <span className="bz-slate__lead">{lead}</span>
        <span className="bz-slate__who">{name}</span>
        <span className="bz-slate__line">{line}</span>
      </span>
      {members && (
        <span className="bz-slate__also" aria-hidden="true">
          And by {members}
        </span>
      )}
      <span className="bz-slate__bug" aria-hidden="true">
        <span className="bz-slate__cs">{callSign}</span>
        {channel && <span className="bz-slate__ch">{channel}</span>}
      </span>
    </div>
  );
}
