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

/** `behindLive`: playing on from a pause (the phone's remote offers Back to live); Cast only, the relay's state has no such field. */
type PhoneState = { stationId: string | null; paused: boolean; changedBy: string | null; sleepEndsAt: number | null; behindLive: boolean };
/** What's on now, as last told to the phones: a phone that just spoke gets it at once. */
let latest: PhoneState | null = null;

/** Tells every phone what's on, whenever it changes; ends the session when the sleep timer does. */
function StateToPhones({ cast, end }: { cast: ReturnType<typeof castInput>; end: () => void }) {
  const [s] = usePlayer();
  useEffect(() => {
    latest = { stationId: s.currentId, paused: s.status === "paused", changedBy: session.changedBy, sleepEndsAt: s.sleep?.endsAt ?? null, behindLive: s.behindLive };
    cast.broadcast(latest);
  }, [cast, s.currentId, s.status, s.sleep?.endsAt, s.behindLive]);
  useEffect(() => {
    // The sleep timer stopped Opencast: casting, the stream ends (the TV goes back to its own screen).
    if (s.status === "stopped") end();
  }, [s.status, end]);
  return null;
}

async function boot() {
  // Checked on the env itself so the production build drops the mock chunk entirely.
  if (import.meta.env.VITE_MOCK === "true") {
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
    // A phone that just connected (or just spoke) hears what's on without waiting for a change.
    setTimeout(() => latest && cast.broadcast({ ...latest, changedBy: session.changedBy }), 0);
  });

  const cast = castInput({ context, othersCanChange: () => session.othersCanChange, castingFrom: () => session.changedBy ?? session.from });
  const inputs = (): InputAdapter[] => [cast];

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <TvApp mode="cast" inputs={inputs} routes={tvRoutes}>
        <StateToPhones cast={cast} end={() => context.stop?.()} />
      </TvApp>
    </StrictMode>
  );
}

void boot();
