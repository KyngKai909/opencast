import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@opencast/ui/styles.css";
import "@opencast/player/styles.css";
import "./app.css";
import { config } from "./config";
import { isNative } from "./native/platform";
import { App } from "./App";

async function boot() {
  if (config.mock) {
    const { startMocks } = await import("./mocks/browser");
    await startMocks();
  } else if (import.meta.env.PROD && !isNative() && "serviceWorker" in navigator) {
    // The web app only: the iPhone and Android apps already run from the files inside them.
    void navigator.serviceWorker.register("/sw.js");
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

void boot();
