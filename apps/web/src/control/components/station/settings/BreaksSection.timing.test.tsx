// A247, on the mocks: "Breaks come" with its five choices, N and the minutes in the same tile, the
// clock's minutes as chips (too close, and Save waits), inside long programs as a switch (not with
// every N minutes), all in the page's one draft: the preview asks with it, Save sends it, Reset
// puts it back.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { setupServer } from "msw/node";

vi.mock("../../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { handlers } from "../../../mocks/handlers";
import { resetDb } from "../../../mocks/db";
import { breakRuleOf, resetStationState } from "../../../mocks/fixtures/station";
import { BEAT } from "../../../mocks/fixtures/stations";
import { renderWithApi, signInAs, stubMatchMedia } from "../../onair/testing";
import { BreaksSection, lengthLine, recipeLine, timingLine, timingRules } from "./BreaksSection";

type Sent = { everyPrograms?: number | null; clockMinutes?: number[] | null; longPrograms?: { overMs: number; everyMs: number } | null; mode?: string; everyMinutes?: number | null };
const server = setupServer(...handlers);
let previews: Array<{ rule: Sent }> = [];
let saves: Sent[] = [];
beforeAll(() => {
  stubMatchMedia();
  server.listen({ onUnhandledRequest: "bypass" });
  server.events.on("request:start", async ({ request }) => {
    if (request.method === "POST" && request.url.endsWith("/break-rule/preview")) previews.push(await request.clone().json());
    if (request.method === "PUT" && request.url.endsWith("/break-rule")) saves.push(await request.clone().json());
  });
});
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
  resetStationState();
  signInAs("kai@example.com");
  previews = [];
  saves = [];
});
afterEach(() => server.resetHandlers());

const beat = { station: BEAT, id: BEAT.id, role: "owner" as const, studio: false, base: "/control/beat", label: "BEAT 12.1", can: () => true };
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const select = (name: string) => screen.getByRole("combobox", { name }) as HTMLSelectElement;
const pick = (name: string, value: string) => fireEvent.change(select(name), { target: { value } });
const minute = (m: string) => within(screen.getByRole("group", { name: "Minutes past the hour" })).getByRole("button", { name: m });
const lastPreview = () => previews[previews.length - 1]?.rule;

