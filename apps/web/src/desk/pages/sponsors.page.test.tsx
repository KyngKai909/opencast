// desk-pages 03, Catalog sponsors, on the mocks: the page as drawn (the figures, Clear and Inland
// Empire Libraries, the credit in the pane); the grid of series by market; offering an open slot
// from the grid; ending a sponsorship; and a market lead acting only in their own market.
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
import { resetSponsors } from "../mocks/sponsorsDb";
import { resetDb } from "../mocks/db";
import { setTokenSource } from "../../api/client";
import { MOCK_TOKEN_PREFIX } from "../../auth/mockToken";
import Sponsors from "./Sponsors";

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
  resetSponsors();
  signInAs("dee@opencast.example");
});
afterEach(() => server.resetHandlers());

function signInAs(email: string) {
  setTokenSource(async () => `${MOCK_TOKEN_PREFIX}${email}`);
}

function renderAt(path = "/desk/catalog-sponsors") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/desk/catalog-sponsors" element={<Sponsors />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe("Catalog sponsors", () => {
  it("draws the figures, the sponsors with Clear first, and the selected credit", async () => {
    renderAt();
    expect(await screen.findByRole("heading", { level: 1, name: "Catalog sponsors" })).toBeTruthy();
    expect(screen.getByText("Businesses and organizations thanked in the catalog's credit.")).toBeTruthy();
    expect(screen.getByText("2,840")).toBeTruthy();
    expect(screen.getByText("Catalog credits aired in September")).toBeTruthy();
    expect(screen.getByText("Markets with a local sponsor slot open")).toBeTruthy();
    expect(screen.getByText("Share to the creator fund. Not set yet")).toBeTruthy();
    const list = screen.getByRole("grid", { name: "Catalog sponsors" });
    const clear = within(list).getByRole("row", { name: /Clear/ });
    expect(clear.textContent).toContain("The house sponsor, thanked wherever nobody else is");
    expect(clear.textContent).toContain("Every market");
    expect(clear.textContent).toContain("Not billed");
    expect(clear.textContent).toContain("2,412");
    const libraries = within(list).getByRole("row", { name: /Inland Empire Libraries/ });
    expect(libraries.textContent).toContain("Since August");
    expect(libraries.textContent).toContain("Nights at the observatory");
    expect(libraries.textContent).toContain("$150.00");
    expect(libraries.textContent).toContain("428");
    const pane = screen.getByRole("region", { name: "Inland Empire Libraries' credit" });
    expect(within(pane).getByRole("figure", { name: /Nights at the observatory is made possible by Inland Empire Libraries/ })).toBeTruthy();
    expect(pane.textContent).toContain("6 Inland Empire stations");
    expect(pane.textContent).toContain("October 1");
    expect(pane.textContent).toContain("Checked against the same credit rules as station sponsorships: who they are, not what they sell.");
    fireEvent.click(clear);
    expect((await screen.findByRole("region", { name: "Clear's credit" })).textContent).toContain("Not billed. Whether Clear pays for the slots it fills isn't decided");
  });

  it("shows every series in every market, and offers an open slot from the grid", async () => {
    renderAt();
    const grid = await screen.findByRole("table", { name: "Slots by series and market" });
    expect(within(grid).getByRole("button", { name: "Nights at the observatory in Inland Empire: Inland Empire Libraries. $150.00 a month" })).toBeTruthy();
    fireEvent.click(within(grid).getByRole("button", { name: "Cartoons, 1928 to 1936 in Inland Empire: Clear. Open slot, $150.00 a month" }));
    const pane = await screen.findByRole("region", { name: "Cartoons, 1928 to 1936 in Inland Empire" });
    expect(pane.textContent).toContain("Airs 12 times a day here, on 5 stations");
    fireEvent.click(within(pane).getByRole("button", { name: "Offer it" }));
    const dialog = await screen.findByRole("dialog", { name: "Offer a slot" });
    expect((within(dialog).getByLabelText("Series") as HTMLSelectElement).value).toBe("00000000-0000-4000-8000-000000007102");
    expect(within(dialog).getByText(/\$150\.00 a month, from Settings/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Find the business"), { target: { value: "orange" } });
    await waitFor(() => expect((within(dialog).getByLabelText("Business") as HTMLSelectElement).textContent).toBe("Orange Street Coffee, Redlands"));
    fireEvent.change(within(dialog).getByLabelText("Their credit"), { target: { value: "Coffee roasted in Redlands, now 20% off" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send the offer" }));
    expect(await within(dialog).findByText(/The credit can't be sent yet/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Their credit"), { target: { value: "Orange Street Coffee, roasting in Redlands." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send the offer" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("Offered to Orange Street Coffee. It's theirs to answer.")).toBeTruthy();
    const list = screen.getByRole("grid", { name: "Catalog sponsors" });
    expect((await within(list).findByRole("row", { name: /Orange Street Coffee/ })).textContent).toContain("Offered, waiting for their answer");
  });

  it("ends a sponsorship: thanked to the end of the month, then Clear again", async () => {
    renderAt();
    const pane = await screen.findByRole("region", { name: "Inland Empire Libraries' credit" });
    fireEvent.click(within(pane).getByRole("button", { name: "End sponsorship" }));
    expect(await screen.findByText("Inland Empire Libraries is thanked to the end of September, then Clear again.")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("region", { name: "Inland Empire Libraries' credit" }).textContent).toContain("September 30"));
  });

  it("lets a market lead act only in their own market, and the rest of the team read", async () => {
    signInAs("lee@opencast.example");
    renderAt("/desk/catalog-sponsors?market=inland-empire");
    const pane = await screen.findByRole("region", { name: "Inland Empire Libraries' credit" });
    expect(within(pane).queryByRole("button", { name: "End sponsorship" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add a sponsor" })).toBeTruthy();
    const grid = screen.getByRole("table", { name: "Slots by series and market" });
    expect(within(grid).queryByRole("columnheader", { name: "Los Angeles" })).toBeNull();
    fireEvent.click(within(grid).getByRole("button", { name: /^Cartoons, 1928 to 1936 in Inland Empire/ }));
    expect(within(await screen.findByRole("region", { name: "Cartoons, 1928 to 1936 in Inland Empire" })).queryByRole("button", { name: "Offer it" })).toBeNull();
  });

  it("shows a rights reviewer the page with nothing to change", async () => {
    signInAs("rae@opencast.example");
    renderAt();
    const pane = await screen.findByRole("region", { name: "Inland Empire Libraries' credit" });
    expect(within(pane).queryByRole("button", { name: "End sponsorship" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add a sponsor" })).toBeNull();
  });
});
