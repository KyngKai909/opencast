// What Network desk is pointed at, from Vite's env (.env.example lists them).

const env = import.meta.env;

export const config = {
  /** `npm run dev:mock`: every API call answered by Mock Service Worker. */
  mock: env.VITE_MOCK === "true",
  apiBase: (env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, "") ?? "",
  /** Opencast's own Privy app. Never Clear's. */
  privyAppId: (env.VITE_PRIVY_APP_ID as string | undefined) || null,
  /** Master control, for "Open in master control". */
  controlUrl: ((env.VITE_CONTROL_URL as string | undefined) || "http://localhost:5173").replace(/\/+$/, ""),
  /** The viewer app, where a creator's permission page lives (mock mode's links). */
  viewerUrl: ((env.VITE_VIEWER_URL as string | undefined) || "http://localhost:5174").replace(/\/+$/, ""),
  /** Where mock mode's clock starts (the reference's moment), or null for the real time. */
  mockClock: (env.VITE_MOCK_CLOCK as string | undefined) || null
};
