import { describe, expect, it } from "vitest";
import { installedHeight } from "./appHeight";

const win = (innerHeight: number, screen: { width: number; height: number }, landscape = false) => ({
  innerHeight,
  screen: screen as Screen,
  matchMedia: ((q: string) => ({ matches: q.includes("landscape") ? landscape : false })) as unknown as Window["matchMedia"]
});

describe("an installed app's height", () => {
  it("on an iPhone is the screen's, upright and on its side, even when the window reports less", () => {
    // 100% came out 797 on an 844-point screen: the status bar short.
    expect(installedHeight(win(797, { width: 390, height: 844 }), true)).toBe(844);
    expect(installedHeight(win(343, { width: 390, height: 844 }, true), true)).toBe(390);
  });

  it("never less than the window, and elsewhere the window's", () => {
    expect(installedHeight(win(900, { width: 390, height: 844 }), true)).toBe(900);
    expect(installedHeight(win(780, { width: 412, height: 915 }), false)).toBe(780);
  });
});
