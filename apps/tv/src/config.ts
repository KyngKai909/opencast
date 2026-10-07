// What TV mode is pointed at, from Vite's env (.env.example lists them).

const env = import.meta.env;

export const config = {
  /** `npm run dev:mock`: every API call answered by Mock Service Worker. */
  mock: env.VITE_MOCK === "true",
  apiBase: (env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, "") ?? "",
  /** Where "sign in on your phone" sends people (the viewer app's /tv page). */
  viewerUrl: (env.VITE_VIEWER_URL as string | undefined) ?? "http://localhost:5174",
  /** The Cast receiver's application id, registered in the Cast console (the senders use it too). */
  castAppId: (env.VITE_CAST_APP_ID as string | undefined) || null,
  /**
   * The Samsung TV app's build (npm run build:tizen): its page is a file (file://…/index.html), so
   * TV mode's routes go in the address's hash (#/guide) instead of its path.
   */
  hashRoutes: env.VITE_TIZEN === "true",
  /** Where mock mode's clock starts (the reference frames' moment), or null for the real time. */
  mockClock: (env.VITE_MOCK_CLOCK as string | undefined) || null
};
