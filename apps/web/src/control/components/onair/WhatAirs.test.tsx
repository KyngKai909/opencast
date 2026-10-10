// Programming Phase 3: template slots that air the next episode, on the mocks at the reference
// Saturday, 8:42 pm. The words (whatAirs.ts) and the preview line; "What airs" under a program in
// the template editor (the segmented control, the order as a select, the preview line, the tray's
// line and saving with the slot's id); the Add drawer's template mode; and on the log, the "Next
// episode" mark and the details that say which slot and template.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { setupServer } from "msw/node";
import { Route, Routes } from "react-router";
import { slotPreviewLine, type DayTemplate, type LogEntry } from "@opencast/contracts";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));
vi.mock("../../../auth/AuthProvider", async (original) => ({ ...(await original<object>()), useAuth: () => ({ getToken: async () => null }) }));

import { handlers } from "../../mocks/handlers";
import { resetDb } from "../../mocks/db";
import { resetBlocks } from "../../mocks/blocks";
import { templateById, updateTemplate } from "../../mocks/schedule";
import { BEAT } from "../../mocks/fixtures/stations";
import { PROGRAM_IDS } from "../../mocks/fixtures/library";
import { TEMPLATE_IDS } from "../../mocks/fixtures/templates";
import { ShellOptionsProvider } from "../../layout/shell";
import { StationProvider } from "../../station/StationContext";
import { renderWithApi, signInAs, stubMatchMedia } from "./testing";
import { EntryPane } from "./LogPane";
import { LogPage } from "./LogPage";
import { TemplatesTab } from "./TemplatesTab";
import { entriesInput, templateEntries } from "./templateDraft";
import { nextEpisodeMark, orderOptions, settingInput, settingLine, settingOf, slotDetail, withWhatAirs } from "./whatAirs";

const server = setupServer(...handlers);
beforeAll(() => {
  stubMatchMedia();
  server.listen({ onUnhandledRequest: "bypass" });
});
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
  resetBlocks();
  sessionStorage.clear();
  signInAs("kai@example.com");
});
afterEach(() => server.resetHandlers());

const ep = (n: number, o: { programId?: string; seasonNumber?: number | null; title?: string } = {}) => ({ itemId: `i${n}`, title: o.title ?? `Late Crate, ep. ${n}`, programId: o.programId ?? "lc", seasonNumber: o.seasonNumber ?? null, episodeNumber: n });
const on = (date: string, ...episodes: Array<ReturnType<typeof ep>>) => ({ date, episodes });

