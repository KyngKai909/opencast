// What the app is pointed at, from Vite's env (.env.example lists them).

const env = import.meta.env;

export const config = {
  /** `npm run dev:mock`: every API call answered by Mock Service Worker. */
  mock: env.VITE_MOCK === "true",
  apiBase: (env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, "") ?? "",
  privyAppId: (env.VITE_PRIVY_APP_ID as string | undefined) || null,
  controlUrl: (env.VITE_CONTROL_URL as string | undefined) ?? "http://localhost:5173",
  /** Opencast's Cast receiver application, from the Google Cast console. Without it, casting isn't offered. */
  castAppId: (env.VITE_CAST_APP_ID as string | undefined) || null,
  /** TV mode's origin: dev:mock's Cast sender reaches its receiver through TV mode's bridge page. */
  tvUrl: ((env.VITE_TV_URL as string | undefined) || "http://localhost:5175").replace(/\/+$/, ""),
  /** Where mock mode's clock starts (the reference frames' moment), or null for the real time. */
  mockClock: (env.VITE_MOCK_CLOCK as string | undefined) || null
};
