// A244: programming blocks in master control, on the mocks at the reference Saturday, 8:42 pm.
// BEAT's Late Crate Nights is on tonight from 8:00 to 9:00 pm (Late Crate, ep. 14 and Saturday
// Reel are in it) and every Saturday from its template. The words; the Blocks page and the block
// editor; the program log's rail and its pane; edit mode's block changes as the draft keeps them;
// and the mock's checks, as the API's.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { setupServer } from "msw/node";
import { Route, Routes } from "react-router";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));
vi.mock("../../../auth/AuthProvider", async (original) => ({ ...(await original<object>()), useAuth: () => ({ getToken: async () => null }) }));

import type { ProgramBlock } from "@opencast/contracts";
import { handlers } from "../../mocks/handlers";
import { resetDb } from "../../mocks/db";
import { checkBlockChanges, LATE_CRATE_NIGHTS_ID, resetBlocks, spanViews } from "../../mocks/blocks";
import { BEAT } from "../../mocks/fixtures/stations";
import { at } from "../../mocks/fixtures/time";
import { renderWithApi, signInAs, stubMatchMedia } from "../../components/onair/testing";
import { blockRoleSupply, idLine, lengthWords, onLogLines, partLine, spanSummary, startsWords, untilWords } from "../../components/live/blocks";
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
          <Route path="/control/beat/blocks" element={<Blocks />} />
          <Route path="/control/beat/blocks/:blockId" element={<Blocks />} />
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

describe("the Blocks page and the block editor", () => {
  it("lists the station's blocks with when they're on and their next date", async () => {
    renderAt("/control/beat/blocks");
    expect(await screen.findByRole("heading", { name: "Blocks" })).toBeTruthy();
    const list = screen.getByRole("list", { name: "Your blocks" });
    expect(within(list).getByText("Late Crate Nights")).toBeTruthy();
    expect(within(list).getByText("Every Saturday, 8:00 pm to 9:00 pm")).toBeTruthy();
    expect(within(list).getByText("Not on the log yet")).toBeTruthy();
    expect(within(list).getByText(/^Next Sat/)).toBeTruthy();
  });

  it("makes a new block and opens its editor", async () => {
    renderAt("/control/beat/blocks/new");
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Saturday Matinee" } });
    fireEvent.click(screen.getByRole("button", { name: "Make the block" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Saturday Matinee" })).toBeTruthy();
    expect(screen.getByText("No intro of its own yet, so a :05 card with the block's name and logo")).toBeTruthy();
    expect(screen.getByText("No ID of its own, so your station ID airs.")).toBeTruthy();
  });

  it("turns the outro off, and archives only once it's off the log", async () => {
    renderAt(`/control/beat/blocks/${LATE_CRATE_NIGHTS_ID}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Late Crate Nights" })).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Outro" }));
    expect(await screen.findByText("No outro.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Archive Late Crate Nights" }));
    expect(await screen.findByText("Late Crate Nights is on the log 1 more time. Take it off the log first.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take it off the log and archive" }));
    await waitFor(() => expect(screen.queryByRole("heading", { level: 1, name: "Late Crate Nights" })).toBeNull());
  });
});

describe("the program log's rail", () => {
  it("draws the block beside the timeline and opens its pane", async () => {
    renderWithApi(<LogPage stationId={BEAT.id} station={BEAT} base="/control/beat" canEdit />, { path: "/control/beat/log" });
    const rail = await screen.findByRole("button", { name: "Late Crate Nights, 8:00 pm to 8:59 pm" });
    fireEvent.click(rail);
    const pane = await screen.findByRole("region", { name: "Late Crate Nights" });
    expect(within(pane).getByText("2 programs, 8:00 pm to 8:59 pm")).toBeTruthy();
    expect(within(pane).getByRole("button", { name: "Change times" })).toBeTruthy();
    expect(within(pane).getByRole("link", { name: "Edit Late Crate Nights" }).getAttribute("href")).toBe(`/control/beat/blocks/${LATE_CRATE_NIGHTS_ID}`);
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
