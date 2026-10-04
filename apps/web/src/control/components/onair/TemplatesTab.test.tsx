// A246 (Phase 4): the Schedule's Templates tab on the mocks at the reference Saturday, 8:42 pm.
// BEAT's "Every day" off air hours first; "After work" (weekdays, Wednesday Sep 30 edited by hand,
// with Crate Talk put on at 7:00 pm) and Every Saturday as cards with their dates ahead, edited
// ones amber, and the precedence note when one overrides another. A template opened: what saving
// does, its rundown edited with the day's rows and handles, Save with the dates rebuilt and kept,
// and "Reset to template". On the phone, the tab says it's desk work.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { setupServer } from "msw/node";
import { Route, Routes } from "react-router";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));
vi.mock("../../../auth/AuthProvider", async (original) => ({ ...(await original<object>()), useAuth: () => ({ getToken: async () => null }) }));

import { handlers } from "../../mocks/handlers";
import { resetDb } from "../../mocks/db";
import { resetBlocks, templateBlocksOf } from "../../mocks/blocks";
import { createTemplate, templateById } from "../../mocks/schedule";
import { BEAT } from "../../mocks/fixtures/stations";
import { TEMPLATE_IDS } from "../../mocks/fixtures/templates";
import { ShellOptionsProvider } from "../../layout/shell";
import { StationProvider } from "../../station/StationContext";
import { renderWithApi, signInAs, stubMatchMedia } from "./testing";
import { TemplatesTab } from "./TemplatesTab";

const server = setupServer(...handlers);
beforeAll(() => {
  stubMatchMedia();
  server.listen({ onUnhandledRequest: "bypass" });
});
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
  resetBlocks();
  signInAs("kai@example.com");
});
afterEach(() => server.resetHandlers());

const beat = { station: BEAT, id: BEAT.id, role: "owner" as const, studio: false, base: "/control/beat", label: "BEAT", can: () => true };
const renderAt = (path: string) =>
  renderWithApi(
    <ShellOptionsProvider>
      <StationProvider value={beat}>
        <Routes>
          <Route path="/control/beat/schedule/templates" element={<TemplatesTab />} />
          <Route path="/control/beat/schedule/templates/:templateId" element={<TemplatesTab />} />
        </Routes>
      </StationProvider>
    </ShellOptionsProvider>,
    { path }
  );

const card = async (name: string) => (await screen.findByRole("navigation", { name: "Your templates" })).querySelector<HTMLElement>(`a[href$="${name}"]`)!;

