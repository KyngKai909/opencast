import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@opencast/ui/styles.css";
import "./app.css";
import { App } from "./App";

async function boot() {
  // Checked here, not through config, so production builds leave the mocks out.
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
