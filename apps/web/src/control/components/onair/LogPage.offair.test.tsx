// The program log's off air (G9; A246's rundown): planned off air is its own row, striped grey,
// "Off air" with when the station is back, never dead air, and nothing warns about it; the hours'
// row links to where they're set (the Templates tab's "Every day"). A one-off sign-off reads as
// one. On the mocks at the reference Saturday, 8:42 pm: BEAT signs off every night 2:00 to 6:00 am
// (its overnight repeats run until 4:00), and tomorrow night it signs off at 11:00 pm.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { setupServer } from "msw/node";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { handlers } from "../../mocks/handlers";
import { resetDb } from "../../mocks/db";
import { BEAT } from "../../mocks/fixtures/stations";
import { dayRows } from "./dayRows";
import { LogPage } from "./LogPage";
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

const T = (hhmm: string) => `2026-09-27T${hhmm}:00.000Z`;

describe("the day's rows, off air", () => {
  const entries = [
    { id: "slow", kind: "program" as const, code: "PGM" as const, startsAt: T("05:30"), endsAt: T("06:40"), title: "Slow Hours", episodeTitle: null, itemId: null, programId: null, liveSourceId: null, carriedFrom: null, carriageAgreementId: null, repeatGroupId: null, localNote: null },
    { id: "signoff", kind: "off_air" as const, code: "OPEN" as const, startsAt: T("06:40"), endsAt: T("09:00"), title: "Off air", episodeTitle: null, itemId: null, programId: null, liveSourceId: null, carriedFrom: null, carriageAgreementId: null, repeatGroupId: null, localNote: null }
  ];
  const offAir = [
    { startsAt: T("06:40"), endsAt: T("09:00"), backAt: T("13:00"), source: "sign_off" as const, logEntryId: "signoff" },
    { startsAt: T("09:00"), endsAt: T("13:00"), backAt: T("13:00"), source: "hours" as const, logEntryId: null }
  ];
  // Dead air after 1:00 pm UTC (6:00 am Pacific), none inside the planned off air.
  const rows = dayRows({ entries, breaks: [], gaps: [{ startsAt: T("13:00"), endsAt: T("14:00") }], offAir, spans: [], from: T("05:00"), to: T("14:00"), now: Date.parse(T("03:42")) });

  it("draws the hours and a sign-off as planned off air, with when the station is back, and dead air as dead air", () => {
    expect(rows.map((r) => [r.id, r.kind, r.code])).toEqual([
      ["slow", "entry", "PGM"],
      ["signoff", "entry", "OFF"],
      [`off:${T("09:00")}`, "off_air", "OFF"],
      [`gap:${T("13:00")}`, "gap", "GAP"]
    ]);
    expect(rows[1].source).toBe("Planned, back at 6:00 am");
    expect(rows[2].source).toBe("Planned, back at 6:00 am");
  });
});

describe("the program log on the mocks", () => {
  it("draws BEAT's off air hours after the overnight repeats, linked to where they're set, and warns only about the real dead air", async () => {
    renderWithApi(<LogPage stationId={BEAT.id} station={BEAT} base="/control/beat" />, { path: "/?day=sat" });
    const list = await screen.findByRole("list", { name: "The rundown" });
    const off = within(list).getByText((_, el) => el?.tagName === "SMALL" && el.textContent === "Planned, back at 6:00 am. Change the hours").closest("li") as HTMLElement;
    expect(off.className).toContain("cc-rr--off");
    expect(off.className).not.toContain("cc-rr--gap");
    expect(within(off).getByRole("link", { name: "Change the hours" }).getAttribute("href")).toBe("/control/beat/schedule/templates");
    // The chips: one dead air, the frame's 11:40 pm to 2:00 am; the off air hours planned.
    expect(screen.getByText("Dead air at 11:40 pm, 2 hr 20 min")).toBeTruthy();
    expect(screen.getByText("Off air 4:00 to 6:00 am, planned")).toBeTruthy();
    expect(within(list).getAllByText("Dead air", { selector: "b" })).toHaveLength(1);
  });

  it("shows tomorrow night's sign-off as planned off air, back when the hours end", async () => {
    renderWithApi(<LogPage stationId={BEAT.id} station={BEAT} base="/control/beat" />, { path: "/?day=sun" });
    const list = await screen.findByRole("list", { name: "The rundown" });
    const rows = within(list).getAllByText("Off air", { selector: "b" }).map((b) => b.closest("li") as HTMLElement);
    const signOff = rows.find((r) => r.textContent?.includes("11:00 pm"))!;
    expect(within(signOff).getByText("Planned, back at 6:00 am")).toBeTruthy();
    expect(signOff.className).not.toContain("cc-rr--gap");
  });
});
