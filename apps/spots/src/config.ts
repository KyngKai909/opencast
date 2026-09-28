// What Opencast for business is pointed at, from Vite's env (.env.example lists them).

const env = import.meta.env;

export const config = {
  /** `npm run dev:mock`: every API call answered by Mock Service Worker. */
  mock: env.VITE_MOCK === "true",
  apiBase: (env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, "") ?? "",
  privyAppId: (env.VITE_PRIVY_APP_ID as string | undefined) || null,
  /** Where mock mode's clock starts (the reference frames' moment), or null for the real time. */
  mockClock: (env.VITE_MOCK_CLOCK as string | undefined) || null
};
