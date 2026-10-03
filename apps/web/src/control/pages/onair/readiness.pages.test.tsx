// Preparation for air on the pages, on the mocks at the reference Saturday, 8:42 pm: the Monitor's
// "Prepared for air" names Late Crate, ep. 15 (10:00 pm, still being prepared) and links it to that
// airing on the log (G13), which the log picks out; the pre-flight offers "Go to library" for
// "Items prepared for air" only when an item couldn't be prepared (G14).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { setupServer } from "msw/node";
import { Route, Routes } from "react-router";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { handlers } from "../../mocks/handlers";
import { getDb, resetDb } from "../../mocks/db";
import { BEAT } from "../../mocks/fixtures/stations";
import { LogPage } from "../../components/onair/LogPage";
import { renderWithApi, signInAs, stubMatchMedia } from "../../components/onair/testing";
import { ShellOptionsProvider } from "../../layout/shell";
import { StationProvider } from "../../station/StationContext";
import Monitor from "./Monitor";
import SetupSignOn from "./SetupSignOn";

const server = setupServer(...handlers);
beforeAll(() => {
  stubMatchMedia();
  // The Monitor's program picture: jsdom plays no media.
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  HTMLMediaElement.prototype.load = () => undefined;
  server.listen({ onUnhandledRequest: "bypass" });
});
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
  signInAs("kai@example.com");
});
afterEach(() => server.resetHandlers());

const lateCrate15 = () => getDb().log.find((e) => e.stationId === BEAT.id && e.title === "Late Crate, ep. 15" && e.startsAt === "2026-09-27T05:00:00.000Z")!;
const beat = { station: BEAT, id: BEAT.id, role: "owner" as const, studio: false, base: "/control/beat", label: "BEAT 12.1", can: () => true };

describe("the Monitor's Prepared for air", () => {
  it("links the item named to its airing on the log", async () => {
    renderWithApi(
      <ShellOptionsProvider>
        <StationProvider value={beat}>
          <Monitor />
        </StationProvider>
      </ShellOptionsProvider>
    );
    const link = await screen.findByRole("link", { name: "Late Crate, ep. 15" });
    expect(link.getAttribute("href")).toBe(`/control/beat/schedule?day=2026-09-26&entry=${lateCrate15().id}`);
    // The line reads as before, counting the item once though it airs twice (10:00 pm and 3:30 am).
    expect(link.closest("dd")!.textContent).toMatch(/^\d+ of \d+ items ready for the next 48 hours; Late Crate, ep\. 15 at 10:00 pm is being prepared$/);
  });

  it("the log picks out the airing it links to", async () => {
    const id = lateCrate15().id;
    renderWithApi(<LogPage stationId={BEAT.id} station={BEAT} base="/control/beat" />, { path: `/?day=2026-09-26&entry=${id}` });
    const title = await screen.findAllByText("Late Crate, ep. 15");
    const picked = title.map((t) => t.closest(".oc-blk")).filter((b) => b?.classList.contains("oc-blk--sel"));
    // The 10:00 pm airing (the evening's window has only that one), not the dead air's pane.
    expect(picked).toHaveLength(1);
    expect(document.querySelectorAll(".oc-blk--sel")).toHaveLength(1);
  });
});

describe("the pre-flight's Items prepared for air", () => {
  const renderSignOn = () =>
    renderWithApi(
      <Routes>
        <Route path="/control/setup/:stationId/sign-on" element={<SetupSignOn />} />
      </Routes>,
      { path: `/control/setup/${BEAT.id}/sign-on` }
    );
  const preparedRow = async () => (await screen.findByText("Items prepared for air")).closest("li") as HTMLElement;

  it("has no fix while items are only being prepared", async () => {
    renderSignOn();
    const row = await preparedRow();
    expect(row.textContent).toMatch(/The rest are being prepared/);
    expect(within(row).queryByRole("link", { name: "Go to library" })).toBeNull();
  });

  it("offers Go to library, to the item, when one couldn't be prepared", async () => {
    const item = getDb().library.items.find((i) => i.title === "Late Crate, ep. 15")!;
    item.status = "failed";
    renderSignOn();
    const row = await preparedRow();
    await waitFor(() => expect(row.textContent).toMatch(/1 couldn't be prepared \(its file needs replacing\)/));
    expect(within(row).getByRole("link", { name: "Go to library" }).getAttribute("href")).toBe(`/control/beat/library/items/${item.id}`);
  });

  it("says the output is ready, in the API's words", async () => {
    renderSignOn();
    const row = (await screen.findByText("Output ready")).closest("li") as HTMLElement;
    expect(row.textContent).toContain("Assembled from prepared items");
  });
});
