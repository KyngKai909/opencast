// Every viewer route and overlay against the real API (playwright.real.config.ts), as Sam (the
// seeded viewer) and signed out: each answer matches its contract (the client parses every
// response and says so in the console when one doesn't), and the API refuses nothing it isn't
// meant to. The account's endpoints (A1, A2, A3, E1) are in the contracts now; a proposed endpoint
// added later goes in PROPOSED, by request id.

import type { Page } from "@playwright/test";
import { api, expect, seed, signIn, test } from "../lib/real";

/** Proposed endpoints the API doesn't mount yet (docs/contract-requests.md), by request id. None now. */
const PROPOSED: Array<[id: string, method: string, path: RegExp]> = [];

interface Visit {
  name: string;
  path: string | (() => Promise<string>);
  signedOut?: boolean;
  /** Gets from the path to the thing checked. */
  open?: (page: Page) => Promise<void>;
  sees: (page: Page) => ReturnType<Page["getByRole"]>;
  /** Refusals this visit expects ("GET /v1/stations/nobody 404"). */
  refuses?: RegExp;
}

const heading = (name: string | RegExp) => (p: Page) => p.getByRole("heading", { name }).first();
const dialog = (name: string | RegExp) => (p: Page) => p.getByRole("dialog", { name });
const main = (p: Page) => p.getByRole("main").first();

/** A permission link the desk sent Tía Lupe's Kitchen (a new one: the seed's answered one's link isn't kept). */
async function permissionLink(): Promise<string> {
  const asked = await api<{ link: string }>(`/admin/creators/${seed.creators.lupe}/permission-requests`, { as: "dee", method: "POST", body: { sentVia: ["email"], note: "Checking the page." } });
  return `/permission/${asked.link.split("/permission/")[1]}`;
}

const VISITS: Visit[] = [
  { name: "home", path: "/", sees: (p) => p.getByRole("button", { name: /^BEAT 12\.1, Inland Beat: station preview$/ }) },
  { name: "home, signed out", path: "/", signedOut: true, sees: dialog("Where are you tuning in from?") },
  { name: "market picker", path: "/?modal=market", sees: dialog("Where are you tuning in from?") },
  { name: "radio band", path: "/radio", sees: heading("Radio band") },
  { name: "tuned in, TV", path: "/watch/beat", sees: (p) => p.getByRole("button", { name: /^Pledge/ }).first() },
  { name: "tuned in, radio", path: "/watch/nite", sees: main },
  { name: "pledge", path: "/watch/reel?modal=pledge&station=REEL", sees: dialog(/Saturday Reel/) },
  { name: "share", path: "/watch/beat?modal=share&station=BEAT", sees: dialog("Share") },
  { name: "guide", path: "/guide", sees: heading(/Tonight|Today|Tomorrow/) },
  { name: "search", path: "/?q=late", sees: dialog("Search") },
  { name: "search, a number", path: "/?q=12.1", sees: dialog("Search") },
  { name: "station preview", path: "/?station=BEAT", sees: dialog("Inland Beat") },
  { name: "program", path: async () => `/program/${seed.programs.lateCrate}`, sees: heading("Late Crate") },
  { name: "station", path: "/beat", sees: (p) => p.getByText("Inland Beat").first() },
  { name: "station, claimable", path: "/crat", sees: (p) => p.getByText("Crate").first() },
  { name: "station, off the air", path: "/mojv", sees: (p) => p.getByText("Mojave Community").first() },
  { name: "station, unknown", path: "/nobody", sees: main, refuses: /^GET \/v1\/stations\/nobody 404$/ },
  { name: "presets", path: "/presets", sees: (p) => p.getByRole("button", { name: "Key 1, BEAT 12.1. Tune in" }) },
  { name: "you", path: "/you", sees: heading("Reminders") },
  { name: "managing a pledge", path: "/you", open: async (p) => p.getByRole("button", { name: /Saturday Reel.*Manage|Manage, Saturday Reel/ }).click(), sees: dialog(/Saturday Reel/) },
  ...["account", "market", "watching", "notifications", "tvs", "appearance", "privacy", "data"].map((s): Visit => ({ name: `settings, ${s}`, path: `/settings/${s}`, sees: main })),
  { name: "remote, not casting", path: "/remote", sees: heading("Not casting") },
  { name: "tv code", path: "/tv", sees: heading("Add a TV") },
  { name: "permission page", path: permissionLink, signedOut: true, sees: (p) => p.getByRole("heading", { level: 1 }) }
];

for (const v of VISITS) {
  test(v.name, async ({ page }) => {
    const refused: string[] = [];
    const mismatched: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && /doesn't match its contract/.test(m.text())) mismatched.push(m.text().slice(0, 300));
    });
    page.on("response", (r) => {
      const u = new URL(r.url());
      if (u.port === "8788" && r.status() >= 400) refused.push(`${r.request().method()} ${u.pathname} ${r.status()}`);
    });
    if (!v.signedOut) await signIn(page, "sam");
    await page.goto(typeof v.path === "string" ? v.path : await v.path());
    if (v.open) await v.open(page);
    await expect(v.sees(page)).toBeVisible();
    // Let the page's queries answer (nothing loading). The player stays "tuning": the harness runs
    // no playout worker, so no station has a stream (docs/apps/testing.md).
    await expect(page.locator('[aria-busy="true"]:visible:not(.oc-player)')).toHaveCount(0);
    for (const r of refused) test.info().annotations.push({ type: "refused", description: r });
    expect(mismatched, "responses that don't match their contracts").toEqual([]);
    const unexpected = refused.filter((r) => {
      const [method, path, status] = r.split(" ");
      if (v.refuses?.test(r)) return false;
      return !(status === "404" && PROPOSED.some(([, m, p]) => m === method && p.test(path!)));
    });
    expect(unexpected, "calls the API refused").toEqual([]);
  });
}
