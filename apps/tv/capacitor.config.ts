// The Android TV and Fire TV app (Phase 8): TV mode's web build (dist/, the index entry) in a
// Capacitor WebView. The receiver entry is in dist/ too but the app never loads it.
// `npm run build:android` builds with the production env and copies it into android/.
//
// For a demo or development on an emulator, TV_DEV_SERVER=http://localhost:5175 npx cap sync android
// points a debug build at `npm run dev:mock` instead (with `adb reverse tcp:5175 tcp:5175`; only
// debug builds allow http, and only to localhost and the emulator's host: src/debug).

import process from "node:process";
import type { CapacitorConfig } from "@capacitor/cli";

const devServer = process.env.TV_DEV_SERVER;

const config: CapacitorConfig = {
  appId: "org.useopencast.tv",
  appName: "Opencast",
  webDir: "dist",
  // TV mode is always dark: no white flash before the page paints.
  backgroundColor: "#0F1830",
  ...(devServer ? { server: { url: devServer } } : {}),
  android: {
    // The picture only: no http anywhere (usesCleartextTraffic is off in the manifest too).
    allowMixedContent: false,
    // The remote's keys reach the page from MainActivity; the WebView starts with focus so the
    // D-pad's arrows and OK arrive without a first click.
    initialFocus: true
  },
  plugins: {
    // Back is TV mode's Back (MainActivity sends it to the page), never the App plugin's.
    App: { disableBackButtonHandler: true }
  }
};

export default config;
