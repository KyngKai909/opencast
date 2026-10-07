import { afterEach, describe, expect, it, vi } from "vitest";
import { keyboardInput, type Command } from "@opencast/player";
import { watchCommand, type WatchState } from "../components/watching/watchCommands";
import { exitTizenApp, isTizenApp, startTizenKeys, tizenTv, TIZEN_KEYS, type TizenApi, type TizenWindow } from "./tizen";

/** Samsung's documented key list (developer.samsung.com, Remote Control). */
const SAMSUNG: Record<string, number> = {
  ChannelUp: 427, ChannelDown: 428, Minus: 189, Info: 457, Guide: 458, ChannelList: 10073, PreviousChannel: 10190, Tools: 10135,
  MediaPlayPause: 10252, MediaPlay: 415, MediaPause: 19, MediaStop: 413, MediaRewind: 412, MediaFastForward: 417,
  MediaTrackNext: 10233, MediaTrackPrevious: 10232, ColorF0Red: 403, Exit: 10182, VolumeUp: 447,
  ...Object.fromEntries(Array.from({ length: 10 }, (_, d) => [String(d), 48 + d]))
};

/** What Tizen puts in `key` for some of them. */
const TIZEN_NAMES: Record<number, string> = { 427: "XF86RaiseChannel", 428: "XF86LowerChannel", 10009: "XF86Back", 189: "minus", 10073: "XF86ChannelList", 10190: "XF86PreviousChannel", 10252: "XF86PlayBack", 415: "XF86AudioPlay", 19: "XF86AudioPause", 413: "XF86AudioStop", 417: "XF86AudioForward", 412: "XF86AudioRewind" };

function fakeTizen(o: { keys?: Record<string, number>; listThrows?: boolean } = {}) {
  const keys = o.keys ?? SAMSUNG;
  const registered = new Set<string>();
  const exit = vi.fn();
  const tizen: TizenApi = {
    tvinputdevice: {
      getSupportedKeys: () => {
        if (o.listThrows) throw new Error("NotSupportedError");
        return Object.entries(keys).map(([name, code]) => ({ name, code }));
      },
      registerKey: (name) => {
        if (!o.listThrows && !(name in keys)) throw new Error("InvalidValuesError");
        registered.add(name);
      },
      unregisterKey: (name) => void registered.delete(name)
    },
    application: { getCurrentApplication: () => ({ exit }) }
  };
  const w: TizenWindow = { tizen, addEventListener: window.addEventListener.bind(window), removeEventListener: window.removeEventListener.bind(window) };
  return { w, tizen, registered, exit };
}

/** A key as the TV delivers it: Samsung's key code, and Tizen's own name for the key. */
function fire(type: "keydown" | "keyup", keyCode: number, key = TIZEN_NAMES[keyCode] ?? "Unidentified") {
  const e = new KeyboardEvent(type, { key, keyCode, bubbles: true, cancelable: true });
  if (e.keyCode !== keyCode) Object.defineProperty(e, "keyCode", { value: keyCode });
  document.body.dispatchEvent(e);
}
const press = (keyCode: number, key?: string) => {
  fire("keydown", keyCode, key);
  fire("keyup", keyCode, key);
};

function remote(where: "picture" | "overlay" = "picture") {
  const got: Command[] = [];
  const stop = keyboardInput({ profile: "tv", context: () => where }).start((c) => got.push(c));
  return { got, stop };
}

const stops: (() => void)[] = [];
afterEach(() => {
  stops.splice(0).forEach((s) => s());
  vi.useRealTimers();
});