describe("the template list", () => {
  it("puts the off air hours first, then each template with how it repeats and its dates ahead, edited ones amber", async () => {
    renderAt("/control/beat/schedule/templates");
    // The first template opens once the list is in.
    expect(await screen.findByRole("heading", { level: 2, name: "After work" })).toBeTruthy();
    const every = screen.getByRole("region", { name: "Every day" });
    expect(await within(every).findByText("Off air every night, 2:00 am to 6:00 am. Applies to every template and date")).toBeTruthy();
    expect(within(every).getByRole("button", { name: "Change the off air hours" })).toBeTruthy();
    const after = await card(TEMPLATE_IDS.weekdays);
    expect(after.textContent).toMatch(/^After workMonday to Friday from Sep 21\. 15 dates ahead, 1 edited/);
    // A square a date: Wednesday Sep 30 in amber, and said in words.
    expect(after.querySelectorAll(".cc-tdots i")).toHaveLength(15);
    expect(after.querySelector(".cc-tdots__e")?.textContent).toBe("30");
    expect(after.textContent).toContain("Edited by hand: Wed Sep 30");
    expect((await card(TEMPLATE_IDS.saturdays)).textContent).toMatch(/^Every SaturdayFrom Sep 26\. 3 dates ahead/);
    // The first is open: what saving it does, and its edited date.
    expect(after.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Sep 30 edited")).toBeTruthy();
    expect(screen.getByText("Saving changes here rebuilds 14 upcoming weekdays. Sep 30, edited by hand, is kept as an exception.")).toBeTruthy();
    expect(screen.getByRole("list", { name: "The rundown" }).textContent).toContain("Late Crate, ep. 13");
  });

  it("says when one template overrides another: once, then a weekday, then weekdays, then every day", async () => {
    createTemplate(BEAT.id, { fromDay: "2026-09-26", pattern: "once", onto: "2026-10-03", name: "Opening night" });
    renderAt("/control/beat/schedule/templates");
    const once = await screen.findByRole("link", { name: /^Opening night/ });
    expect(once.textContent).toContain("Once, Sat Oct 3. Overrides Every Saturday that day");
  });
});

describe("a template, edited as the day is", () => {
  it("moves a block's end with its handle, says who joins it, and saves with the dates rebuilt", async () => {
    renderAt(`/control/beat/schedule/templates/${TEMPLATE_IDS.saturdays}`);
    fireEvent.click(await screen.findByRole("button", { name: "Edit template" }));
    const rundown = await screen.findByRole("list", { name: "The rundown, being edited" });
    expect(rundown.textContent).toContain("Late Crate Nights starts 8:00 pm");
    expect(rundown.textContent).toContain("Member. Its intro airs just before");
    // A row down: below Beat Tape Live, so it takes the start of the row under it, 10:00 pm.
    fireEvent.keyDown(within(rundown).getByRole("button", { name: "Move the end of Late Crate Nights, now 9:00 pm" }), { key: "ArrowDown" });
    const tray = await screen.findByRole("region", { name: "Your changes" });
    expect(within(tray).getByText("1 change, checked: nothing blocks saving")).toBeTruthy();
    expect(within(tray).getByText("Late Crate Nights now ends at 10:00 pm, was 9:00 pm. Beat Tape Live joins it")).toBeTruthy();
    expect(within(tray).getByText("Saving changes here rebuilds 3 upcoming Saturdays.")).toBeTruthy();
    fireEvent.click(within(tray).getByRole("button", { name: "Save template" }));
    expect(await screen.findByText("Template saved. 3 dates rebuilt.")).toBeTruthy();
    expect(templateBlocksOf(TEMPLATE_IDS.saturdays).map((b) => [b.startTime, b.lengthMs])).toEqual([["20:00", 2 * 3_600_000]]);
    // Back out of edit mode, with what the template makes now.
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit template" })).toBeTruthy());
  });

  it("moves a row with the arrow keys, and discards", async () => {
    renderAt(`/control/beat/schedule/templates/${TEMPLATE_IDS.weekdays}`);
    fireEvent.click(await screen.findByRole("button", { name: "Edit template" }));
    const rundown = await screen.findByRole("list", { name: "The rundown, being edited" });
    // Late Crate, ep. 13 a place down: after Crate Session 01, at midnight (the time it leaves isn't closed up).
    fireEvent.keyDown(within(rundown).getByRole("button", { name: "Move Late Crate, ep. 13, 9:30 pm" }), { key: "ArrowDown" });
    const tray = await screen.findByRole("region", { name: "Your changes" });
    expect(within(tray).getByText("Late Crate, ep. 13 moves to 12:00 am")).toBeTruthy();
    expect(within(tray).getByText("Saving changes here rebuilds 14 upcoming weekdays. Sep 30, edited by hand, is kept as an exception.")).toBeTruthy();
    fireEvent.click(within(tray).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Your changes" })).toBeNull());
  });
});

describe("resetting a date to its template (decision 6)", () => {
  it("says what comes off, then makes the date from the template again", async () => {
    renderAt(`/control/beat/schedule/templates/${TEMPLATE_IDS.weekdays}`);
    fireEvent.click(await screen.findByRole("button", { name: "Reset Sep 30 to template" }));
    const dialog = await screen.findByRole("dialog", { name: "Reset Sep 30 to After work?" });
    expect(await within(dialog).findByText("Crate Talk, 7:00 pm")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset to template" }));
    expect(await screen.findByText("Sep 30 is back to After work: 1 taken off.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Sep 30 edited")).toBeNull());
    expect(templateById(BEAT.id, TEMPLATE_IDS.weekdays)!.dates.find((d) => d.date === "2026-09-30")?.edited).toBe(false);
  });
});

describe("on the phone", () => {
  it("says building templates is desk work, with the way back to the Log", async () => {
    const was = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q.includes("max-width: 767px"), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
    try {
      renderAt("/control/beat/schedule/templates");
      expect(await screen.findByRole("heading", { name: "Open Templates on a computer" })).toBeTruthy();
      expect(screen.getByRole("link", { name: "Back to the Log" }).getAttribute("href")).toBe("/control/beat/schedule");
    } finally {
      await act(async () => undefined);
      window.matchMedia = was;
    }
  });
});
