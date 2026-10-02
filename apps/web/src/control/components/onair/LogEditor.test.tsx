// Edit mode on the program log (the user's request of 2026-09-29), on the mocks at the reference
// Saturday, 8:42 pm: BEAT on air with Saturday Reel airing. "Edit log" for owners and operators;
// moving a program by dragging it or typing a start (snapped with the 4-second rule), the draft
// summed up with its problems and dead air before anything goes out, publishing it all at once or
// discarding it, what's airing locked, a stale draft refused, and the history after.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { setupServer } from "msw/node";
import type { LogChange, LogEntry } from "@opencast/contracts";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { handlers } from "../../mocks/handlers";
import { getDb, resetDb, saveDb } from "../../mocks/db";
import { BEAT } from "../../mocks/fixtures/stations";
import { LogPage } from "./LogPage";
import { dragTo, draftEntries, lockOf, rippleFrom, typedTime, withChange } from "./logEdit";
import { renderWithApi, signInAs, stubMatchMedia } from "./testing";

// jsdom has no PointerEvent: a mouse event with a pointer id stands in.
class TestPointerEvent extends MouseEvent {
  pointerId = 1;
}

const server = setupServer(...handlers);
beforeAll(() => {
  stubMatchMedia();
  (window as unknown as { PointerEvent: typeof TestPointerEvent }).PointerEvent ??= TestPointerEvent;
  server.listen({ onUnhandledRequest: "bypass" });
});
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
  sessionStorage.clear();
  signInAs("kai@example.com");
});
afterEach(() => server.resetHandlers());

const Z = (hms: string, day = "27") => `2026-09-${day}T${hms}.000Z`;

describe("the draft, worked out", () => {
  const entry = (id: string, startsAt: string, endsAt: string): LogEntry => ({ id, kind: "program", code: "PGM", startsAt, endsAt, title: id, episodeTitle: null, itemId: null, programId: null, liveSourceId: null, carriedFrom: null, carriageAgreementId: null, repeatGroupId: null, localNote: null });

  it("a drag moves to the nearest whole minute, a segment boundary", () => {
    // 1.12 px a minute: 11.2 px is ten minutes; 12 px is 10.7, so 11.
    expect(dragTo(Z("05:00:00"), 11.2, 1.12)).toBe(Z("05:10:00"));
    expect(dragTo(Z("05:00:00"), 12, 1.12)).toBe(Z("05:11:00"));
    expect(dragTo(Z("05:30:28"), -33.6, 1.12)).toBe(Z("05:00:00"));
  });

  it("a typed time is snapped to the nearest 4 seconds, on the broadcast day it's near", () => {
    // Saturday evening, Pacific: 10:10:43 pm is 5:10:44 UTC Sunday.
    expect(typedTime("22:10:43", Z("05:00:00"))).toBe(Z("05:10:44"));
    expect(typedTime("10:10 pm", Z("05:00:00"))).toBe(Z("05:10:00"));
    // After midnight is still Saturday night.
    expect(typedTime("1:30", Z("05:00:00"))).toBe(Z("08:30:00"));
    expect(typedTime("25:00", Z("05:00:00"))).toBeNull();
    expect(typedTime("soon", Z("05:00:00"))).toBeNull();
  });

  it("keeps one change of a kind per entry, and a removal drops what was drafted for it", () => {
    let changes: LogChange[] = [];
    changes = withChange(changes, { op: "move", entryId: "a", startsAt: Z("05:00:00") });
    changes = withChange(changes, { op: "move", entryId: "a", startsAt: Z("05:10:00") });
    expect(changes).toEqual([{ op: "move", entryId: "a", startsAt: Z("05:10:00") }]);
    changes = withChange(changes, { op: "remove", entryId: "a" });
    expect(changes).toEqual([{ op: "remove", entryId: "a" }]);
    // An insert's own move changes the insert.
    changes = withChange(changes, { op: "insert", key: "k1", entry: { kind: "program", startsAt: Z("06:00:00"), itemId: "i" } });
    changes = withChange(changes, { op: "move", entryId: "new:k1", startsAt: Z("06:30:00") });
    expect(changes[1]).toEqual({ op: "insert", key: "k1", entry: { kind: "program", startsAt: Z("06:30:00"), itemId: "i" } });
  });

  it("draws the draft: a move keeps the length, an insert takes its item's length in whole minutes", () => {
    const drafted = draftEntries(
      [entry("a", Z("05:00:00"), Z("05:30:00")), entry("b", Z("05:30:00"), Z("06:00:00"))],
      [
        { op: "move", entryId: "a", startsAt: Z("04:00:00") },
        { op: "insert", key: "k", entry: { kind: "program", startsAt: Z("05:00:00"), itemId: "x" } }
      ],
      () => ({ id: "x", title: "Crate Talk", durationMs: 14.2 * 60_000 })
    );
    expect(drafted.map((e) => [e.title, e.startsAt, e.endsAt, e.change])).toEqual([
      ["a", Z("04:00:00"), Z("04:30:00"), "moved"],
      ["Crate Talk", Z("05:00:00"), Z("05:15:00"), "inserted"],
      ["b", Z("05:30:00"), Z("06:00:00"), undefined]
    ]);
  });

  it("putting something on moves what follows down just enough, up to a gap", () => {
    const list = [entry("a", Z("05:00:00"), Z("05:30:00")), entry("b", Z("05:30:00"), Z("06:00:00")), entry("c", Z("07:00:00"), Z("07:30:00"))];
    expect(rippleFrom(list, Z("05:00:00"), 15 * 60_000, () => false)).toEqual([
      { op: "move", entryId: "a", startsAt: Z("05:15:00") },
      { op: "move", entryId: "b", startsAt: Z("05:45:00") }
    ]);
    // Something locked stays put.
    expect(rippleFrom(list, Z("05:00:00"), 15 * 60_000, (e) => e.id === "a")).toEqual([]);
  });

  it("locks what's airing and anything inside the lead, in the API's words", () => {
    const t = Date.parse(Z("03:42:12"));
    expect(lockOf({ startsAt: Z("03:30:00"), endsAt: Z("03:59:00") }, t, true)).toBe("On air now, too late to change.");
    expect(lockOf({ startsAt: Z("03:42:31"), endsAt: Z("03:59:00") }, t, true)).toBe("Airs in 19 s, too late to change.");
    expect(lockOf({ startsAt: Z("03:42:36"), endsAt: Z("03:59:00") }, t, true)).toBeNull();
    // Off air, only what's started.
    expect(lockOf({ startsAt: Z("03:42:32"), endsAt: Z("03:59:00") }, t, false)).toBeNull();
  });
});

