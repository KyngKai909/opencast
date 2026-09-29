// What every desk page shares: loading, not found, an error line, the breadcrumb, a section head,
// and the rail pages no frame draws yet.

import type { ReactNode } from "react";
import { Button, ControlTitle } from "@opencast/ui";
import { ApiError } from "../../api/client";
import "./common.css";
import { DESK } from "../../areas";

/** Loading: a quiet page, no spinner. */
export function Quiet() {
  return <div className="nd-quiet" aria-busy="true" />;
}

export function NotFound() {
  return (
    <div className="nd-empty">
      <ControlTitle title="There's nothing here." />
      <Button href={DESK}>Back to the market board</Button>
    </div>
  );
}

/** The words for a failed call: the API's own, or a plain fallback. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return "Something went wrong. Try again.";
}

export function ErrorLine({ error }: { error: unknown }) {
  return (
    <p className="nd-error" role="alert">
      {errorText(error)}
    </p>
  );
}

/** "Pipeline / Desert Skate Films" above a page title. */
export function Crumb({ href, label, here }: { href: string; label: string; here: string }) {
  return (
    <p className="nd-crumb">
      <a href={href}>{label}</a> / <span>{here}</span>
    </p>
  );
}

/** A section's head (.sec-top): 17px display heading over a line rule, quiet words after it, anything at its end. */
export function SecTop({ title, sub, end, first, id }: { title: ReactNode; sub?: ReactNode; end?: ReactNode; first?: boolean; id?: string }) {
  return (
    <div className={`nd-sectop${first ? " nd-sectop--first" : ""}`}>
      <h2 className="nd-sectop__h" id={id}>
        {title}
      </h2>
      {sub != null && <span className="nd-sectop__sub">{sub}</span>}
      {end != null && <div className="nd-sectop__end">{end}</div>}
    </div>
  );
}

/** A rail page no frame draws yet (Catalog, Rights claims, Catalog sponsors). */
export function Unbuilt({ title, about }: { title: string; about: string }) {
  return (
    <>
      <ControlTitle title={title} description={about} />
      <p className="nd-unbuilt">This page isn't designed yet. It comes after the pages the desk needs first.</p>
    </>
  );
}
