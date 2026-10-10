// A244: programming blocks in master control, on the mocks at the reference Saturday, 8:42 pm.
// BEAT's Late Crate Nights is on tonight from 8:00 to 9:00 pm (Late Crate, ep. 14 and Saturday
// Reel are in it) and every Saturday from its template. The words; A246 (Phase 4): the Blocks tab
// as 07 draws it (the list, the block page with what it airs and where it falls back, one Save and
// the warning before leaving, the look's preview with the player's own parts, a sample program
// when it isn't on the log, where it airs, "Place on the log"); the Log's block label and pane,
// and its start and end as handles in edit mode; edit mode's block changes as the draft keeps
// them; and the mock's checks, as the API's.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { setupServer } from "msw/node";
import { Route, Routes } from "react-router";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));
vi.mock("../../../auth/AuthProvider", async (original) => ({ ...(await original<object>()), useAuth: () => ({ getToken: async () => null }) }));

import type { LibraryItem, ProgramBlock } from "@opencast/contracts";
import { handlers } from "../../mocks/handlers";
import { resetDb } from "../../mocks/db";
import { checkBlockChanges, LATE_CRATE_NIGHTS_ID, resetBlocks, spanViews } from "../../mocks/blocks";
import { BEAT } from "../../mocks/fixtures/stations";
import { at } from "../../mocks/fixtures/time";
import { renderWithApi, signInAs, stubMatchMedia } from "../../components/onair/testing";
import { TEMPLATE_IDS } from "../../mocks/fixtures/templates";
import { blockRoleSupply, idLine, lengthWords, onLogLines, partLine, spanSummary, startsWords, untilWords } from "../../components/live/blocks";
import { airsRows, initials, madeByLine, nextAiring, ownWords, scheduleWords, whereRows } from "../../components/live/blockAirs";
import { previewBug } from "../../components/live/BlockPreview";
import { changedFields, draftOf } from "../../components/live/BlockPage";
import { draftSpans, newSpanId, spanAt, spanPieces, withChange } from "../../components/onair/logEdit";
import { LogPage } from "../../components/onair/LogPage";
import { ShellOptionsProvider } from "../../layout/shell";
import { StationProvider } from "../../station/StationContext";
import Blocks from "./Blocks";

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
          <Route path="/control/beat/schedule/blocks" element={<Blocks />} />
          <Route path="/control/beat/schedule/blocks/:blockId" element={<Blocks />} />
        </Routes>
      </StationProvider>
    </ShellOptionsProvider>,
    { path }
  );

const block = (o: Partial<ProgramBlock> = {}): ProgramBlock =>
  ({
    id: "b",
    stationId: BEAT.id,
    name: "Late Crate Nights",
    description: null,
    colour: "#1F5C99",
    logoUrl: null,
    bug: "logo",
    intro: true,
    outro: true,
    sequences: null,
    owner: BEAT,
    carried: false,
    reskin: "owner_only",
    items: { intro: [], outro: [], id: [], bumpers: { into_break: 0, out_of_break: 0, up_next: 0, any: 0 } },
    schedule: { label: null, next: null },
    createdAt: at("12:00"),
    updatedAt: at("12:00"),
    ...o
  }) as ProgramBlock;

