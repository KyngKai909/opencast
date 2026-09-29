// Every Network desk route against the real API (playwright.real.config.ts), as Dee (an Opencast
// admin), and the gates: signed out, and signed in off the team. Each page has its heading, says
// no error, throws nothing, and every answer matches its contract (the client says so in the
// console when one doesn't). The API refuses nothing: every endpoint the desk calls is in the
// contracts (its proposed ones all landed on 2026-09-28). A proposed endpoint added later goes in
// PROPOSED, by request id, and is recorded on the test.
// Routes from apps/web/src/desk/routes.tsx (the Opencast app's /desk).

import type { Page } from "@playwright/test";
import { expect, seed, signIn, signOut, test } from "../lib/real";

const IE = "/desk/markets/inland-empire";

/** Proposed endpoints the API doesn't mount yet (docs/contract-requests.md), by request id. None now. */
const PROPOSED: Array<[id: string, method: string, path: RegExp]> = [];

interface Visit {
  name: string;
  path: string | (() => string);
  as?: "dee" | "sam" | null;
  /** The page's heading (level 1). */
  h1: string | RegExp;
  /** And something else it says once its data is in. */
  says?: (page: Page) => ReturnType<Page["getByText"]>;
}

const VISITS: Visit[] = [
  { name: "board, TV band", path: `${IE}/board`, h1: "Inland Empire", says: (p) => p.getByRole("heading", { name: "TV band" }) },
  { name: "board, a free channel selected", path: `${IE}/board?ch=33`, h1: "Inland Empire", says: (p) => p.getByRole("button", { pressed: true }).first() },
  { name: "board, radio band", path: `${IE}/board?ch=101.9`, h1: "Inland Empire", says: (p) => p.getByRole("heading", { name: "Radio band" }) },
  { name: "pipeline", path: `${IE}/pipeline`, h1: "Creator pipeline", says: (p) => p.getByRole("table", { name: "Creators" }) },
  { name: "pipeline, said yes", path: `${IE}/pipeline?stage=said_yes`, h1: "Creator pipeline", says: (p) => p.getByRole("group", { name: "Stages" }).getByRole("button", { pressed: true }) },
  { name: "pipeline, add a creator", path: `${IE}/pipeline?add=1`, h1: "Creator pipeline", says: (p) => p.getByRole("dialog", { name: "Add a creator" }) },
  { name: "ask, a creator who said yes", path: () => `${IE}/pipeline/${seed.creators.lupe}/ask`, h1: /Tía Lupe's Kitchen/ },
  { name: "setup, Tía Lupe's Kitchen", path: () => `${IE}/pipeline/${seed.creators.lupe}/setup`, h1: /\b33\.1$|Tía Lupe's Kitchen|^Set up / },
  { name: "setup, Crate (on air, not claimed)", path: () => `${IE}/pipeline/${seed.creators.crate}/setup`, h1: /CRAT/, says: (p) => p.getByText("On air, waiting to be claimed") },
  { name: "listed sources", path: `${IE}/listed`, h1: "Listed sources" },
  { name: "listed sources, list a source", path: `${IE}/listed?add=1`, h1: "Listed sources", says: (p) => p.getByRole("dialog", { name: "List a source" }) },
  { name: "catalog", path: `${IE}/catalog`, h1: "Catalog", says: (p) => p.getByText("This page isn't designed yet.") },
  { name: "held earnings", path: "/desk/held-earnings", h1: "Held earnings", says: (p) => p.getByRole("main").getByText("CRAT").first() },
  { name: "reserved call signs", path: "/desk/reserved-call-signs", h1: "Reserved call signs" },
  { name: "rights claims", path: "/desk/rights-claims", h1: "Rights claims", says: (p) => p.getByText("This page isn't designed yet.") },
  { name: "catalog sponsors", path: "/desk/catalog-sponsors", h1: "Catalog sponsors", says: (p) => p.getByText("This page isn't designed yet.") },
  { name: "settings", path: "/desk/settings", h1: "Settings", says: (p) => p.getByRole("heading", { name: "Appearance" }) },
  { name: "a page that isn't there", path: "/desk/no-such-page", h1: "There's nothing here." },
  { name: "signed out: the sign-in page", path: "/desk", as: null, h1: "Sign in to Network desk" },
  { name: "signed in off the team", path: "/desk", as: "sam", h1: "This desk is for the Opencast team.", says: (p) => p.getByText("You're signed in as sam@example.com", { exact: false }) }
];

for (const v of VISITS) {
  test(v.name, async ({ page }) => {
    const errors: string[] = [];
    const mismatched: string[] = [];
    const refused: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && /doesn't match its contract/.test(m.text())) mismatched.push(m.text().slice(0, 300));
    });
    page.on("response", (r) => {
      const u = new URL(r.url());
      if (u.port === "8788" && r.status() >= 400) refused.push(`${r.request().method()} ${u.pathname} ${r.status()}`);
    });
    const who = v.as === undefined ? "dee" : v.as;
    if (who) await signIn(page, who);
    else await signOut(page);
    await page.goto(typeof v.path === "string" ? v.path : v.path());
    await expect(page.getByRole("heading", { level: 1, name: v.h1 })).toBeVisible();
    if (v.says) await expect(v.says(page)).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Something went wrong", { exact: false })).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    for (const r of refused) {
      const [method, path] = r.split(" ");
      const id = PROPOSED.find(([, m, p]) => m === method && p.test(path!))?.[0];
      test.info().annotations.push({ type: id ? `still on mocks (${id})` : "refused", description: r });
    }
    expect(errors, "page errors").toEqual([]);
    expect(mismatched, "responses that don't match their contracts").toEqual([]);
    const unexpected = refused.filter((r) => {
      const [method, path, status] = r.split(" ");
      return !(status === "404" && PROPOSED.some(([, m, p]) => m === method && p.test(path!)));
    });
    expect(unexpected, "calls the API refused").toEqual([]);
  });
}
