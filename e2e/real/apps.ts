// Each app in real mode: its Vite dev server (so import.meta.env.DEV is true and the test-token
// sign-in is in), pointed at the e2e API, on its own port. Set in the process environment, which
// wins over the apps' .env files, so a Privy app id in .env.local never loads Privy here.

import { API_BASE, appUrl, type RealApp } from "./shared.js";

export function appEnv(app: RealApp): Record<string, string> {
  const common = {
    VITE_API_BASE: API_BASE,
    VITE_DEV_TOKEN_AUTH: "true",
    VITE_MOCK: "false",
    VITE_MOCK_CLOCK: "",
    // No Privy, no Clear provider app, no Cast: nothing outside loads in the browser either.
    VITE_PRIVY_APP_ID: "",
    VITE_CLEAR_PRIVY_PROVIDER_APP_ID: "",
    VITE_CAST_APP_ID: "",
    // TV mode's links to the Opencast app (its /tv sign-in page, pledges).
    VITE_VIEWER_URL: appUrl("web"),
    VITE_TV_URL: appUrl("tv")
  };
  return app === "web" ? { ...common, VITE_MIRROR_TV: "url" } : common;
}

/** The command a Playwright webServer (or a person) runs, from the app's folder. */
export const appCommand = (port: number) => `npx vite --mode e2e --port ${port} --strictPort`;
