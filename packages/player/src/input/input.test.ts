import { describe, expect, it, vi } from "vitest";
import { commandForKey, HOLD_MS, keyboardInput } from "./keyboard";
import { castInput, parseCastCommand, CAST_NAMESPACE } from "./cast";
import { bridgeInput } from "./bridge";

const key = (k: string, keyCode = 0) => ({ key: k, keyCode });

describe("the TV remote", () => {
  it("on the picture: ▲ ▼ change channel, ◀ presets, ▶ guide, numbers tune, Back is last channel", () => {
    expect(commandForKey(key("ArrowUp"), "tv")).toEqual({ type: "channel", dir: "up" });
    expect(commandForKey(key("ArrowLeft"), "tv")).toEqual({ type: "presets" });
    expect(commandForKey(key("ArrowRight"), "tv")).toEqual({ type: "guide" });
    expect(commandForKey(key("1"), "tv")).toEqual({ type: "digit", digit: 1 });
    expect(commandForKey(key("Enter"), "tv")).toEqual({ type: "select" });
    expect(commandForKey(key("GoBack"), "tv")).toEqual({ type: "last" });
  });
  it("in the guide and menus: arrows move focus, Back closes", () => {
    expect(commandForKey(key("ArrowUp"), "tv", "overlay")).toEqual({ type: "focus", dir: "up" });
    expect(commandForKey(key("Escape"), "tv", "overlay")).toEqual({ type: "back" });
    expect(commandForKey(key("5"), "tv", "overlay")).toEqual({ type: "digit", digit: 5 });
  });
  it("knows the TVs' channel keys by name and by code", () => {
    expect(commandForKey(key("ChannelDown"), "tv")).toEqual({ type: "channel", dir: "down" });
    expect(commandForKey(key("Unidentified", 427), "tv")).toEqual({ type: "channel", dir: "up" });
  });
});

