// The usage section on a statement (pay-as-you-go, follow-up Phase 2), on the mocks: BEAT's August
// statement, with each type's units and price shown, and what was taken from earnings counted
// before the payout, once. The list of statements counts it the same way.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { setupServer } from "msw/node";
import { Route, Routes } from "react-router";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { handlers } from "../../mocks/handlers";
import { resetDb } from "../../mocks/db";
import { resetEarnings } from "../../mocks/fixtures/earnings";
import { usageStatement } from "../../mocks/fixtures/account";
import { BEAT } from "../../mocks/fixtures/stations";
import { renderWithApi, signInAs, stubMatchMedia } from "../../components/onair/testing";
import { ShellOptionsProvider } from "../../layout/shell";
import { StationProvider } from "../../station/StationContext";
import Statement from "./Statement";
import Statements from "./Statements";

const server = setupServer(...handlers);
beforeAll(() => {
  stubMatchMedia();
  server.listen({ onUnhandledRequest: "bypass" });
});
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear();
  resetDb();
  resetEarnings();
  signInAs("kai@example.com");
});
afterEach(() => server.resetHandlers());

const base = "/control/beat";
const august = usageStatement(BEAT.id)!;

function renderAt(path: string) {
  return renderWithApi(
    <ShellOptionsProvider>
      <StationProvider value={{ station: BEAT, id: BEAT.id, role: "owner", studio: false, base, can: () => true }}>
        <Routes>
          <Route path={`${base}/earnings/statements`} element={<Statements />} />
          <Route path={`${base}/earnings/statements/:statementId`} element={<Statement />} />
        </Routes>
      </StationProvider>
    </ShellOptionsProvider>,
    { path }
  );
}

const rowsOf = (section: HTMLElement) => within(section).getAllByRole("term").map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]);

describe("a statement's usage section", () => {
  it("BEAT's August: each type with its units and price, then what was taken from earnings; counted once", async () => {
    renderAt(`${base}/earnings/statements/${august.id}`);
    expect(await screen.findByRole("heading", { name: "August" })).toBeTruthy();
    const usage = screen.getByRole("region", { name: "Usage" });
    expect(within(usage).getByText("Taken from earnings before the payout")).toBeTruthy();
    expect(rowsOf(usage)).toEqual([
      ["Storage38.50 GB-months, 10.00 free, at $0.04 a GB-month", "−$1.14"],
      ["Relays, everything you air168 hours, at $0.20 an hour", "−$33.60"],
      ["Live hours10.6 hours, 5 free, at $0.75 an hour", "−$4.20"],
      ["Usage, taken from earnings4 entries, before each weekly payout and when the month closed", "−$38.94"]
    ]);
    expect(within(usage).getByText("Each type is shown with its units and price. Only what was taken from earnings counts in the total.")).toBeTruthy();
    // Earned, less usage, less paid out: nothing left, and the types aren't taken twice.
    const other = screen.getByRole("region", { name: "Other" });
    expect(rowsOf(other).at(-1)).toEqual(["Total", "$0.00"]);
  });

  it("the list counts it the same way", async () => {
    renderAt(`${base}/earnings/statements`);
    const table = await screen.findByRole("grid", { name: "Statements" });
    const row = within(table).getAllByRole("row").find((r) => r.textContent?.startsWith("August"))!;
    expect(row.textContent).toBe("AugustAugust 1 to 31$0.00");
    expect(within(table).getByRole("columnheader", { name: "Statement" })).toBeTruthy();
  });
});
