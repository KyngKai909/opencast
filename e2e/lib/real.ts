// Helpers for the real-API specs (playwright.real.config.ts, `tests/<product>[.<name>].real.spec.ts`).
//
//   import { api, expect, seed, signIn, test } from "../lib/real";
//
//   test("…", async ({ page }) => {
//     await signIn(page, "kai");                       // before page.goto: the app starts signed in
//     await page.goto("/");
//     const beat = seed.stations.beat;                   // the seed's ids (e2e/real/shared.ts Seed)
//     await api(`/stations/${beat.id}/rotations/main`, { as: "kai", method: "PUT", body: { spotIds: [seed.spots.fallMenu] } });
//   });
//
// `test` blocks every request the page makes to anything but this machine (and lists them on the
// test as `outside` annotations): the real-API runs never call outside services, from the API
// (e2e/real/api-server.ts refuses them) or from the browser.

import { test as base, type Page } from "@playwright/test";
import { tokenFor } from "../real/tokens";
import { API_BASE, PEOPLE, emailOf, readState, type Person, type Seed } from "../real/shared";

export { expect } from "@playwright/test";
export { tokenFor } from "../real/tokens";
export { PEOPLE, REAL_PORTS, appUrl, emailOf, type Person, type Seed } from "../real/shared";

const local = (url: URL) => ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.protocol === "data:" || url.protocol === "blob:";

export const test = base.extend<{ outside: string[] }>({
  outside: [
    async ({ context }, use, info) => {
      const hits: string[] = [];
      await context.route(
        (url) => !local(url),
        (route) => {
          hits.push(route.request().url());
          return route.abort("blockedbyclient");
        }
      );
      await use(hits);
      for (const url of [...new Set(hits)]) info.annotations.push({ type: "outside", description: `blocked ${url}` });
    },
    { auto: true }
  ]
});

/**
 * The seed's ids, read from the run's state when first used (the global setup writes it, after the
 * spec files are loaded). `seed.stations.beat.id`, `seed.businesses.orange`, `seed.users.kai`…
 */
export const seed: Seed = new Proxy({} as Seed, {
  get: (_, key) => (readState().seed as unknown as Record<string | symbol, unknown>)[key]
});

/**
 * Signs `person` in to the app in `page`: a seeded person (PEOPLE: "kai", "maya", "dee"…) or anyone
 * new (any other name, e.g. "new-owner"; the API makes their account on first use, with the email
 * `<name>@example.com`). Call it before `page.goto` to open the app signed in; on a page that's
 * already open it signs in there too (the app follows the change). Returns the token and email.
 */
export async function signIn(page: Page, person: Person | (string & {})) {
  const token = await tokenFor(person, { expiresIn: "2h" });
  const email = emailOf(person);
  const put = ([t, e]: [string, string]) => {
    localStorage.setItem("oc-dev-token", t);
    localStorage.setItem("oc-dev-email", e);
  };
  await page.addInitScript(put, [token, email] as [string, string]);
  if (/^https?:/.test(page.url())) {
    await page.evaluate(([t, e]) => {
      localStorage.setItem("oc-dev-token", t);
      localStorage.setItem("oc-dev-email", e);
      window.dispatchEvent(new StorageEvent("storage", { key: "oc-dev-token" }));
    }, [token, email] as [string, string]);
  }
  return { token, email, id: (seed.users as Record<string, string>)[person] ?? null };
}

/** Signs out of the app in `page` (and keeps it signed out on the next load). */
export async function signOut(page: Page) {
  await page.addInitScript(() => {
    localStorage.removeItem("oc-dev-token");
    localStorage.removeItem("oc-dev-email");
  });
  if (/^https?:/.test(page.url())) {
    await page.evaluate(() => {
      localStorage.removeItem("oc-dev-token");
      localStorage.removeItem("oc-dev-email");
      window.dispatchEvent(new StorageEvent("storage", { key: "oc-dev-token" }));
    });
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message: string
  ) {
    super(message);
  }
}

/**
 * Arranges (or checks) data through the real API, as someone or nobody. `path` is under /v1
 * (`/businesses/${id}/spots`). Returns the parsed body; throws an ApiError unless the status is
 * `status` (default: any 2xx).
 */
export async function api<T = any>(
  path: string,
  o: { as?: Person | (string & {}); method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown; status?: number; token?: string } = {}
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = o.token ?? (o.as ? await tokenFor(o.as) : null);
  if (token) headers.authorization = `Bearer ${token}`;
  if (o.body !== undefined) headers["content-type"] = "application/json";
  const method = o.method ?? (o.body === undefined ? "GET" : "POST");
  const res = await fetch(`${readState().apiBase}/v1${path.startsWith("/") ? path : `/${path}`}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const text = await res.text();
  const body = text ? (() => {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  })() : undefined;
  const ok = o.status === undefined ? res.ok : res.status === o.status;
  if (!ok) throw new ApiError(res.status, body, `${method} /v1${path} as ${o.as ?? "nobody"} answered ${res.status}${o.status ? ` (wanted ${o.status})` : ""}: ${text.slice(0, 500)}`);
  return body as T;
}

/** TV mode signs in by code: approves the code the TV shows, as `person` (tv.approveTvCode). */
export async function approveTvCode(code: string, person: Person | (string & {}) = "sam") {
  return api(`/tv/codes/${encodeURIComponent(code)}/approve`, { as: person, method: "POST" });
}

/** The pushes and emails the API has sent this run, oldest first (the harness's notifier). */
export async function sent(): Promise<Array<{ channel: "push" | "email"; to: string; title: string; at: string }>> {
  return (await fetch(`${API_BASE}/e2e/sent`)).json();
}

export const person = (p: Person) => PEOPLE[p];
