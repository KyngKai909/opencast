// Break rules (A246 phase 3): how often each part airs, as chips, on the mocks. Spots, the
// thank-you credit, bumpers, the station ID (which can't be never: that chip is crossed out and
// can't be chosen) and Up next; "Every N programs" with N beside it; the Bumpers chips set the
// opening and closing sequences together; Up next's chips set its own cadence (S20) and never the
// between-programs sequence. Changes wait in the draft until "Save break rules".

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { setupServer } from "msw/node";

vi.mock("../../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { handlers } from "../../../mocks/handlers";
import { resetDb } from "../../../mocks/db";
import { resetStationState, breakRuleOf, saveStationState, stationState } from "../../../mocks/fixtures/station";
import { BEAT } from "../../../mocks/fixtures/stations";
import { renderWithApi, signInAs, stubMatchMedia } from "../../onair/testing";
import { BreaksSection } from "./BreaksSection";

const server = setupServer(...handlers);
beforeAll(() => {
  stubMatchMedia();
  server.listen({ onUnhandledRequest: "bypass" });
});
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
  resetStationState();
  signInAs("kai@example.com");
});
afterEach(() => server.resetHandlers());

const beat = { station: BEAT, id: BEAT.id, role: "owner" as const, studio: false, base: "/control/beat", label: "BEAT 12.1", can: () => true };
const chips = (part: string) => screen.getByRole("radiogroup", { name: `How often: ${part}` });
const chip = (part: string, name: string | RegExp) => within(chips(part)).getByRole("radio", { name });
const chosen = (part: string) => within(chips(part)).queryByRole("radio", { checked: true })?.textContent ?? null;
const save = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Save break rules" }));
  expect(await screen.findByText("Break rules saved.")).toBeTruthy();
};

describe("Break rules: how often, as chips", () => {
  it("has the five choices for each part, every break to start with; Up next never (no bumper holds its role)", async () => {
    renderWithApi(<BreaksSection s={beat} />);
    await screen.findByRole("radiogroup", { name: "How often: Spots" });
    for (const part of ["Spots", "Thank-you credit", "Bumpers", "Station ID"]) expect(chosen(part)).toBe("Every break");
    expect(chosen("Up next")).toBe("Never");
    expect(within(chips("Spots")).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Every break", "After each program", "Every 2 programs", "Once an hour", "Never"]);
  });

  it("the station ID can't be never: its chip is crossed out and does nothing", async () => {
    renderWithApi(<BreaksSection s={beat} />);
    await screen.findByRole("radiogroup", { name: "How often: Station ID" });
    const never = chip("Station ID", "Never") as HTMLButtonElement;
    expect(never.disabled).toBe(true);
    expect(never.closest(".cc-cad__set")).toBeTruthy();
    fireEvent.click(never);
    expect(chosen("Station ID")).toBe("Every break");
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    // The others can be never.
    expect((chip("Spots", "Never") as HTMLButtonElement).disabled).toBe(false);
  });

  it("every N programs: N chosen beside it, saved with the rest", async () => {
    renderWithApi(<BreaksSection s={beat} />);
    await screen.findByRole("radiogroup", { name: "How often: Thank-you credit" });
    fireEvent.click(chip("Thank-you credit", "Every 2 programs"));
    const n = screen.getByRole("combobox", { name: "How many programs: Thank-you credit" }) as HTMLSelectElement;
    fireEvent.change(n, { target: { value: "3" } });
    expect(chosen("Thank-you credit")).toBe("Every 3 programs");
    await save();
    expect(breakRuleOf(BEAT.id).cadence?.underwriting).toEqual({ every: "n_programs", n: 3 });
  });

  it("the Bumpers chips set the opening and closing sequences together", async () => {
    renderWithApi(<BreaksSection s={beat} />);
    await screen.findByRole("radiogroup", { name: "How often: Bumpers" });
    fireEvent.click(chip("Bumpers", "Once an hour"));
    await save();
    const rule = breakRuleOf(BEAT.id);
    expect(rule.bumperSequences?.open).toEqual({ roles: ["into_break"], every: "hour" });
    expect(rule.bumperSequences?.close).toEqual({ roles: ["out_of_break"], every: "hour" });
    expect(rule.cadence?.bumpers).toEqual({ every: "hour" });
  });

  it("says so when the opening and closing sequences differ (none of the chips is theirs)", async () => {
    const rule = breakRuleOf(BEAT.id);
    stationState().breakRules[BEAT.id] = { ...rule, bumperSequences: { ...rule.bumperSequences!, close: { roles: ["out_of_break"], every: "program" } } };
    saveStationState();
    renderWithApi(<BreaksSection s={beat} />);
    await screen.findByRole("radiogroup", { name: "How often: Bumpers" });
    expect(chosen("Bumpers")).toBeNull();
    expect(screen.getByText("Opening and closing differ. Set each in the bumper order below")).toBeTruthy();
  });

  it("S20: Up next's chips set its own cadence and leave the between-programs sequence (and the sting in it) alone", async () => {
    const rule = breakRuleOf(BEAT.id);
    stationState().breakRules[BEAT.id] = { ...rule, bumperSequences: { ...rule.bumperSequences!, between: { roles: ["up_next", "any"], every: "program" } } };
    saveStationState();
    renderWithApi(<BreaksSection s={beat} />);
    await screen.findByRole("radiogroup", { name: "How often: Up next" });
    // Left out, Up next goes as often as its position: between every program.
    expect(chosen("Up next")).toBe("After each program");
    fireEvent.click(chip("Up next", "Once an hour"));
    expect(await screen.findByText("Which bumpers air, in order. Up next goes by its own choice above; here it only sets its place")).toBeTruthy();
    await save();
    const saved = breakRuleOf(BEAT.id);
    expect(saved.cadence?.upNext).toEqual({ every: "hour" });
    expect(saved.bumperSequences?.between).toEqual({ roles: ["up_next", "any"], every: "program" });
    // Never takes it off, still without touching the sequence.
    fireEvent.click(chip("Up next", "Never"));
    await save();
    expect(breakRuleOf(BEAT.id).cadence?.upNext).toEqual({ every: "never" });
    expect(breakRuleOf(BEAT.id).bumperSequences?.between.roles).toEqual(["up_next", "any"]);
  });

  it("spots and the station ID save with the rest of the rule, in one Save", async () => {
    renderWithApi(<BreaksSection s={beat} />);
    await screen.findByRole("radiogroup", { name: "How often: Spots" });
    fireEvent.click(chip("Spots", "After each program"));
    fireEvent.click(chip("Station ID", "Once an hour"));
    // Nothing is saved until Save.
    expect(breakRuleOf(BEAT.id).cadence?.spots).toEqual({ every: "break" });
    await save();
    await waitFor(() => expect(breakRuleOf(BEAT.id).cadence).toMatchObject({ spots: { every: "program" }, stationId: { every: "hour" }, underwriting: { every: "break" } }));
  });
});
