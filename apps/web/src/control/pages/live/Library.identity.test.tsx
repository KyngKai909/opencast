// A242 (2026-10-02) in the Library, on the mocks: openers, closers and off-air cards as types. The
// rail's "Sign-off and sign-on" lists with their counts, each list with the sequence they air in
// and the drop zone set to upload that type, the type picker (a picture is an off-air card only),
// and the item page's words.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { setupServer } from "msw/node";
import { Route, Routes } from "react-router";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));
vi.mock("../../../auth/AuthProvider", async (original) => ({ ...(await original<object>()), useAuth: () => ({ getToken: async () => null }) }));

import type { LibraryItem as Item } from "@opencast/contracts";
import { handlers } from "../../mocks/handlers";
import { getDb, resetDb } from "../../mocks/db";
import { BEAT } from "../../mocks/fixtures/stations";
import { renderWithApi, signInAs, stubMatchMedia } from "../../components/onair/testing";
import { identityCounts, typeOf } from "../../components/live/LibraryParts";
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

describe("an item's type", () => {
  it("is its identity code when it has one, else its log code", () => {
    expect(typeOf({ code: "SID", identCode: "OPN" })).toBe("OPN");
    expect(typeOf({ code: "OPEN", identCode: "OFF" })).toBe("OFF");
    expect(typeOf({ code: "BMP", identCode: null })).toBe("BMP");
    expect(typeOf({ code: "PGM" })).toBe("PGM");
    const items = [{ identCode: "OPN" }, { identCode: "OPN" }, { identCode: "CLS" }, { identCode: null }] as Item[];
    expect(identityCounts(items)).toEqual({ openers: 2, closers: 1, offAirCards: 0 });
  });
});

describe("the Library's openers, closers and off-air cards", () => {
  it("lists them on the rail with their counts", async () => {
    renderAt("/control/beat/library");
    const rail = await screen.findByRole("navigation", { name: "Library folders" });
    expect(within(rail).getByText("Sign-off and sign-on")).toBeTruthy();
    for (const [name, href] of [
      ["Closers", "/control/beat/library/closers"],
      ["Off-air cards", "/control/beat/library/off-air-cards"],
      ["Openers", "/control/beat/library/openers"]
    ]) {
      const link = within(rail).getByRole("link", { name: new RegExp(`^${name}`) });
      expect(link.getAttribute("href")).toBe(href);
      expect(within(link).getByLabelText("1 item")).toBeTruthy();
    }
    // The type picker shows each one's own type; a picture is an off-air card and nothing else.
    const opener = screen.getByRole("combobox", { name: "Type of BEAT sign-on" }) as HTMLSelectElement;
    expect(opener.value).toBe("OPN");
    expect(within(opener).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "PGM (Program)",
      "SPT (Spot)",
      "UND (Underwriting)",
      "BMP (Bumper)",
      "SID (Station ID)",
      "OPN (Opener)",
      "CLS (Closer)",
      "OFF (Off-air card)"
    ]);
    const card = screen.getByRole("combobox", { name: "Type of BEAT test card" }) as HTMLSelectElement;
    expect(within(card).getAllByRole("option").map((o) => o.textContent)).toEqual(["OFF (Off-air card)"]);
  });

  it("shows a list with the sequence, and uploads there as that type", async () => {
    renderAt("/control/beat/library/openers");
    expect(await screen.findByRole("heading", { name: "Openers" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "BEAT sign-on" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "BEAT goodnight" })).toBeNull();
    const sequence = screen.getByRole("region", { name: "When you sign off and back on" });
    expect(sequence.querySelector(".cc-signoff__line")!.textContent).toBe("Closer → Off-air card → off air → Opener → (Station ID) → first program");
    expect(within(sequence).getByText("Your opener. It ends as the first program starts")).toBeTruthy();
    expect(within(sequence).getByText("Only if you turn it on in Settings, Breaks. The opener replaces it")).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "Upload as" }) as HTMLSelectElement).value).toBe("OPN");
  });

  it("says what's made for the station where it has none of its own", async () => {
    getDb().library.items = getDb().library.items.filter((i) => !(i.stationId === BEAT.id && i.identCode === "CLS"));
    renderAt("/control/beat/library/closers");
    expect(await screen.findByText("No closer of your own yet. Until you add one, Opencast makes one in your look.")).toBeTruthy();
    expect(screen.getByText('Made for you: "12.1 BEAT · Signing off · Back at 6:00 am", in your look')).toBeTruthy();
  });

  it("takes pictures as off-air cards in the drop zone", async () => {
    renderAt("/control/beat/library/off-air-cards");
    expect(await screen.findByText("Drop an off-air card here")).toBeTruthy();
    const input = document.querySelector<HTMLInputElement>(".cc-drop input[type=file]")!;
    expect(input.accept).toBe("video/*,audio/*,image/png,image/jpeg,image/webp");
    // Back to guessing: video and audio only.
    fireEvent.change(screen.getByRole("combobox", { name: "Upload as" }), { target: { value: "" } });
    expect(input.accept).toBe("video/*,audio/*");
  });

  it("changes an item's type to a closer, and keeps a picture an off-air card", async () => {
    renderAt("/control/beat/library");
    const bumper = (await screen.findByRole("combobox", { name: "Type of Back to the reel" })) as HTMLSelectElement;
    fireEvent.change(bumper, { target: { value: "CLS" } });
    await waitFor(() => expect(beatItem("Back to the reel")).toMatchObject({ code: "SID", identCode: "CLS" }));
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Type of Back to the reel" }) as HTMLSelectElement).value).toBe("CLS"));
  });

  it("names the type on the item page, and sends it to sign-off and sign-on rather than the log", async () => {
    renderAt(`/control/beat/library/items/${beatItem("BEAT test card").id}`);
    expect(await screen.findByRole("heading", { name: "BEAT test card" })).toBeTruthy();
    expect(screen.getByText(/^Off-air card, a picture\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign-off and sign-on" }).getAttribute("href")).toBe("/control/beat/settings/breaks");
    expect(screen.queryByRole("link", { name: "Schedule" })).toBeNull();
  });
});
