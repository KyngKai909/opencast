// TV mode as an app: the Android TV and Fire TV app (Phase 8), TV browsers. The remote's keys
// (keyboard arrows stand in on a computer) through the "tv" keyboard profile. In the Android app,
// MainActivity sends the TV's own keys into the page as the same KeyboardEvents (native/keys.ts),
// and the app says what kind of TV it is before the TV registers (native/platform.ts).
//
// Phones drive the TV app through the API's relay (tv/relay.ts), a second input beside the keys.
// On first launch it registers itself (tv/registration.ts).
//
// With ?mirror, the iPhone's second screen (Phase 8's Swift plugin loads this page on the
// external display): the phone remote's commands arrive over the bridge, and nothing is stored.
//   ?mirror&device=Kai's iPhone&market=inland-empire&station=<station id>

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@opencast/ui/styles.css";
import "@opencast/player/styles.css";
import { tvApi } from "@opencast/contracts";
import { bridgeInput, keyboardInput, type InputAdapter } from "@opencast/player";
import { send } from "./api/client";
import { AndroidTv, startNativeKeys } from "./native/AndroidTv";
import { isAndroidApp, loadNativeInfo } from "./native/plugin";
import { tvRoutes } from "./routes";
import { getDevice, setDevice, useMemoryOnly } from "./tv/device";
import { setPhones } from "./tv/phones";
import { ensureRegistered } from "./tv/registration";
import { relayInput } from "./tv/relay";
import { RelayStateToPhones } from "./tv/remoteState";
import { onSignOut, signOutLocally } from "./tv/session";
import { TvApp } from "./tv/TvApp";

const params = new URLSearchParams(window.location.search);
const mirror = params.has("mirror");
if (mirror) {
  useMemoryOnly();
  setDevice({ welcomed: true, marketSlug: params.get("market"), lastStationId: params.get("station") });
}
const device = params.get("device")?.slice(0, 60) || null;
const androidApp = !mirror && isAndroidApp();

// The TV app's relay: open while it runs (never on the mirror, whose phone is the bridge).
const relay = mirror
  ? null
  : relayInput({
      open: async (signal) => {
        await ensureRegistered();
        return send(tvApi.tvRemoteEvents, {}, { signal, accept: "text/event-stream" });
      },
      othersCanChange: () => getDevice().settings.othersOnWifiCanChange,
      onPhones: setPhones,
      onSignedOut: () => {
        if (getDevice().token) signOutLocally();
      }
    });
if (relay) onSignOut(() => relay.reset());

// The relay's chip comes first in the hint row, then the remote's keys.
const inputs = (where: () => "picture" | "overlay"): InputAdapter[] =>
  mirror || !relay ? [bridgeInput({ origins: [window.location.origin], device: () => device })] : [relay, keyboardInput({ profile: "tv", context: where })];

async function boot() {
  // Checked on the env itself so the production build drops the mock chunk entirely.
  if (import.meta.env.VITE_MOCK === "true") {
    const { startMocks } = await import("./mocks/browser");
    await startMocks();
  }
  if (androidApp) {
    startNativeKeys();
    // Fire TV, Google TV or Android TV, from the app, before the TV registers as one.
    await loadNativeInfo();
  }
  // First launch: the TV registers itself (again later if the API can't be reached now).
  if (!mirror) void ensureRegistered().catch(() => undefined);
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <TvApp mode={mirror ? "mirror" : "tv"} inputs={inputs} routes={tvRoutes}>
        {relay && <RelayStateToPhones relay={relay} />}
        {androidApp && <AndroidTv />}
      </TvApp>
    </StrictMode>
  );
}

void boot();
