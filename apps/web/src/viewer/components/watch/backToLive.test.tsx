// Back to live beside play and pause on the tuned-in page (web and phone): shown while behind live
// (paused, or playing on from a pause), and it goes back to live.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, controlUrl: "http://control.test", tvUrl: "http://tv.test", mockClock: "2026-09-27T03:42:00Z" }
}));
// The picture and the page's parts have tests of their own; here only the controls matter.
vi.mock("./Picture", () => ({ Picture: ({ children }: { children?: unknown }) => <div data-testid="picture">{children as never}</div> }));
vi.mock("./parts", () => ({ Actions: () => null, MembersLine: () => null, NowTitle: () => null, SharedAiring: () => null, Tonight: () => null }));
vi.mock("./overlay", () => ({ useOverlayParams: () => ({ open: vi.fn(), close: vi.fn(), params: new URLSearchParams() }) }));
vi.mock("../../data/viewer", () => ({ useChannels: () => [] }));
vi.mock("../remote/WatchOnSheet", () => ({ WatchOnSheet: () => null }));
vi.mock("../../cast/session", () => ({ useCastSession: () => ({ status: "idle" }) }));
vi.mock("../../cast/useCast", () => ({ watchOnOffered: () => false }));

const { WatchWeb } = await import("./WatchWeb");
const { WatchPhone } = await import("./WatchPhone");
type W = Parameters<typeof WatchWeb>[0]["w"];

const row = (band: "tv" | "radio") => ({
  station: { id: "00000000-0000-4000-8000-000000000012", kind: "station", callSign: "BEAT", handle: "beat", name: "Inland Beat", colour: "#8C3B7A", band, channel: band === "tv" ? "12.1" : "96.2", marketSlug: "inland-empire", homeCity: "Redlands" },
  onAir: true,
  now: null,
  next: null,
  playback: { kind: "hls", url: "/hls/beat/index.m3u8" }
});

function watch(o: { band?: "tv" | "radio"; status?: string; behindLive?: boolean; airPlay?: { available: boolean; active: boolean } }) {
  const r = row(o.band ?? "tv");
  const engine = { togglePlay: vi.fn(), backToLive: vi.fn(), handle: vi.fn(), setMuted: vi.fn(), showAirPlayPicker: vi.fn(), stopAirPlay: vi.fn() };
  const w = {
    state: { status: o.status ?? "playing", behindLive: o.behindLive ?? false, currentId: r.station.id, pendingId: null, muted: false, airPlay: o.airPlay ?? { available: false, active: false } },
    engine,
    channels: [r],
    row: r,
    now: null,
    backAt: null,
    page: { data: undefined },
    program: { data: undefined },
    playing: true,
    notOnDial: false
  } as unknown as W;
  return { w, engine };
}

const live = () => screen.queryByRole("button", { name: "Back to live" });

describe.each([
  ["web", WatchWeb, "tv"],
  ["phone", WatchPhone, "tv"],
  ["phone, radio band", WatchPhone, "radio"]
] as const)("Back to live on the %s", (_name, Watch, band) => {
  it("isn't there at the live edge", () => {
    render(<Watch w={watch({ band }).w} />);
    expect(live()).toBeNull();
  });

  it("shows while paused, and goes back to live", () => {
    const { w, engine } = watch({ band, status: "paused", behindLive: true });
    render(<Watch w={w} />);
    fireEvent.click(live()!);
    expect(engine.backToLive).toHaveBeenCalledOnce();
  });

  it("stays while playing on behind live", () => {
    render(<Watch w={watch({ band, status: "playing", behindLive: true }).w} />);
    expect(live()).toBeTruthy();
  });
});

describe("beside play and pause", () => {
  it("web: right after the play button in the controls under the picture", () => {
    render(<WatchWeb w={watch({ status: "paused", behindLive: true }).w} />);
    const play = screen.getByRole("button", { name: "Play" });
    expect(play.nextElementSibling).toBe(live());
  });

  it("phone, radio band: under the play button's row", () => {
    render(<WatchPhone w={watch({ band: "radio", status: "paused", behindLive: true }).w} />);
    const controls = screen.getByRole("button", { name: "Play" }).parentElement!;
    expect(controls.nextElementSibling).toBe(live());
  });
});

describe("AirPlay on the tuned-in page (Safari)", () => {
  it("web: an AirPlay button beside sound while an AirPlay TV is around, opening Safari's list", () => {
    render(<WatchWeb w={watch({}).w} />);
    expect(screen.queryByRole("button", { name: "AirPlay" })).toBeNull();
    const { w, engine } = watch({ airPlay: { available: true, active: false } });
    render(<WatchWeb w={w} />);
    fireEvent.click(screen.getByRole("button", { name: "AirPlay" }));
    expect(engine.showAirPlayPicker).toHaveBeenCalledOnce();
  });

  it.each([
    ["web", WatchWeb, "tv"],
    ["phone", WatchPhone, "tv"],
    ["phone, radio band", WatchPhone, "radio"]
  ] as const)("%s: while AirPlaying, says where it's playing, and Stop takes it back", (_n, Watch, band) => {
    const { w, engine } = watch({ band, airPlay: { available: true, active: true } });
    render(<Watch w={w} />);
    const line = screen.getByRole("status");
    expect(line.textContent).toContain("Playing on AirPlay");
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(engine.stopAirPlay).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "AirPlay" })).toBeNull();
  });
});

