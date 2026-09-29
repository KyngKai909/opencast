// States every page shares: loading, not found, a station that isn't yours.

import { Button } from "@opencast/ui";
import "./common.css";

/** Loading: a quiet page, no spinner. */
export function Quiet() {
  return <div className="bz-quiet" aria-busy="true" />;
}

export function NotYours() {
  return (
    <main className="bz-center">
      <h1 className="bz-center__h">That business isn't one of yours.</h1>
      <p className="bz-center__p">Choose one of your businesses, or start another.</p>
      <Button href="/">Your businesses</Button>
    </main>
  );
}

export function NotFound() {
  return (
    <main className="bz-center">
      <h1 className="bz-center__h">There's nothing here.</h1>
      <Button href="/">Back to Opencast for business</Button>
    </main>
  );
}

/** A page a later step of this phase replaces: the route works, the screen isn't built yet. */
export function Stub({ name }: { name: string }) {
  return (
    <section className="bz-stub" aria-label={name}>
      <p>{name}</p>
    </section>
  );
}