describe("holding OK and Back on the TV remote", () => {
  function remote(where: "picture" | "overlay" = "overlay") {
    const target = new EventTarget();
    const dispatch = vi.fn();
    const stop = keyboardInput({ profile: "tv", context: () => where, target: target as never }).start(dispatch);
    const down = (key: string, repeat = false) => target.dispatchEvent(new KeyboardEvent("keydown", { key, repeat, cancelable: true }));
    const up = (key: string) => target.dispatchEvent(new KeyboardEvent("keyup", { key, cancelable: true }));
    return { dispatch, down, up, stop, target };
  }

  it("a press of OK acts when it's let go", () => {
    vi.useFakeTimers();
    const r = remote();
    r.down("Enter");
    expect(r.dispatch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    r.up("Enter");
    expect(r.dispatch).toHaveBeenCalledTimes(1);
    expect(r.dispatch.mock.calls[0]).toEqual([{ type: "select" }, { input: "remote" }]);
    vi.useRealTimers();
  });

  it("holding OK sends OK with hold once, and nothing when it's let go; key repeats don't add presses", () => {
    vi.useFakeTimers();
    const r = remote();
    r.down("Enter");
    r.down("Enter", true);
    vi.advanceTimersByTime(HOLD_MS);
    r.down("Enter", true);
    r.up("Enter");
    expect(r.dispatch.mock.calls.map((c) => c[0])).toEqual([{ type: "select", hold: true }]);
    vi.useRealTimers();
  });

  it("holding Back opens the menu rail, on the picture and in overlays; a press is still Back", () => {
    vi.useFakeTimers();
    const pic = remote("picture");
    pic.down("Escape");
    pic.up("Escape");
    pic.down("Backspace");
    vi.advanceTimersByTime(HOLD_MS + 10);
    pic.up("Backspace");
    expect(pic.dispatch.mock.calls.map((c) => c[0])).toEqual([{ type: "last" }, { type: "menu" }]);
    const menu = remote("overlay");
    menu.down("GoBack");
    vi.advanceTimersByTime(HOLD_MS);
    expect(menu.dispatch.mock.calls.map((c) => c[0])).toEqual([{ type: "menu" }]);
    vi.useRealTimers();
  });

  it("arrows and numbers still act at once; stopping or leaving the page drops a half-held key", () => {
    vi.useFakeTimers();
    const r = remote();
    r.down("ArrowDown");
    r.down("7");
    expect(r.dispatch.mock.calls.map((c) => c[0])).toEqual([{ type: "focus", dir: "down" }, { type: "digit", digit: 7 }]);
    r.down("Enter");
    r.target.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(HOLD_MS * 2);
    r.up("Enter");
    expect(r.dispatch).toHaveBeenCalledTimes(2);
    r.stop();
    vi.useRealTimers();
  });
});

describe("the web keyboard", () => {
  it("1 to 6 are presets; arrows change channel", () => {
    expect(commandForKey(key("4"), "web")).toEqual({ type: "preset", key: 4 });
    expect(commandForKey(key("7"), "web")).toBeNull();
    expect(commandForKey(key("ArrowDown"), "web")).toEqual({ type: "channel", dir: "down" });
  });
});

describe("Cast messages", () => {
  it("accepts the phone remote's commands and nothing else", () => {
    expect(parseCastCommand('{"type":"channel","dir":"up","from":"Kai\'s phone"}')).toEqual({ type: "channel", dir: "up", from: "Kai's phone" });
    expect(parseCastCommand({ type: "tune", channel: "24.1" })).toEqual({ type: "tune", channel: "24.1" });
    expect(parseCastCommand({ type: "tune", channel: "drop table" })).toBeNull();
    expect(parseCastCommand({ type: "preset", key: 9 })).toBeNull();
    expect(parseCastCommand({ type: "eval", code: "x" })).toBeNull();
    expect(parseCastCommand("not json")).toBeNull();
  });
  it("names the sender, and ignores other phones when only the caster may change channel", () => {
    let listener: ((e: { senderId: string; data: unknown }) => void) | null = null;
    const ctx = { addCustomMessageListener: (_ns: string, l: typeof listener) => (listener = l), sendCustomMessage: vi.fn() };
    const dispatch = vi.fn();
    let others = true;
    const input = castInput({ context: ctx as never, othersCanChange: () => others, castingFrom: () => "Kai's phone" });
    input.start(dispatch);
    listener!({ senderId: "a", data: { type: "channel", dir: "up", from: "Kai's phone" } });
    listener!({ senderId: "b", data: { type: "channel", dir: "down", from: "Sam's phone" } });
    others = false;
    listener!({ senderId: "b", data: { type: "channel", dir: "down" } });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[1][1]).toEqual({ input: "cast", who: "Sam's phone" });
    input.broadcast({ stationId: "x" });
    expect(ctx.sendCustomMessage).toHaveBeenCalledWith(CAST_NAMESPACE, undefined, { type: "state", stationId: "x" });
    expect(input.hints?.()).toEqual([{ kind: "chip", label: "Playing from Kai's phone", detail: "Change channel on your phone" }]);
  });
});

describe("the iPhone bridge", () => {
  it("takes commands from the app's own origin only", () => {
    const target = new EventTarget();
    const dispatch = vi.fn();
    bridgeInput({ source: target as never, origins: ["capacitor://localhost"], device: () => "Kai's iPhone" }).start(dispatch);
    target.dispatchEvent(new MessageEvent("message", { origin: "https://evil.example", data: { opencast: "command", command: { type: "info" } } }));
    target.dispatchEvent(new MessageEvent("message", { origin: "capacitor://localhost", data: { opencast: "command", command: { type: "info" } } }));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]).toEqual([{ type: "info" }, { input: "bridge", who: "Kai's iPhone" }]);
  });
});

describe("a computer's keyboard in TV mode", () => {
  it("pauses and resumes with the space bar or k on the picture, not in the guide or menus", () => {
    expect(commandForKey(key(" "), "tv")).toEqual({ type: "togglePlay" });
    expect(commandForKey(key("k"), "tv")).toEqual({ type: "togglePlay" });
    expect(commandForKey(key(" "), "tv", "overlay")).toBeNull();
  });
});
