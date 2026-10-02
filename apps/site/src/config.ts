// What the site is pointed at, from Vite's env (.env.example lists it).

const env = import.meta.env;

export const config = {
  /** `npm run dev:mock`: the waitlist is answered by Mock Service Worker. */
  mock: env.VITE_MOCK === "true",
  apiBase: (env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, "") ?? ""
};
