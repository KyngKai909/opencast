import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ThemeProvider } from "./theme/ThemeProvider";
import { ChannelsProvider } from "./state/ChannelsProvider";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <ChannelsProvider>
          <App />
        </ChannelsProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>
);
