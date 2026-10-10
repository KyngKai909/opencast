// The swipe home's screen (A245; swipe home 01, 03, 08): Back to live when behind (just above the
// banner while it's up, above the floating bar once it hides; the position line hides meanwhile),
// the position line, next and previous as actions for screen readers and the arrow keys, a tap
// pausing and resuming (and not the tap that gave the sound), and the five buttons' names.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { DialRowX } from "../../api/ext";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, controlUrl: "http://control.test", tvUrl: "http://tv.test", mockClock: "2026-09-27T03:42:00Z" }
}));
vi.mock("@opencast/player", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@opencast/player")>()),
  PlayerSurface: () => <div data-testid="surface" />,
  TuningStatic: () => <canvas data-testid="static" />,
  prefersReducedMotion: () => reduced
}));
let reduced = false;
const remind = vi.fn();
const save = vi.fn();
vi.mock("../../data/viewer", () => ({
  useMarkets: () => ({ data: [{ slug: "inland-empire", name: "Inland Empire" }] }),
  useMarketSlug: () => "inland-empire",
  useViewerActions: () => ({ remind }),
  usePresets: () => ({ presets: [], loading: false, onDevice: true })
}));
vi.mock("../watch/usePresetButton", () => ({ usePresetButton: () => ({ key: 1, save }) }));
vi.mock("../watch/overlay", () => ({ useOverlayParams: () => ({ open: vi.fn(), close: vi.fn(), params: new URLSearchParams() }) }));
vi.mock("../remote/WatchOnSheet", () => ({ WatchOnSheet: () => null }));
vi.mock("../watch/NotForMe", () => ({ NotForMe: () => null }));
vi.mock("../watch/parts", () => ({ SharedAiring: () => null }));
vi.mock("../watch/AirPlay", () => ({ AirPlayLine: () => null }));
vi.mock("../../cast/session", () => ({ useCastSession: () => ({ status: "idle" }) }));
vi.mock("../../cast/useCast", () => ({ watchOnOffered: () => false }));
vi.mock("../../native/haptics", () => ({ tick: vi.fn() }));
vi.mock("../../device/store", () => ({ setDevice: vi.fn() }));
vi.mock("./form", () => ({ useSwipeShell: () => {} }));
vi.mock("./useSwipeOrder", async () => {
  const { swipeOrder } = await import("@opencast/player");
  return { useSwipeOrders: () => ({ tv: swipeOrder(rows, [rows[1]!.station.id], "tv"), radio: swipeOrder(rows, [], "radio") }) };
});

let n = 0;
function row(callSign: string, channel: string): DialRowX {
  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  return {
    station: { id, kind: "station", callSign, handle: callSign.toLowerCase(), name: `${callSign} station`, colour: "#8C3B7A", band: "tv", channel, marketSlug: "inland-empire", homeCity: "Redlands" },
    onAir: true,
    now: { logEntryId: null, title: `${callSign} now`, episodeTitle: null, code: "PGM", kind: "program", startsAt: "2026-09-27T03:30:00Z", endsAt: "2026-09-27T04:00:00Z", live: false, carriedFrom: null, programId: null },
    next: { logEntryId: "le-1", title: `${callSign} next`, episodeTitle: null, code: "PGM", kind: "program", startsAt: "2026-09-27T04:00:00Z", endsAt: "2026-09-27T05:00:00Z", live: false, carriedFrom: null, programId: null },
    playback: { kind: "hls", url: `/mock-hls/${callSign.toLowerCase()}/master.m3u8` }
  } as DialRowX;
}
// Preset 1 is BEAT; then the dial: CIVC, SAZN.
const rows = [row("CIVC", "7.1"), row("BEAT", "12.1"), row("SAZN", "18.1")];
const BEAT = rows[1]!;

const { SwipeScreen } = await import("./SwipeScreen");
type W = Parameters<typeof SwipeScreen>[0]["w"];

function watch(o: { status?: string; behindLive?: boolean; banner?: boolean } = {}) {
  const engine = {
    togglePlay: vi.fn(),
    backToLive: vi.fn(),
    peek: vi.fn(() => true),
    swipeReady: vi.fn(() => true),
    tune: vi.fn(() => Promise.resolve()),
    getState: vi.fn(() => ({ mutedByBrowser: false })),
    canPlayDash: () => true,
    showAirPlayPicker: vi.fn(),
    setOptions: vi.fn()
  };
  const status = o.status ?? "playing";
  const w = {
    state: {
      status,
      behindLive: o.behindLive ?? false,
      paused: status === "paused" ? { since: Date.parse("2026-09-27T03:42:00Z"), expired: false } : null,
      currentId: BEAT.station.id,
      pendingId: null,
      banner: o.banner ? { stationId: BEAT.station.id, until: 0 } : null,
      entry: null,
      tuning: null,
      airPlay: { available: false, active: false }
    },
    engine,
    channels: rows,
    row: BEAT,
    now: BEAT.now,
    backAt: null,
    page: { data: undefined },
    program: { data: undefined },
    playing: status === "playing",
    notOnDial: false
  } as unknown as W;
  return { w, engine };
}

