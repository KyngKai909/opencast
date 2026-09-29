import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@opencast/ui/styles.css";
import "./site.css";
import { config } from "./config";
import { App } from "./App";

async function boot() {
  // Mock mode only: Vite drops this branch, and the mocks with it, from the build.
  if (import.meta.env.DEV && config.mock) {
    const { startMocks } = await import("./mocks/browser");
    await startMocks();
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

void boot();
