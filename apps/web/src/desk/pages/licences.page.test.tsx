// Programming Phase 6, network licences on the mocks: the list (ending soonest first, ended last),
// a licence with its ending notice and a month's minutes by station and outlet, the month before
// and after, the CSV download, and adding a licence (what it covers, where it can air, where in the
// world, its dates and deal), which lands on its page; the form's checks; a market lead can't add one.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { MemoryRouter, Route, Routes } from "react-router";
import { ToastProvider } from "@opencast/ui";

vi.mock("../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { handlers } from "../../mocks/handlers";
import { resetSettings } from "../mocks/settingsDb";
import { resetLicences } from "../mocks/licencesDb";
import { resetDb } from "../mocks/db";
import { setTokenSource } from "../../api/client";
import { MOCK_TOKEN_PREFIX } from "../../auth/mockToken";
import Licences from "./Licences";
import Licence from "./Licence";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PRAIRIE = U(9101);

const server = setupServer(...handlers);
beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
  server.listen({ onUnhandledRequest: "bypass" });
});
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear();
  resetDb();
  resetSettings();
  resetLicences();
  signInAs("dee@opencast.example");
});
afterEach(() => server.resetHandlers());

function signInAs(email: string) {
  setTokenSource(async () => `${MOCK_TOKEN_PREFIX}${email}`);
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/desk/licences" element={<Licences />} />
            <Route path="/desk/licences/:licenceId" element={<Licence />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe("Network licences", () => {
  it("lists them, ending soonest first and ended last, each with where it can air and until when", async () => {
    renderAt("/desk/licences");
    expect(await screen.findByRole("heading", { level: 1, name: "Network licences" })).toBeTruthy();
    const table = screen.getByRole("grid", { name: "Network licences" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent?.match(/Prairie Films|Harbor Light Pictures|Old Reel Archive/)?.[0])).toEqual(["Prairie Films", "Harbor Light Pictures", "Old Reel Archive"]);
    expect(rows[0].textContent).toContain("Westerns package. Licensed catalogs");
    expect(rows[0].textContent).toContain("Opencast, Other apps, Relays");
    expect(rows[0].textContent).toContain("US, CA");
    expect(rows[0].textContent).toContain("Jul 1 to Oct 8, 2026");
    expect(rows[0].textContent).toContain("12.5% revenue share");
    expect(rows[0].textContent).toContain("Ends in 11 days");
    expect(rows[1].textContent).toContain("Worldwide");
    expect(rows[1].textContent).toContain("Sep 1, 2026 to Aug 31, 2027");
    expect(rows[1].textContent).toContain("$500.00 a month");
    expect(rows[1].textContent).toContain("Active");
    expect(rows[2].textContent).toContain("Ended");
  });

  it("shows a licence with its ending notice and a month's minutes, by station and outlet, and downloads the CSV", async () => {
    renderAt(`/desk/licences/${PRAIRIE}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Prairie Films" })).toBeTruthy();
    expect(screen.getByText(/Ends Oct 8, 2026\. What it covers is off the air after that/)).toBeTruthy();
    expect(screen.getByText("Opencast, Other apps, Relays")).toBeTruthy();
    // This month (September 2026), by station.
    expect(await screen.findByText("September 2026")).toBeTruthy();
    const stations = await screen.findByRole("table", { name: "Minutes aired in September 2026, by station" });
    const beat = within(stations).getByRole("row", { name: /BEAT/ });
    expect(beat.textContent).toContain("2,790");
    expect(beat.textContent).toContain("508.9");
    expect(within(stations).getByRole("row", { name: /CRAT/ }).textContent).toContain("Not counted");
    expect(screen.getByText("5,220")).toBeTruthy();
    expect(screen.getByText("Opencast 5,220 min, Relays 1,395 min")).toBeTruthy();
    const byOutlet = screen.getByRole("table", { name: "Minutes aired in September 2026, by station and outlet" });
    expect(within(byOutlet).getAllByRole("row", { name: /Relays/ })).toHaveLength(1);

    const saved: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => (saved.push(b), "blob:minutes"));
    URL.revokeObjectURL = vi.fn();
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(clicked).toHaveBeenCalledTimes(1);
    clicked.mockRestore();
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(saved[0]!);
    });
    expect(text.split("\n")[0]).toBe("Month,Licensor,Licence,Station,Outlet,Airings,Minutes aired,Viewer hours");
    expect(text).toContain("2026-09,Prairie Films,Westerns package,BEAT 12.1,relays,16,1395,96.4");
    expect(text).toContain("All stations,all,58,5220,697.1");

    // October: in force to the 8th only. November: nothing it covers aired.
    fireEvent.click(screen.getByRole("button", { name: "On to October 2026" }));
    expect(await screen.findByText("October 2026")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "On to November 2026" }));
    expect(await screen.findByText("Nothing it covers aired in November 2026.")).toBeTruthy();
  });

  it("adds a licence: what it covers, where it can air and where in the world, its dates and deal", async () => {
    renderAt("/desk/licences?new=1");
    const dialog = await screen.findByRole("dialog", { name: "New licence" });
    // Opencast is always on.
    const opencast = within(dialog).getByRole("checkbox", { name: /^Opencast/ }) as HTMLInputElement;
    expect(opencast.checked).toBe(true);
    expect(opencast.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Add licence" }));
    expect(await within(dialog).findByText("Say who licenses it.")).toBeTruthy();
    expect(within(dialog).getByText("The first day it can air.")).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText("Licensor"), { target: { value: "Coastline Classics" } });
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: "Newsreels, 1930 to 1950" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /^Relays/ }));
    fireEvent.click(within(dialog).getByRole("radio", { name: "Some countries" }));
    fireEvent.change(within(dialog).getByLabelText(/Countries/), { target: { value: "us mx" } });
    fireEvent.change(within(dialog).getByLabelText("Starts"), { target: { value: "2026-11-01" } });
    fireEvent.change(within(dialog).getByLabelText(/Ends/), { target: { value: "2026-10-01" } });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Flat fee" }));
    fireEvent.change(within(dialog).getByLabelText("Fee, $"), { target: { value: "250" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add licence" }));
    expect(await within(dialog).findByText("On or after the day it starts.")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Ends/), { target: { value: "2027-10-31" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add licence" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Coastline Classics" })).toBeTruthy();
    expect(screen.getAllByText("Newsreels, 1930 to 1950").length).toBeGreaterThan(0);
    expect(screen.getByText("Opencast, Relays")).toBeTruthy();
    expect(screen.getByText("US, MX")).toBeTruthy();
    expect(screen.getByText("Nov 1, 2026 to Oct 31, 2027")).toBeTruthy();
    expect(screen.getByText("$250.00 a month")).toBeTruthy();
    expect(screen.getByText("Starts Nov 1, 2026")).toBeTruthy();
  });

  it("refuses a market lead's new licence, as the API does", async () => {
    signInAs("lee@opencast.example");
    renderAt("/desk/licences?new=1");
    const dialog = await screen.findByRole("dialog", { name: "New licence" });
    fireEvent.change(within(dialog).getByLabelText("Licensor"), { target: { value: "Coastline Classics" } });
    fireEvent.change(within(dialog).getByLabelText("Starts"), { target: { value: "2026-11-01" } });
    fireEvent.change(within(dialog).getByLabelText(/Ends/), { target: { value: "2027-10-31" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add licence" }));
    expect(await within(dialog).findByText("Only a rights reviewer or an admin can do that.")).toBeTruthy();
  });
});
