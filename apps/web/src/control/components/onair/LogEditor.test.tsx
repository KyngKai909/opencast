// Edit mode on the program log (the user's request of 2026-09-29; A246's rundown, tray and drawer),
// on the mocks at the reference Saturday, 8:42 pm: BEAT on air with Saturday Reel airing. "Edit" for
// owners and operators; moving a program by dragging it, the arrow keys or typing a start (snapped
// with the 4-second rule), keeping one at its time (G18), the draft summed up in the tray with its
// problems and dead air before anything goes out, publishing it all at once (with the change record)
// or discarding it, what's airing locked, a draft from before someone else's change reloaded and
// kept, and quick fill joining a draft.

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

  it("keeps one mark per entry, and an insert takes its own (G18)", () => {
    let changes: LogChange[] = withChange([], { op: "keep", entryId: "a", keep: true });
    changes = withChange(changes, { op: "keep", entryId: "a", keep: false });
    expect(changes).toEqual([{ op: "keep", entryId: "a", keep: false }]);
    changes = withChange([{ op: "insert", key: "k1", entry: { kind: "program", startsAt: Z("06:00:00"), itemId: "i" } }], { op: "keep", entryId: "new:k1", keep: true });
    expect(changes).toEqual([{ op: "insert", key: "k1", entry: { kind: "program", startsAt: Z("06:00:00"), itemId: "i", keepTime: true } }]);
    const drafted = draftEntries([entry("a", Z("05:00:00"), Z("05:30:00"))], [{ op: "keep", entryId: "a", keep: true }], () => undefined);
    expect([drafted[0].keepTime, drafted[0].change]).toEqual([true, undefined]);
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
    // Something locked, or kept at its time, stays put.
    expect(rippleFrom(list, Z("05:00:00"), 15 * 60_000, (e) => e.id === "a")).toEqual([]);
    expect(rippleFrom(list.map((e) => (e.id === "b" ? { ...e, keepTime: true } : e)), Z("05:00:00"), 15 * 60_000, () => false)).toEqual([{ op: "move", entryId: "a", startsAt: Z("05:15:00") }]);
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

function page(canEdit = true, path = "/?day=sat") {
  return renderWithApi(<LogPage stationId={BEAT.id} station={BEAT} base="/control/beat" canEdit={canEdit} />, { path });
}

const beat = (title: string) => getDb().log.find((e) => e.title === title && e.stationId === BEAT.id && e.localNote !== "Overnight repeat")!;

/** The tray at the foot. */
const tray = () => screen.findByRole("region", { name: "Your changes" });

/** A row of the rundown being edited, by its title. */
async function row(title: string) {
  const list = await screen.findByRole("list", { name: "The rundown, being edited" });
  return within(list).getAllByText(title, { selector: "b" })[0].closest("li") as HTMLElement;
}

async function edit() {
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  await screen.findByRole("list", { name: "The rundown, being edited" });
}

async function publish(name: string) {
  const t = await tray();
  const button = within(t).getByRole("button", { name }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
}

describe("edit mode", () => {
  it("is for owners and operators", async () => {
    page(false);
    await screen.findByText("Dead air at 11:40 pm, 2 hr 20 min");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });

  it("opens with nothing to publish yet, and says how", async () => {
    page();
    await edit();
    expect(screen.queryByRole("region", { name: "Your changes" })).toBeNull();
    expect(screen.getByText("Editing Saturday, Sep 26")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Done editing" })).toBeTruthy();
  });

  it("moves a program to a typed start, checks it with the dead air it leaves, and publishes it with the record", async () => {
    page();
    await edit();
    fireEvent.click(within(await row("Slow Hours")).getByRole("button", { name: /^Slow Hours/ }));
    const start = await screen.findByLabelText("Starts at");
    expect((start as HTMLInputElement).value).toBe("22:30:28");
    fireEvent.change(start, { target: { value: "11:00 pm" } });
    fireEvent.blur(start);
    const t = await tray();
    expect(await within(t).findByText("1 change, checked: nothing blocks publishing")).toBeTruthy();
    expect(within(t).getByText("Slow Hours moves to 11:00 pm")).toBeTruthy();
    expect(within(t).getByText("Dead air from 10:30 pm to 11:00 pm (30 min).")).toBeTruthy();
    // The row says where it was.
    expect(within(await row("Slow Hours")).getByText(/Moved from 10:30 pm/)).toBeTruthy();
    await publish("Publish 1 change");
    expect(await screen.findByText("1 change published.")).toBeTruthy();
    expect(beat("Slow Hours").startsAt).toBe(Z("06:00:00"));
    // Out of edit mode, with the change record.
    expect(await screen.findByText(/^Published: 1 change, by Kai M\. at 8:4\d pm$/)).toBeTruthy();
    expect(screen.getByText("Slow Hours moves to 11:00 pm", { selector: "li" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "The rundown, being edited" })).toBeNull();
  });

  it("moves a program a place with the arrow keys, and a live block stops what it pushes: the overlap blocks publishing", async () => {
    page();
    await edit();
    fireEvent.keyDown(await screen.findByRole("button", { name: "Move Late Crate, ep. 15, 10:00 pm" }), { key: "ArrowUp" });
    const t = await tray();
    expect(await within(t).findByText("1 change, checked: 1 problem blocks publishing")).toBeTruthy();
    expect(within(t).getByText("Late Crate, ep. 15 moves to 9:01 pm: Late Crate, ep. 15 would overlap Beat Tape Live at 9:01 pm.")).toBeTruthy();
    expect((within(t).getByRole("button", { name: "Publish 1 change" }) as HTMLButtonElement).disabled).toBe(true);
    // Undo takes it back out.
    fireEvent.click(within(t).getByRole("button", { name: "Undo: Late Crate, ep. 15 moves to 9:01 pm" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Your changes" })).toBeNull());
  });

  it("drags a program to after another, and the rows below shift down", async () => {
    page();
    await edit();
    const list = await screen.findByRole("list", { name: "The rundown, being edited" });
    // jsdom lays nothing out: each row is 40 px, in order.
    list.querySelectorAll<HTMLElement>("li[data-row]").forEach((li, i) => {
      li.getBoundingClientRect = () => ({ top: i * 40, height: 40, bottom: i * 40 + 40, left: 0, right: 800, width: 800, x: 0, y: i * 40, toJSON: () => ({}) });
    });
    const rows = [...list.querySelectorAll<HTMLElement>("li[data-row]")];
    const below = rows.findIndex((li) => li.textContent?.includes("Late Crate, ep. 12"));
    const handle = screen.getByRole("button", { name: "Move Late Crate, ep. 13, 2:30 am" });
    // Dragged up to just above Late Crate, ep. 12: right after the dead air's program, Slow Hours (carried, it stays).
    fireEvent.pointerDown(handle, { clientY: (below + 1) * 40 + 20 });
    fireEvent.pointerMove(handle, { clientY: below * 40 + 10 });
    fireEvent.pointerMove(handle, { clientY: below * 40 + 5 });
    fireEvent.pointerUp(handle, { clientY: below * 40 + 5 });
    const t = await tray();
    expect(await within(t).findByText("Late Crate, ep. 13 moves to Sat 11:40 pm")).toBeTruthy();
  });

  it("keeps a program at its time: the tray says so, its start can't be typed, and it's published", async () => {
    page();
    await edit();
    fireEvent.click(await screen.findByRole("button", { name: "Keep Late Crate, ep. 15, 10:00 pm, at this time" }));
    const t = await tray();
    expect(await within(t).findByText("Late Crate, ep. 15 keeps its time")).toBeTruthy();
    expect(within(await row("Late Crate, ep. 15")).getByText("Kept at this time")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Move Late Crate, ep. 15, 10:00 pm" })).toBeNull();
    fireEvent.click(within(await row("Late Crate, ep. 15")).getByRole("button", { name: /^Late Crate, ep\. 15/ }));
    expect(((await screen.findByLabelText("Starts at")) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Kept at this time. Turn it off to move it.")).toBeTruthy();
    await publish("Publish 1 change");
    expect(await screen.findByText("1 change published.")).toBeTruthy();
    expect(beat("Late Crate, ep. 15").keepTime).toBe(true);
  });

  it("removes a row, struck through until it's published; Discard leaves the log as it was", async () => {
    page();
    await edit();
    fireEvent.click(await screen.findByRole("button", { name: "Remove Slow Hours, 10:30 pm" }));
    const t = await tray();
    expect(await within(t).findByText("Slow Hours at 10:30 pm comes off the log")).toBeTruthy();
    expect(within(await row("Slow Hours")).getByText("Coming off the log")).toBeTruthy();
    fireEvent.click(within(t).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.queryByRole("list", { name: "The rundown, being edited" })).toBeNull());
    expect(getDb().log.some((e) => e.title === "Slow Hours" && e.stationId === BEAT.id)).toBe(true);
    expect(sessionStorage.getItem(`oc-log-draft:${BEAT.id}`)).toBeNull();
  });

  it("locks what's airing now: no handle, no fields, and the reason on the row", async () => {
    page();
    await edit();
    const reel = await row("Saturday Reel");
    expect(within(reel).getByText("On air now, too late to change.")).toBeTruthy();
    expect(within(reel).getByText("locked")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Move Saturday Reel, 8:30 pm" })).toBeNull();
    fireEvent.click(within(reel).getByRole("button", { name: /^Saturday Reel/ }));
    expect(await screen.findByText("On air now, too late to change.", { selector: ".cc-edit__lock" })).toBeTruthy();
    expect(screen.queryByLabelText("Starts at")).toBeNull();
  });

  it("when someone else changed the day meanwhile, reloads it and keeps the draft, checked again", async () => {
    page();
    await edit();
    fireEvent.click(await screen.findByRole("button", { name: "Remove Slow Hours, 10:30 pm" }));
    await within(await tray()).findByText("1 change, checked: nothing blocks publishing");
    // Someone else moves Late Crate, ep. 15 while the draft is open.
    await act(async () => {
      const late = beat("Late Crate, ep. 15");
      late.localNote = "moved";
      late.startsAt = Z("05:00:04");
      saveDb();
    });
    fireEvent.click(await screen.findByRole("button", { name: "Keep Late Crate, ep. 15, 10:00 pm, at this time" }));
    expect(await screen.findByText("The log changed since you started editing.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reload and keep my changes" }));
    const t = await tray();
    expect(await within(t).findByText("2 changes, checked: nothing blocks publishing")).toBeTruthy();
    expect(within(t).getByText("Slow Hours at 10:30 pm comes off the log")).toBeTruthy();
    await publish("Publish 2 changes");
    expect(await screen.findByText("2 changes published.")).toBeTruthy();
    expect(getDb().log.some((e) => e.title === "Slow Hours" && e.stationId === BEAT.id)).toBe(false);
  });
});

describe("the Add drawer", () => {
  it("adds from the library into dead air, as a change in the draft", async () => {
    page();
    await edit();
    fireEvent.click(await screen.findByRole("button", { name: /^Fill/ }));
    const drawer = await screen.findByRole("dialog", { name: "Add at 11:40 pm" });
    expect(within(drawer).getByText("2 hr 20 min free, until Late Crate, ep. 12 at 2:00 am")).toBeTruthy();
    fireEvent.change(within(drawer).getByLabelText("Search your library"), { target: { value: "Late Crate, ep. 1" } });
    fireEvent.click(within(drawer).getByRole("button", { name: /^Late Crate, ep\. 1 29:00\. Leaves 1 hr 51 min Fits/ }));
    const t = await tray();
    expect(await within(t).findByText("Late Crate, ep. 1 goes on at 11:40 pm")).toBeTruthy();
  });

  it("quick fill with nothing drafted is written at once", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: /^Fill/ }));
    let drawer = await screen.findByRole("dialog", { name: "Add at 11:40 pm" });
    fireEvent.click(within(drawer).getByRole("button", { name: "Sign off" }));
    expect(await screen.findByText("Off air from 11:40 pm to 2:00 am.")).toBeTruthy();
    expect(getDb().log.some((e) => e.kind === "off_air" && e.startsAt === Z("06:40:00"))).toBe(true);
  });

  it("with changes drafted, repeating from the library joins the draft as inserts", async () => {
    page();
    await edit();
    fireEvent.click(await screen.findByRole("button", { name: "Remove Slow Hours, 10:30 pm" }));
    await within(await tray()).findByText("1 change, checked: nothing blocks publishing");
    fireEvent.click(screen.getAllByRole("button", { name: /^Fill/ })[0]);
    const drawer = await screen.findByRole("dialog", { name: /^Add at 10:28 pm$/ });
    fireEvent.click(within(drawer).getByRole("button", { name: "Fill" }));
    const t = await tray();
    expect(await within(t).findByText(/^\d+ changes, checked/)).toBeTruthy();
    expect(within(t).getAllByText(/goes on at/).length).toBeGreaterThan(0);
    expect(getDb().log.some((e) => e.title === "Slow Hours" && e.stationId === BEAT.id)).toBe(true);
  });
});