describe("Break rules: when breaks come", () => {
  it("offers the five choices, with N and the minutes in the same tile", async () => {
    renderWithApi(<BreaksSection s={beat} />);
    await screen.findByRole("combobox", { name: "Breaks come" });
    // BEAT breaks every 30 minutes.
    expect([...select("Breaks come").options].map((o) => o.text)).toEqual(["After every program", "After every 2 programs", "Every 30 minutes", "At set times each hour", "Never"]);
    expect(select("Breaks come").value).toBe("minutes");
    expect(select("How many minutes").value).toBe("30");
    pick("How many minutes", "15");
    expect([...select("Breaks come").options].map((o) => o.text)[2]).toBe("Every 15 minutes");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    pick("Breaks come", "programs");
    expect(select("After how many programs").value).toBe("2");
    pick("After how many programs", "3");
    expect(screen.getByText("Between the others, a program's spare time airs your station ID and bumpers")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "How many minutes" })).toBeNull();
    await waitFor(() => expect(lastPreview()).toMatchObject({ mode: "after_every_program", everyPrograms: 3, everyMinutes: null }), { timeout: 3_000 });
    fireEvent.click(button("Save break rules"));
    await screen.findByText("Break rules saved.");
    expect(saves[saves.length - 1]).toMatchObject({ mode: "after_every_program", everyPrograms: 3 });
    expect(breakRuleOf(BEAT.id)).toMatchObject({ mode: "after_every_program", everyPrograms: 3 });
  });

  it("clock breaks: the minutes as chips, too close says so and Save waits", async () => {
    renderWithApi(<BreaksSection s={beat} />);
    await screen.findByRole("combobox", { name: "Breaks come" });
    pick("Breaks come", "clock");
    // The top and bottom of the hour to start.
    expect(minute(":00").getAttribute("aria-pressed")).toBe("true");
    expect(minute(":30").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(minute(":00"));
    fireEvent.click(minute(":30"));
    // The last time can't be taken off: one at least.
    expect(minute(":30").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(minute(":15"));
    fireEvent.click(minute(":45"));
    fireEvent.click(minute(":30"));
    expect(screen.getByText("Programs pause at the times below")).toBeTruthy();
    await waitFor(() => expect(lastPreview()).toMatchObject({ mode: "every_n_minutes", clockMinutes: [15, 45], everyMinutes: 30 }), { timeout: 3_000 });
    fireEvent.click(minute(":20"));
    expect(screen.getByRole("alert").textContent).toBe("Leave at least 10 minutes between break times.");
    expect(button("Save break rules").disabled).toBe(true);
    fireEvent.click(minute(":20"));
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(button("Save break rules"));
    await screen.findByText("Break rules saved.");
    expect(saves[saves.length - 1]).toMatchObject({ mode: "every_n_minutes", clockMinutes: [15, 45], everyMinutes: 30 });
  });

  it("inside long programs: a switch, off with every N minutes; Reset puts it all back", async () => {
    renderWithApi(<BreaksSection s={beat} />);
    await screen.findByRole("combobox", { name: "Breaks come" });
    const toggle = () => screen.getByRole("switch", { name: "Inside long programs too" }) as HTMLButtonElement;
    expect(toggle().disabled).toBe(true);
    expect(screen.getByText("Every N minutes already breaks inside every program")).toBeTruthy();
    pick("Breaks come", "program");
    expect(toggle().disabled).toBe(false);
    fireEvent.click(toggle());
    expect(select("Programs longer than").value).toBe("45");
    expect(select("A break every").value).toBe("30");
    pick("Programs longer than", "30");
    // Every is shorter than longer-than: 30 becomes 25.
    expect(select("A break every").value).toBe("25");
    expect(screen.getByText(/A break inside a program comes out of the time it leaves in its slot/)).toBeTruthy();
    await waitFor(() => expect(lastPreview()).toMatchObject({ mode: "after_every_program", longPrograms: { overMs: 30 * 60_000, everyMs: 25 * 60_000 } }), { timeout: 3_000 });
    // Every N minutes again: the switch goes off.
    pick("Breaks come", "minutes");
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    fireEvent.click(button("Reset"));
    expect(select("Breaks come").value).toBe("minutes");
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });
});

describe("Break rules: when breaks come, the words", () => {
  const long = { overMs: 45 * 60_000, everyMs: 30 * 60_000 };
  it("say what's true for each choice", () => {
    expect(recipeLine({ mode: "after_every_program", lengthMs: 120_000, everyPrograms: 3 })).toBe("Drawn to scale for a 2:00 break. After every 3rd program, a break is the time its program leaves, so most run shorter or longer");
    expect(recipeLine({ mode: "every_n_minutes", lengthMs: 120_000, clockMinutes: [15, 45] })).toBe("Drawn to scale for a 2:00 break");
    expect(recipeLine({ mode: "none", lengthMs: 120_000, longPrograms: long })).toBe("Drawn to scale for a 2:00 break, cued from the booth and inside long programs");
    expect(lengthLine({ mode: "after_every_program", longPrograms: long })).toBe("Breaks inside long programs, cued live, and between repeats. The rest are the time a program leaves");
    expect(lengthLine({ mode: "every_n_minutes", clockMinutes: [15, 45] })).toBe("Breaks at your times, and cued live. After a program, a break is the time it leaves");
    expect(lengthLine({ mode: "none", longPrograms: long })).toBe("Breaks cued from the booth, and inside long programs");
    // Every N minutes: inside long programs doesn't apply.
    expect(lengthLine({ mode: "every_n_minutes", longPrograms: long })).toBe("Every break. Live programs cue their own");
    expect(timingLine({ mode: "after_every_program" })).toBeNull();
    expect(timingLine({ mode: "every_n_minutes" })).toBe("Inside every program, or at its maker's break points");
    expect(timingRules({ mode: "after_every_program" })).toBeNull();
    expect(timingRules({ mode: "after_every_program", everyPrograms: 2 })).toBe("The count starts again each day at 6:00 am, after off air time and where a block starts or ends. Live programs cue their own and aren't counted.");
    expect(timingRules({ mode: "every_n_minutes", clockMinutes: [15, 45] })).toBe("A break inside a program comes out of the time it leaves in its slot, so a program is never cut for one. A break less than 5 minutes from another, or from the end of its program, is skipped. Programs carried live only never pause.");
  });
});
