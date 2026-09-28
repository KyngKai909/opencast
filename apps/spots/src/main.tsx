import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@opencast/ui/styles.css";
import "./app.css";
import { config } from "./config";
import { App } from "./App";

async function boot() {
  if (config.mock) {
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