describe("the words", () => {
  it("previews the next dates: numbers, ranges for a full slot, a mix by program, and a slot that stops", () => {
    const sats = { one: "Saturday", many: "Saturdays" };
    expect(slotPreviewLine([on("a", ep(13)), on("b", ep(14)), on("c", ep(15)), on("d", ep(16))], sats)).toBe("Next 4 Saturdays: ep. 13, 14, 15, 16");
    expect(slotPreviewLine([on("a", ep(1), ep(2), ep(3), ep(4)), on("b", ep(10), ep(1), ep(2))], { one: "day", many: "days" })).toBe("Next 2 days: ep. 1–4, 10 and 1–2");
    expect(slotPreviewLine([on("a", ep(13)), on("b", ep(4, { programId: "sh" }))], sats, (id) => (id === "lc" ? "Late Crate" : "Slow Hours"))).toBe("Next 2 Saturdays: Late Crate ep. 13, Slow Hours ep. 4");
    expect(slotPreviewLine([on("a", ep(2)), on("b", ep(3)), on("c"), on("d")], sats)).toBe("Next 4 Saturdays: ep. 2, 3, then nothing: it stops at the end");
    expect(slotPreviewLine([on("a", ep(1, { seasonNumber: 1 })), on("b", ep(1, { seasonNumber: 2 }))], sats)).toBe("Next 2 Saturdays: ep. S1E1, S2E1");
    expect(slotPreviewLine([on("a", { ...ep(1), episodeNumber: null as never, title: "Pilot" })], sats)).toBe("Next Saturday: Pilot");
  });

  it("offers Marathon and Shuffle shows only for a mix, and says what a slot does", () => {
    expect(orderOptions(1).map((o) => o.label)).toEqual(["In order", "Newest first", "Shuffle"]);
    expect(orderOptions(2).map((o) => o.label)).toEqual(["In order", "Newest first", "Shuffle", "Shuffle shows, keep each in order", "Marathon"]);
    const next = withWhatAirs(settingOf({ programId: "lc" }), "next_episode", "lc");
    expect(next).toEqual({ whatAirs: "next_episode", programIds: ["lc"], order: "in_order", atEnd: "start_over", sameAsSlotId: null });
    expect(settingInput(next, "slot-1")).toEqual({ slotId: "slot-1", whatAirs: "next_episode", programIds: ["lc"], order: "in_order", atEnd: "start_over" });
    expect(settingLine("Late Crate", next)).toBe("Late Crate airs the next episode each date, in order");
    expect(settingLine("Night", { ...next, whatAirs: "fill", programIds: ["lc", "sh"], order: "shuffle", atEnd: "stop" }, (id) => (id === "lc" ? "Late Crate" : "Slow Hours"))).toBe(
      "Night fills its slot with next episodes, from Late Crate and Slow Hours, shuffle, and stops at the end"
    );
  });

  it("sends each entry's slot id back with what airs from it", () => {
    const tpl = templateById(BEAT.id, TEMPLATE_IDS.weekdays)! as unknown as DayTemplate;
    const draft = templateEntries(tpl, "2026-09-28");
    const late = draft.find((e) => e.title.startsWith("Late Crate"))!;
    const input = entriesInput(draft, tpl, (e) => (e.id === late.id ? withWhatAirs(settingOf(tpl.entries[0]), "next_episode", PROGRAM_IDS.lateCrate) : null));
    expect(input[0]).toEqual({ startTime: "21:30", lengthMs: 30 * 60_000, kind: "program", itemId: late.itemId, slotId: tpl.entries[0].slotId, whatAirs: "next_episode", programIds: [PROGRAM_IDS.lateCrate], order: "in_order", atEnd: "start_over" });
    // The rest keep their slots, airing this episode.
    expect(input[1]).toMatchObject({ slotId: tpl.entries[1].slotId, itemId: tpl.entries[1].itemId });
    expect(input[1].whatAirs).toBeUndefined();
  });
});

const beat = { station: BEAT, id: BEAT.id, role: "owner" as const, studio: false, base: "/control/beat", label: "BEAT", can: () => true };
const renderTemplates = (path: string) =>
  renderWithApi(
    <ShellOptionsProvider>
      <StationProvider value={beat}>
        <Routes>
          <Route path="/control/beat/schedule/templates/:templateId" element={<TemplatesTab />} />
        </Routes>
      </StationProvider>
    </ShellOptionsProvider>,
    { path }
  );

