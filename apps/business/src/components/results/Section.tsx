// A ruled section of a Results page: its heading over a line rule (the reference's .sec-top), then
// its content. Rules, not boxes.

import { useId, type ReactNode } from "react";
import "./Section.css";

export function Section({ title, sub, end, children, className }: { title: ReactNode; sub?: ReactNode; end?: ReactNode; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section className={`bz-sec${className ? ` ${className}` : ""}`} aria-labelledby={id}>
      <div className="bz-sec__top">
        <h2 className="bz-sec__h" id={id}>
          {title}
        </h2>
        {sub && <span className="bz-sec__sub">{sub}</span>}
        {end && <span className="bz-sec__end">{end}</span>}
      </div>
      {children}
    </section>
  );
}
