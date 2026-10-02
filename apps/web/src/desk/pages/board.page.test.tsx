// The market board on the mocks (network-desk 01.1), A234: a station sharing X.1's call sign whose
// owners no longer include anyone who owns X.1 is flagged under the figures, named by channel and
// call sign, with who owns each now; selecting it opens the slot, whose line for it says the same.
// Nothing on the page changes a call sign or unlinks a station: that's left to people.
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
import { getDb, resetDb, saveDb } from "../mocks/db";
import { STATION_IDS } from "../mocks/fixtures/stations";
import { setTokenSource } from "../../api/client";
import { MOCK_TOKEN_PREFIX } from "../../auth/mockToken";
import Board from "./Board";
import { DeskLayout } from "../layout/DeskLayout";

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
  setTokenSource(async () => `${MOCK_TOKEN_PREFIX}dee@opencast.example`);
});
afterEach(() => server.resetHandlers());

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/desk" element={<DeskLayout />}>
              <Route path="markets/:marketSlug/board" element={<Board />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

const flags = () => screen.queryByRole("list", { name: "Shared call signs whose owners differ" });

describe("the board's shared call signs whose owners differ (A234)", () => {
  it("flags 12.2 BEAT under the figures, and selecting it shows its line in the slot", async () => {
    renderAt("/desk/markets/inland-empire/board");
    const list = await screen.findByRole("list", { name: "Shared call signs whose owners differ" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain("Needs attention. 12.2 BEAT Beat Tapes no longer shares an owner with 12.1 BEAT Inland Beat");
    expect(items[0]!.textContent).toContain("Since September 25. Jen Park owns 12.2, Kai M. owns 12.1. BEAT is fixed on air, so nothing changes by itself");
    // Only a way to look: nothing here changes the call sign or unlinks it.
    expect(within(items[0]!).getAllByRole("button").map((b) => b.textContent)).toEqual(["Select 12"]);

    // The rail's Market board says how many there are.
    const rail = await screen.findByRole("link", { name: /^Market board/ });
    await waitFor(() => expect(rail.textContent).toContain("1, 1 shared call sign to look at"));

    fireEvent.click(within(items[0]!).getByRole("button", { name: "Select 12" }));
    await screen.findByText("12.1–2, selected");
    expect(screen.getByText(/^Beat Tapes\. No longer shares an owner with 12\.1 BEAT\. Since September 25\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open 12.2" }).getAttribute("href")).toBe("/control/beat-12-2/monitor");
    expect(screen.getByRole("link", { name: "Open 12.1" }).getAttribute("href")).toBe("/control/beat/monitor");
  });

  it("shows nothing once they have an owner in common again, and nothing on a market without one", async () => {
    const d = getDb();
    const tapes = d.stations.find((s) => s.ident.id === STATION_IDS.BEAT_TAPES)!;
    tapes.owners = ["Kai M."];
    tapes.ownersSplitAt = null;
    saveDb();
    const { unmount } = renderAt("/desk/markets/inland-empire/board");
    await screen.findByText("TV band");
    expect(flags()).toBeNull();
    unmount();
    renderAt("/desk/markets/high-desert/board");
    await screen.findByText("TV band");
    expect(flags()).toBeNull();
  });
});