describe("a block in words", () => {
  it("says what airs for its intro, outro and ID: its own, or the automatic card and the station's ID", () => {
    expect(lengthWords(6_000)).toBe(":06");
    expect(lengthWords(90_000)).toBe("1:30");
    expect(partLine(block(), "intro")).toBe("No intro of its own yet, so a :05 card with the block's name and logo");
    expect(partLine(block({ items: { ...block().items, outro: [{ id: "o", title: "Late Crate Nights outro", durationMs: 6_000 }] } }), "outro")).toBe("Uses: Late Crate Nights outro (:06)");
    expect(partLine(block({ outro: false }), "outro")).toBe("No outro.");
    expect(idLine(block())).toBe("No ID of its own, so your station ID airs.");
  });

  it("says where each bumper role comes from (block, then station)", () => {
    const b = block({ items: { ...block().items, bumpers: { into_break: 2, out_of_break: 0, up_next: 0, any: 1 } } });
    expect(blockRoleSupply(b, "into_break", "BEAT")).toBe("2 in this block");
    expect(blockRoleSupply(b, "out_of_break", "BEAT")).toBe("None yet, so its Any bumper airs");
    expect(blockRoleSupply(b, "up_next", "BEAT")).toBe("None yet, so BEAT's up next airs");
    expect(blockRoleSupply(block(), "any", "BEAT")).toBe("None yet, so BEAT's airs");
  });

  it("says where a span airs, the Monitor's lines, and where it's on the log", () => {
    expect(spanSummary({ entryIds: ["a", "b", "c"], airsFrom: "2026-10-04T04:00:00.000Z", airsUntil: "2026-10-04T08:10:00.000Z" }, "America/Los_Angeles")).toBe("3 programs, 9:00 pm to 1:10 am");
    expect(spanSummary({ entryIds: [], airsFrom: null, airsUntil: null })).toBe("Nothing in it yet");
    expect(untilWords({ name: "Late Crate Nights", endsAt: "2026-10-04T08:00:00.000Z" }, "America/Los_Angeles")).toBe("Late Crate Nights · until 1:00 am");
    expect(startsWords({ name: "Late Crate Nights", startsAt: "2026-10-04T04:00:00.000Z" }, "America/Los_Angeles")).toBe("Late Crate Nights starts at 9:00 pm");
    expect(onLogLines({ onLog: { templates: [{ templateId: "t", name: "After dark", label: "Every Saturday", startTime: "21:00", lengthMs: 4 * 3_600_000 }], dates: [], ahead: 3 } })).toEqual([{ text: "Every Saturday, 9:00 pm to 1:00 am (from the template After dark)", date: null }]);
  });
});

