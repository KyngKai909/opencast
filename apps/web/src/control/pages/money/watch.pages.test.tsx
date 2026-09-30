// Watch data on master control's pages, on the mocks at the reference Saturday, 8:42 pm
// (follow-up Phase 1): the Audience page's rows (BEAT's watch time and tune-away lines, the airing
// on now counting; HALL's listening time), and Offering your programs across every station that
// aired them, for a station and a studio, never per station.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { setupServer } from "msw/node";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { handlers } from "../../mocks/handlers";
import { resetDb } from "../../mocks/db";
import { resetSettings, saveSettings, settingsDb } from "../../../desk/mocks/settingsDb";
import { BEAT, HALL, LAB } from "../../mocks/fixtures/stations";
import { renderWithApi, signInAs, stubMatchMedia } from "../../components/onair/testing";
import { ProgramWatch } from "../../components/watch/ProgramWatch";
import { ShellOptionsProvider } from "../../layout/shell";
import { StationProvider } from "../../station/StationContext";
import Audience from "./Audience";
import { stationLabel } from "../../station/slug";

const server = setupServer(...handlers);
beforeAll(() => {
  stubMatchMedia();
  server.listen({ onUnhandledRequest: "bypass" });
});
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear();
  resetDb();
  resetSettings();
  signInAs("kai@example.com");
});
afterEach(() => server.resetHandlers());

const as = (station: typeof BEAT, base: string, studio = false) => ({ station, id: station.id, role: "owner" as const, studio, base, label: stationLabel(station), can: () => true });

function renderAudience(station: typeof BEAT, base: string) {
  return renderWithApi(
    <ShellOptionsProvider>
      <StationProvider value={as(station, base)}>
        <Audience />
      </StationProvider>
    </ShellOptionsProvider>,
    { path: "/?period=tonight" }
  );
}

const rowOf = (table: HTMLElement, title: string) => within(table).getAllByRole("row").find((r) => r.textContent?.includes(title))!;

describe("the Audience page's program rows", () => {
  it("BEAT tonight: watch time and a tune-away line with its sentence; the airing on now is counting", async () => {
    renderAudience(BEAT, "/control/beat");
    const table = await screen.findByRole("table", { name: /By program/ });
    expect(within(table).getByText("Watch time")).toBeTruthy();
    const late = rowOf(table, "Late Crate, ep. 14");
    expect(within(late).getByRole("figure").textContent).toMatch(/^Most left around \d{1,2}:\d{2} pm2 said “Not for me”$/);
    expect(within(late).getByText(/^\d[\d,.]* (hours|hour|min)$/)).toBeTruthy();
    const onNow = rowOf(table, "Saturday Reel");
    expect(within(onNow).getByText("Counting…")).toBeTruthy();
    expect(within(onNow).queryByRole("figure")).toBeNull();
  });

  it("under the minimum: Not enough viewers yet", async () => {
    // Raise the desk's minimum above every airing tonight.
    settingsDb().rules.push({ id: "00000000-0000-4000-8000-000000009998", key: "watch_data.minimum_audience", scope: "", value: { viewers: 100_000, carriedAirings: 2 }, effectiveFrom: "2026-09-01T00:00:00.000Z", setBy: null, note: null, createdAt: "2026-09-01T00:00:00.000Z" });
    saveSettings();
    renderAudience(BEAT, "/control/beat");
    const table = await screen.findByRole("table", { name: /By program/ });
    expect(within(rowOf(table, "Late Crate, ep. 14")).getByText("Not enough viewers yet")).toBeTruthy();
    expect(within(table).queryAllByRole("figure")).toHaveLength(0);
  });

  it("HALL is on the radio band: listening time", async () => {
    renderAudience(HALL, "/control/hall");
    const table = await screen.findByRole("table", { name: /By program/ });
    expect(within(table).getByText("Listening time")).toBeTruthy();
    expect(within(table).queryByText("Watch time")).toBeNull();
    expect(within(table).getAllByRole("figure").length).toBeGreaterThan(0);
  });
});

describe("Offering your programs, across every station", () => {
  it("BEAT's programs added up across carriers: totals, airings not counted yet, the minimum", async () => {
    renderWithApi(<ProgramWatch stationId={BEAT.id} />);
    const list = await screen.findByRole("list", { name: "Your programs across every station" });
    const items = within(list).getAllByRole("listitem");
    const row = (title: string, detail: RegExp) => items.find((li) => li.textContent?.includes(title) && detail.test(li.textContent ?? ""))!;
    const late = row("Late Crate", /airings on 2 stations/);
    expect(within(late).getByText("Watch time")).toBeTruthy();
    expect(within(late).getByText("Stayed to the end")).toBeTruthy();
    expect(within(late).getByRole("figure").textContent).toMatch(/^Most left \d+ minutes in/);
    const radio = row("Late Crate", /^Late CrateRadio band/);
    expect(within(radio).getByText("Listening time")).toBeTruthy();
    const tape = row("Beat Tape Live", /Radio band/);
    expect(within(tape).getByText("1 airing not counted yet")).toBeTruthy();
    expect(within(tape).getByText("Not enough viewers yet")).toBeTruthy();
    expect(within(row("Crate Talk", /./)).getByText("Not enough viewers yet")).toBeTruthy();
    // Never a station: no carrier's call sign anywhere.
    for (const cs of ["HALL", "SAZN", "CRAT"]) expect(list.textContent).not.toContain(cs);
  });

  it("a studio's programs too", async () => {
    signInAs("sam@example.com");
    renderWithApi(<ProgramWatch stationId={LAB.id} />);
    const list = await screen.findByRole("list", { name: "Your programs across every station" });
    expect(within(list).getAllByRole("listitem").map((li) => li.querySelector("b")?.textContent)).toEqual(["Crate Diggers Radio Hour", "Studio Notes"]);
    expect(within(list).getByText("Listening time")).toBeTruthy();
  });
});
