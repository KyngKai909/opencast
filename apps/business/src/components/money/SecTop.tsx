// A section's head on a money page (the reference's .sec-top): the heading over a line rule, and
// anything at its end (the movements filter). Rules, not boxes.

import type { ReactNode } from "react";
import "./SecTop.css";

export function SecTop({ title, id, end, className }: { title: ReactNode; id?: string; end?: ReactNode; className?: string }) {
  return (
    <div className={`bz-sectop${className ? ` ${className}` : ""}`}>
      <h2 className="bz-sectop__h" id={id}>
        {title}
      </h2>
      {end && <div className="bz-sectop__end">{end}</div>}
    </div>
  );
}
