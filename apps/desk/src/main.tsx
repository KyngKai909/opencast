import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@opencast/ui/styles.css";
import "./app.css";
import { App } from "./App";

async function boot() {
  // The env itself, not config: Vite replaces it at build time, so a production build drops the
  // mocks' chunk entirely.
  if (import.meta.env.VITE_MOCK === "true") {
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