describe("the Blocks tab's words (A246, Phase 4)", () => {
  it("groups a block's days at the same times, says what it has of its own, and when it's next", () => {
    expect(scheduleWords("Every Friday, 9:00 pm to 1:00 am; Every Saturday, 9:00 pm to 1:00 am")).toBe("Fridays and Saturdays, 9:00 pm to 1:00 am");
    expect(scheduleWords("Weekdays, 6:00 am to 9:00 am")).toBe("Weekdays, 6:00 am to 9:00 am");
    expect(scheduleWords("Every Friday, 9:00 pm to 1:00 am; Every Sunday, 2:00 pm to 4:00 pm")).toBe("Fridays, 9:00 pm to 1:00 am; Sundays, 2:00 pm to 4:00 pm");
    expect(scheduleWords("Sat 8:00 pm to 9:00 pm")).toBe("Sat 8:00 pm to 9:00 pm");
    expect(scheduleWords(null)).toBeNull();
    expect(ownWords(block({ items: { ...block().items, id: [{ id: "i", title: "LCN ID", durationMs: 5_000 }], bumpers: { into_break: 4, out_of_break: 3, up_next: 0, any: 0 } } }), "BEAT")).toBe("Its own look, bumpers and ID");
    expect(ownWords(block({ colour: null }), "BEAT")).toBe("BEAT's bumpers and ID");
    expect(ownWords(block(), "BEAT")).toBe("Its own look. BEAT's bumpers and ID");
    const now = Date.parse(at("20:42"));
    expect(nextAiring(at("21:00"), now)).toBe("Next: tonight at 9:00 pm");
    expect(nextAiring(at("+2 06:00"), now)).toBe("Next: Monday at 6:00 am");
    expect(nextAiring(at("+1 06:00"), now)).toBe("Next: tomorrow at 6:00 am");
    expect(nextAiring(at("+14 20:00"), now)).toBe("Next: Sat Oct 10 at 8:00 pm");
    expect(nextAiring(at("20:00"), now)).toBe("On now");
    expect(nextAiring(null, now)).toBeNull();
    expect(initials("Late Crate Nights")).toBe("LCN");
  });

  it("says what it airs, part by part, and where each falls back: 'Uses BEAT's' only when BEAT has one", () => {
    const item = (o: Partial<LibraryItem>) => ({ code: "BMP", identCode: null, bumperRole: null, durationMs: 5_000, status: "ready", rights: { confirmedAt: at("12:00") }, airs: null, programBlockId: null, ...o }) as unknown as LibraryItem;
    const own = [item({ code: "SID", durationMs: 6_000, programBlockId: "b" }), item({ bumperRole: "into_break", durationMs: 4_000, programBlockId: "b" }), item({ identCode: "OPN", code: "SID", durationMs: 6_000, programBlockId: "b" })];
    const station = [item({ bumperRole: "out_of_break", durationMs: 10_000 }), item({ code: "SID", durationMs: 5_000 })];
    const rows = airsRows({ intro: true, outro: true }, own, station, "BEAT", new Date(at("20:42")));
    expect(rows.map((r) => [r.title, r.detail, r.lengthMs, r.fallback])).toEqual([
      ["Intro", "Just before its first program. 1", 6_000, null],
      ["Outro", "Just after its last program. None of its own", 5_000, "An automatic card airs"],
      ["Block ID", "Airs where the station ID would. 1", 6_000, null],
      ["Bumpers into the break", "1 of its own", 4_000, null],
      ["Bumpers out of the break", "None of its own", 10_000, "Uses BEAT's"],
      // Up next never falls back to an Any bumper; BEAT has no up next of its own.
      ["Up next", "None of its own", null, "Nothing airs here yet"]
    ]);
    // Nothing of BEAT's for the ID: the generated one, said as automatic. An Any of its own fills into and out of the break.
    const bare = airsRows({ intro: false, outro: true }, [item({ programBlockId: "b" })], [], "BEAT", new Date(at("20:42")));
    expect(bare.find((r) => r.part === "intro")).toMatchObject({ detail: "Off. Nothing airs before it", fallback: null });
    expect(bare.find((r) => r.part === "id")).toMatchObject({ fallback: "An automatic ID airs" });
    expect(bare.find((r) => r.part === "into_break")).toMatchObject({ detail: "None of its own for this", fallback: "Uses its Any bumpers" });
    expect(bare.find((r) => r.part === "up_next")).toMatchObject({ fallback: "Nothing airs here yet" });
    expect(bare.find((r) => r.part === "any")).toMatchObject({ title: "Any bumper", detail: "1 of its own. Airs wherever a bumper is wanted" });
    // A station bumper outside its air window doesn't count.
    const later = airsRows({ intro: true, outro: true }, [], [item({ bumperRole: "up_next", airs: { from: "2026-12-01", until: null, dailyFrom: null, dailyUntil: null } })], "BEAT", new Date(at("20:42")));
    expect(later.find((r) => r.part === "up_next")?.fallback).toBe("Nothing airs here yet");
  });

  it("says where it airs, its templates at the same times together, and who makes it", () => {
    const onLog = {
      templates: [
        { templateId: "fri", name: null, label: "Every Friday", startTime: "21:00", lengthMs: 4 * 3_600_000 },
        { templateId: "sat", name: null, label: "Every Saturday", startTime: "21:00", lengthMs: 4 * 3_600_000 }
      ],
      dates: [
        { spanId: "s1", startsAt: at("+6 21:00"), endsAt: at("+7 01:00"), templateId: "fri" },
        { spanId: "s2", startsAt: at("+7 21:00"), endsAt: at("+8 01:00"), templateId: "sat" },
        { spanId: "s3", startsAt: at("+28 20:00"), endsAt: at("+29 02:00"), templateId: null }
      ],
      ahead: 3
    };
    expect(whereRows({ onLog }, "/control/beat/schedule")).toEqual([
      { key: "fri,sat", title: "Fridays and Saturdays templates", detail: "9:00 pm to 1:00 am. 2 dates ahead", href: "/control/beat/schedule/templates/fri" },
      { key: "s3", title: "Sat Oct 24", detail: "Once, 8:00 pm to 2:00 am", href: "/control/beat/schedule?day=2026-10-24&block=s3" }
    ]);
    expect(madeByLine(block())).toBe("Made by BEAT. Offering blocks to other stations, with your look or theirs, comes later with the syndication market.");
  });

  it("keeps everything updateBlock takes as one draft, and says what changed", () => {
    const b = block();
    expect(changedFields(b, draftOf(b))).toEqual({});
    expect(changedFields(b, { ...draftOf(b), outro: false, name: " Late Crate Nights ", colour: "#2E6B5A" })).toEqual({ outro: false, colour: "#2E6B5A" });
    expect(changedFields(b, { ...draftOf(b), description: "Records after dark." })).toEqual({ description: "Records after dark." });
  });

  it("draws the bug as the player gets it: the block's logo, the station's, or nothing", () => {
    const setup = { bug: { mode: "call_sign_and_channel" as const, position: "top_right", opacity: 80 }, logoUrl: null };
    expect(previewBug({ id: "b", name: "L", colour: null, logoUrl: "https://x/l.png", bug: "logo" }, BEAT, setup)).toMatchObject({ mode: "logo", logoUrl: "https://x/l.png", blockId: "b", position: "top_right", opacity: 80 });
    expect(previewBug({ id: "b", name: "L", colour: null, logoUrl: null, bug: "logo" }, BEAT, setup)).toMatchObject({ mode: "call_sign_and_channel", callSign: "BEAT", channel: "12.1" });
    expect(previewBug({ id: "b", name: "L", colour: null, logoUrl: null, bug: "off" }, BEAT, setup)).toBeNull();
    expect(previewBug({ id: "b", name: "L", colour: null, logoUrl: null, bug: "station" }, BEAT, { ...setup, bug: { ...setup.bug, mode: "off" } })).toBeNull();
  });
});

