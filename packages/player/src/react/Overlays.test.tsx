import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { dateRangeTag, HLS_CLASS, parseDateRanges } from "@opencast/contracts";
import { NOTHING_ON_SCREEN, type OnScreen } from "../engine/timeline";
import { PlayerEngine } from "../engine/PlayerEngine";
import { CHANGE_MS, fakeDriver, flush, station, stubMedia } from "../test-helpers";
import { Overlays, visibleGraphics } from "./Overlays";
import { PlayerProvider } from "./context";
import { PlayerSurface } from "./PlayerSurface";

const BEAT = station("BEAT", "12.1");
const NITE = station("NITE", "88.4", { band: "radio" });
const bug: NonNullable<OnScreen["bug"]> = { id: "bug-1", mode: "call_sign_and_channel", callSign: "BEAT", channel: "12.1", logoUrl: null, position: "bottom_right", opacity: 78 };
const l3: NonNullable<OnScreen["lowerThird"]> = { id: "l3-1", name: "Dana Whitfield", title: "Chair, Planning Commission" };
const code: NonNullable<OnScreen["code"]> = { id: "code-1", spotId: "s1", code: "ORANGE10", offer: "10% off", qrUrl: "https://useopencast.org/c/ORANGE10", until: 0 };
const on = (p: Partial<OnScreen>): OnScreen => ({ ...NOTHING_ON_SCREEN, ...p });

describe("how the graphics share the picture", () => {
  it("the banner covers the bug and the lower third, but a spot's code stays (decided: it's paid, and only 10 s)", () => {
    expect(visibleGraphics({ onScreen: on({ bug, lowerThird: l3 }), showing: true, banner: true })).toEqual({ bug: null, lowerThird: null, code: null });
    expect(visibleGraphics({ onScreen: on({ bug, lowerThird: l3, code }), showing: true, banner: true })).toEqual({ bug: null, lowerThird: null, code });
    expect(visibleGraphics({ onScreen: on({ bug }), showing: false, banner: false }).bug).toBeNull();
  });

  it("the TV guide's window draws the bug alone", () => {
    expect(visibleGraphics({ onScreen: on({ bug, lowerThird: l3, code }), showing: true, banner: false }, "bug")).toEqual({ bug, lowerThird: null, code: null });
  });

  it("the code takes the lower third's corner for its seconds; a bottom-left bug never covers either", () => {
    expect(visibleGraphics({ onScreen: on({ bug, lowerThird: l3, code }), showing: true, banner: false })).toEqual({ bug, lowerThird: null, code });
    const left = { ...bug, position: "bottom_left" as const };
    expect(visibleGraphics({ onScreen: on({ bug: left, lowerThird: l3 }), showing: true, banner: false }).bug).toBeNull();
    expect(visibleGraphics({ onScreen: on({ bug: left }), showing: true, banner: false }).bug).toBe(left);
  });
});

