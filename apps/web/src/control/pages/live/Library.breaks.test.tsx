// Programming Phase 4 (2026-10-10) in the Library, on the mocks: a program's suggested break points
// on its page ("Suggested break points: 3, from chapter marks"), each previewed from two seconds
// before, then used (they become its break points) or dismissed, saved to the mock as the API would.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { setupServer } from "msw/node";
import { Route, Routes } from "react-router";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));
vi.mock("../../../auth/AuthProvider", async (original) => ({ ...(await original<object>()), useAuth: () => ({ getToken: async () => null }) }));

import { handlers } from "../../mocks/handlers";
import { getDb, resetDb } from "../../mocks/db";
import { BEAT } from "../../mocks/fixtures/stations";
import { renderWithApi, signInAs, stubMatchMedia } from "../../components/onair/testing";
import { suggestionWords, timesWords } from "../../components/live/BreakFields";
import { ShellOptionsProvider } from "../../layout/shell";
import { StationProvider } from "../../station/StationContext";
import LibraryItem from "./LibraryItem";

const server = setupServer(...handlers);
beforeAll(() => {
  stubMatchMedia();
  server.listen({ onUnhandledRequest: "bypass" });
});
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
  signInAs("kai@example.com");
});
afterEach(() => server.resetHandlers());

const beat = { station: BEAT, id: BEAT.id, role: "owner" as const, studio: false, base: "/control/beat", label: "BEAT 12.1", can: () => true };
const renderAt = (path: string) =>
  renderWithApi(
    <ShellOptionsProvider>
      <StationProvider value={beat}>
        <Routes>
          <Route path="/control/beat/library/items/:itemId" element={<LibraryItem />} />
        </Routes>
      </StationProvider>
    </ShellOptionsProvider>,
    { path }
  );
const beatItem = (title: string) => getDb().library.items.find((i) => i.stationId === BEAT.id && i.title === title)!;
const MIN = 60_000;

describe("suggested break points, in words", () => {
  it("says how many and where they came from, and when each is", () => {
    expect(suggestionWords({ source: "chapter", pointsMs: [8 * MIN, 22 * MIN, 33 * MIN], previewUrl: null })).toBe("Suggested break points: 3, from chapter marks");
    expect(suggestionWords({ source: "fade", pointsMs: [11 * MIN], previewUrl: null })).toBe("Suggested break points: 1, from fades to black");
    expect(timesWords([8 * MIN, 22 * MIN + 10_000, 33 * MIN + 40_000])).toBe("8:00, 22:10 and 33:40");
    expect(timesWords([14 * MIN])).toBe("14:00");
  });
});

describe("a program's page", () => {
  it("shows the suggestions, previews each from two seconds before, and Use these makes them its break points", async () => {
    renderAt(`/control/beat/library/items/${beatItem("Crate Talk, ep. 1").id}`);
    expect(await screen.findByText("Suggested break points: 3, from chapter marks")).toBeTruthy();
    expect(beatItem("Crate Talk, ep. 1").breakPointsMs).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Preview the break at 22:10" }));
    expect(await screen.findByLabelText("Preview of Crate Talk, ep. 1, from 22:08")).toBeTruthy();
    expect(screen.getByText("Playing from 22:08")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use these" }));
    await waitFor(() => expect(beatItem("Crate Talk, ep. 1").breakPointsMs).toEqual([8 * MIN, 22 * MIN + 10_000, 33 * MIN + 40_000]));
    expect(await screen.findByText("3 break points")).toBeTruthy();
    expect(screen.getByText("At 8:00, 22:10 and 33:40.")).toBeTruthy();
    expect(screen.queryByText("Suggested break points: 3, from chapter marks")).toBeNull();
  });

  it("Dismiss leaves its break points as they are", async () => {
    renderAt(`/control/beat/library/items/${beatItem("Crate Talk, ep. 2").id}`);
    expect(await screen.findByText("Suggested break points: 2, from fades to black")).toBeTruthy();
    // Its preview isn't ready yet.
    expect((screen.getByRole("button", { name: "Preview the break at 11:24" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("The preview is still being made.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByText("Suggested break points: 2, from fades to black")).toBeNull());
    expect(beatItem("Crate Talk, ep. 2").breakPointsMs).toEqual([]);
    expect(beatItem("Crate Talk, ep. 2").suggestedBreakPoints).toBeNull();
  });

  it("a program with break points of its own and nothing suggested lists them", async () => {
    renderAt(`/control/beat/library/items/${beatItem("Crate Session 01").id}`);
    expect(await screen.findByText("3 break points")).toBeTruthy();
    expect(screen.getByText("At 30:00, 1:00:00 and 1:30:00.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use these" })).toBeNull();
  });
});
