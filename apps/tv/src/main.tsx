// TV mode as an app: the Android TV and Fire TV app (Phase 8), TV browsers. The remote's keys
// (keyboard arrows stand in on a computer) through the "tv" keyboard profile.
//
// With ?mirror, the iPhone's second screen (Phase 8's Swift plugin loads this page on the
// external display): the phone remote's commands arrive over the bridge, and nothing is stored.
//   ?mirror&device=Kai's iPhone&market=inland-empire&station=<station id>

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@opencast/ui/styles.css";
import "@opencast/player/styles.css";
import { bridgeInput, keyboardInput, type InputAdapter } from "@opencast/player";
import { config } from "./config";
import { tvRoutes } from "./routes";
import { setDevice, useMemoryOnly } from "./tv/device";
import { TvApp } from "./tv/TvApp";

const params = new URLSearchParams(window.location.search);
const mirror = params.has("mirror");
if (mirror) {
  useMemoryOnly();
  setDevice({ welcomed: true, marketSlug: params.get("market"), lastStationId: params.get("station") });
}
const device = params.get("device")?.slice(0, 60) || null;

const inputs = (where: () => "picture" | "overlay"): InputAdapter[] =>
  mirror ? [bridgeInput({ origins: [window.location.origin], device: () => device })] : [keyboardInput({ profile: "tv", context: where })];

async function boot() {
  if (config.mock) {
    const { startMocks } = await import("./mocks/browser");
    await startMocks();
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <TvApp mode={mirror ? "mirror" : "tv"} inputs={inputs} routes={tvRoutes} />
    </StrictMode>
  );
}

void boot();
