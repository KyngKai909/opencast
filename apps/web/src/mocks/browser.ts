import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";
import { setAccountState, type AccountState } from "../control/mocks/fixtures/account";
import { stationByRef } from "../control/mocks/fixtures/stations";

declare global {
  interface Window {
    /** Mock mode only: put the mock world in a state from the console or a Playwright flow. */
    ocMock?: { setAccountState(station: string, state: AccountState): void };
  }
}

/** Starts Mock Service Worker: every /v1 call is answered from the fixtures. Streams pass through. */
export async function startMocks() {
  const worker = setupWorker(...handlers);
  await worker.start({ onUnhandledRequest: ({ url }, print) => (new URL(url).pathname.startsWith("/v1/") ? print.warning() : undefined), quiet: true });
  // Pay-as-you-go: any station's Station account in any state ("free", "earnings", "grace", "paused"),
  // by call sign, handle or id: `ocMock.setAccountState("BEAT", "grace")`, then reload.
  window.ocMock = { setAccountState: (station, state) => setAccountState(stationByRef(station)?.id ?? station, state) };
}
