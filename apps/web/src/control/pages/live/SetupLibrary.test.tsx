// Setup step 2, the library (A.2), on the mocks (changed 2026-09-29): Continue always works, even
// with nothing in the library (only signing on checks what's needed), and a station with no station
// ID of its own sees the generated one as a read-only row, with Preview; uploading one replaces it.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { setupServer } from "msw/node";
import { Route, Routes } from "react-router";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));
// The drop zone uploads with the signed-in person's token; nothing is uploaded here.
vi.mock("../../../auth/AuthProvider", async (original) => ({ ...(await original<object>()), useAuth: () => ({ getToken: async () => null }) }));

import { handlers } from "../../mocks/handlers";
import { getDb, resetDb } from "../../mocks/db";
import { BEAT } from "../../mocks/fixtures/stations";
import { renderWithApi, signInAs, stubMatchMedia } from "../../components/onair/testing";
import SetupLibrary from "./SetupLibrary";

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

const renderSetup = () =>
  renderWithApi(
    <Routes>
      <Route path="/control/setup/:stationId/library" element={<SetupLibrary />} />
    </Routes>,
    { path: `/control/setup/${BEAT.id}/library` }
  );

describe("setup's library step", () => {
  it("goes on to the program log with nothing in the library", async () => {
    const db = getDb();
    db.library.items = db.library.items.filter((i) => i.stationId !== BEAT.id);
    renderSetup();
    expect(await screen.findByText("Nothing here yet. Drop your first programs and a station ID above.")).toBeTruthy();
    const next = screen.getByRole("button", { name: "Continue to program log" }) as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    expect(screen.getByText("Signing on needs at least one program on the log. Without a station ID of your own, the generated one airs.")).toBeTruthy();
  });

  it("shows the generated station ID, read-only, with a preview", async () => {
    const db = getDb();
    db.library.items = db.library.items.filter((i) => !(i.stationId === BEAT.id && i.code === "SID"));
    renderSetup();
    const row = await screen.findByRole("group", { name: "Generated station ID" });
    expect(within(row).getByText("Generated station ID")).toBeTruthy();
    expect(within(row).getByText("Made for BEAT. Replaced by any station ID you upload")).toBeTruthy();
    expect(within(row).getByText("SID")).toBeTruthy();
    expect(within(row).getByText("Ready for air")).toBeTruthy();
    // Nothing to change, move or remove on it.
    expect(within(row).queryByRole("combobox")).toBeNull();
    expect(within(row).queryByRole("button", { name: /More/ })).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Preview" }));
    const dialog = await screen.findByRole("dialog", { name: "Generated station ID" });
    expect(within(dialog).getByRole("img", { name: "BEAT 12.1 in BEAT's colour" })).toBeTruthy();
    expect(within(dialog).getByText(/^Ten seconds over a soft sound bed, where BEAT needs a station ID/)).toBeTruthy();
  });

  it("has no generated row once the station has a station ID of its own", async () => {
    renderSetup();
    await screen.findByRole("button", { name: "Continue to program log" });
    await screen.findAllByText(/BEAT station ID/);
    expect(screen.queryByRole("group", { name: "Generated station ID" })).toBeNull();
  });
});
