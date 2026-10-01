// The phone remote's Guide drives the TV's guide (the user's report, 2026-09-29: it opened the
// phone's own guide while a TV was being driven). Guide sends `guide` to the TV; the arrows and OK,
// always on the remote (2026-09-30), move and choose there, and Back closes it; the phone's guide
// stays one tap away.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

vi.mock("../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, controlUrl: "http://control.test", tvUrl: "http://tv.test", mockClock: "2026-09-27T03:42:00Z" }
}));

const BEAT = {
  station: { id: "00000000-0000-4000-8000-000000000012", kind: "station", callSign: "BEAT", handle: "beat", name: "Inland Beat", colour: "#8C3B7A", band: "tv", channel: "12.1", marketSlug: "inland-empire", homeCity: "Redlands" },
  onAir: true,
  now: null,
  next: null,
  playback: { kind: "hls", url: "/hls/beat/index.m3u8" }
};
const REEL = { ...BEAT, station: { ...BEAT.station, id: "00000000-0000-4000-8000-000000000024", callSign: "REEL", handle: "reel", name: "Reel", channel: "24.1" } };

const tv = { receiver: { stationId: BEAT.station.id, paused: false, changedBy: null, sleepEndsAt: null } };
const sent: unknown[] = [];
let session: unknown;
vi.mock("../cast/session", () => ({
  useCastSession: () => session,
  receiverOf: (s: { receiver?: unknown }) => s.receiver ?? null,
  sendToTv: (c: unknown) => void sent.push(c),
  startCast: vi.fn(),
  stopCasting: vi.fn()
}));
vi.mock("../cast/mirroring", () => ({ getMirroring: async () => null, batteryLine: () => null }));
vi.mock("../cast/useCast", () => ({ findTargets: async () => [], hideMirrorGuide: vi.fn(), useCastIntro: () => ({ from: "Kai's phone", marketSlug: "inland-empire", othersCanChange: true }) }));
vi.mock("../data/viewer", () => ({
  useChannels: () => [BEAT, REEL],
  useLastChannelId: () => null,
  useMarketSlug: () => "inland-empire",
  usePresets: () => ({ presets: [] }),
  useViewerActions: () => ({ savePreset: vi.fn() })
}));
vi.mock("../layout/shell", () => ({ useIsPhone: () => true, useShellOptions: () => {} }));
vi.mock("../player/PlayerRoot", () => ({ useNowPlaying: () => ({ row: null, playing: false }) }));
vi.mock("../components/remote/Mirroring", () => ({ MirrorGuideSheet: () => null, MirrorStoppedSheet: () => null, PictureBehind: () => null }));
vi.mock("../components/remote/WatchOnSheet", () => ({ mirrorGuideHref: (n: string) => `/remote/mirror-guide?tv=${n}` }));

const { default: RemotePage } = await import("./Remote");

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

function show() {
  return render(
    <MemoryRouter initialEntries={["/remote"]}>
      <Routes>
        <Route path="/remote" element={<RemotePage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  sent.length = 0;
  tv.receiver = { stationId: BEAT.station.id, paused: false, changedBy: null, sleepEndsAt: null };
});

describe.each([
  ["the TV app (relay)", { status: "casting", target: { id: "den", name: "Den TV", kind: "tv_app" }, me: "Kai's phone" }],
  ["a Chromecast", { status: "casting", target: { id: "l", name: "Living room TV", kind: "chromecast" }, me: "Kai's phone" }],
  ["a mirrored TV", { status: "mirroring", target: { id: "airplay:Bedroom TV", name: "Bedroom TV", kind: "airplay" } }]
])("driving %s", (_name, s) => {
  beforeEach(() => {
    session = { ...s, receiver: tv.receiver };
  });

  it("Guide opens the guide on the TV, not the phone's", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Guide" }));
    expect(sent).toEqual([{ type: "guide" }]);
    expect(screen.queryByTestId("where")).toBeNull();
  });

  it("the arrows and OK are always there beside the rockers, on the TV's picture too", () => {
    show();
    expect(screen.getByRole("group", { name: "Channel" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Arrows" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Right" }));
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(sent).toEqual([{ type: "focus", dir: "right" }, { type: "select" }]);
    // Last is the play rocker's, once.
    expect(screen.getAllByRole("button", { name: /^Last/ }).map((b) => b.getAttribute("aria-label"))).toEqual(["Last channel"]);
  });

  it("while the TV's guide is open, the pad moves and chooses there; Back and Guide close it", () => {
    show();
    const guide = screen.getByRole("button", { name: "Guide" });
    fireEvent.click(guide);
    expect(guide.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("group", { name: "Guide on the TV" })).toBeTruthy();
    // The rockers stay.
    expect(screen.getByRole("group", { name: "Channel" })).toBeTruthy();
    for (const name of ["Up", "Down", "Left", "Right", "OK"]) fireEvent.click(screen.getByRole("button", { name }));
    expect(sent.slice(1)).toEqual([
      { type: "focus", dir: "up" },
      { type: "focus", dir: "down" },
      { type: "focus", dir: "left" },
      { type: "focus", dir: "right" },
      { type: "select" }
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(sent.at(-1)).toEqual({ type: "back" });
    expect(guide.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("group", { name: "Arrows" })).toBeTruthy();
    // Guide again: open, then pressed again, closed (as the TV's Guide key does).
    fireEvent.click(guide);
    fireEvent.click(guide);
    expect(sent.slice(-2)).toEqual([{ type: "guide" }, { type: "guide" }]);
    expect(screen.queryByRole("group", { name: "Guide on the TV" })).toBeNull();
  });

  it("Guide lets go when the TV's guide tunes another station (OK on what's on closes it there)", () => {
    const r = show();
    fireEvent.click(screen.getByRole("button", { name: "Guide" }));
    expect(screen.getByRole("group", { name: "Guide on the TV" })).toBeTruthy();
    session = { ...s, receiver: { ...tv.receiver, stationId: REEL.station.id } };
    r.rerender(
      <MemoryRouter initialEntries={["/remote"]}>
        <Routes>
          <Route path="/remote" element={<RemotePage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.queryByRole("group", { name: "Guide on the TV" })).toBeNull();
    expect(screen.getByRole("button", { name: "Guide" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("the phone's own guide is still there, as a second way", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Guide on this phone" }));
    expect(screen.getByTestId("where").textContent).toBe("/guide");
    expect(sent).toEqual([]);
  });
});
