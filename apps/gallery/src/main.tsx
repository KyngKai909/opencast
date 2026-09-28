import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { GroundProvider } from "@opencast/ui";
import "@opencast/ui/styles.css";
import "./gallery.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GroundProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </GroundProvider>
  </StrictMode>
);
