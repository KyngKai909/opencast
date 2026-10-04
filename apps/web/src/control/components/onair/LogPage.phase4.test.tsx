// A246 (Phase 4) on the Log tab, on the mocks at the reference Saturday, 8:42 pm. In edit mode, a
// block's start and end are handle rows: Late Crate Nights (8:00 to 9:00 pm) is on air, so only
// its end moves; a row down takes the start of the row below, and the tray's line (the dry run's)
// names who joins it. A block's "Place on the log", on a date, opens Add a block set to it. On
// the phone the rundown is the whole screen: the day and its chips on top, a break picked opens
// as a bottom sheet, dead air opens Fill's sheet, and no glance pane or Week.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { setupServer } from "msw/node";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { handlers } from "../../mocks/handlers";
import { resetDb } from "../../mocks/db";
import { LATE_CRATE_NIGHTS_ID, resetBlocks } from "../../mocks/blocks";
import { BEAT } from "../../mocks/fixtures/stations";
import { LogPage } from "./LogPage";
import { renderWithApi, signInAs, stubMatchMedia } from "./testing";

const server = setupServer(...handlers);
let web: typeof window.matchMedia;
beforeAll(() => {
  stubMatchMedia();
  web = window.matchMedia;
  server.listen({ onUnhandledRequest: "bypass" });
});
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
  resetBlocks();
  sessionStorage.clear();
  signInAs("kai@example.com");
});
afterEach(() => {
  server.resetHandlers();
  window.matchMedia = web;
});

/** The phone's width (useIsPhone). */
function asPhone() {
  window.matchMedia = ((q: string) => ({ matches: q.includes("max-width: 767px"), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
}

const log = (path = "/control/beat/schedule") => renderWithApi(<LogPage stationId={BEAT.id} station={BEAT} base="/control/beat" canEdit />, { path });

describe("a block's start and end, as handles in edit mode", () => {
  it("keeps the start of a block on air, moves its end a row with the arrow keys, and the dry run says who joins it", async () => {
    log("/control/beat/schedule?edit=1");
    const rundown = await screen.findByRole("list", { name: "The rundown, being edited" });
    expect(await within(rundown).findByText("Late Crate Nights started 8:00 pm")).toBeTruthy();
    expect(within(rundown).getByText("On air, so only its end can change")).toBeTruthy();
    expect(within(rundown).queryByRole("button", { name: /Move the start of Late Crate Nights/ })).toBeNull();
    const end = within(rundown).getByRole("button", { name: "Move the end of Late Crate Nights, now 9:00 pm" });
    expect(within(rundown).getByText("Ends 9:00 pm")).toBeTruthy();
    fireEvent.keyDown(end, { key: "ArrowDown" });
    expect(await within(rundown).findByText("Ends 10:00 pm, was 9:00 pm")).toBeTruthy();
    // Beat Tape Live starts inside it now: a member.
    await waitFor(() => expect(within(rundown).getByText("Live, so it keeps its start. Member")).toBeTruthy());
    const tray = screen.getByRole("region", { name: "Your changes" });
    expect(await within(tray).findByText("Late Crate Nights now ends at 10:00 pm, was 9:00 pm. Beat Tape Live joins it")).toBeTruthy();
    expect(within(tray).getByText("1 change, checked: nothing blocks publishing")).toBeTruthy();
  });

  it("opens Add a block set to the block a block page placed (?addBlock=)", async () => {
    log(`/control/beat/schedule?edit=1&day=2026-10-03&addBlock=${LATE_CRATE_NIGHTS_ID}`);
    const dialog = await screen.findByRole("dialog", { name: "Add a block" });
    await waitFor(() => expect((within(dialog).getByLabelText("Block") as HTMLSelectElement).value).toBe(LATE_CRATE_NIGHTS_ID));
  });
});

describe("on the phone", () => {
  it("is the rundown: the day and its chips on top, no glance pane and no Week", async () => {
    asPhone();
    log();
    expect(await screen.findByRole("list", { name: "The rundown" })).toBeTruthy();
    expect(screen.getByText("Today, Sat Sep 26")).toBeTruthy();
    expect(screen.getByRole("button", { name: "On air: Saturday Reel, 17 min left" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Tonight at a glance" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Week" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Make a template from this day" })).toBeNull();
  });

  it("opens a break as a bottom sheet", async () => {
    asPhone();
    log();
    fireEvent.click(await within(await screen.findByRole("list", { name: "The rundown" })).findByRole("button", { name: /Spots placed at 9:09 pm/ }));
    const sheet = await screen.findByRole("dialog", { name: "Break, 9:29:00 pm" });
    expect(within(sheet).getByText("Spots, placed at 9:09 pm")).toBeTruthy();
    expect(within(sheet).getByRole("img", { name: "Credit :15, Open 1:45" })).toBeTruthy();
    // The sheet's grab handle closes it, as the pane's own Close does.
    fireEvent.click(within(sheet).getAllByRole("button", { name: "Close" }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Break, 9:29:00 pm" })).toBeNull());
  });

  it("fills dead air from Fill's sheet", async () => {
    asPhone();
    log();
    fireEvent.click(await within(await screen.findByRole("list", { name: "The rundown" })).findByRole("button", { name: /^Fill/ }));
    const sheet = await screen.findByRole("dialog", { name: /^Dead air in/ });
    fireEvent.click(within(sheet).getByRole("button", { name: "Fill the gap" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /^Dead air in/ })).toBeNull());
  });
});