describe("the Schedule's Blocks tab (A246)", () => {
  it("lists the station's blocks with when they run, what they have of their own, and their next airing", async () => {
    renderAt("/control/beat/schedule/blocks");
    expect(await screen.findByRole("heading", { level: 1, name: "Schedule" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Blocks" }).getAttribute("aria-selected")).toBe("true");
    const list = await screen.findByRole("list", { name: "Your blocks" });
    const lcn = within(list).getByRole("link", { name: /Late Crate Nights/ });
    expect(lcn.getAttribute("href")).toBe(`/control/beat/schedule/blocks/${LATE_CRATE_NIGHTS_ID}`);
    expect(lcn.textContent).toBe("Late Crate NightsSaturdays, 8:00 pm to 9:00 pm. Its own look. BEAT's bumpers and IDOn now");
    expect(within(list).getByRole("link", { name: /Sunday Matinee/ }).textContent).toBe("Sunday MatineeNot on the log yetPlace on the log");
    // The first is open.
    expect(await screen.findByRole("heading", { level: 2, name: /^Late Crate Nights/ })).toBeTruthy();
  });

  it("shows a block: what it airs with where it falls back, the look on air, where it airs, who makes it", async () => {
    renderAt(`/control/beat/schedule/blocks/${LATE_CRATE_NIGHTS_ID}`);
    const airs = await screen.findByRole("region", { name: /^What it airs/ });
    expect(within(airs).getByText("Anything it doesn't have falls back to BEAT's")).toBeTruthy();
    const row = (title: string) => within(airs).getByText(title).closest("li")!.textContent;
    await waitFor(() => expect(row("Bumpers out of the break")).toContain("Uses BEAT's"));
    expect(row("Intro")).toContain("An automatic card airs");
    expect(row("Up next")).toContain("Nothing airs here yet");
    // The look: the player's own banner, naming the block over the program on now, and the guide's band.
    const look = screen.getByRole("figure", { name: "How Late Crate Nights looks on air" });
    expect(await within(look).findByRole("heading", { name: "Late Crate Nights · Saturday Reel" })).toBeTruthy();
    expect(within(look).getByRole("note", { name: /^Late Crate Nights, 8:00 pm to/ })).toBeTruthy();
    const where = screen.getByRole("region", { name: "Where it airs" });
    expect(where.textContent).toContain("Saturdays template");
    expect(within(where).getByRole("link", { name: "Open Saturdays template" }).getAttribute("href")).toBe(`/control/beat/schedule/templates/${TEMPLATE_IDS.saturdays}`);
    expect(screen.getByText("Made by BEAT. Offering blocks to other stations, with your look or theirs, comes later with the syndication market.")).toBeTruthy();
  });

  it("previews a block that isn't on the log with a sample program, labelled as one", async () => {
    renderAt("/control/beat/schedule/blocks/00000000-0000-4000-8000-0000000b1002");
    const look = await screen.findByRole("figure", { name: "How Sunday Matinee looks on air, with a sample program" });
    expect(within(look).getByText("A sample program: Sunday Matinee isn't on the log yet.")).toBeTruthy();
    expect(within(look).getByRole("heading", { name: "Sunday Matinee · Your program" })).toBeTruthy();
    expect(screen.getByText("Not on the log yet. Place it on a date, or in a template.")).toBeTruthy();
  });

  it("keeps changes as a draft with one Save, and asks before leaving them", async () => {
    renderAt(`/control/beat/schedule/blocks/${LATE_CRATE_NIGHTS_ID}`);
    const save = await screen.findByRole("button", { name: "Save" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(await screen.findByRole("switch", { name: "Outro" }));
    expect(screen.getByText("Unsaved changes. Save keeps them; leaving drops them.")).toBeTruthy();
    // The look follows the draft: the bug off.
    fireEvent.click(screen.getByRole("radio", { name: "Nothing" }));
    // Leaving for another block asks first.
    fireEvent.click(screen.getByRole("link", { name: /Sunday Matinee/ }));
    const ask = await screen.findByRole("dialog", { name: "Leave without saving?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Keep editing" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Late Crate Nights saved.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Unsaved changes. Save keeps them; leaving drops them.")).toBeNull());
    const saved = (await import("../../mocks/blocks")).blockById(LATE_CRATE_NIGHTS_ID)!;
    expect([saved.outro, saved.bug]).toEqual([false, "off"]);
  });

  it("adds a clip from the library at once, keeping the changes not saved yet", async () => {
    renderAt(`/control/beat/schedule/blocks/${LATE_CRATE_NIGHTS_ID}`);
    fireEvent.click(await screen.findByRole("switch", { name: "Outro" }));
    fireEvent.click(screen.getByRole("button", { name: "Add from the library" }));
    const dialog = await screen.findByRole("dialog", { name: "Add from the library" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Out of the break" }));
    fireEvent.click(await within(dialog).findByRole("radio", { name: /Back to the reel/ }));
    expect(await screen.findByText("Back to the reel is part of Late Crate Nights now. Added at once.")).toBeTruthy();
    await waitFor(() => expect(within(screen.getByRole("region", { name: /^What it airs/ })).getByText("Bumpers out of the break").closest("li")!.textContent).toContain("1 of its own"));
    expect(screen.getByText("Unsaved changes. Save keeps them; leaving drops them.")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Outro" }).getAttribute("aria-checked")).toBe("false");
  });

  it("places it on the log from a menu: on a date, or in a template", async () => {
    renderAt(`/control/beat/schedule/blocks/${LATE_CRATE_NIGHTS_ID}`);
    fireEvent.click(await screen.findByRole("button", { name: "Place Late Crate Nights on the log" }));
    const menu = await screen.findByRole("menu");
    await waitFor(() => expect(within(menu).getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["On a dateThe Log, in edit mode", "In After workThe template editor", "In Every SaturdayThe template editor"]));
    fireEvent.click(within(menu).getByRole("menuitem", { name: /On a date/ }));
    expect(await screen.findByRole("dialog", { name: "Place Late Crate Nights on a date" })).toBeTruthy();
  });

  it("makes a new block and opens it", async () => {
    renderAt("/control/beat/schedule/blocks/new");
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Saturday Matinee" } });
    fireEvent.click(screen.getByRole("button", { name: "Make the block" }));
    expect(await screen.findByRole("heading", { level: 2, name: /^Saturday Matinee/ })).toBeTruthy();
    expect(screen.getByRole("figure", { name: "How Saturday Matinee looks on air, with a sample program" })).toBeTruthy();
  });

  it("archives only once it's off the log", async () => {
    renderAt(`/control/beat/schedule/blocks/${LATE_CRATE_NIGHTS_ID}`);
    fireEvent.click(await screen.findByRole("button", { name: "Archive block" }));
    expect(await screen.findByText("Late Crate Nights is on the log 1 more time. Take it off the log first.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take it off the log and archive" }));
    await waitFor(() => expect(screen.queryByRole("heading", { level: 2, name: /^Late Crate Nights/ })).toBeNull());
  });
});

describe("the program log's block", () => {
  it("draws the block as a label where it starts, and opens its pane from it", async () => {
    renderWithApi(<LogPage stationId={BEAT.id} station={BEAT} base="/control/beat" canEdit />, { path: "/control/beat/schedule" });
    const label = await screen.findByRole("button", { name: /^Late Crate Nights Block, 8:00 to 9:00 pm/ });
    fireEvent.click(label);
    const pane = await screen.findByRole("region", { name: "Late Crate Nights" });
    expect(within(pane).getByText("Block, 8:00 to 9:00 pm. 2 programs, 8:00 pm to 8:59 pm")).toBeTruthy();
    expect(within(pane).getByRole("button", { name: "Change times" })).toBeTruthy();
    expect(within(pane).getByRole("link", { name: "Edit Late Crate Nights" }).getAttribute("href")).toBe(`/control/beat/schedule/blocks/${LATE_CRATE_NIGHTS_ID}`);
  });
});

describe("edit mode's block changes", () => {
  it("keep one change per span, and a span the draft adds takes its own changes in", () => {
    const add = { op: "block_add" as const, key: "k1", blockId: "b", startsAt: at("21:00"), endsAt: at("23:00") };
    let changes = withChange([], add);
    changes = withChange(changes, { op: "block_resize", spanId: newSpanId("k1"), endsAt: at("23:30") });
    expect(changes).toEqual([{ ...add, endsAt: at("23:30") }]);
    expect(withChange(changes, { op: "block_remove", spanId: newSpanId("k1") })).toEqual([]);
    const resized = withChange(withChange([], { op: "block_resize", spanId: "s", endsAt: at("22:00") }), { op: "block_resize", spanId: "s", startsAt: at("20:30") });
    expect(resized).toEqual([{ op: "block_resize", spanId: "s", endsAt: at("22:00"), startsAt: at("20:30") }]);
  });

  it("leave the spans as the draft has them, with their members and where a program dropped in belongs", () => {
    const spans = draftSpans([{ id: "s", blockId: "b", name: "Late Crate Nights", colour: "#1F5C99", startsAt: at("20:00"), endsAt: at("21:00") }], [{ op: "block_resize", spanId: "s", endsAt: at("22:00") }, { op: "block_add", key: "k", blockId: "m", startsAt: at("22:00"), endsAt: at("23:00") }], (id) => (id === "m" ? { name: "Matinee", colour: null } : undefined));
    expect(spans.map((x) => [x.name, x.startsAt, x.endsAt, x.change])).toEqual([
      ["Late Crate Nights", at("20:00"), at("22:00"), "resized"],
      ["Matinee", at("22:00"), at("23:00"), "added"]
    ]);
    const entries = [
      { id: "a", kind: "program" as const, startsAt: at("20:00"), endsAt: at("20:30") },
      { id: "o", kind: "off_air" as const, startsAt: at("20:30"), endsAt: at("21:00") },
      { id: "b", kind: "program" as const, startsAt: at("21:00"), endsAt: at("22:10") }
    ];
    expect(spanPieces(spans[0], entries)).toEqual([
      { startsAt: at("20:00"), endsAt: at("20:30") },
      { startsAt: at("21:00"), endsAt: at("22:10") }
    ]);
    expect(spanAt(spans, at("22:30"))?.name).toBe("Matinee");
    expect(spanAt(spans, at("23:00"))).toBeUndefined();
  });
});

describe("the mock's block checks, as the API's", () => {
  it("refuse an overlap and say each change in a line", () => {
    const t = Date.parse(at("20:42"));
    const r = checkBlockChanges(BEAT.id, [{ op: "block_add", blockId: LATE_CRATE_NIGHTS_ID, startsAt: at("20:30"), endsAt: at("22:00") }], { t, boundary: t, tooSoon: "That's in the past." });
    expect(r.problems).toEqual([{ index: 0, code: "too_soon", message: "That's in the past." }]);
    const later = checkBlockChanges(BEAT.id, [{ op: "block_add", blockId: LATE_CRATE_NIGHTS_ID, startsAt: at("+7 20:30"), endsAt: at("+7 22:00") }], { t, boundary: t, tooSoon: "" });
    expect(later.problems).toEqual([{ index: 0, code: "block_overlap", message: "Blocks can't overlap: Late Crate Nights is on until 9:00 pm." }]);
    expect(later.lines.get(0)).toBe("Late Crate Nights added, Sat 8:30 pm to 10:00 pm");
  });

  it("draw the span with its members, the second one running to 8:59 pm", () => {
    const [span] = spanViews(BEAT.id, at("18:00"), at("22:00"));
    expect(span).toMatchObject({ name: "Late Crate Nights", startsAt: at("20:00"), endsAt: at("21:00"), airsFrom: at("20:00"), airsUntil: at("20:59"), problems: [] });
    expect(span.entryIds).toHaveLength(2);
  });
});