describe("drawing them", () => {
  it("the bug in its corner at its opacity, the lower third, and the code with a QR", () => {
    const { container, getByRole, rerender } = render(<Overlays channel={BEAT} size="web" onScreen={on({ bug: { ...bug, position: "top_left", opacity: 60 }, lowerThird: l3 })} showing banner={false} />);
    const b = container.querySelector(".oc-ovl__bug") as HTMLElement;
    expect(b.dataset.position).toBe("top_left");
    expect(b.style.getPropertyValue("--bug-opacity")).toBe("0.6");
    expect(b.textContent).toBe("BEAT12.1");
    expect(container.querySelector(".oc-l3")?.textContent).toBe("Dana WhitfieldChair, Planning Commission");
    rerender(<Overlays channel={BEAT} size="tv" onScreen={on({ code })} showing banner={false} />);
    expect(container.querySelector(".oc-ovl--tv .oc-ovl__code")?.textContent).toBe("ORANGE1010% off");
    expect(getByRole("img", { name: "QR code for ORANGE10" }).querySelector("path")?.getAttribute("d")).toMatch(/^M\d/);
  });

  it("the window's bug is drawn at the window's size (tv 03.1), with nothing else", () => {
    const { container } = render(<Overlays channel={BEAT} size="tv" only="bug" onScreen={on({ bug, lowerThird: l3, code })} showing banner={false} />);
    expect(container.querySelector(".oc-ovl--tv.oc-ovl--window .oc-bug")?.textContent).toBe("BEAT12.1");
    expect(container.querySelector(".oc-l3, .oc-ovl__code")).toBeNull();
  });

  it("with the banner up, the code sits above it", () => {
    const { container } = render(<Overlays channel={BEAT} size="tv" onScreen={on({ bug, code })} showing banner codeLift={420} />);
    expect((container.querySelector(".oc-ovl__code") as HTMLElement).style.bottom).toMatch(/calc\(.*420px.*\)/);
    expect(container.querySelector(".oc-bug")).toBeNull();
  });

  it("a logo bug is the station's image", () => {
    const { container } = render(<Overlays channel={BEAT} size="web" onScreen={on({ bug: { ...bug, mode: "logo", logoUrl: "https://cdn.example/beat.svg", callSign: null } })} showing banner={false} />);
    expect(container.querySelector("img.oc-ovl__logo")?.getAttribute("src")).toBe("https://cdn.example/beat.svg");
  });
});

describe("on the player", () => {
  let engine: PlayerEngine;
  let driver: ReturnType<typeof fakeDriver>;
  beforeEach(() => {
    vi.useFakeTimers();
    stubMedia();
    driver = fakeDriver();
    engine = new PlayerEngine({ driver, warm: "none", bannerMs: 1000 });
    engine.setChannels([BEAT, NITE]);
  });
  afterEach(() => {
    engine.destroy();
    vi.useRealTimers();
  });

  const T0 = Date.parse("2026-09-27T03:30:00Z");
  const ranges = parseDateRanges(
    [
      dateRangeTag({ id: "bug-1", class: HLS_CLASS.bug, start: T0, durationSeconds: 60, attributes: { mode: "call_sign_and_channel", callSign: "BEAT", channel: "12.1", position: "bottom_right", opacity: 78 } }),
      dateRangeTag({ id: "l3-1", class: HLS_CLASS.lowerThird, start: T0, durationSeconds: 60, attributes: { name: "Dana Whitfield", title: "Chair, Planning Commission" } })
    ].join("\n")
  );

  async function playing(id: string, overlays: boolean | "bug" = true) {
    const view = render(
      <PlayerProvider engine={engine}>
        <PlayerSurface overlays={overlays} />
      </PlayerProvider>
    );
    await act(async () => {
      const t = engine.tune(id);
      await flush(CHANGE_MS);
      await t;
      const h = driver.handles.at(-1)!;
      h.playlist({ ranges });
      h.programDate = T0 + 5000;
      await flush(1200); // past the banner
    });
    return view;
  }

  it("draws the station's graphics over the picture once the banner has gone", async () => {
    const { container } = await playing(BEAT.station.id);
    expect(container.querySelector(".oc-player .oc-ovl .oc-bug")?.textContent).toBe("BEAT12.1");
    expect(container.querySelector(".oc-player .oc-ovl .oc-l3")).not.toBeNull();
  });

  it("not where the surface turns them off, the bug alone in the TV guide's window, and never on radio", async () => {
    const off = await playing(BEAT.station.id, false);
    expect(off.container.querySelector(".oc-ovl")).toBeNull();
    off.unmount();
    const win = await playing(BEAT.station.id, "bug");
    expect(win.container.querySelector(".oc-ovl--window .oc-bug")).not.toBeNull();
    expect(win.container.querySelector(".oc-ovl .oc-l3")).toBeNull();
    win.unmount();
    const radio = await playing(NITE.station.id);
    expect(radio.container.querySelector(".oc-ovl")).toBeNull();
  });
});

