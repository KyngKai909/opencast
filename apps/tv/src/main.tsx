// TV mode as an app: the Android TV and Fire TV app (Phase 8), TV browsers. The remote's keys
// (keyboard arrows stand in on a computer) through the "tv" keyboard profile.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@opencast/ui/styles.css";
import "@opencast/player/styles.css";
import { keyboardInput, type InputAdapter } from "@opencast/player";
import { config } from "./config";
import { tvRoutes } from "./routes";
import { TvApp } from "./tv/TvApp";

const inputs = (where: () => "picture" | "overlay"): InputAdapter[] => [keyboardInput({ profile: "tv", context: where })];

async function boot() {
  if (config.mock) {
    const { startMocks } = await import("./mocks/browser");
    await startMocks();
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <TvApp mode="tv" inputs={inputs} routes={tvRoutes} />
    </StrictMode>
  );
}

void boot();
