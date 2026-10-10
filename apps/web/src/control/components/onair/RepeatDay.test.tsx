// Making and stopping day templates (G8), on the mocks at the reference Saturday, 8:42 pm: the
// dialog that makes one from a day and says what it made ("Make a template from this day", "New
// template"), changing one ("Change how it repeats"), stopping one with its warning, and taking off
// a one-time copy from before templates. The Templates tab's cards are TemplatesTab.test.tsx's.

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
import { templateById, templateView } from "../../mocks/schedule";
import { TEMPLATE_IDS } from "../../mocks/fixtures/templates";
import { RepeatDialog, StopDialog } from "./RepeatDay";
import { renderWithApi, signInAs, stubMatchMedia } from "./testing";
import type { LogRepeat, RepeatPattern } from "./templates";

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

function repeat(day = SAT, pattern: RepeatPattern = "weekly", template?: ReturnType<typeof templateView>) {
  const onClose = vi.fn();
  renderWithApi(<RepeatDialog stationId={BEAT.id} day={day} template={template} pattern={pattern} phone={false} onClose={onClose} />);
  return onClose;
}

/** A line of the result: "Dates made" and its value. */
function line(dialog: HTMLElement, label: string) {
  return within(dialog).getByText(label).closest(".oc-kv__row")!.textContent;
}

describe("stopping", () => {
  it("stops a template, saying its future dates that weren't edited will be cleared", async () => {
    const onClose = vi.fn();
    renderWithApi(<StopDialog stationId={BEAT.id} what={{ kind: "template", template: templateView(templateById(BEAT.id, TEMPLATE_IDS.saturdays)!) }} phone={false} onClose={onClose} />);
    const dialog = await screen.findByRole("dialog", { name: "Stop repeating Every Saturday?" });
    expect(within(dialog).getByText("Future dates that weren't edited will be cleared. What already aired stays in the as-run log.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Stop repeating" }));
    expect(await screen.findByText(/^Every Saturday stopped\. \d+ (entry|entries) came off the log\.$/)).toBeTruthy();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(templateById(BEAT.id, TEMPLATE_IDS.saturdays)).toBeUndefined();
  });

  it("takes off a one-time copy from before templates (G7's removeRepeat)", async () => {
    const copy: LogRepeat = { id: "7a0e3a52-2f55-4d7c-8c38-3a1a1b2c3d4e", day: "2026-09-19", pattern: "daily", until: "2026-10-31", entries: 4, template: false };
    onAirState().repeats.push({ id: copy.id, stationId: BEAT.id, day: copy.day, pattern: "daily", until: copy.until });
    renderWithApi(<StopDialog stationId={BEAT.id} what={{ kind: "copy", repeat: copy }} phone={false} onClose={() => undefined} />);
    const dialog = await screen.findByRole("dialog", { name: "Stop repeating Every day?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Stop repeating" }));
    expect(await screen.findByText("Every day stopped. 0 entries came off the log.")).toBeTruthy();
    expect(onAirState().repeats).toEqual([]);
  });
});

describe("the Repeat this day dialog", () => {
  it("repeats a day once onto a date, and says what it made", async () => {
    repeat(SUN, "once");
    const dialog = await screen.findByRole("dialog", { name: "Repeat this day" });
    const choices = within(dialog).getByRole("radiogroup", { name: "Repeats" });
    expect(within(choices).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Every Sunday", "Weekdays", "Every day", "Once"]);
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
  });

  it("repeats every week until a date, with the API's words when the date is too early", async () => {
    repeat(SUN, "weekly");
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
    repeat(SAT, "weekdays", templateView(templateById(BEAT.id, TEMPLATE_IDS.weekdays)!));
    const dialog = await screen.findByRole("dialog", { name: "After work" });
    const name = within(dialog).getByLabelText("Name") as HTMLInputElement;
    expect(name.value).toBe("After work");
    fireEvent.change(name, { target: { value: "Weeknights" } });
    fireEvent.click(within(within(dialog).getByRole("radiogroup", { name: "Repeats" })).getByRole("radio", { name: "Every day" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    const done = await screen.findByRole("dialog", { name: "Weeknights" });
    expect(line(done, "Edited dates left as they are")).toBe("Edited dates left as they are1");
    expect(templateById(BEAT.id, TEMPLATE_IDS.weekdays)).toMatchObject({ name: "Weeknights", pattern: "daily" });
  });
});
