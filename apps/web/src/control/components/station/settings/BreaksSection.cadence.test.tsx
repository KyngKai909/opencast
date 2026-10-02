// Settings, Breaks: "How often" (added 2026-09-29), on the mocks. Spots, the thank-you credit,
// bumpers and the station ID each get a choice; the station ID can't be never; a change is saved
// with the rest of the rule, and the mock answers it back. The ladder draws a bumper into the break
// and one out of it (A143).

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

const beat = { station: BEAT, id: BEAT.id, role: "owner" as const, studio: false, base: "/control/beat", label: "BEAT 12.1", can: () => true };
const select = (name: string) => screen.getByRole("combobox", { name }) as HTMLSelectElement;
const labels = (s: HTMLSelectElement) => within(s).getAllByRole("option").map((o) => o.textContent);

describe("Settings, Breaks: How often", () => {
  it("has a choice for spots, the credit, bumpers and the station ID, every break to start with", async () => {
    renderWithApi(<BreaksSection s={beat} />);
    expect(await screen.findByRole("heading", { name: "How often" })).toBeTruthy();
    for (const name of ["How often: Spots", "How often: Station ID", "How often: Bumpers", "How often: Thank-you credit"]) expect(select(name).value).toBe("break");
    expect(labels(select("How often: Station ID"))).not.toContain("Never");
    expect(labels(select("How often: Bumpers"))).toContain("Never");
    expect(labels(select("How often: Spots"))).toEqual(["In every break", "After every program", "After every 2 programs", "After every 3 programs", "After every 4 programs", "Once an hour", "Never"]);
    expect(screen.getByText("Last in every break")).toBeTruthy();
    expect(screen.getByText("In every break, up to the hourly cap")).toBeTruthy();
  });

  it("draws a bumper into the break and one out of it, fixed, around the spots and the credit", async () => {
    renderWithApi(<BreaksSection s={beat} />);
    const ladder = await screen.findByRole("list", { name: "In every break, in this order" });
    const rows = within(ladder).getAllByRole("listitem");
    expect(rows.map((r) => r.id)).toEqual(["cc-fill-BMP-in", "cc-fill-SPT", "cc-fill-UND", "cc-fill-partners", "cc-fill-BMP", "cc-fill-SID"]);
    expect(rows[0].textContent).toContain("A bumper into the break");
    expect(rows[4].textContent).toContain("A bumper out of the break");
    // Only the spots and the credit move.
    expect(rows.filter((r) => r.getAttribute("draggable") === "true").map((r) => r.id)).toEqual(["cc-fill-SPT", "cc-fill-UND"]);
  });

  it("saves a change with the rest of the rule", async () => {
    renderWithApi(<BreaksSection s={beat} />);
    await screen.findByRole("heading", { name: "How often" });
    fireEvent.change(select("How often: Station ID"), { target: { value: "hour" } });
    await waitFor(() => expect(breakRuleOf(BEAT.id).cadence?.stationId).toEqual({ every: "hour" }));
    expect(await screen.findByText("Last in the first break after the top of the hour")).toBeTruthy();
    fireEvent.change(select("How often: Bumpers"), { target: { value: "never" } });
    await waitFor(() => expect(breakRuleOf(BEAT.id).cadence).toEqual({ stationId: { every: "hour" }, bumpers: { every: "never" }, underwriting: { every: "break" }, spots: { every: "break" } }));
    expect(await screen.findByText("No bumpers in breaks")).toBeTruthy();
    fireEvent.change(select("How often: Thank-you credit"), { target: { value: "n:3" } });
    await waitFor(() => expect(breakRuleOf(BEAT.id).cadence?.underwriting).toEqual({ every: "n_programs", n: 3 }));
  });

  it("saves how often spots air", async () => {
    renderWithApi(<BreaksSection s={beat} />);
    await screen.findByRole("heading", { name: "How often" });
    fireEvent.change(select("How often: Spots"), { target: { value: "n:2" } });
    await waitFor(() => expect(breakRuleOf(BEAT.id).cadence?.spots).toEqual({ every: "n_programs", n: 2 }));
    expect(await screen.findByText("Up to the hourly cap. Other breaks are only as long as the rest needs")).toBeTruthy();
    fireEvent.change(select("How often: Spots"), { target: { value: "never" } });
    await waitFor(() => expect(breakRuleOf(BEAT.id).cadence?.spots).toEqual({ every: "never" }));
    expect(await screen.findByText("Breaks are only as long as the rest needs. Nothing is sold in them")).toBeTruthy();
  });
});
