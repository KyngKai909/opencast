import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { dateRangeTag, HLS_CLASS, parseDateRanges } from "@opencast/contracts";
import { NOTHING_ON_SCREEN, type OnScreen } from "../engine/timeline";
import { PlayerEngine } from "../engine/PlayerEngine";
import { fakeDriver, flush, station, stubMedia } from "../test-helpers";
import { Overlays, visibleGraphics } from "./Overlays";
import { PlayerProvider } from "./context";
import { PlayerSurface } from "./PlayerSurface";

const BEAT = station("BEAT", "12.1");
const NITE = station("NITE", "88.3", { band: "radio" });
const bug: NonNullable<OnScreen["bug"]> = { id: "bug-1", mode: "call_sign_and_channel", callSign: "BEAT", channel: "12.1", logoUrl: null, position: "bottom_right", opacity: 78 };
const l3: NonNullable<OnScreen["lowerThird"]> = { id: "l3-1", name: "Dana Whitfield", title: "Chair, Planning Commission" };
const code: NonNullable<OnScreen["code"]> = { id: "code-1", spotId: "s1", code: "ORANGE10", offer: "10% off", qrUrl: "https://useopencast.org/c/ORANGE10", until: 0 };
const on = (p: Partial<OnScreen>): OnScreen => ({ ...NOTHING_ON_SCREEN, ...p });

describe("how the graphics share the picture", () => {
  it("nothing while the banner is up (it covers the bottom and carries the ident), or when the picture isn't showing", () => {
    expect(visibleGraphics({ onScreen: on({ bug, lowerThird: l3 }), showing: true, banner: true })).toEqual({ bug: null, lowerThird: null, code: null });
    expect(visibleGraphics({ onScreen: on({ bug }), showing: false, banner: false }).bug).toBeNull();
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

  async function playing(id: string, overlays = true) {
    const view = render(
      <PlayerProvider engine={engine}>
        <PlayerSurface overlays={overlays} />
      </PlayerProvider>
    );
    await act(async () => {
      const t = engine.tune(id);
      await flush(10);
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

  it("not where the surface turns them off (the TV guide's window), and never on radio", async () => {
    const off = await playing(BEAT.station.id, false);
    expect(off.container.querySelector(".oc-ovl")).toBeNull();
    off.unmount();
    const radio = await playing(NITE.station.id);
    expect(radio.container.querySelector(".oc-ovl")).toBeNull();
  });
});
