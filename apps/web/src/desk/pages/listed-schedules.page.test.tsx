// A241 on External sources (mocks), on the reference's Saturday, 8:42 pm: What's on has three
// choices. "Enter it by hand" edits the weekly slots (day chips, times, title, description; add or
// remove a row), where it was checked and the dates it doesn't air, refusing what the API refuses
// (two slots on at once, no published schedule); the details show the week compactly. A webpage's
// event data reads as such, and a page with none says so and offers entering it by hand.
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
import { resetDb } from "../mocks/db";
import { setTokenSource } from "../../api/client";
import { MOCK_TOKEN_PREFIX } from "../../auth/mockToken";
import Listed from "./Listed";

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
  setTokenSource(async () => `${MOCK_TOKEN_PREFIX}dee@opencast.example`);
});
afterEach(() => server.resetHandlers());

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/desk/markets/:marketSlug/listed" element={<Listed />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

const PAGE = "/desk/markets/inland-empire/listed";
const table = () => screen.getByRole("grid", { name: "External sources" });
const rowOf = (name: RegExp) => within(table()).getByRole("row", { name });
const fill = (el: HTMLElement, label: string, value: string) => fireEvent.change(within(el).getByLabelText(label), { target: { value } });
const slot = (f: HTMLElement, n: number) => within(f).getByRole("listitem", { name: `Slot ${n}` });
const pickDays = (s: HTMLElement, days: string[]) => {
  for (const d of days) fireEvent.click(within(s).getByRole("button", { name: d }));
};
const weekOf = (d: HTMLElement) => within(within(d).getByRole("list", { name: "Every week" })).getAllByRole("listitem").map((li) => li.textContent);

