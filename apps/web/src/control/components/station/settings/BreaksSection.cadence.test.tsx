// Settings, Breaks: "How often" (added 2026-09-29), on the mocks. The station ID, bumpers and the
// thank-you credit each get a choice; the station ID can't be never; a change is saved with the
// rest of the rule, and the mock answers it back.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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

const beat = { station: BEAT, id: BEAT.id, role: "owner" as const, studio: false, base: "/control/beat", can: () => true };
const select = (name: string) => screen.getByRole("combobox", { name }) as HTMLSelectElement;
const labels = (s: HTMLSelectElement) => within(s).getAllByRole("option").map((o) => o.textContent);

describe("Settings, Breaks: How often", () => {
  it("has a choice for the station ID, bumpers and the credit, every break to start with", async () => {
    renderWithApi(<BreaksSection s={beat} />);
    expect(await screen.findByRole("heading", { name: "How often" })).toBeTruthy();
    for (const name of ["How often: Station ID", "How often: Bumpers", "How often: Thank-you credit"]) expect(select(name).value).toBe("break");
    expect(labels(select("How often: Station ID"))).not.toContain("Never");
    expect(labels(select("How often: Bumpers"))).toContain("Never");
    expect(screen.getByText("Last in every break")).toBeTruthy();
  });

  it("saves a change with the rest of the rule", async () => {
    renderWithApi(<BreaksSection s={beat} />);
    await screen.findByRole("heading", { name: "How often" });
    fireEvent.change(select("How often: Station ID"), { target: { value: "hour" } });
    await waitFor(() => expect(breakRuleOf(BEAT.id).cadence?.stationId).toEqual({ every: "hour" }));
    expect(await screen.findByText("Last in the first break after the top of the hour")).toBeTruthy();
    fireEvent.change(select("How often: Bumpers"), { target: { value: "never" } });
    await waitFor(() => expect(breakRuleOf(BEAT.id).cadence).toEqual({ stationId: { every: "hour" }, bumpers: { every: "never" }, underwriting: { every: "break" } }));
    expect(await screen.findByText("Breaks hold on the station ID slate instead")).toBeTruthy();
    fireEvent.change(select("How often: Thank-you credit"), { target: { value: "n:3" } });
    await waitFor(() => expect(breakRuleOf(BEAT.id).cadence?.underwriting).toEqual({ every: "n_programs", n: 3 }));
  });
});
