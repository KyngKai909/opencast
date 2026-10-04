// Break rules (A246 phase 3), on the mocks: one draft for the whole page. A change marks it unsaved
// and enables Reset and Save; Reset puts it back; Save sends it all at once. Leaving with unsaved
// changes asks first (a link, a Schedule tab, closing the tab). The preview rebuilds the hour with
// the draft before it's saved, asking once a change has settled (debounced), not on every click.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react";
import { setupServer } from "msw/node";
import { Link, Route, Routes } from "react-router";

vi.mock("../../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { handlers } from "../../../mocks/handlers";
import { resetDb } from "../../../mocks/db";
import { resetStationState, breakRuleOf } from "../../../mocks/fixtures/station";
import { BEAT } from "../../../mocks/fixtures/stations";
import { renderWithApi, signInAs, stubMatchMedia } from "../../onair/testing";
import { BreaksSection, lengthLine, ownOrderLine, recipeLine } from "./BreaksSection";
import { PREVIEW_DEBOUNCE_MS, previewParts, previewWindow, useDebounced } from "./BreakPreview";

const server = setupServer(...handlers);
let previews: Array<{ rule: { cadence?: { underwriting?: { every: string } } } }> = [];
beforeAll(() => {
  stubMatchMedia();
  server.listen({ onUnhandledRequest: "bypass" });
  server.events.on("request:start", async ({ request }) => {
    if (request.method === "POST" && request.url.endsWith("/break-rule/preview")) previews.push(await request.clone().json());
  });
});
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
  resetStationState();
  signInAs("kai@example.com");
  previews = [];
});
afterEach(() => server.resetHandlers());

const beat = { station: BEAT, id: BEAT.id, role: "owner" as const, studio: false, base: "/control/beat", label: "BEAT 12.1", can: () => true };
const chip = (part: string, name: string) => within(screen.getByRole("radiogroup", { name: `How often: ${part}` })).getByRole("radio", { name });
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

function Page() {
  return (
    <Routes>
      <Route
        path="/control/beat/schedule/rules"
        element={
          <>
            <Link to="/control/beat/monitor">Monitor</Link>
            <BreaksSection s={beat} head={(go) => <button onClick={() => go("/control/beat/schedule")}>Log</button>} />
          </>
        }
      />
      <Route path="/control/beat/monitor" element={<p>The Monitor</p>} />
      <Route path="/control/beat/schedule" element={<p>The Log</p>} />
    </Routes>
  );
}