describe("captions lift clear of the graphics", () => {
  it("the engine lifts them by the higher of the surface's lift (the banner) and the graphics'", () => {
    const e = new PlayerEngine({ driver: fakeDriver(), warm: "none" });
    expect(e.captionLiftNow()).toBeNull();
    e.setGraphicsLift(20);
    expect(e.captionLiftNow()).toBe(20);
    e.setCaptionLift(45);
    expect(e.captionLiftNow()).toBe(45);
    e.setGraphicsLift(62.4);
    expect(e.captionLiftNow()).toBe(62);
    e.setGraphicsLift(null);
    e.setCaptionLift(null);
    expect(e.captionLiftNow()).toBeNull();
    e.destroy();
  });

  it("the surface measures the lower third or code and lifts the captions above it; the code sits above the banner", async () => {
    vi.useFakeTimers();
    stubMedia();
    const driver = fakeDriver();
    const e = new PlayerEngine({ driver, warm: "none", bannerMs: 5000 });
    e.setChannels([BEAT]);
    // A 1000 × 562 picture at the top of the page; the lower third's top is 200 px from the bottom, the banner's 300.
    const rects: Record<string, { top: number; bottom: number; height: number }> = {
      "oc-player": { top: 0, bottom: 562, height: 562 },
      "oc-l3": { top: 362, bottom: 520, height: 158 },
      "oc-banner": { top: 262, bottom: 540, height: 278 },
      "oc-ovl__code": { top: 262 - 150, bottom: 262, height: 150 }
    };
    const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const k = Object.keys(rects).find((c) => this.classList.contains(c));
      const r = k ? rects[k]! : { top: 0, bottom: 0, height: 0 };
      return { ...r, left: 0, right: 1000, width: 1000, x: 0, y: r.top, toJSON: () => r } as DOMRect;
    });
    const lifts: Array<number | null> = [];
    const set = e.setGraphicsLift.bind(e);
    e.setGraphicsLift = (p) => {
      lifts.push(p === null ? null : Math.round(p));
      set(p);
    };
    const T0 = Date.parse("2026-09-27T03:30:00Z");
    const tags = (withCode: boolean) =>
      parseDateRanges(
        [
          dateRangeTag({ id: "l3-1", class: HLS_CLASS.lowerThird, start: T0, durationSeconds: 60, attributes: { name: "Dana Whitfield", title: "Chair, Planning Commission" } }),
          ...(withCode ? [dateRangeTag({ id: "code-1", class: HLS_CLASS.code, start: T0, durationSeconds: 60, attributes: { spotId: "s", code: "ORANGE10", offer: "10% off", qrUrl: "https://useopencast.org/c/ORANGE10" } })] : [])
        ].join("\n")
      );
    const view = render(
      <PlayerProvider engine={e}>
        <PlayerSurface />
      </PlayerProvider>
    );
    await act(async () => {
      const t = e.tune(BEAT.station.id);
      await flush(10);
      await t;
      const h = driver.handles.at(-1)!;
      h.playlist({ ranges: tags(false) });
      h.programDate = T0 + 5000;
      await flush(5200); // the banner goes
    });
    // The lower third covers the bottom 200 of 562 px (36%), plus a little room.
    expect(lifts.at(-1)).toBe(38);
    // A code, and the banner again: the code sits above the banner (300 px up), and the captions above the code.
    await act(async () => {
      driver.handles.at(-1)!.playlist({ ranges: tags(true) });
      await flush(300);
      e.showBanner();
      await flush(10);
    });
    const code = view.container.querySelector(".oc-ovl__code") as HTMLElement;
    expect(code.style.bottom).toMatch(/calc\(.*300px.*\)/);
    expect(lifts.at(-1)).toBe(Math.round(((562 - 112) / 562) * 100 + 2));
    view.unmount();
    expect(lifts.at(-1)).toBeNull();
    spy.mockRestore();
    e.destroy();
    vi.useRealTimers();
  });
});