describe("the Samsung TV app's remote keys", () => {
  it("registers the keys TV mode uses that this TV has, and never Exit, volume or the colour keys", () => {
    // A remote without GUIDE (many Samsung remotes).
    const { Guide: _, ...noGuide } = SAMSUNG;
    const { w, registered } = fakeTizen({ keys: noGuide });
    stops.push(startTizenKeys(w));
    expect(registered.has("Guide")).toBe(false);
    expect(registered.has("ChannelUp")).toBe(true);
    expect(registered.has("Minus")).toBe(true);
    expect(registered.has("7")).toBe(true);
    expect(registered.has("PreviousChannel")).toBe(true);
    for (const name of ["Exit", "VolumeUp", "ColorF0Red"]) expect(registered.has(name), name).toBe(false);
  });

  it("registers every key of the map on a TV with all of them", () => {
    const { w, registered } = fakeTizen();
    stops.push(startTizenKeys(w));
    expect([...registered].sort()).toEqual(Object.keys(TIZEN_KEYS).sort());
  });

  it("on the picture: Samsung's keys become the same commands as Android TV's", () => {
    stops.push(startTizenKeys(fakeTizen().w));
    const r = remote();
    stops.push(r.stop);
    for (const code of [427, 428, 10233, 10232, 457, 458, 10073, 10135, 10190, 10252, 415, 19, 413, 49, 50, 189, 417]) press(code, code >= 48 && code <= 57 ? String(code - 48) : undefined);
    expect(r.got).toEqual([
      { type: "channel", dir: "up" },
      { type: "channel", dir: "down" },
      { type: "channel", dir: "up" },
      { type: "channel", dir: "down" },
      { type: "info" },
      { type: "guide" },
      { type: "guide" },
      { type: "menu" },
      { type: "last" },
      { type: "togglePlay" },
      { type: "play" },
      { type: "pause" },
      { type: "pause" },
      { type: "digit", digit: 1 },
      { type: "digit", digit: 2 },
      { type: "dot" },
      { type: "backToLive" }
    ]);
    // ⏪ means nothing yet, as on Fire TV.
    press(412);
    expect(r.got).toHaveLength(17);
  });

  it("18-2 on the number keys tunes 18.2", () => {
    stops.push(startTizenKeys(fakeTizen().w));
    const r = remote();
    stops.push(r.stop);
    press(49, "1");
    press(56, "8");
    press(189);
    press(50, "2");
    expect(r.got).toEqual([{ type: "digit", digit: 1 }, { type: "digit", digit: 8 }, { type: "dot" }, { type: "digit", digit: 2 }]);
  });

  it("uses the codes the TV reports for its keys", () => {
    stops.push(startTizenKeys(fakeTizen({ keys: { ...SAMSUNG, ChannelUp: 5001 } }).w));
    const r = remote();
    stops.push(r.stop);
    press(5001, "XF86RaiseChannel");
    expect(r.got).toEqual([{ type: "channel", dir: "up" }]);
  });

  it("falls back to Samsung's documented codes when the TV can't list its keys", () => {
    const { w, registered } = fakeTizen({ listThrows: true });
    stops.push(startTizenKeys(w));
    expect(registered.has("ChannelDown")).toBe(true);
    const r = remote();
    stops.push(r.stop);
    press(428);
    expect(r.got).toEqual([{ type: "channel", dir: "down" }]);
  });

  it("Back (Return) is the last channel on the picture, closes an overlay, and held opens the menu", () => {
    vi.useFakeTimers();
    stops.push(startTizenKeys(fakeTizen().w));
    const pic = remote();
    press(10009);
    expect(pic.got).toEqual([{ type: "last" }]);
    fire("keydown", 10009);
    vi.advanceTimersByTime(600);
    fire("keyup", 10009);
    expect(pic.got).toEqual([{ type: "last" }, { type: "menu" }]);
    pic.stop();
    const overlay = remote("overlay");
    stops.push(overlay.stop);
    press(10009);
    press(13, "Enter");
    expect(overlay.got).toEqual([{ type: "back" }, { type: "select" }]);
  });

  it("leaves the arrows and OK as they are", () => {
    stops.push(startTizenKeys(fakeTizen().w));
    const r = remote();
    stops.push(r.stop);
    press(38, "ArrowUp");
    press(39, "ArrowRight");
    expect(r.got).toEqual([{ type: "channel", dir: "up" }, { type: "guide" }]);
  });

  it("stops: the keys are unregistered and arrive as Tizen's again", () => {
    const { w, registered } = fakeTizen();
    const stop = startTizenKeys(w);
    stop();
    expect(registered.size).toBe(0);
    const r = remote();
    stops.push(r.stop);
    press(10190);
    expect(r.got).toEqual([]);
  });
});

describe("Back at the Samsung TV app's root", () => {
  const base: WatchState = { fading: false, stopped: false, tvApp: true, card: false, typing: false, airShown: false, currentId: "s1", flip: false };

  it("with no last channel, the remote's Back leaves the app", () => {
    const { w, exit } = fakeTizen();
    stops.push(startTizenKeys(w));
    const r = remote();
    stops.push(r.stop);
    press(10009);
    const act = watchCommand(r.got[0]!, { ...base, exitable: true });
    expect(act).toEqual({ do: "exit" });
    exitTizenApp(w);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("the sleep timer's end and the app's lifecycle use Tizen's calls", async () => {
    const { w, exit } = fakeTizen();
    const setScreenSaver = vi.fn();
    const t = tizenTv({ ...w, webapis: { appcommon: { setScreenSaver, AppCommonScreenSaverState: { SCREEN_SAVER_OFF: 0, SCREEN_SAVER_ON: 1 } } } });
    await t.tv.exitToHome();
    expect(exit).toHaveBeenCalledTimes(1);
    await t.tv.setKeepScreenOn({ on: true });
    await t.tv.setKeepScreenOn({ on: false });
    expect(setScreenSaver.mock.calls).toEqual([[0], [1]]);
    const seen: boolean[] = [];
    const stop = t.appStates((active) => seen.push(active));
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    stop();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(seen).toEqual([false, true]);
  });
});

describe("off Tizen (a browser, Samsung's included, and the Android app)", () => {
  it("isn't the Samsung TV app, and nothing is registered, renamed or exited", () => {
    const add = vi.fn();
    const w: TizenWindow = { addEventListener: add, removeEventListener: vi.fn() };
    expect(isTizenApp(w)).toBe(false);
    expect(isTizenApp(window as TizenWindow)).toBe(false);
    startTizenKeys(w)();
    expect(add).not.toHaveBeenCalled();
    expect(() => exitTizenApp(w)).not.toThrow();
    const r = remote();
    stops.push(r.stop);
    // Samsung's PRE-CH, unregistered, means nothing; Back still works (keyboard.ts knows 10009).
    press(10190);
    press(10009);
    expect(r.got).toEqual([{ type: "last" }]);
  });

  it("is the Samsung TV app when tizen.tvinputdevice is there", () => {
    expect(isTizenApp(fakeTizen().w)).toBe(true);
  });
});