describe("Break rules: one draft, saved together", () => {
  it("a change is unsaved until Save; Reset puts it back", async () => {
    renderWithApi(<BreaksSection s={beat} />);
    await screen.findByRole("radiogroup", { name: "How often: Thank-you credit" });
    expect(button("Save break rules").disabled).toBe(true);
    expect(button("Reset").disabled).toBe(true);
    expect(screen.getByText("Everything on this page saves together. Applies to breaks not yet filled. Breaks in the next 20 minutes keep what they have.")).toBeTruthy();
    fireEvent.click(chip("Thank-you credit", "Once an hour"));
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(button("Save break rules").disabled).toBe(false);
    // Changing it back is no change at all.
    fireEvent.click(chip("Thank-you credit", "Every break"));
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    fireEvent.click(chip("Thank-you credit", "Once an hour"));
    fireEvent.click(screen.getByRole("radio", { name: "The credit, then spots" }));
    fireEvent.click(button("Reset"));
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    expect(chip("Thank-you credit", "Every break").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Spots, then the credit" }).getAttribute("aria-checked")).toBe("true");
    expect(breakRuleOf(BEAT.id).cadence?.underwriting).toEqual({ every: "break" });
  });

  it("Save sends everything on the page at once, then it's saved", async () => {
    renderWithApi(<BreaksSection s={beat} />);
    await screen.findByRole("radiogroup", { name: "How often: Thank-you credit" });
    fireEvent.click(chip("Thank-you credit", "Once an hour"));
    fireEvent.click(screen.getByRole("button", { name: "Cannabis" }));
    fireEvent.click(screen.getByRole("radio", { name: "On" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Break length" }), { target: { value: "90000" } });
    expect(breakRuleOf(BEAT.id).blockedCategories).not.toContain("Cannabis");
    fireEvent.click(button("Save break rules"));
    expect(await screen.findByText("Break rules saved.")).toBeTruthy();
    expect(breakRuleOf(BEAT.id)).toMatchObject({ cadence: { underwriting: { every: "hour" } }, adsFromPartners: true, lengthMs: 90_000 });
    expect(breakRuleOf(BEAT.id).blockedCategories).toContain("Cannabis");
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    expect(button("Save break rules").disabled).toBe(true);
  });

  it("with nothing unsaved, a link just goes", async () => {
    renderWithApi(<Page />, { path: "/control/beat/schedule/rules" });
    await screen.findByRole("radiogroup", { name: "How often: Spots" });
    // Nothing to lose: it just goes.
    fireEvent.click(screen.getByRole("link", { name: "Monitor" }));
    expect(await screen.findByText("The Monitor")).toBeTruthy();
  });

  it("with unsaved changes, a link or a Schedule tab asks first: keep editing, or leave without saving", async () => {
    renderWithApi(<Page />, { path: "/control/beat/schedule/rules" });
    await screen.findByRole("radiogroup", { name: "How often: Spots" });
    fireEvent.click(chip("Spots", "Once an hour"));
    fireEvent.click(screen.getByRole("link", { name: "Monitor" }));
    const dialog = await screen.findByRole("dialog", { name: "Leave without saving?" });
    expect(within(dialog).getByText("Your changes to the break rules haven't been saved. Leaving drops them.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    // A Schedule tab asks too.
    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Leave without saving?" })).getByRole("button", { name: "Leave without saving" }));
    expect(await screen.findByText("The Log")).toBeTruthy();
    expect(breakRuleOf(BEAT.id).cadence?.spots).toEqual({ every: "break" });
  });

  it("closing or reloading the tab with unsaved changes gets the browser's prompt", async () => {
    renderWithApi(<BreaksSection s={beat} />);
    await screen.findByRole("radiogroup", { name: "How often: Spots" });
    const unload = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(unload()).toBe(false);
    fireEvent.click(chip("Spots", "Never"));
    expect(unload()).toBe(true);
  });
});

describe("Break rules: the preview", () => {
  it("rebuilds the hour with the draft, asking once the clicks settle", async () => {
    renderWithApi(<BreaksSection s={beat} />);
    // The next whole hour from 8:42 pm.
    expect(await screen.findByRole("heading", { name: "Preview: 9:00 to 10:00 pm" })).toBeTruthy();
    await waitFor(() => expect(previews).toHaveLength(1));
    expect(await screen.findByText("Rebuilt with the rules as saved")).toBeTruthy();
    // Three quick changes: one request, with the last.
    fireEvent.click(chip("Thank-you credit", "Never"));
    fireEvent.click(chip("Thank-you credit", "Once an hour"));
    fireEvent.click(chip("Thank-you credit", "After each program"));
    expect(screen.getByText("Rebuilt with the rules as set. Nothing is saved yet")).toBeTruthy();
    await waitFor(() => expect(previews).toHaveLength(2));
    await new Promise((r) => setTimeout(r, PREVIEW_DEBOUNCE_MS + 200));
    expect(previews).toHaveLength(2);
    expect(previews[1].rule.cadence?.underwriting).toEqual({ every: "program" });
    // Nothing was saved by previewing.
    expect(breakRuleOf(BEAT.id).cadence?.underwriting).toEqual({ every: "break" });
  });

  it("draws a break the rule rebuilds: the credit added where it wasn't", async () => {
    renderWithApi(<BreaksSection s={beat} />);
    const rows = await screen.findByRole("list", { name: "The hour, rebuilt" });
    // 9:29 pm, cued from the booth during Beat Tape Live: bumpers, the credit, open time, the ID.
    expect(await within(rows).findByRole("img", { name: "Bumper :10, Credit :15, Bumper :10, Open 1:20, ID :05" })).toBeTruthy();
    fireEvent.click(chip("Thank-you credit", "Never"));
    expect(await within(rows).findByRole("img", { name: "Bumper :10, Bumper :10, Open 1:35, ID :05" }, { timeout: 3000 })).toBeTruthy();
    expect(within(rows).getByText("Beat Tape Live")).toBeTruthy();
  });

  it("steps the hour with its arrows, a day ahead at most", async () => {
    renderWithApi(<BreaksSection s={beat} />);
    await screen.findByRole("heading", { name: "Preview: 9:00 to 10:00 pm" });
    expect(button("An hour earlier").disabled).toBe(true);
    fireEvent.click(button("An hour later"));
    expect(await screen.findByRole("heading", { name: "Preview: 10:00 to 11:00 pm" })).toBeTruthy();
  });
});

describe("Break rules: the words", () => {
  it("say what's true for the mode: after every program, the length doesn't shape breaks", () => {
    expect(recipeLine({ mode: "after_every_program", lengthMs: 120_000 })).toBe("Drawn to scale for a 2:00 break. After every program, a break is the time its program leaves, so most run shorter or longer");
    expect(recipeLine({ mode: "every_n_minutes", lengthMs: 90_000 })).toBe("Drawn to scale for a 1:30 break");
    expect(lengthLine({ mode: "after_every_program" })).toBe("Breaks cued live, and between repeats. The rest are the time a program leaves");
    expect(lengthLine({ mode: "every_n_minutes" })).toBe("Every break. Live programs cue their own");
  });

  it("name the blocks with their own bumper order", () => {
    expect(ownOrderLine([])).toBeNull();
    expect(ownOrderLine(["Late Crate Nights"])).toBe("Late Crate Nights uses its own bumper order during the block.");
    expect(ownOrderLine(["Late Crate Nights", "Sunday Matinee"])).toBe("Late Crate Nights and Sunday Matinee use their own bumper order during their blocks.");
  });

  it("the preview's hour, and a break's parts in the break and between programs", () => {
    expect(previewWindow(Date.parse("2026-09-27T03:42:12Z"))).toEqual({ from: "2026-09-27T04:00:00.000Z", to: "2026-09-27T05:00:00.000Z" });
    expect(previewWindow(Date.parse("2026-09-27T03:42:12Z"), 2).from).toBe("2026-09-27T06:00:00.000Z");
    const parts = previewParts(
      [
        { code: "BMP", title: "Right back", lengthMs: 5_000, whose: "station", note: null, element: { position: "open", role: "into_break", announces: null, fits: true } },
        { code: "SPT", title: "REEL's break time", lengthMs: 60_000, whose: "producer", note: null },
        { code: "SID", title: "Station ID", lengthMs: 5_000, whose: "station", note: null },
        { code: "BMP", title: "Up next", lengthMs: 8_000, whose: "station", note: null, element: { position: "between", role: "up_next", announces: null, fits: true } },
        { code: "BMP", title: "Sting", lengthMs: 0, whose: "station", note: null, element: { position: "between", role: "any", announces: null, fits: false } }
      ],
      "REEL"
    );
    expect(parts.inBreak.map((p) => [p.kind, p.label])).toEqual([["bumper", ""], ["barter", "REEL barter"], ["id", "ID"]]);
    expect(parts.between.map((p) => [p.kind, p.length])).toEqual([["upnext", 8_000]]);
  });

  it("a value settles after the wait", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ v }) => useDebounced(v, 400), { initialProps: { v: 1 } });
    rerender({ v: 2 });
    rerender({ v: 3 });
    expect(result.current).toBe(1);
    act(() => void vi.advanceTimersByTime(399));
    expect(result.current).toBe(1);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toBe(3);
    vi.useRealTimers();
  });
});
