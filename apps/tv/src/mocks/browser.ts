import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";
import { externalDown, externalUp, setDashPlayed } from "./external";

declare global {
  interface Window {
    /** Mock mode only: put the mock world in a state from the console or a Playwright flow. */
    ocMock?: {
      /**
       * External stations (follow-up Phase 6): a stream down since `minutesAgo` (5 or more: off the
       * dial), or back. `station`: a call sign ("COLT"; a shared one is its family's X.1, "RIVC" is
       * 15.1), an address ("rivc-15-2") or an id.
       */
      externalDown(station: string, minutesAgo?: number): void;
      externalUp(station: string): void;
      /** DASH stream links (A201): the rule played (the default) or not. */
      dashStreamLinks(played: boolean): void;
    };
  }
}

/** Starts Mock Service Worker: every /v1 call is answered from the fixtures. Streams pass through. */
export async function startMocks() {
  const worker = setupWorker(...handlers);
  await worker.start({ onUnhandledRequest: ({ url }, print) => (new URL(url).pathname.startsWith("/v1/") ? print.warning() : undefined), quiet: true });
  // External stations: `ocMock.externalDown("COLT")` (still on the dial for 5 minutes), `ocMock.externalDown("COLT", 5)`
  // (off the dial now), `ocMock.externalUp("COLT")`. What's open reads it again at once ("oc-mock-changed").
  const changed = () => window.dispatchEvent(new Event("oc-mock-changed"));
  window.ocMock = {
    ...window.ocMock,
    externalDown: (station, minutesAgo) => (externalDown(station, minutesAgo), changed()),
    externalUp: (station) => (externalUp(station), changed()),
    dashStreamLinks: (played) => (setDashPlayed(played), changed())
  };
}