function show(w: W, landscape = false) {
  return render(
    <MemoryRouter>
      <SwipeScreen w={w} form={{ device: "phone", landscape }} />
    </MemoryRouter>
  );
}

const live = () => screen.queryByRole("button", { name: /^Back to live/ });

/** jsdom has no PointerEvent: a mouse event with a pointer id stands in. */
class FakePointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? "touch";
  }
}

beforeEach(() => {
  reduced = false;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  vi.stubGlobal("PointerEvent", FakePointerEvent);
});
afterEach(() => vi.unstubAllGlobals());

describe("Back to live on the swipe home", () => {
  it("isn't there at the live edge, and the position line says where you are", () => {
    show(watch().w);
    expect(live()).toBeNull();
    expect(screen.getByText("Preset 1 of 1")).toBeTruthy();
  });

  it("shows while paused, just above the banner, with how far behind; the position line hides", () => {
    const { w, engine } = watch({ status: "paused", behindLive: true, banner: true });
    show(w);
    const b = live()!;
    expect(b.className).toContain("vw-sw__live--above_banner");
    expect(b.textContent).toMatch(/behind$/);
    expect(screen.queryByText("Preset 1 of 1")).toBeNull();
    expect(screen.getByText(/^Paused at/)).toBeTruthy();
    fireEvent.click(b);
    expect(engine.backToLive).toHaveBeenCalledOnce();
  });

  it("drops to just above the floating bar once the banner hides, still behind live", () => {
    show(watch({ status: "playing", behindLive: true, banner: false }).w);
    expect(live()!.className).toContain("vw-sw__live--above_bar");
  });
});

describe("next and previous", () => {
  it("are actions for screen readers, named for where they go, and change channel with a snap", async () => {
    vi.useFakeTimers();
    const { w, engine } = watch();
    show(w);
    // From preset 1 (BEAT): next is the dial's first (CIVC), previous wraps to the end (SAZN).
    expect(screen.getByRole("button", { name: "Previous channel: SAZN 18.1" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next channel: CIVC 7.1" }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(400)));
    expect(engine.peek).not.toHaveBeenCalledWith(rows[0]!.station.id);
    expect(engine.tune).toHaveBeenCalledWith(rows[0]!.station.id, { input: "touch", via: "swipe" });
    vi.useRealTimers();
  });

  it("the arrow keys: down brings the next station, up the previous", async () => {
    vi.useFakeTimers();
    const { w, engine } = watch();
    show(w);
    fireEvent.keyDown(window, { key: "ArrowUp" });
    await act(async () => void (await vi.advanceTimersByTimeAsync(400)));
    expect(engine.tune).toHaveBeenCalledWith(rows[2]!.station.id, { input: "touch", via: "swipe" });
    vi.useRealTimers();
  });

  it("with reduced motion change channel at once (the player crossfades)", async () => {
    reduced = true;
    const { w, engine } = watch();
    show(w);
    fireEvent.click(screen.getByRole("button", { name: "Next channel: CIVC 7.1" }));
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))));
    expect(engine.tune).toHaveBeenCalledWith(rows[0]!.station.id, { input: "touch", via: "swipe" });
  });
});

describe("a tap on the picture", () => {
  const tap = (el: Element) => {
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 300 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 101, clientY: 301 });
  };

  it("pauses and resumes", () => {
    const { w, engine } = watch();
    const { container } = show(w);
    tap(container.querySelector(".vw-sw__touch")!);
    expect(engine.togglePlay).toHaveBeenCalledOnce();
  });

  it("isn't a pause when it was the tap that turned the sound on", () => {
    const { w, engine } = watch();
    engine.getState.mockReturnValue({ mutedByBrowser: true });
    const { container } = show(w);
    tap(container.querySelector(".vw-sw__touch")!);
    expect(engine.togglePlay).not.toHaveBeenCalled();
  });
});

