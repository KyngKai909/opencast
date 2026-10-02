// Small pieces the area's pages share: the page head with its trail, the state tag with whose
// turn it is, the page a viewer gets, and an error line.

import type { ReactNode } from "react";
import { Button, ControlTitle, Tag } from "@opencast/ui";
import { VIEWER_REASON } from "../../business/abilities";
import type { TagTone } from "./format";
import "./parts.css";

/** The page head (.mc-title), with the quiet trail above the title on inner pages ("Sponsorships / New"). */
export function PageHead({ trail, title, description, end }: { trail?: ReactNode; title: ReactNode; description?: ReactNode; end?: ReactNode }) {
  return (
    <div className="bz-dl-head">
      {trail && <p className="bz-dl-head__trail">{trail}</p>}
      <ControlTitle title={title} description={description} end={end} />
    </div>
  );
}

/** A state in words, coloured by whose turn it is (production orders 01 note): signal the business's, amber waiting, solid done. */
export function StateTag({ text, tone, fill }: { text: string; tone: TagTone; fill?: boolean }) {
  const variant = tone === "on" ? "solid" : tone === "wait" ? "standby" : "plain";
  return (
    <Tag variant={variant} className={["bz-dl-tag", tone === "you" && "bz-dl-tag--you", fill && "bz-dl-tag--fill"].filter(Boolean).join(" ")}>
      {text}
    </Tag>
  );
}

/** Sponsorships and orders aren't a viewer's (the team frame's permissions): the rail's reason, and the way to results. */
export function NoAccess({ base, statements }: { base: string; statements?: boolean }) {
  return (
    <main className="bz-dl-noaccess">
      <h1 className="bz-dl-noaccess__h">{VIEWER_REASON}.</h1>
      <div className="bz-dl-noaccess__to">
        <Button href={`${base}/results`}>Where it aired</Button>
        {statements && <Button href={`${base}/balance/statements`}>Statements</Button>}
      </div>
    </main>
  );
}

export function ErrorLine({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="bz-dl-error" role="alert">
      {children}
    </p>
  );
}

/** A quiet placeholder while a list loads: ruled rows, no spinner. */
export function QuietRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="bz-dl-quiet" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="bz-dl-quiet__row" />
      ))}
    </div>
  );
}
