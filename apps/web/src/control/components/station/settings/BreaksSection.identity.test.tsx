// Settings, Breaks: signing off and on (A242, 2026-10-02), on the mocks. Beside the station ID's
// cadence: the sequence, "Air the station ID after the opener" and "Open each broadcast day with
// the opener", both off to start with; each change is saved with the rest of the rule.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { setupServer } from "msw/node";

vi.mock("../../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { handlers } from "../../../mocks/handlers";
import { resetDb } from "../../../mocks/db";
import { breakRuleOf } from "../../../mocks/fixtures/station";
import { BEAT } from "../../../mocks/fixtures/stations";
import { renderWithApi, signInAs, stubMatchMedia } from "../../onair/testing";
import { BreaksSection } from "./BreaksSection";

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
const toggle = (name: string) => screen.getByRole("switch", { name }) as HTMLInputElement;

describe("Settings, Breaks: signing off and on", () => {
  it("shows the sequence, both switches off", async () => {
    renderWithApi(<BreaksSection s={beat} />);
    expect(await screen.findByRole("heading", { name: "Signing off and on" })).toBeTruthy();
    expect(screen.getByText("Closer → Off-air card → off air → Opener → (Station ID) → first program")).toBeTruthy();
    expect(toggle("Air the station ID after the opener").getAttribute("aria-checked")).toBe("false");
    expect(toggle("Open each broadcast day with the opener").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("Off: the opener takes the station ID's place as you sign back on")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Openers and closers" }).getAttribute("href")).toBe("/control/beat/library/openers");
  });

  it("saves the station ID after the opener, and the daily opener", async () => {
    renderWithApi(<BreaksSection s={beat} />);
    await screen.findByRole("heading", { name: "Signing off and on" });
    fireEvent.click(toggle("Air the station ID after the opener"));
    await waitFor(() => expect(breakRuleOf(BEAT.id).stationIdAfterOpener).toBe(true));
    expect(await screen.findByText("Closer → Off-air card → off air → Opener → Station ID → first program")).toBeTruthy();
    fireEvent.click(toggle("Open each broadcast day with the opener"));
    await waitFor(() => expect(breakRuleOf(BEAT.id).dailyOpener).toBe(true));
    expect(await screen.findByText(/^For a channel that never signs off: at the first program after 6:00 am/)).toBeTruthy();
    // The rest of the rule is unchanged.
    expect(breakRuleOf(BEAT.id).cadence?.stationId).toEqual({ every: "break" });
  });
});
