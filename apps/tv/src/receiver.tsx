// The Cast Web Receiver (receiver.html): TV mode on a Chromecast, driven by phones over Opencast's
// Cast namespace. The phone that starts casting says which market and station, and its name for
// the chip ("Playing from Kai's phone"); every phone gets the state back (what's on, paused,
// who changed it). Nothing is stored between sessions.

import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "@opencast/ui/styles.css";
import "@opencast/player/styles.css";
import { CAST_NAMESPACE, castInput, usePlayer, type InputAdapter } from "@opencast/player";
import { cafContext, loadCaf, mockCastContext } from "./cast/context";
import { config } from "./config";
import { tvRoutes } from "./routes";
import { setDevice, useMemoryOnly } from "./tv/device";
import { TvApp } from "./tv/TvApp";

useMemoryOnly();

/** The casting session, from the first phone's "session" message. */
const session = { from: null as string | null, othersCanChange: true, changedBy: null as string | null };

function safe(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Tells every phone what's on, whenever it changes. */
function StateToPhones({ cast }: { cast: ReturnType<typeof castInput> }) {
  const [s] = usePlayer();
  useEffect(() => {
    cast.broadcast({ stationId: s.currentId, paused: s.status === "paused", changedBy: session.changedBy, sleepEndsAt: s.sleep?.endsAt ?? null });
  }, [cast, s.currentId, s.status, s.sleep?.endsAt]);
  return null;
}

async function boot() {
  if (config.mock) {
    const { startMocks } = await import("./mocks/browser");
    await startMocks();
  }

  // dev:mock always uses the stand-in; on a Cast device, Google's framework.
  const context = config.mock ? mockCastContext() : ((await loadCaf()) && cafContext()) || mockCastContext();

  // The phone that starts casting introduces itself; later phones only send commands.
  context.addCustomMessageListener(CAST_NAMESPACE, ({ data }) => {
    const m = (typeof data === "string" ? safe(data) : data) as { type?: string; from?: string; marketSlug?: string; othersCanChange?: boolean } | null;
    if (m?.type === "session") {
      session.from = typeof m.from === "string" ? m.from.slice(0, 60) : session.from;
      if (typeof m.othersCanChange === "boolean") session.othersCanChange = m.othersCanChange;
      if (typeof m.marketSlug === "string") setDevice({ marketSlug: m.marketSlug });
    }
    if (m && typeof m.from === "string") session.changedBy = m.from.slice(0, 60);
  });

  const cast = castInput({ context, othersCanChange: () => session.othersCanChange, castingFrom: () => session.changedBy ?? session.from });
  const inputs = (): InputAdapter[] => [cast];

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <TvApp mode="cast" inputs={inputs} routes={tvRoutes}>
        <StateToPhones cast={cast} />
      </TvApp>
    </StrictMode>
  );
}

void boot();
