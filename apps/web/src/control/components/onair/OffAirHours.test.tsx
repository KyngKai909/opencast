// The off air hours setting (G9), on the mocks at the reference Saturday, 8:42 pm: BEAT's rule as
// the frame's pane draws it, the form that replaces every rule, the API's 400 for a rule that signs
// off and back on at the same time shown on that rule, and at most seven rules.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { setupServer } from "msw/node";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { handlers } from "../../mocks/handlers";
import { getDb, resetDb } from "../../mocks/db";
import { BEAT } from "../../mocks/fixtures/stations";
import { OffAirHoursSection } from "./OffAirHours";
import { renderWithApi, signInAs, stubMatchMedia } from "./testing";

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

function pairs() {
  return [...document.querySelectorAll(".oc-kv__row")].map((r) => [r.querySelector("dt")!.textContent, r.querySelector("dd")!.textContent]);
}

describe("off air hours", () => {
  it("reads as the frame's pane: sign off every night at 2:00 am, back on at 6:00 am, and the next time", async () => {
    renderWithApi(<OffAirHoursSection stationId={BEAT.id} callSign="BEAT" phone={false} />);
    await screen.findByText("Every night, 2:00 am");
    // Tonight BEAT's overnight repeats run until 4:00 am; the hours cover the rest.
    expect(pairs()).toEqual([
      ["Sign off", "Every night, 2:00 am"],
      ["Sign back on", "6:00 am"],
      ["Next", "Sun 4:00 am to 6:00 am"]
    ]);
    expect(screen.getByText("Planned off air hours aren't dead air: no warnings, nothing fills them, and viewers see when you're back.")).toBeTruthy();
  });

  it("shows the API's 400 on the rule that signs off and back on at the same time, then saves", async () => {
    renderWithApi(<OffAirHoursSection stationId={BEAT.id} callSign="BEAT" phone={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Change" }));
    const form = await screen.findByRole("dialog", { name: "Off air hours" });
    const back = within(form).getByLabelText("Sign back on") as HTMLSelectElement;
    expect(back.value).toBe("06:00");
    fireEvent.change(back, { target: { value: "02:00" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect(await within(form).findByText("Sign off and back on can't be the same time.")).toBeTruthy();
    expect(back.getAttribute("aria-invalid")).toBe("true");
    // Nothing was saved.
    expect(getDb().offAirRules.find((r) => r.stationId === BEAT.id)).toMatchObject({ backAt: "06:00" });

    // Weeknights only, back at 5:00 am.
    fireEvent.change(back, { target: { value: "05:00" } });
    const nights = within(form).getByRole("group", { name: "Signs off on" });
    fireEvent.click(within(nights).getByRole("button", { name: "Sat" }));
    fireEvent.click(within(nights).getByRole("button", { name: "Sun" }));
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("Off air hours saved.")).toBeTruthy();
    expect(await screen.findByText("Weeknights, 2:00 am")).toBeTruthy();
    expect(getDb().offAirRules.filter((r) => r.stationId === BEAT.id)).toEqual([expect.objectContaining({ days: [1, 2, 3, 4, 5], signOffAt: "02:00", backAt: "05:00" })]);
  });

  it("takes up to seven rules, asks for a night, and can have none", async () => {
    renderWithApi(<OffAirHoursSection stationId={BEAT.id} callSign="BEAT" phone={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Change" }));
    const form = await screen.findByRole("dialog", { name: "Off air hours" });
    const add = within(form).getByRole("button", { name: "Add off air hours" });
    for (let i = 0; i < 6; i++) fireEvent.click(add);
    expect(within(form).getAllByRole("group", { name: "Signs off on" })).toHaveLength(7);
    expect((add as HTMLButtonElement).disabled).toBe(true);

    // A rule with no night can't be saved.
    const last = within(form).getAllByRole("group", { name: "Signs off on" })[6];
    for (const b of within(last).getAllByRole("button")) if (b.getAttribute("aria-pressed") === "true") fireEvent.click(b);
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    expect(await within(form).findByText("Choose at least one night.")).toBeTruthy();

    // Every rule removed: none, and BEAT is on around the clock.
    for (const b of within(form).getAllByRole("button", { name: "Remove" })) fireEvent.click(b);
    expect(within(form).getByText("No off air hours. BEAT stays on around the clock.")).toBeTruthy();
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("No off air hours. BEAT stays on around the clock.")).toBeTruthy();
    expect(getDb().offAirRules.filter((r) => r.stationId === BEAT.id)).toEqual([]);
  });
});