describe("Enter it by hand", () => {
  it("edits the weekly slots, refuses two on at once and a missing published schedule, and lists it", async () => {
    renderAt(`${PAGE}?add=1`);
    const d = await screen.findByRole("dialog", { name: "List a source" });
    fill(d, "Whose stream", "City of Grand Terrace");
    fill(d, "Channel", "9.4");
    fireEvent.click(within(d).getByRole("checkbox", { name: /Same brand as 9.1 RDLS/ }));
    fill(d, "Call sign", "GRTR");
    fireEvent.click(within(d).getByRole("radio", { name: "Stream link" }));
    fill(d, "Stream address", "https://grandterrace.example.gov/live/council.m3u8");
    fill(d, "Who said yes", "Ana Ruiz, City Clerk, City of Grand Terrace");
    fill(d, "Said yes on", "2026-09-24");
    fill(d, "Where it's kept", "Email to network@opencast.tv, Sept 24");

    // Three choices; by hand opens the slot editor with one empty row.
    expect(within(d).getAllByRole("radio", { name: /Its feed|Enter it by hand|None/ }).map((r) => r.textContent)).toEqual(["Its feed", "Enter it by hand", "None"]);
    fireEvent.click(within(d).getByRole("radio", { name: "Enter it by hand" }));
    expect(within(d).getByText(/Times are Pacific Time; an end before the start runs past midnight/)).toBeTruthy();
    const one = slot(d, 1);
    pickDays(one, ["Mon", "Tue", "Wed", "Thu", "Fri"]);
    expect(within(one).getByRole("button", { name: "Wed" }).getAttribute("aria-pressed")).toBe("true");
    fill(one, "Ends", "21:00");
    expect(within(one).getByText("6:00–9:00 pm, 3 hr")).toBeTruthy();
    fill(one, "Title", "City Council");
    fireEvent.change(within(one).getByLabelText(/^Description/), { target: { value: "Regular meetings, live from City Hall" } });

    // A second slot that overlaps on Wednesdays.
    fireEvent.click(within(d).getByRole("button", { name: "Add a slot" }));
    const two = slot(d, 2);
    pickDays(two, ["Wed"]);
    fill(two, "Starts", "20:00");
    fill(two, "Ends", "22:00");
    fill(two, "Title", "Planning Commission");
    fireEvent.click(within(d).getByRole("button", { name: "List it" }));
    expect(await within(two).findByText("“Planning Commission” overlaps “City Council” on Wednesdays at 8:00 pm. Two slots can't be on at once.")).toBeTruthy();
    expect(within(d).getByText("Paste the link to their published schedule.")).toBeTruthy();
    expect(within(d).getByText("The day you checked it.")).toBeTruthy();

    // Late on Saturdays instead, past midnight; then where it was checked and a day off.
    fireEvent.click(within(two).getByRole("button", { name: "Wed" }));
    pickDays(two, ["Sat"]);
    fill(two, "Starts", "23:00");
    fill(two, "Ends", "01:00");
    expect(within(two).getByText("11:00 pm–1:00 am, 2 hr, past midnight")).toBeTruthy();
    fill(d, "Their published schedule", "https://grandterrace.example.gov/meetings/schedule");
    fill(d, "Date checked", "2026-09-25");
    fill(d, "Date", "2026-11-26");
    fireEvent.click(within(d).getByRole("button", { name: "Add date" }));
    expect(within(within(d).getByRole("list", { name: "Dates it doesn't air" })).getByText("Thu, Nov 26")).toBeTruthy();
    // A row can go again.
    fireEvent.click(within(d).getByRole("button", { name: "Add a slot" }));
    fireEvent.click(within(d).getByRole("button", { name: "Remove slot 3" }));
    expect(within(d).queryByRole("listitem", { name: "Slot 3" })).toBeNull();

    fireEvent.click(within(d).getByRole("button", { name: "List it" }));
    expect(await screen.findByText("City of Grand Terrace is on the dial at 9.4.")).toBeTruthy();
    const row = await waitFor(() => rowOf(/^City of Grand Terrace/));
    expect(within(row).getByText("Entered by hand")).toBeTruthy();
    expect(within(row).getByText("Checked against their published schedule")).toBeTruthy();

    fireEvent.click(within(row).getByText("City of Grand Terrace"));
    const details = await screen.findByRole("dialog", { name: "City of Grand Terrace" });
    expect(weekOf(details)).toEqual(["Mon–Fri 6:00–9:00 pm: City Council. Regular meetings, live from City Hall", "Sat 11:00 pm–1:00 am: Planning Commission"]);
    expect(within(details).getByText("November 26")).toBeTruthy();
    expect(within(details).getByText("https://grandterrace.example.gov/meetings/schedule")).toBeTruthy();
  });

  it("shows Loma Linda's week compactly, and changes it with the change kept in its history", async () => {
    renderAt(PAGE);
    fireEvent.click(await screen.findByText("Loma Linda Community Access"));
    expect(within(rowOf(/^Loma Linda Community Access/)).getByText("Entered by hand")).toBeTruthy();
    const d = await screen.findByRole("dialog", { name: "Loma Linda Community Access" });
    expect(weekOf(d)).toEqual([
      "Mon–Fri 6:00–9:00 pm: City Council and commissions. Whichever meets that night, live from City Hall",
      "Sat, Sun 9:00–10:30 am: Community notices",
      "Sat 11:00 pm–1:00 am: Loma Linda after hours. Local music and talks"
    ]);
    expect(within(d).getByText("November 26, December 24, December 25")).toBeTruthy();
    expect(within(d).getByText("Checked against")).toBeTruthy();

    fireEvent.click(within(d).getByRole("button", { name: "Change" }));
    const f = await screen.findByRole("dialog", { name: "Change the listing" });
    expect(within(f).getByRole("radio", { name: "Enter it by hand" }).getAttribute("aria-checked")).toBe("true");
    expect(within(f).getAllByRole("listitem", { name: /^Slot / })).toHaveLength(3);
    const one = slot(f, 1);
    expect((within(one).getByLabelText("Title") as HTMLInputElement).value).toBe("City Council and commissions");
    fill(one, "Title", "City Council");
    fireEvent.click(within(f).getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Loma Linda Community Access is saved. It's on the dial at 9.7.")).toBeTruthy();

    const d2 = await screen.findByRole("dialog", { name: "Loma Linda Community Access" });
    await waitFor(() => expect(weekOf(d2)[0]).toBe("Mon–Fri 6:00–9:00 pm: City Council. Whichever meets that night, live from City Hall"));
    const changes = await within(d2).findByRole("list", { name: "Changes" });
    await waitFor(() =>
      expect(
        within(changes).getByText(
          /^Dee A\. changed Weekly schedule from Mon–Fri 6:00–9:00 pm: City Council and commissions, “Whichever meets that night, live from City Hall”; .* to Mon–Fri 6:00–9:00 pm: City Council, “Whichever meets that night, live from City Hall”; .*, 8:42 pm\. Its schedule read again$/
        )
      ).toBeTruthy()
    );
  });
});

describe("A webpage's event data", () => {
  it("reads as the page's event data; a page without any says so, and offers entering it by hand", async () => {
    renderAt(PAGE);
    fireEvent.click(await screen.findByText("Riverside County Library Live"));
    expect(within(rowOf(/^Riverside County Library Live/)).getByText("Their webpage's event data")).toBeTruthy();
    const d = await screen.findByRole("dialog", { name: "Riverside County Library Live" });
    expect(within(d).getByText("Schedule page")).toBeTruthy();
    expect(within(d).getByText("Webpage (its event data)")).toBeTruthy();

    // Its address moves to a page with no event data.
    fireEvent.click(within(d).getByRole("button", { name: "Change" }));
    const f = await screen.findByRole("dialog", { name: "Change the listing" });
    expect(within(f).getByRole("radio", { name: "Its feed" }).getAttribute("aria-checked")).toBe("true");
    expect((within(f).getByLabelText("Format") as HTMLSelectElement).value).toBe("webpage");
    expect(within(f).getByRole("option", { name: "Webpage (its event data)" })).toBeTruthy();
    fill(f, "Calendar, feed or schedule page", "https://riverside.example.gov/library/hours.html");
    fireEvent.click(within(f).getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Riverside County Library Live is saved. It's on the dial at 15.3.")).toBeTruthy();

    const d2 = await screen.findByRole("dialog", { name: "Riverside County Library Live" });
    expect(await within(d2).findByText(/This page has no schedule data a computer can read\./)).toBeTruthy();
    expect(within(rowOf(/^Riverside County Library Live/)).getByText("No schedule data on the page")).toBeTruthy();
    fireEvent.click(within(d2).getByRole("button", { name: "Enter the schedule by hand instead." }));
    const f2 = await screen.findByRole("dialog", { name: "Change the listing" });
    expect(within(f2).getByRole("radio", { name: "Enter it by hand" }).getAttribute("aria-checked")).toBe("true");
    expect((within(f2).getByLabelText("Their published schedule") as HTMLInputElement).value).toBe("https://riverside.example.gov/library/hours.html");
    // Back on its feed, the form says the same, and switches to by hand from there too.
    fireEvent.click(within(f2).getByRole("radio", { name: "Its feed" }));
    expect(within(f2).getByText(/This page has no schedule data a computer can read\./)).toBeTruthy();
    fireEvent.click(within(f2).getByRole("button", { name: "Enter the schedule by hand instead." }));
    expect(within(f2).getByRole("listitem", { name: "Slot 1" })).toBeTruthy();
  });
});