function page(canEdit = true) {
  return renderWithApi(<LogPage stationId={BEAT.id} station={BEAT} base="/control/beat" canEdit={canEdit} />, { path: "/?view=evening&day=sat" });
}

/** A block on the edit timeline, by its title. */
async function block(title: string) {
  const tl = await screen.findByRole("list", { name: "The log, being edited" });
  return within(tl).getByText(title).closest("button") as HTMLElement;
}

async function edit() {
  fireEvent.click(await screen.findByRole("button", { name: "Edit log" }));
  await screen.findByText("Editing the log.");
}

describe("edit mode", () => {
  it("is for owners and operators", async () => {
    page(false);
    await screen.findByText("Dead air from 11:40 pm to 2:00 am.");
    expect(screen.queryByRole("button", { name: "Edit log" })).toBeNull();
  });

  it("opens with nothing to publish yet", async () => {
    page();
    await edit();
    expect(screen.getByText("No changes yet. Drag a program to move it, or pick one to change it.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Publish changes" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("moves a program to a typed start, sums it up with the dead air it leaves, and publishes it", async () => {
    page();
    await edit();
    fireEvent.click(await block("Slow Hours"));
    const start = await screen.findByLabelText("Starts at");
    expect((start as HTMLInputElement).value).toBe("22:30:28");
    fireEvent.change(start, { target: { value: "11:00 pm" } });
    fireEvent.blur(start);
    expect(await screen.findByText("1 change: Slow Hours moves to 11:00 pm")).toBeTruthy();
    expect(screen.getByText("Dead air from 10:30 pm to 11:00 pm (30 min).")).toBeTruthy();
    const publish = screen.getByRole("button", { name: "Publish changes" }) as HTMLButtonElement;
    await waitFor(() => expect(publish.disabled).toBe(false));
    fireEvent.click(publish);
    expect(await screen.findByText("1 change published.")).toBeTruthy();
    expect(getDb().log.find((e) => e.title === "Slow Hours" && e.stationId === BEAT.id)!.startsAt).toBe(Z("06:00:00"));
    // Out of edit mode, with the history.
    expect(await screen.findByText(/^Last changed by Kai M\. at 8:4\d pm$/)).toBeTruthy();
    expect(screen.getByText("1 change: Slow Hours moves to 11:00 pm")).toBeTruthy();
    expect(screen.queryByText("Editing the log.")).toBeNull();
  });

  it("moves a program by dragging it, to the nearest minute", async () => {
    page();
    await edit();
    const late = await block("Late Crate, ep. 15");
    // 1.12 px a minute: 22.4 px down is 20 minutes.
    fireEvent.pointerDown(late, { clientY: 100 });
    fireEvent.pointerMove(late, { clientY: 110 });
    fireEvent.pointerUp(late, { clientY: 122.4 });
    expect(await screen.findByText("1 change: Late Crate, ep. 15 moves to 10:20 pm")).toBeTruthy();
    // It now runs into Slow Hours: a problem, and nothing can be published.
    expect(await screen.findByText("Late Crate, ep. 15 moves to 10:20 pm: Late Crate, ep. 15 would overlap Slow Hours at 10:30 pm.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Publish changes" }) as HTMLButtonElement).disabled).toBe(true);
    // Undo takes it back out.
    fireEvent.click(screen.getByRole("button", { name: "Undo: Late Crate, ep. 15 moves to 10:20 pm" }));
    expect(await screen.findByText("No changes yet. Drag a program to move it, or pick one to change it.")).toBeTruthy();
  });

  it("puts something from the library on after a program, and what follows moves down to make room", async () => {
    page();
    await edit();
    fireEvent.click(await block("Late Crate, ep. 15"));
    fireEvent.click(await screen.findByRole("button", { name: "Put on after" }));
    const dialog = await screen.findByRole("dialog");
    const first = within(await within(dialog).findByRole("radiogroup", { name: "What goes on" })).getAllByRole("radio")[0];
    fireEvent.click(first);
    fireEvent.click(within(dialog).getByRole("button", { name: "Put it on" }));
    // Late Crate, ep. 1 is 29 minutes: Slow Hours moves from 10:30:28 to 10:57:28.
    expect(await screen.findByText("2 changes: Late Crate, ep. 1 goes on at 10:28 pm, Slow Hours moves to 10:57 pm")).toBeTruthy();
  });

  it("discards the draft, and nothing changes", async () => {
    page();
    await edit();
    fireEvent.click(await block("Slow Hours"));
    fireEvent.click(await screen.findByRole("button", { name: "Take off the log" }));
    expect(await screen.findByText("1 change: Slow Hours at 10:30 pm comes off the log")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.queryByText("Editing the log.")).toBeNull());
    expect(getDb().log.some((e) => e.title === "Slow Hours" && e.stationId === BEAT.id)).toBe(true);
    expect(sessionStorage.getItem(`oc-log-draft:${BEAT.id}`)).toBeNull();
  });

  it("locks what's airing now: no fields, and nothing moves when it's dragged", async () => {
    page();
    await edit();
    const reel = await block("Saturday Reel");
    fireEvent.pointerDown(reel, { clientY: 100 });
    fireEvent.pointerMove(reel, { clientY: 130 });
    fireEvent.pointerUp(reel, { clientY: 130 });
    fireEvent.click(reel);
    expect(await screen.findByText("On air now, too late to change.")).toBeTruthy();
    expect(screen.queryByLabelText("Starts at")).toBeNull();
    expect(screen.getByText("No changes yet. Drag a program to move it, or pick one to change it.")).toBeTruthy();
  });

  it("says when someone else changed the log since the draft began, and reloads", async () => {
    page();
    await edit();
    // Someone else moves Late Crate, ep. 15 while the draft is open.
    await act(async () => {
      const late = getDb().log.find((e) => e.title === "Late Crate, ep. 15" && e.stationId === BEAT.id)!;
      late.localNote = "moved";
      late.startsAt = Z("05:00:04");
      saveDb();
    });
    fireEvent.click(await block("Slow Hours"));
    fireEvent.click(await screen.findByRole("button", { name: "Take off the log" }));
    expect(await screen.findByText("The log changed since you started editing.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(await screen.findByText("No changes yet. Drag a program to move it, or pick one to change it.")).toBeTruthy();
    expect(getDb().log.some((e) => e.title === "Slow Hours" && e.stationId === BEAT.id)).toBe(true);
  });
});
