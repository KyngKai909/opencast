// The desk's Catalog and Settings pages on the mocks: the shelf as drawn (desk-catalog 01); a series
// with its episode, the item that came out and what was rebuilt (02); adding an item and checking
// it twice, the second time by someone else (03); and Settings' rules, team and change log (desk-pages 04).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { MemoryRouter, Route, Routes } from "react-router";
import { ToastProvider } from "@opencast/ui";

vi.mock("../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { handlers } from "../../mocks/handlers";
import { resetSettings } from "../mocks/settingsDb";
import { resetDb } from "../mocks/db";
import { setTokenSource } from "../../api/client";
import { MOCK_TOKEN_PREFIX } from "../../auth/mockToken";
import Catalog from "./Catalog";

import CatalogItem from "./CatalogItem";
import CatalogSeries from "./CatalogSeries";
import Settings from "./Settings";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const server = setupServer(...handlers);
beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
  server.listen({ onUnhandledRequest: "bypass" });
});
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear();
  resetDb();
  resetSettings();
  signInAs("dee@opencast.example");
});
afterEach(() => server.resetHandlers());

function signInAs(email: string) {
  setTokenSource(async () => `${MOCK_TOKEN_PREFIX}${email}`);
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/desk/markets/:marketSlug/catalog" element={<Catalog />} />
            <Route path="/desk/markets/:marketSlug/catalog/series/:seriesId" element={<CatalogSeries />} />
            <Route path="/desk/markets/:marketSlug/catalog/items/:itemId" element={<CatalogItem />} />
            <Route path="/desk/settings/:section" element={<Settings />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe("the shelf", () => {
  it("lists every series with its basis, episodes, carriers and state", async () => {
    renderAt("/desk/markets/inland-empire/catalog");
    expect(await screen.findByRole("heading", { level: 1, name: "Catalog" })).toBeTruthy();
    expect(screen.getByText("Opencast's own programs, offered free to every station. Made possible by Clear.")).toBeTruthy();
    expect(screen.getByText("312")).toBeTruthy();
    expect(screen.getByText("Items waiting for a second check")).toBeTruthy();
    const table = screen.getByRole("grid", { name: "Catalog series" });
    const mystery = within(table).getByRole("row", { name: /The mystery hour/ });
    expect(mystery.textContent).toContain("Per show, still checking");
    expect(mystery.textContent).toContain("44 of 60");
    expect(mystery.textContent).toContain("7 in review");
    expect(within(table).getByRole("row", { name: /Licensed catalogs/ }).textContent).toContain("Coming");
    expect(screen.getByRole("button", { name: "Add an item" })).toBeTruthy();
  });

  it("shows no changes to someone who can't make them", async () => {
    signInAs("lee@opencast.example");
    renderAt("/desk/markets/inland-empire/catalog");
    expect(await screen.findByRole("grid", { name: "Catalog series" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add an item" })).toBeNull();
  });
});

describe("a series", () => {
  it("shows an episode's items, the one that came out, and what was rebuilt", async () => {
    renderAt(`/desk/markets/inland-empire/catalog/series/${U(7102)}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Cartoons, 1928 to 1936" })).toBeTruthy();
    const ep = screen.getByRole("table", { name: "Episode 14" });
    expect(within(ep).getByRole("row", { name: /River Rhythms/ }).textContent).toContain("Published 1929, before 1931");
    expect(within(ep).getByRole("row", { name: /Down the River/ }).textContent).toContain("Removed Sept 21");
    expect(screen.getByText(/"Down the River" came out when its check failed \(renewal found in 1962\)/)).toBeTruthy();
    expect(screen.getByText('Sept 21: Episode 14 rebuilt after "Down the River" failed (renewal found in 1962). 38 unchanged.')).toBeTruthy();
    expect(screen.getByText("All the station's, except 1 credit an hour")).toBeTruthy();
  });
});

describe("adding an item, checked twice", () => {
  it("fills the checklist, sends it, and takes the second check from someone else", async () => {
    const add = await fetch("http://api.test/v1/admin/catalog/series/" + U(7102) + "/items", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${MOCK_TOKEN_PREFIX}dee@opencast.example` },
      body: JSON.stringify({ libraryItemId: U(7701), source: "1933, original print, Library of Congress", publishedYear: 1933 })
    }).then((r) => r.json());
    const view = renderAt(`/desk/markets/inland-empire/catalog/items/${add.id}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Ferry Boat Follies" })).toBeTruthy();
    expect(screen.getByText("Add an item")).toBeTruthy();
    const send = screen.getByRole("button", { name: "Send for second check" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(screen.getByText('"Source is an original, not a restoration" isn\'t answered yet.')).toBeTruthy();

    for (const title of ["Source is an original, not a restoration", "Published 1933, with a copyright notice", "Copyright not renewed", "Soundtrack", "Characters and trademarks"]) {
      fireEvent.click(await screen.findByRole("button", { name: `Answer: ${title}` }));
      const group = await screen.findByRole("group", { name: `Answer: ${title}` });
      fireEvent.click(within(group).getByRole("radio", { name: title === "Characters and trademarks" ? "Yes, with a caution" : "Yes" }));
      fireEvent.change(within(group).getByLabelText(/The record/), { target: { value: "Checked against the archive's record" } });
      fireEvent.click(within(group).getByRole("button", { name: "Save" }));
      await waitFor(() => expect(screen.queryByRole("group", { name: `Answer: ${title}` })).toBeNull());
    }
    await waitFor(() => expect((screen.getByRole("button", { name: "Send for second check" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Send for second check" }));
    await waitFor(() => expect(document.body.textContent).toContain("Waiting for a rights reviewer or admin other than Dee A."));
    view.unmount();

    signInAs("rae@opencast.example");
    renderAt(`/desk/markets/inland-empire/catalog/items/${add.id}`);
    fireEvent.click(await screen.findByRole("button", { name: "Confirm: it's free to air" }));
    expect(await screen.findByText(/Rae T\. reviewed the evidence and confirmed/)).toBeTruthy();
    expect(screen.getByText("1933. Not renewed")).toBeTruthy();
  });
});

describe("Settings", () => {
  it("lists the rules, sets one from a date, and logs it", async () => {
    const view = renderAt("/desk/settings/rules");
    expect(await screen.findByRole("heading", { name: "Rules" })).toBeTruthy();
    expect(screen.getByText("Set once, read everywhere. A change takes effect from the date you choose; the old value stays in the change log.")).toBeTruthy();
    expect(within(await screen.findByRole("region", { name: "Pay-as-you-go" })).getAllByText("Not set yet")).toHaveLength(3);
    expect(screen.getByText("10 GB, 5 live hours")).toBeTruthy();
    expect(screen.getByText("1930")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit: Repeat limit" }));
    const dialog = await screen.findByRole("dialog", { name: "Repeat limit" });
    fireEvent.change(within(dialog).getByLabelText("Upheld claims in 12 months"), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText("Takes effect"), { target: { value: "2026-10-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Set it" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Repeat limit" })).toBeNull());
    expect(await screen.findByText("2 from October 1")).toBeTruthy();
    view.unmount();

    renderAt("/desk/settings/log");
    expect(await screen.findByText("Repeat limit: 3 to 2")).toBeTruthy();
  });

  it("shows the team with its roles, and each market's numbering", async () => {
    const view = renderAt("/desk/settings/team");
    const team = await screen.findByRole("table", { name: "The team" });
    expect(within(team).getByRole("row", { name: /Rae T\./ }).textContent).toContain("Rights reviewer");
    expect(within(team).getByRole("row", { name: /Lee R\./ }).textContent).toContain("Market lead, High Desert");
    view.unmount();
    renderAt("/desk/settings/markets");
    const markets = await screen.findByRole("table", { name: "Numbering by market" });
    expect(within(markets).getByRole("row", { name: /High Desert/ }).textContent).toContain("TV 2 to 36, with subchannels");
    expect(within(markets).getByRole("row", { name: /Inland Empire/ }).textContent).toContain("Radio 88.2 to 107.8, even tenths");
  });
});
