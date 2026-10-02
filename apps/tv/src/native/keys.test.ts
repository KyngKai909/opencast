import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keyboardInput, type Command } from "@opencast/player";
import { ANDROID_KEYS, deliverKey, domKeyFor, type NativeKey } from "./keys";

const code = (name: string) => ANDROID_KEYS[name]!.code;

describe("the remote's keys from the Android app", () => {
  it("forwards exactly the keys TvKeys.java names", () => {
    const java = readFileSync(resolve(__dirname, "../../android/app/src/main/java/org/useopencast/tv/TvKeys.java"), "utf8");
    const listed = [...java.matchAll(/KeyEvent\.(KEYCODE_[A-Z0-9_]+)/g)].map((m) => m[1]);
    expect(new Set(listed)).toEqual(new Set(Object.keys(ANDROID_KEYS)));
    expect(listed).toHaveLength(Object.keys(ANDROID_KEYS).length);
  });

  it("has Android's key codes (android.view.KeyEvent)", () => {
    const expected: Record<string, number> = {
      KEYCODE_BACK: 4, KEYCODE_0: 7, KEYCODE_9: 16, KEYCODE_DPAD_CENTER: 23, KEYCODE_PERIOD: 56, KEYCODE_ENTER: 66, KEYCODE_MINUS: 69,
      KEYCODE_MENU: 82, KEYCODE_MEDIA_PLAY_PAUSE: 85, KEYCODE_MEDIA_NEXT: 87, KEYCODE_MEDIA_PREVIOUS: 88, KEYCODE_MEDIA_REWIND: 89,
      KEYCODE_MEDIA_FAST_FORWARD: 90, KEYCODE_PAGE_UP: 92, KEYCODE_PAGE_DOWN: 93, KEYCODE_MEDIA_PLAY: 126, KEYCODE_MEDIA_PAUSE: 127,
      KEYCODE_NUMPAD_0: 144, KEYCODE_NUMPAD_9: 153, KEYCODE_NUMPAD_DOT: 158, KEYCODE_NUMPAD_ENTER: 160, KEYCODE_INFO: 165,
      KEYCODE_CHANNEL_UP: 166, KEYCODE_CHANNEL_DOWN: 167, KEYCODE_GUIDE: 172, KEYCODE_LAST_CHANNEL: 229
    };
    for (const [name, value] of Object.entries(expected)) expect(code(name), name).toBe(value);
  });

  it("becomes the key names the keyboard adapter maps", () => {
    expect(domKeyFor(code("KEYCODE_CHANNEL_UP"))).toEqual({ key: "ChannelUp", keyCode: 427 });
    expect(domKeyFor(code("KEYCODE_GUIDE"))).toEqual({ key: "Guide", keyCode: 458 });
    expect(domKeyFor(code("KEYCODE_BACK"))).toEqual({ key: "GoBack", keyCode: 461 });
    expect(domKeyFor(code("KEYCODE_DPAD_CENTER"))).toEqual({ key: "Enter", keyCode: 13 });
    expect(domKeyFor(code("KEYCODE_NUMPAD_7"))).toEqual({ key: "7", keyCode: 103 });
    // The D-pad's arrows reach the WebView by themselves.
    expect(domKeyFor(19)).toBeNull();
  });
});

