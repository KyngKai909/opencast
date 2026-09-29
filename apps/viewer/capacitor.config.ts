// The viewer as an iPhone and Android app (Phase 8). The app runs the bundled web build in dist/
// (`npm run build:native`, which also copies TV mode into dist/tv/ for the iPhone's external
// display). docs/apps/native.md has the toolchains, the ids and the demo steps.
//
// Live reload, for development only: point the app at the viewer's dev server on this computer's
// LAN address, then run it from Xcode or Android Studio.
//   CAP_SERVER_URL=http://192.168.1.20:5174 npx cap sync
// Never ship a build made with CAP_SERVER_URL set (`build:native` refuses to).

import type { CapacitorConfig } from "@capacitor/cli";

const liveReload = process.env.CAP_SERVER_URL?.trim() || null;

const config: CapacitorConfig = {
  appId: "org.useopencast.viewer",
  appName: "Opencast",
  webDir: "dist",
  // Two grounds: the web view's own background shows for a moment before the app draws, so it's
  // the dark ground (the default one), as in the PWA manifest.
  backgroundColor: "#0F1830",
  ios: {
    // The page handles the notch and home indicator itself (env(safe-area-inset-*)).
    contentInset: "never",
    // Lets the external display's web view and the phone's share media sessions sensibly.
    allowsLinkPreview: false
  },
  android: {
    // The API and the streams are https; nothing on the page needs plain http.
    allowMixedContent: false
  },
  ...(liveReload ? { server: { url: liveReload, cleartext: liveReload.startsWith("http://") } } : {})
};

export default config;
