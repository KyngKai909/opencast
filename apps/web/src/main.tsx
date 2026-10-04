import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@opencast/ui/styles.css";
import "@opencast/player/styles.css";
import "./app.css";
import { isNative } from "./viewer/native/platform";
import { App } from "./App";
import { ViewportProbe } from "./viewer/debug/ViewportProbe";

async function boot() {
  // The env itself, not config: Vite replaces it at build time, so a production build drops the
  // mocks' chunk entirely.
  if (import.meta.env.VITE_MOCK === "true") {
    const { startMocks } = await import("./mocks/browser");
    await startMocks();
  } else if (import.meta.env.PROD && !isNative() && "serviceWorker" in navigator) {
    // The web app only: the iPhone and Android apps already run from the files inside them.
    void navigator.serviceWorker.register("/sw.js");
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
      <ViewportProbe />
    </StrictMode>
  );
}

void boot();
