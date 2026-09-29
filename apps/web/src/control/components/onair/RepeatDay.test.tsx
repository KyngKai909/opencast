// "Repeat this day" as day templates (G8), on the mocks at the reference Saturday, 8:42 pm: BEAT's
// templates in the list (Every Saturday from tonight, "After work" on weekdays with an edited
// Wednesday), the dialog that makes one and says what it made, changing one, stopping one with its
// warning, and taking off a one-time copy from before templates.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { setupServer } from "msw/node";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { handlers } from "../../mocks/handlers";
import { resetDb } from "../../mocks/db";
import { onAirState } from "../../mocks/fixtures/onair";
import { BEAT } from "../../mocks/fixtures/stations";
import { RepeatDaySection } from "./RepeatDay";
import { renderWithApi, signInAs, stubMatchMedia } from "./testing";
import type { LogRepeat } from "./templates";

const server = setupServer(...handlers);
beforeAll(() => {
  stubMatchMedia();
  server.listen({ onUnhandledRequest: "bypass" });
});
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
  onAirState().repeats = [];
  signInAs("kai@example.com");
});
afterEach(() => server.resetHandlers());

const SAT = { year: 2026, month: 9, day: 26 };
const SUN = { year: 2026, month: 9, day: 27 };

function section(day = SAT, repeats: LogRepeat[] = []) {
  return renderWithApi(<RepeatDaySection stationId={BEAT.id} day={day} repeats={repeats} phone={false} dateHref={(d) => `?day=${d}`} />);
}

/** A row of the template list, by its title. */
async function row(title: string) {
  const t = await screen.findByText(title, { selector: ".oc-lines__title" });
  return t.closest(".oc-kvrows__row") as HTMLElement;
}

/** A line of the result: "Dates made" and its value. */
function line(dialog: HTMLElement, label: string) {
  return within(dialog).getByText(label).closest(".oc-kv__row")!.textContent;
}

describe("the template list", () => {
  it("lists BEAT's templates with their names, dates and edited dates, and links the next date", async () => {
    section();
    const weekdays = await row("After work");
    expect(weekdays.textContent).toContain("Weekdays. Built from Mon Sep 21. 15 dates ahead, 1 edited.");
    expect(within(weekdays).getByRole("link", { name: "Next Mon Sep 28" }).getAttribute("href")).toBe("/?day=2026-09-28");
    const saturdays = await row("Every Saturday");
    expect(saturdays.textContent).toContain("Built from Sat Sep 26. 3 dates ahead.");
    // Tonight is the day Every Saturday is built from: the choices say so, as the frame draws them.
    const choices = screen.getByRole("radiogroup", { name: "Repeat this day" });
    expect(within(choices).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Every Saturday", "Weekdays", "Every day", "Once"]);
    expect(within(choices).getByRole("radio", { name: "Every Saturday" }).getAttribute("aria-checked")).toBe("true");
  });

  it("stops a template, saying its future dates that weren't edited will be cleared", async () => {
    section();
    fireEvent.click(within(await row("Every Saturday")).getByRole("button", { name: "Stop" }));
    const dialog = await screen.findByRole("dialog", { name: "Stop repeating Every Saturday?" });
    expect(within(dialog).getByText("Future dates that weren't edited will be cleared. What already aired stays in the as-run log.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Stop repeating" }));
    expect(await screen.findByText(/^Every Saturday stopped\. \d+ (entry|entries) came off the log\.$/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Every Saturday", { selector: ".oc-lines__title" })).toBeNull());
  });

  it("takes off a one-time copy from before templates (G7's removeRepeat)", async () => {
    const copy: LogRepeat = { id: "7a0e3a52-2f55-4d7c-8c38-3a1a1b2c3d4e", day: "2026-09-19", pattern: "daily", until: "2026-10-31", entries: 4, template: false };
    onAirState().repeats.push({ id: copy.id, stationId: BEAT.id, day: copy.day, pattern: "daily", until: copy.until });
    section(SAT, [copy]);
    const r = await row("Every day");
    expect(r.textContent).toContain("Copied from Sat Sep 19, until Sat Oct 31. 4 entries to come.");
    fireEvent.click(within(r).getByRole("button", { name: "Take off" }));
    const dialog = await screen.findByRole("dialog", { name: "Stop repeating Every day?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Stop repeating" }));
    expect(await screen.findByText("Every day stopped. 0 entries came off the log.")).toBeTruthy();
    expect(onAirState().repeats).toEqual([]);
  });
});

describe("the Repeat this day dialog", () => {
  it("repeats a day once onto a date, and says what it made", async () => {
    section(SUN);
    const choices = await screen.findByRole("radiogroup", { name: "Repeat this day" });
    expect(within(choices).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Every Sunday", "Weekdays", "Every day", "Once"]);
    fireEvent.click(within(choices).getByRole("radio", { name: "Once" }));
    const dialog = await screen.findByRole("dialog", { name: "Repeat this day" });
    expect(within(dialog).getByText("Sunday, September 27")).toBeTruthy();
    // Once needs the day to copy to.
    fireEvent.click(within(dialog).getByRole("button", { name: "Repeat this day" }));
    expect(await within(dialog).findByText("Choose the day to copy to.")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Copy to"), { target: { value: "2026-10-04" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Repeat this day" }));
    const done = await screen.findByRole("dialog", { name: "Once, Sun Oct 4" });
    expect(line(done, "Dates made")).toBe("Dates made1");
    expect(line(done, "Skipped for conflicts")).toBe("Skipped for conflicts0");
    expect(line(done, "Entries placed")).toMatch(/^Entries placed[1-9]\d*$/);
    fireEvent.click(within(done).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The new template is in the list.
    expect(await row("Once, Sun Oct 4")).toBeTruthy();
  });

  it("repeats every week until a date, with the API's words when the date is too early", async () => {
    section(SUN);
    fireEvent.click(within(await screen.findByRole("radiogroup", { name: "Repeat this day" })).getByRole("radio", { name: "Every Sunday" }));
    const dialog = await screen.findByRole("dialog", { name: "Repeat this day" });
    expect(within(dialog).getByText("Leave it empty to keep repeating.")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Until"), { target: { value: "2026-09-27" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Repeat this day" }));
    expect(await within(dialog).findByText("It has to repeat after the day it's built from.")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Until"), { target: { value: "2026-10-11" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Repeat this day" }));
    const done = await screen.findByRole("dialog", { name: "Every Sunday" });
    // Sundays October 4 and 11.
    expect(line(done, "Dates made")).toBe("Dates made2");
  });

  it("changes a template: a new name and a new pattern, edited dates left as they are", async () => {
    section();
    fireEvent.click(within(await row("After work")).getByRole("button", { name: "Change" }));
    const dialog = await screen.findByRole("dialog", { name: "After work" });
    const name = within(dialog).getByLabelText("Name") as HTMLInputElement;
    expect(name.value).toBe("After work");
    fireEvent.change(name, { target: { value: "Weeknights" } });
    fireEvent.click(within(within(dialog).getByRole("radiogroup", { name: "Repeats" })).getByRole("radio", { name: "Every day" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    const done = await screen.findByRole("dialog", { name: "Weeknights" });
    expect(line(done, "Edited dates left as they are")).toBe("Edited dates left as they are1");
    fireEvent.click(within(done).getByRole("button", { name: "Done" }));
    const r = await row("Weeknights");
    await waitFor(() => expect(r.textContent).toContain("Every day. Built from Mon Sep 21."));
  });
});
