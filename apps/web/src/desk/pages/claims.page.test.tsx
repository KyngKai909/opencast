// The desk's Rights claims page on the mocks (desk-pages 01): the figures, the open claims with
// their state, next date and carriers; a claim's timeline, carriers and evidence; a privacy
// complaint that says so; the Closed and By station tabs; recording an outcome; and a market lead,
// who sees their own market and can't record outcomes.
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
import { resetClaims } from "../mocks/claimsDb";
import { resetDb } from "../mocks/db";
import { setTokenSource } from "../../api/client";
import { MOCK_TOKEN_PREFIX } from "../../auth/mockToken";
import Claims from "./Claims";

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
  resetClaims();
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
            <Route path="/desk/rights-claims" element={<Claims />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe("Rights claims", () => {
  it("shows the figures and every open claim with its state, what's next and its carriers", async () => {
    renderAt("/desk/rights-claims");
    expect(await screen.findByRole("heading", { level: 1, name: "Rights claims" })).toBeTruthy();
    expect(screen.getByText("Claims against programs on any station, and the answers.")).toBeTruthy();
    expect(await screen.findByText("Open claims, 3 off air")).toBeTruthy();
    expect(screen.getByText("Station answer due in 2 days")).toBeTruthy();
    expect(screen.getByText("Stations carrying something that was claimed")).toBeTruthy();
    expect(screen.getByText("Stations near the repeat limit")).toBeTruthy();
    const table = screen.getByRole("grid", { name: "Open claims" });
    const late = within(table).getByRole("row", { name: /Late Crate, ep\. 9, on BEAT 12\.1/ });
    expect(late.textContent).toContain("Northside Records: two tracks in the second half");
    expect(late.textContent).toContain("Counter-notice sent");
    expect(late.textContent).toContain("Northside has until Sept 29");
    const tamales = within(table).getByRole("row", { name: /Tamales for forty/ });
    expect(tamales.textContent).toContain("Off air");
    expect(tamales.textContent).toContain("SAZN answers by Sept 28");
    const council = within(table).getByRole("row", { name: /Council Watch/ });
    expect(council.textContent).toContain("Privacy, not copyright");
    expect(council.textContent).toContain("6");
  });

  it("shows the selected claim's timeline, where it reached, and its evidence", async () => {
    renderAt("/desk/rights-claims");
    const table = await screen.findByRole("grid", { name: "Open claims" });
    fireEvent.click(within(table).getByRole("row", { name: /Late Crate/ }));
    const pane = await screen.findByRole("complementary", { name: "Late Crate, ep. 9" });
    expect(within(pane).getByText("Claim received")).toBeTruthy();
    expect(within(pane).getByText("Off air on BEAT and 3 carriers")).toBeTruthy();
    expect(within(pane).getByText("Pulled from every log at once")).toBeTruthy();
    expect(within(pane).getByText("BEAT answered")).toBeTruthy();
    expect(within(pane).getByText('"The owner gave permission," with the licence attached')).toBeTruthy();
    expect(within(pane).getByText("Counter-notice sent to the claimant")).toBeTruthy();
    expect(within(pane).getByText("Northside's time to take legal action ends")).toBeTruthy();
    const carriers = within(pane).getByRole("list", { name: "Carriers" });
    expect(carriers.textContent).toContain("REEL 24.1");
    expect(within(pane).getByText("Opencast doesn't decide who's right. It follows the process, keeps the record, and restores or removes on the dates.")).toBeTruthy();
    expect(within(pane).getByRole("link", { name: "Message BEAT" }).getAttribute("href")).toMatch(/^mailto:kai@inlandbeat\.example\?subject=/);

    fireEvent.click(within(pane).getByRole("button", { name: "See evidence" }));
    const evidence = await screen.findByRole("dialog", { name: "Evidence" });
    expect(evidence.textContent).toContain("rights@northside.example");
    expect(evidence.textContent).toContain("31:10 to 44:15, Two tracks in the second half");
    expect(within(evidence).getByRole("link", { name: "northside-licence.pdf" })).toBeTruthy();
  });

  it("says a privacy complaint follows its own path", async () => {
    renderAt("/desk/rights-claims?claim=00000000-0000-4000-8000-000000008104");
    const pane = await screen.findByRole("complementary", { name: "Council Watch, Sept 22" });
    expect(within(pane).getByText("Privacy complaint received")).toBeTruthy();
    expect(within(pane).getByText("Off air on CIVC and 6 carriers")).toBeTruthy();
    expect(within(pane).getByText("Opencast reviews it")).toBeTruthy();
    expect(within(pane).getByText(/Not every claim is copyright/)).toBeTruthy();
  });

  it("records an outcome, and the claim moves to Closed", async () => {
    renderAt("/desk/rights-claims?claim=00000000-0000-4000-8000-000000008103");
    const pane = await screen.findByRole("complementary", { name: "Harbor Nights, ep. 2" });
    fireEvent.click(within(pane).getByRole("button", { name: "Record the outcome" }));
    const dialog = await screen.findByRole("dialog", { name: "Record the outcome" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Record it" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Choose what happened.");
    fireEvent.click(within(dialog).getByRole("radio", { name: /Withdrawn/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Record it" }));
    expect(await screen.findByText("Withdrawn. Harbor Nights, ep. 2 is back on air.")).toBeTruthy();
    await waitFor(() => expect(within(screen.getByRole("grid", { name: "Open claims" })).queryByRole("row", { name: /Harbor Nights, ep\. 2/ })).toBeNull());
    fireEvent.click(screen.getByRole("radio", { name: "Closed" }));
    const closed = await screen.findByRole("grid", { name: "Closed claims" });
    expect(within(closed).getByRole("row", { name: /Harbor Nights, ep\. 2/ }).textContent).toContain("Withdrawn");
  });

  it("lists stations against the repeat limit", async () => {
    renderAt("/desk/rights-claims?tab=stations");
    const table = await screen.findByRole("table", { name: "Claims by station" });
    const reel = within(table).getByRole("row", { name: /REEL 24\.1/ });
    expect(reel.textContent).toContain("1 of 3");
    expect(reel.textContent).toContain("Good");
    expect(screen.getByText(/Stations with upheld claims are counted against the repeat-infringer policy/)).toBeTruthy();
  });

  it("shows a market lead their market's claims, with no outcomes to record", async () => {
    signInAs("lee@opencast.example");
    renderAt("/desk/rights-claims?tab=closed");
    const table = await screen.findByRole("grid", { name: "Closed claims" });
    expect(within(table).getAllByRole("row").filter((r) => /MOJV/.test(r.textContent ?? ""))).toHaveLength(1);
    expect(within(table).queryByRole("row", { name: /BEAT/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Record the outcome" })).toBeNull();
  });
});
