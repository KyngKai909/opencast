import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";
import { setAccountState, type AccountState } from "../control/mocks/fixtures/account";
import { stationByRef } from "../control/mocks/fixtures/stations";
import { externalDown, externalUp } from "../viewer/mocks/external";
import { deskExternalDown, deskExternalUp } from "../desk/mocks/external";

declare global {
  interface Window {
    /** Mock mode only: put the mock world in a state from the console or a Playwright flow. */
    ocMock?: {
      setAccountState(station: string, state: AccountState): void;
      /** External stations (follow-up Phase 6): a stream down since `minutesAgo` (5 or more: off the dial), or back. */
      externalDown(station: string, minutesAgo?: number): void;
      externalUp(station: string): void;
    };
  }
}

/** Starts Mock Service Worker: every /v1 call is answered from the fixtures. Streams pass through. */
export async function startMocks() {
  const worker = setupWorker(...handlers);
  await worker.start({ onUnhandledRequest: ({ url }, print) => (new URL(url).pathname.startsWith("/v1/") ? print.warning() : undefined), quiet: true });
  // Pay-as-you-go: any station's Station account in any state ("free", "earnings", "grace", "paused"),
  // by call sign, handle or id: `ocMock.setAccountState("BEAT", "grace")`, then reload.
  // External stations: `ocMock.externalDown("COLT")` (still on the dial for 5 minutes), `ocMock.externalDown("COLT", 5)`
  // (off the dial now), `ocMock.externalUp("COLT")`: the viewer's dial and the desk's External sources
  // both follow. What's open reads it again at once ("oc-mock-changed").
  const changed = () => window.dispatchEvent(new Event("oc-mock-changed"));
  // The viewer's mock has two external stations (RDLS, COLT), the desk's six: each follows what it has.
  const quietly = (f: () => void) => {
    try {
      f();
    } catch {
      // Not one of this area's external stations.
    }
  };
  window.ocMock = {
    setAccountState: (station, state) => setAccountState(stationByRef(station)?.id ?? station, state),
    externalDown: (station, minutesAgo) => (quietly(() => externalDown(station, minutesAgo)), deskExternalDown(station, minutesAgo), changed()),
    externalUp: (station) => (quietly(() => externalUp(station)), deskExternalUp(station), changed())
  };
}
