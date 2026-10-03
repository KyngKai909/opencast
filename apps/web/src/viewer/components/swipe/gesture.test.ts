// The swipe's numbers (swipe home 08): 1:1 to 60% then a third; snap past 20% or a flick over
// 0.5 px/ms; the detent's half drag and 35%; up and down only.

import { describe, expect, it } from "vitest";
import { DETENT_SHARE, SNAP_SHARE, axisOf, directionOf, dragOffset, releaseAction, seamAt, velocityOf } from "./gesture";

const H = 800;

describe("the drag", () => {
  it("follows the finger 1:1 up to 60% of the screen", () => {
    expect(dragOffset(-200, H, false)).toBe(-200);
    expect(dragOffset(480, H, false)).toBe(480);
  });

  it("then goes a third as far (the rubber band)", () => {
    expect(dragOffset(-(480 + 90), H, false)).toBe(-(480 + 30));
    expect(dragOffset(780, H, false)).toBe(480 + 100);
  });

  it("at the detent goes half as far for the same finger movement", () => {
    expect(dragOffset(-200, H, true)).toBe(-100);
    // 1200 px of finger is 600 of drag: 480, then a third of 120.
    expect(dragOffset(1200, H, true)).toBe(480 + 40);
  });

  it("finger up is the next station, down the previous", () => {
    expect(directionOf(-1)).toBe("next");
    expect(directionOf(1)).toBe("prev");
  });

  it("is up and down only: sideways does nothing, and a few pixels decide nothing yet", () => {
    expect(axisOf(2, -5)).toBeNull();
    expect(axisOf(3, -20)).toBe("y");
    expect(axisOf(-30, 10)).toBe("x");
  });
});

describe("letting go", () => {
  it("snaps past 20% of the screen, and springs back under it", () => {
    expect(releaseAction({ offset: -(SNAP_SHARE * H + 1), velocity: 0, height: H, detent: false })).toBe("snap");
    expect(releaseAction({ offset: -(SNAP_SHARE * H - 1), velocity: 0, height: H, detent: false })).toBe("back");
  });

  it("snaps on a flick faster than 0.5 px per ms the way the drag was going, even a short one", () => {
    expect(releaseAction({ offset: -40, velocity: -0.6, height: H, detent: false })).toBe("snap");
    expect(releaseAction({ offset: -40, velocity: -0.4, height: H, detent: false })).toBe("back");
    // A flick back the other way at the end is a change of mind.
    expect(releaseAction({ offset: -40, velocity: 0.8, height: H, detent: false })).toBe("back");
  });

  it("at the detent needs 35%, and a harder flick", () => {
    expect(releaseAction({ offset: -(SNAP_SHARE * H + 10), velocity: 0, height: H, detent: true })).toBe("back");
    expect(releaseAction({ offset: -(DETENT_SHARE * H + 1), velocity: 0, height: H, detent: true })).toBe("snap");
    expect(releaseAction({ offset: -40, velocity: -0.6, height: H, detent: true })).toBe("back");
    expect(releaseAction({ offset: -40, velocity: -1, height: H, detent: true })).toBe("snap");
  });

  it("with nothing moved, stays", () => {
    expect(releaseAction({ offset: 0, velocity: -2, height: H, detent: false })).toBe("back");
  });

  it("measures the speed over the end of the drag", () => {
    expect(velocityOf([{ y: 500, t: 0 }, { y: 400, t: 200 }, { y: 360, t: 240 }, { y: 300, t: 280 }])).toBeCloseTo(-100 / 80);
    expect(velocityOf([{ y: 500, t: 0 }])).toBe(0);
  });

  it("puts the detent's label on the seam between the pictures", () => {
    expect(seamAt(-100, H, "next")).toBe(700);
    expect(seamAt(100, H, "prev")).toBe(100);
  });
});

describe("the remote's swipe (casting, mirroring)", () => {
  it("changes the TV's channel on a vertical swipe or flick, not a short, slow or sideways one", async () => {
    const { remoteSwipe } = await import("./gesture");
    expect(remoteSwipe(0, -60, 0)).toBe("next");
    expect(remoteSwipe(4, 50, 0)).toBe("prev");
    expect(remoteSwipe(0, -20, -0.8)).toBe("next");
    expect(remoteSwipe(0, -20, -0.2)).toBeNull();
    expect(remoteSwipe(-80, 30, 0)).toBeNull();
  });
});
