// The program log's off air (G9): planned off air is drawn as its own calm band, "Off air" with
// when the station is back, never as dead air, and nothing warns about it. A one-off sign-off reads
// as one. On the mocks at the reference Saturday, 8:42 pm: BEAT signs off every night 2:00 to
// 6:00 am (its overnight repeats run until 4:00), and tomorrow night it signs off at 11:00 pm.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { setupServer } from "msw/node";
import { LogTimeline } from "@opencast/ui";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { handlers } from "../../mocks/handlers";
import { resetDb } from "../../mocks/db";
import { BEAT } from "../../mocks/fixtures/stations";
import { LogPage, OFF_AIR_MARK, timelineBlocks } from "./LogPage";
import { renderWithApi, signInAs, stubMatchMedia } from "./testing";

const server = setupServer(...handlers);
beforeAll(() => {
  stubMatchMedia();
  server.listen({ onUnhandledRequest: "bypass" });
});
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
  signInAs("kai@example.com");
});
afterEach(() => server.resetHandlers());

const T = (hhmm: string) => `2026-09-27T${hhmm}:00.000Z`;

describe("the log's timeline, off air", () => {
  const log = {
    entries: [
      { id: "slow", kind: "program" as const, code: "PGM" as const, startsAt: T("05:30"), endsAt: T("06:40"), title: "Slow Hours", episodeTitle: null, itemId: null, programId: null, liveSourceId: null, carriedFrom: null, carriageAgreementId: null, repeatGroupId: null, localNote: null },
      { id: "signoff", kind: "off_air" as const, code: "OPEN" as const, startsAt: T("06:40"), endsAt: T("09:00"), title: "Off air", episodeTitle: null, itemId: null, programId: null, liveSourceId: null, carriedFrom: null, carriageAgreementId: null, repeatGroupId: null, localNote: null }
    ],
    breaks: [],
    // Dead air after 1:00 pm UTC (6:00 am Pacific), none inside the planned off air.
    gaps: [{ startsAt: T("13:00"), endsAt: T("14:00") }],
    offAir: [
      { startsAt: T("06:40"), endsAt: T("09:00"), backAt: T("13:00"), source: "sign_off" as const, logEntryId: "signoff" },
      { startsAt: T("09:00"), endsAt: T("13:00"), backAt: T("13:00"), source: "hours" as const, logEntryId: null }
    ]
  };

  it("draws the hours and a sign-off as off air, with when the station is back, and dead air as dead air", () => {
    const blocks = timelineBlocks(log, T("05:00"), T("14:00"), Date.parse(T("03:42")));
    expect(blocks.map((b) => [b.id, b.kind, b.code])).toEqual([
      ["slow", "pgm", "PGM"],
      ["signoff", "pgm", "OPEN"],
      [`off:${T("09:00")}`, "pgm", "OPEN"],
      [`gap:${T("13:00")}`, "dead", undefined]
    ]);
    expect(blocks[1].source).toBe("Sign off at 11:40 pm. Back at 6:00 am");
    expect(blocks[2].source).toBe("Off air hours. Back at 6:00 am");
  });

  it("marks the off air band so it's drawn calmly, never as dead air", () => {
    const blocks = timelineBlocks(log, T("05:00"), T("14:00"), Date.parse(T("03:42")));
    const { container } = render(<LogTimeline blocks={blocks} from={T("05:00")} to={T("14:00")} timeZone="America/Los_Angeles" />);
    const off = container.querySelectorAll(`.${OFF_AIR_MARK}`);
    expect(off).toHaveLength(2);
    for (const el of off) {
      const blk = el.closest(".oc-blk")!;
      expect(blk.className).not.toContain("oc-blk--dead");
      expect(blk.textContent).toMatch(/^OPENOff air (Sign off at 11:40 pm|Off air hours)\. Back at 6:00 am, /);
    }
    // One dead air block: the real gap after the station is back.
    expect(screen.getAllByText(/^Dead air, /)).toHaveLength(1);
  });

  it("still draws a sign-off entry as off air when the API has no off air spans", () => {
    const blocks = timelineBlocks({ ...log, offAir: undefined }, T("05:00"), T("14:00"), Date.parse(T("03:42")));
    const b = blocks.find((x) => x.id === "signoff")!;
    expect(b).toMatchObject({ kind: "pgm", code: "OPEN", source: "Viewers see \"Off air\" and when you're back" });
  });
});

describe("the program log on the mocks", () => {
  it("draws BEAT's off air hours after the overnight repeats, and warns only about the real dead air", async () => {
    renderWithApi(<LogPage stationId={BEAT.id} station={BEAT} base="/control/beat" />, { path: "/?view=day&day=sat" });
    expect(await screen.findByText("Off air hours. Back at 6:00 am")).toBeTruthy();
    // The one warning is the frame's: 11:40 pm to 2:00 am. Nothing about 4:00 to 6:00 am.
    expect(await screen.findByText("Dead air from 11:40 pm to 2:00 am.")).toBeTruthy();
    expect(screen.queryByText(/Dead air from .*6:00 am/)).toBeNull();
    expect(screen.getAllByText(/^Dead air, /)).toHaveLength(1);
  });

  it("shows tomorrow night's sign-off as a sign-off, back when the hours end", async () => {
    renderWithApi(<LogPage stationId={BEAT.id} station={BEAT} base="/control/beat" />, { path: "/?view=day&day=sun" });
    const source = await screen.findByText("Sign off at 11:00 pm. Back at 6:00 am");
    const blk = source.closest(".oc-blk")!;
    expect(within(blk as HTMLElement).getByText("Off air")).toBeTruthy();
    expect(blk.className).not.toContain("oc-blk--dead");
  });
});