describe("What airs in the template editor", () => {
  it("is a segmented control under the program, the order a select, with the preview line; saving keeps the slot", async () => {
    renderTemplates(`/control/beat/schedule/templates/${TEMPLATE_IDS.weekdays}`);
    fireEvent.click(await screen.findByRole("button", { name: "Edit template" }));
    const rundown = await screen.findByRole("list", { name: "The rundown, being edited" });
    fireEvent.click(within(rundown).getByRole("button", { name: /^Late Crate, ep\. 13/ }));
    const airs = await screen.findByRole("region", { name: "What airs" });
    const control = within(airs).getByRole("radiogroup", { name: "What airs" });
    expect(within(control).getAllByRole("radio").map((r) => [r.textContent, r.getAttribute("aria-checked")])).toEqual([
      ["This episode", "true"],
      ["Next episode", "false"],
      ["Fill the slot", "false"],
      ["Same as earlier slot", "false"]
    ]);
    fireEvent.click(within(control).getByRole("radio", { name: "Next episode" }));
    // The program it airs is Late Crate's; one program: no Marathon.
    expect((within(airs).getByRole("checkbox", { name: "Late Crate" }) as HTMLInputElement).checked).toBe(true);
    const order = within(airs).getByLabelText("Order") as HTMLSelectElement;
    expect([...order.options].map((o) => o.textContent)).toEqual(["In order", "Newest first", "Shuffle"]);
    // The next four weekdays (Wednesday Sep 30 was edited by hand, so not it).
    expect(await within(airs).findByText("Next 4 weekdays: ep. 1, 2, 3, 4")).toBeTruthy();
    const tray = await screen.findByRole("region", { name: "Your changes" });
    expect(within(tray).getByText("Late Crate, ep. 13 airs the next episode each date, in order")).toBeTruthy();
    expect(within(tray).getByText("1 change, checked: nothing blocks saving")).toBeTruthy();

    const slotId = templateById(BEAT.id, TEMPLATE_IDS.weekdays)!.entries[0].slotId;
    fireEvent.click(within(tray).getByRole("button", { name: "Save template" }));
    expect(await screen.findByText("Template saved. 14 dates rebuilt; 1 edited date kept as an exception.")).toBeTruthy();
    const saved = templateById(BEAT.id, TEMPLATE_IDS.weekdays)!.entries[0];
    expect(saved).toMatchObject({ slotId, whatAirs: "next_episode", programIds: [PROGRAM_IDS.lateCrate], order: "in_order", atEnd: "start_over", title: "Late Crate" });
  });

  it("adds a Next episode slot from the Add drawer's template mode, after its preview line", async () => {
    renderTemplates(`/control/beat/schedule/templates/${TEMPLATE_IDS.weekdays}`);
    fireEvent.click(await screen.findByRole("button", { name: "Edit template" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));
    const drawer = await screen.findByRole("dialog", { name: /^Add at/ });
    fireEvent.click(within(drawer).getByRole("radio", { name: "Next episode" }));
    fireEvent.click(await within(drawer).findByRole("button", { name: /^Late Crate/ }));
    expect(await within(drawer).findByText(/^Next 4 weekdays: ep\. 1, 2, 3, 4$/)).toBeTruthy();
    fireEvent.click(within(drawer).getByRole("button", { name: "Add Late Crate" }));
    const tray = await screen.findByRole("region", { name: "Your changes" });
    expect(within(tray).getByText(/^Late Crate goes on at/)).toBeTruthy();
    expect(within(tray).getByText("Late Crate airs the next episode each date, in order")).toBeTruthy();
  });
});

describe("on the log", () => {
  it("marks an entry from a Next episode slot, and its details say which slot and template", async () => {
    const t = templateById(BEAT.id, TEMPLATE_IDS.weekdays)!;
    const [late, crate] = t.entries;
    updateTemplate(t, {
      entries: [
        { startTime: late.startTime, lengthMs: late.lengthMs, kind: "program", slotId: late.slotId!, whatAirs: "next_episode", programIds: [PROGRAM_IDS.lateCrate] },
        { startTime: crate.startTime, lengthMs: crate.lengthMs, kind: "program", itemId: crate.itemId!, slotId: crate.slotId! }
      ]
    });
    renderWithApi(<LogPage stationId={BEAT.id} station={BEAT} base="/control/beat" canEdit />, { path: "/control/beat/schedule?day=2026-09-29" });
    const rundown = await screen.findByRole("list", { name: "The rundown" });
    const row = await within(rundown).findByRole("button", { name: /^Late Crate/ });
    expect(row.querySelector(".cc-rr__next")?.textContent).toBe("Next episode");
    // Crate Session airs this episode: no mark.
    expect(within(rundown).getByRole("button", { name: /^Crate Session 01/ }).querySelector(".cc-rr__next")).toBeNull();
    fireEvent.click(row);
    const pane = await screen.findByRole("region", { name: "Late Crate" });
    expect(within(pane).getByText("Next episode, from the 9:30 pm slot of After work (Weekdays)")).toBeTruthy();
  });

  it("says a slot's details in words", () => {
    const slot = { slotId: "s", templateId: "t", templateName: null, label: "Every Saturday", startTime: "20:00", whatAirs: "fill" as const };
    expect(slotDetail(slot)).toBe("Fill the slot, from the 8:00 pm slot of Every Saturday");
    expect(slotDetail({ ...slot, whatAirs: "this_episode" })).toBe("From the 8:00 pm slot of Every Saturday");
    expect(nextEpisodeMark({ templateSlot: slot })).toBe(true);
    expect(nextEpisodeMark({ templateSlot: { ...slot, whatAirs: "same_as" } })).toBe(false);
    const entry: LogEntry = { id: "e", kind: "program", code: "PGM", startsAt: "2026-10-03T03:00:00Z", endsAt: "2026-10-03T03:30:00Z", title: "Late Crate", episodeTitle: "Late Crate, ep. 14", itemId: "i", programId: "p", liveSourceId: null, carriedFrom: null, carriageAgreementId: null, repeatGroupId: "t", localNote: null, templateSlot: { ...slot, whatAirs: "next_episode" } };
    render(<EntryPane entry={entry} block={null} onClose={() => undefined} />);
    expect(screen.getByText("Next episode, from the 8:00 pm slot of Every Saturday")).toBeTruthy();
  });
});
