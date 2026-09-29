// Small pieces every Spots page uses: the page head with its crumbs, a ruled section, the spot's
// thumbnail, and what a viewer sees instead of a Spots page.

import { useId, type ReactNode } from "react";
import { Button, ControlTitle, TitleCard } from "@opencast/ui";
import { VIEWER_REASON } from "../../business/abilities";
import { useBusiness } from "../../business/BusinessContext";
import type { SpotX } from "../../api/ext/spots";
import "./parts.css";

/** The page head: "Spots / New spot" above the title (biz-spots 02.1, 03.1, 04.1). */
export function SpotHead({ crumb, title, description, end }: { crumb?: string; title: ReactNode; description?: ReactNode; end?: ReactNode }) {
  const b = useBusiness();
  return (
    <div className="bz-sphead">
      {crumb !== undefined && (
        <nav className="bz-sphead__crumbs" aria-label="Where this is">
          <a href={`${b.base}/spots`}>Spots</a> / <span aria-current="page">{crumb}</span>
        </nav>
      )}
      <ControlTitle title={title} description={description} end={end} />
    </div>
  );
}

/** A ruled section: its heading over a line rule (.sec-top), then its rows. */
export function Section({ title, sub, end, children, className }: { title: ReactNode; sub?: ReactNode; end?: ReactNode; children?: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section className={`bz-spsec${className ? ` ${className}` : ""}`} aria-labelledby={id}>
      <div className="bz-spsec__top">
        <h2 className="bz-spsec__h" id={id}>
          {title}
        </h2>
        {sub && <span className="bz-spsec__sub">{sub}</span>}
        {end && <span className="bz-spsec__end">{end}</span>}
      </div>
      {children}
    </section>
  );
}

/** The spot's still as a small card in its colour, carrying its short line. */
export function SpotThumb({ spot, className }: { spot: Pick<SpotX, "title" | "still">; className?: string }) {
  return <TitleCard colour={spot.still?.colour ?? "#525C73"} title={spot.still?.label ?? spot.title} decorative className={`bz-spthumb${className ? ` ${className}` : ""}`} />;
}

/** A viewer reaching a Spots page by its address: spots aren't in their role. */
export function ViewerBlocked() {
  const b = useBusiness();
  return (
    <section className="bz-spblocked">
      <ControlTitle title="Spots" description={`${VIEWER_REASON}. Spots are run by the owner and managers.`} />
      <Button href={`${b.base}/results`}>Where it aired</Button>
    </section>
  );
}

/** A 16:9 quiet placeholder while a page loads, and the API's words when it fails. */
export function LoadError({ message }: { message: string }) {
  return (
    <p className="bz-sperror" role="alert">
      {message}
    </p>
  );
}
