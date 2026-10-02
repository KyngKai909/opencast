// A243 (2026-10-02) in the Library, on the mocks: bumper roles and when an item airs. The rail's
// Bumpers list with a chip per role (and up next's empty state), a bumper's role under its type,
// and the item page's Role and When it airs, saved to the mock as the API would.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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
import { airsSummary, inWindow, notAiringLine } from "../../components/live/bumpers";
import { ShellOptionsProvider } from "../../layout/shell";
import { StationProvider } from "../../station/StationContext";
import Library from "./Library";
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
          <Route path="/control/beat/library" element={<Library />} />
          <Route path="/control/beat/library/:folderId" element={<Library />} />
          <Route path="/control/beat/library/items/:itemId" element={<LibraryItem />} />
        </Routes>
      </StationProvider>
    </ShellOptionsProvider>,
    { path }
  );
const beatItem = (title: string) => getDb().library.items.find((i) => i.stationId === BEAT.id && i.title === title)!;

describe("when an item airs, in words", () => {
  const night = { from: "2026-12-01", until: "2026-12-31", dailyFrom: "18:00", dailyUntil: "02:00" };
  it("summarises its dates and times", () => {
    expect(airsSummary(null)).toBe("Any time");
    expect(airsSummary(night)).toBe("Dec 1 to Dec 31, 6:00 pm to 2:00 am");
    expect(airsSummary({ ...night, until: null, dailyFrom: null, dailyUntil: null })).toBe("From Dec 1");
    expect(airsSummary({ from: null, until: null, dailyFrom: "18:00", dailyUntil: "02:00" })).toBe("6:00 pm to 2:00 am");
  });
  it("is inside its window by the broadcast day and the wall clock, and says when it's not", () => {
    // 1:30 am on Jan 1 is Dec 31's broadcast day, inside 6:00 pm to 2:00 am.
    expect(inWindow(night, new Date("2027-01-01T09:30:00Z"))).toBe(true);
    expect(inWindow(night, new Date("2027-01-01T10:30:00Z"))).toBe(false);
    expect(notAiringLine(night, new Date("2026-09-27T03:42:12Z"))).toBe("Not airing now: from Dec 1");
    expect(notAiringLine({ from: null, until: null, dailyFrom: "06:00", dailyUntil: "12:00" }, new Date("2026-09-27T03:42:12Z"))).toBe("Not airing now: from 6:00 am");
  });
});

describe("the Library's bumpers", () => {
  it("lists them on the rail, with a chip per role; up next has its own empty state", async () => {
    renderAt("/control/beat/library/bumpers");
    expect(await screen.findByRole("heading", { name: "Bumpers" })).toBeTruthy();
    const rail = screen.getByRole("navigation", { name: "Library folders" });
    expect(within(rail).getByRole("link", { name: /All bumpers/ }).getAttribute("aria-current")).toBe("page");
    const table = screen.getByRole("table", { name: "Bumpers" });
    expect(within(table).getAllByText("Back to the reel").length).toBeGreaterThan(0);
    // The role under its type.
    expect(within(table).getByText("Out of a break")).toBeTruthy();
    expect(within(table).getByText("Any")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Up next" }));
    expect(await screen.findByText("No up next bumpers yet. Upload one, then set its role to Up next.")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Out of a break" }));
    expect((await screen.findAllByText("Back to the reel")).length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Beat Tape Live, trailer")).toHaveLength(0);
  });
});

describe("a bumper's page", () => {
  it("sets its role, with what each role means", async () => {
    const trailer = beatItem("Beat Tape Live, trailer");
    renderAt(`/control/beat/library/items/${trailer.id}`);
    const role = await screen.findByRole("radiogroup", { name: "Role" });
    expect(within(role).getByRole("radio", { name: "Any" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("A brand sting. Airs wherever a bumper is wanted.")).toBeTruthy();
    fireEvent.click(within(role).getByRole("radio", { name: "Up next" }));
    await waitFor(() => expect(beatItem("Beat Tape Live, trailer").bumperRole).toBe("up_next"));
    expect(await screen.findByText("We draw the next program's title over it, from your log. Leave room in the lower third.")).toBeTruthy();
  });

  it("sets when it airs: between dates and at times of day, past midnight", async () => {
    const reel = beatItem("Back to the reel");
    renderAt(`/control/beat/library/items/${reel.id}`);
    expect(await screen.findByRole("heading", { name: "When it airs" })).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "Any time" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Between dates" }));
    fireEvent.change(screen.getAllByLabelText("From")[0]!, { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getAllByLabelText("To")[0]!, { target: { value: "2026-12-31" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "At times of day" }));
    expect(screen.getByText("Past midnight is fine.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(beatItem("Back to the reel").airs).toEqual({ from: "2026-12-01", until: "2026-12-31", dailyFrom: "18:00", dailyUntil: "02:00" }));
    expect(await screen.findByText("Dec 1 to Dec 31, 6:00 pm to 2:00 am")).toBeTruthy();
    expect(screen.getByText("Not airing now: from Dec 1")).toBeTruthy();
  });

  it("a station ID has a window but no role; a program has neither", async () => {
    renderAt(`/control/beat/library/items/${beatItem("BEAT station ID").id}`);
    expect(await screen.findByRole("heading", { name: "When it airs" })).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: "Role" })).toBeNull();
  });
});
