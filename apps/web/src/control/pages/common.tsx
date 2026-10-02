// States every page shares: loading, not found, a station that isn't yours.

import { Button } from "@opencast/ui";
import "./common.css";
import { CONTROL } from "../../areas";

/** Loading: a quiet page, no spinner. */
export function Quiet() {
  return <div className="cc-quiet" aria-busy="true" />;
}

export function NotYours() {
  return (
    <main className="cc-center">
      <h1 className="cc-center__h">That station isn't one of yours.</h1>
      <p className="cc-center__p">Choose one of your stations, or start another.</p>
      <Button href={CONTROL}>Your stations</Button>
    </main>
  );
}

export function NotFound() {
  return (
    <main className="cc-center">
      <h1 className="cc-center__h">There's nothing here.</h1>
      <Button href={CONTROL}>Back to master control</Button>
    </main>
  );
}

/** A page a later step of this phase replaces: the route works, the screen isn't built yet. */
export function Stub({ name }: { name: string }) {
  return (
    <section className="cc-stub" aria-label={name}>
      <p>{name}</p>
    </section>
  );
}
