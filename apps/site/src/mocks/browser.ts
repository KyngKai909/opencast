import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

/** Starts Mock Service Worker: every /v1 call is answered by the mock waitlist. */
export async function startMocks() {
  const worker = setupWorker(...handlers);
  await worker.start({ onUnhandledRequest: ({ url }, print) => (new URL(url).pathname.startsWith("/v1/") ? print.warning() : undefined), quiet: true });
}