describe("the right-hand buttons", () => {
  it("have names, never counts: the preset, Remind for what's next, Pledge, Share, Guide", () => {
    show(watch().w);
    const rail = screen.getByRole("group", { name: "This station" });
    const names = Array.from(rail.querySelectorAll("button")).map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual(["Preset 1. Open presets", "Remind me: BEAT next, 9:00 pm", "Pledge", "Share", "Guide"]);
    fireEvent.click(screen.getByRole("button", { name: /^Remind me/ }));
    expect(remind).toHaveBeenCalledWith({ airing: BEAT.next, station: BEAT.station });
  });

  it("keep their names in landscape, where the labels drop to icons", () => {
    show(watch().w, true);
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
    expect(document.querySelector(".vw-sw--land")).toBeTruthy();
  });
});

describe("the drag", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 800 });
  });
  afterEach(() => {
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  });
  const drag = (el: Element, dx: number, dy: number, ms = 400) => {
    fireEvent.pointerDown(el, { pointerId: 2, clientX: 200, clientY: 400, timeStamp: 0 });
    for (let k = 1; k <= 4; k++) fireEvent.pointerMove(el, { pointerId: 2, clientX: 200 + (dx * k) / 4, clientY: 400 + (dy * k) / 4 });
    fireEvent.pointerUp(el, { pointerId: 2, clientX: 200 + dx, clientY: 400 + dy });
    return ms;
  };

  it("past the threshold snaps to the next station, which slides in as static, never its live picture (here past the detent: a longer pull)", async () => {
    vi.useFakeTimers();
    const { w, engine } = watch();
    const { container } = show(w);
    const touch = container.querySelector(".vw-sw__touch")!;
    // BEAT is the last preset, so the dial's first is past the detent: half the drag, and 35%.
    drag(touch, 0, -200);
    await act(async () => void (await vi.advanceTimersByTimeAsync(400)));
    expect(engine.tune).not.toHaveBeenCalled();
    drag(touch, 0, -700);
    // 2026-10-04: static first, then the picture.
    expect(engine.peek).not.toHaveBeenCalledWith(rows[0]!.station.id);
    expect(container.querySelector(".vw-sw__peek .vw-sw__static")).not.toBeNull();
    await act(async () => void (await vi.advanceTimersByTimeAsync(300)));
    expect(engine.tune).toHaveBeenCalledWith(rows[0]!.station.id, { input: "touch", via: "swipe" });
    vi.useRealTimers();
  });

  it("under it, springs back and puts the next picture away", async () => {
    vi.useFakeTimers();
    const { w, engine } = watch();
    const { container } = show(w);
    // Slowly: no flick.
    const touch = container.querySelector(".vw-sw__touch")!;
    fireEvent.pointerDown(touch, { pointerId: 3, clientX: 200, clientY: 400 });
    fireEvent.pointerMove(touch, { pointerId: 3, clientX: 200, clientY: 380 });
    await act(async () => void (await vi.advanceTimersByTimeAsync(200)));
    fireEvent.pointerMove(touch, { pointerId: 3, clientX: 200, clientY: 360 });
    await act(async () => void (await vi.advanceTimersByTimeAsync(200)));
    fireEvent.pointerUp(touch, { pointerId: 3, clientX: 200, clientY: 360 });
    await act(async () => void (await vi.advanceTimersByTimeAsync(400)));
    expect(engine.tune).not.toHaveBeenCalled();
    expect(engine.peek).toHaveBeenLastCalledWith(null);
    vi.useRealTimers();
  });

  it("sideways does nothing", async () => {
    vi.useFakeTimers();
    const { w, engine } = watch();
    const { container } = show(w);
    drag(container.querySelector(".vw-sw__touch")!, -300, 20);
    await act(async () => void (await vi.advanceTimersByTimeAsync(400)));
    expect(engine.peek).not.toHaveBeenCalled();
    expect(engine.tune).not.toHaveBeenCalled();
    expect(engine.togglePlay).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("from the last preset into the dial meets the detent, which says so", async () => {
    vi.useFakeTimers();
    const { w } = watch();
    const { container } = show(w);
    const touch = container.querySelector(".vw-sw__touch")!;
    fireEvent.pointerDown(touch, { pointerId: 4, clientX: 200, clientY: 600 });
    fireEvent.pointerMove(touch, { pointerId: 4, clientX: 200, clientY: 500 });
    expect(container.querySelector(".vw-sw__detent")!.textContent).toBe("End of your presetsThe dial, in channel order");
    expect(container.querySelector(".vw-sw__detent")!.classList.contains("is-on")).toBe(true);
    fireEvent.pointerCancel(touch, { pointerId: 4 });
    await act(async () => void (await vi.advanceTimersByTimeAsync(400)));
    vi.useRealTimers();
  });
});