describe("native keys, through TV mode's keyboard adapter", () => {
  afterEach(() => vi.useRealTimers());

  function remote(where: "picture" | "overlay" = "picture") {
    const dispatch = vi.fn<(c: Command) => void>();
    const stop = keyboardInput({ profile: "tv", context: () => where }).start(dispatch);
    const send = (name: string, type: NativeKey["type"], o: Partial<NativeKey> = {}) => deliverKey({ type, code: code(name), ...o });
    const press = (name: string) => {
      send(name, "down");
      send(name, "up");
    };
    return { dispatch, stop, send, press, sent: () => dispatch.mock.calls.map((c) => c[0]) };
  }

  it("on the picture: channel, guide, info, menu, last, play/pause, numbers", () => {
    const r = remote();
    for (const k of ["KEYCODE_CHANNEL_UP", "KEYCODE_CHANNEL_DOWN", "KEYCODE_MEDIA_NEXT", "KEYCODE_MEDIA_PREVIOUS", "KEYCODE_GUIDE", "KEYCODE_INFO", "KEYCODE_MENU", "KEYCODE_LAST_CHANNEL", "KEYCODE_MEDIA_PLAY_PAUSE", "KEYCODE_MEDIA_PAUSE", "KEYCODE_1", "KEYCODE_NUMPAD_2", "KEYCODE_PERIOD", "KEYCODE_MINUS"]) r.press(k);
    expect(r.sent()).toEqual([
      { type: "channel", dir: "up" },
      { type: "channel", dir: "down" },
      { type: "channel", dir: "up" },
      { type: "channel", dir: "down" },
      { type: "guide" },
      { type: "info" },
      { type: "menu" },
      { type: "last" },
      { type: "togglePlay" },
      { type: "pause" },
      { type: "digit", digit: 1 },
      { type: "digit", digit: 2 },
      { type: "dot" },
      { type: "dot" }
    ]);
    // Fire TV's ⏪ means nothing yet; ⏩ goes back to live.
    r.press("KEYCODE_MEDIA_REWIND");
    expect(r.dispatch).toHaveBeenCalledTimes(14);
    r.press("KEYCODE_MEDIA_FAST_FORWARD");
    expect(r.sent().at(-1)).toEqual({ type: "backToLive" });
    r.stop();
  });

  it("⏩ goes back to live on the picture only; in the guide and menus it does nothing", () => {
    const r = remote("overlay");
    r.press("KEYCODE_MEDIA_FAST_FORWARD");
    expect(r.dispatch).not.toHaveBeenCalled();
    r.stop();
  });

  it("Back is the last channel on the picture and closes an overlay, when it's let go", () => {
    const pic = remote();
    pic.send("KEYCODE_BACK", "down");
    expect(pic.dispatch).not.toHaveBeenCalled();
    pic.send("KEYCODE_BACK", "up");
    expect(pic.sent()).toEqual([{ type: "last" }]);
    pic.stop();
    const overlay = remote("overlay");
    overlay.press("KEYCODE_BACK");
    overlay.press("KEYCODE_DPAD_CENTER");
    expect(overlay.sent()).toEqual([{ type: "back" }, { type: "select" }]);
    overlay.stop();
  });

  it("holding Back opens the menu (a basic remote's Menu); Android's key repeats don't add presses", () => {
    vi.useFakeTimers();
    const r = remote();
    r.send("KEYCODE_BACK", "down");
    vi.advanceTimersByTime(250);
    r.send("KEYCODE_BACK", "down", { repeat: true });
    vi.advanceTimersByTime(300);
    r.send("KEYCODE_BACK", "down", { repeat: true });
    r.send("KEYCODE_BACK", "up");
    expect(r.sent()).toEqual([{ type: "menu" }]);
    r.stop();
  });

  it("holding OK (the D-pad's centre) is OK with hold", () => {
    vi.useFakeTimers();
    const r = remote("overlay");
    r.send("KEYCODE_DPAD_CENTER", "down");
    vi.advanceTimersByTime(600);
    r.send("KEYCODE_DPAD_CENTER", "up");
    expect(r.sent()).toEqual([{ type: "select", hold: true }]);
    r.stop();
  });

  it("a release the system canceled doesn't act, and the next press works", () => {
    const r = remote();
    r.send("KEYCODE_DPAD_CENTER", "down");
    r.send("KEYCODE_DPAD_CENTER", "up", { canceled: true });
    expect(r.dispatch).not.toHaveBeenCalled();
    r.press("KEYCODE_DPAD_CENTER");
    expect(r.sent()).toEqual([{ type: "select" }]);
    r.stop();
  });

  it("reaches the adapter from whatever has focus, and says so for keys it doesn't know", () => {
    const r = remote();
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    const seen = vi.fn();
    button.addEventListener("keydown", (e) => seen((e as KeyboardEvent).keyCode));
    r.send("KEYCODE_GUIDE", "down");
    expect(seen).toHaveBeenCalledWith(458);
    expect(r.sent()).toEqual([{ type: "guide" }]);
    expect(deliverKey({ type: "down", code: 19 })).toBe(false);
    button.remove();
    r.stop();
  });
});

describe("Android's long press", () => {
  it("counts a Back let go right after Android's long-press repeat as a hold", async () => {
    vi.useFakeTimers();
    const got: Command[] = [];
    const stop = keyboardInput({ profile: "tv", context: () => "picture" }).start((c) => got.push(c));
    let t = 1_000;
    const now = () => t;
    deliverKey({ type: "down", code: 4, repeat: false, canceled: false }, document, now);
    t += 400;
    vi.advanceTimersByTime(400);
    deliverKey({ type: "down", code: 4, repeat: true, canceled: false }, document, now);
    t += 5;
    vi.advanceTimersByTime(5);
    deliverKey({ type: "up", code: 4, repeat: false, canceled: false }, document, now);
    vi.advanceTimersByTime(200);
    expect(got).toEqual([{ type: "menu" }]);
    stop();
    vi.useRealTimers();
  });
});
