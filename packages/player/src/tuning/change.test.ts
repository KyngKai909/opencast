// The channel change's timing state machine (follow-up Phase 5): 300 ms of static at least, the
// program's name and "Tuning in" after 800 ms, Stand by after 8 s, one 160 ms roll, then the
// banner; repeated presses; the reduced-motion and radio band looks; the photosensitivity guard.
// The clock is pinned to the reference's Saturday, 8:42 pm (Pacific).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelChange, clearingFor, minimumFor, type TuningState } from "./change";
import { CLEAR_GAP_MS, CROSSFADE_MS, MIN_STATIC_MS, ROLL_MS, STANDBY_MS, SWEEP_MS, TUNING_IN_MS } from "./constants";
import { needleAt, sweepDistance } from "./sweep";

const SATURDAY_842PM = new Date("2026-09-27T03:42:00Z");

let states: Array<TuningState | null>;
let standby: string[];
let cleared: Array<[string, string, boolean]>;
let c: ChannelChange;
const t0 = SATURDAY_842PM.getTime();
const at = () => Date.now() - t0;
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(SATURDAY_842PM);
  states = [];
  standby = [];
  cleared = [];
  c = new ChannelChange({
    onChange: (s) => states.push(s),
    onStandby: (id) => standby.push(id),
    onCleared: (id, look, fromStandby) => cleared.push([id, look, fromStandby])
  });
});
afterEach(() => {
  c.destroy();
  vi.useRealTimers();
});

describe("the timings", () => {
  it("are the reference's", () => {
    expect([MIN_STATIC_MS, TUNING_IN_MS, STANDBY_MS, ROLL_MS, CROSSFADE_MS, SWEEP_MS]).toEqual([300, 800, 8000, 160, 200, 400]);
    expect([minimumFor("static"), minimumFor("fade"), minimumFor("sweep"), minimumFor("none")]).toEqual([300, 200, 400, 0]);
    expect([clearingFor("static"), clearingFor("fade"), clearingFor("sweep"), clearingFor("none")]).toEqual([160, 200, 200, 0]);
  });
});

describe("a channel change", () => {
  it("shows the number and the static at once, and holds it 300 ms even when the picture is already there", async () => {
    c.press("sazn", "static");
    expect(c.state).toMatchObject({ stationId: "sazn", look: "static", phase: "static", presses: 1 });
    // The next channel was preloaded: its first frame is there 40 ms later.
    await tick(40);
    let swappedAt = -1;
    void c.ready().then((ok) => {
      expect(ok).toBe(true);
      swappedAt = at();
      c.clear();
    });
    await tick(200);
    expect(swappedAt).toBe(-1);
    await tick(60);
    expect(swappedAt).toBe(MIN_STATIC_MS);
    // One 160 ms roll, then it's done and the banner has its turn.
    expect(c.state?.phase).toBe("clearing");
    expect(cleared).toEqual([]);
    await tick(ROLL_MS - 1);
    expect(c.state?.phase).toBe("clearing");
    await tick(1);
    expect(c.state).toBeNull();
    expect(cleared).toEqual([["sazn", "static", false]]);
    expect(standby).toEqual([]);
  });

  it("runs for as long as the first frame takes, with the program's name and \"Tuning in\" from 800 ms", async () => {
    c.press("sazn", "static");
    await tick(799);
    expect(c.state?.phase).toBe("static");
    await tick(1);
    expect(c.state?.phase).toBe("tuning_in");
    // The frame at 2 s: the swap at once (the minimum is long past), then the roll.
    await tick(1200);
    const ok = await c.ready();
    expect(ok).toBe(true);
    c.clear();
    expect(c.state?.phase).toBe("clearing");
    await tick(ROLL_MS);
    expect(cleared).toEqual([["sazn", "static", false]]);
  });

  it("becomes Stand by after 8 s without a frame, and a picture that comes later replaces it (no static), then the banner", async () => {
    c.press("sazn", "static");
    await tick(STANDBY_MS - 1);
    expect(standby).toEqual([]);
    await tick(1);
    expect(standby).toEqual(["sazn"]);
    // Nothing drawn: Stand by is its own screen.
    expect(c.state).toBeNull();
    expect(c.standingBy).toBe("sazn");
    await tick(5000);
    expect(await c.ready()).toBe(true);
    c.clear();
    expect(cleared).toEqual([["sazn", "none", true]]);
    expect(c.standingBy).toBeNull();
  });

  it("a frame just before 8 s is never Stand by", async () => {
    c.press("sazn", "static");
    await tick(STANDBY_MS - 10);
    const ready = c.ready();
    await tick(100);
    expect(await ready).toBe(true);
    expect(standby).toEqual([]);
  });
});

describe("repeated presses", () => {
  it("update the number each time; the static stays up; the 800 ms and 8 s count from the last press", async () => {
    c.press("beat", "static");
    await tick(100);
    c.press("sazn", "static");
    await tick(100);
    c.press("reel", "static");
    expect(c.state).toMatchObject({ stationId: "reel", phase: "static", presses: 3, since: t0 });
    // Only one cover came up for the three presses.
    expect(c.changes.map((x) => x.kind)).toEqual(["up"]);
    await tick(799);
    expect(c.state?.phase).toBe("static");
    await tick(1);
    expect(c.state?.phase).toBe("tuning_in");
    await tick(STANDBY_MS - TUNING_IN_MS - 1);
    expect(standby).toEqual([]);
    await tick(1);
    expect(standby).toEqual(["reel"]);
  });

  it("a wait for an earlier press's picture gives up when another press comes", async () => {
    c.press("beat", "static");
    await tick(50);
    const first = c.ready();
    await tick(10);
    c.press("sazn", "static");
    expect(await first).toBe(false);
  });

  it("a press during the roll brings the static back, for the new channel", async () => {
    c.press("beat", "static");
    await tick(MIN_STATIC_MS);
    expect(await c.ready()).toBe(true);
    c.clear();
    await tick(80);
    c.press("sazn", "static");
    expect(c.state).toMatchObject({ stationId: "sazn", phase: "static" });
    expect(c.changes.map((x) => x.kind)).toEqual(["up", "clear", "up"]);
    await tick(ROLL_MS);
    expect(cleared).toEqual([]);
  });
});

describe("the photosensitivity guard", () => {
  it("clears at most once a second: a second change right after the first holds its static until then", async () => {
    c.press("beat", "static");
    await tick(MIN_STATIC_MS);
    expect(await c.ready()).toBe(true);
    c.clear(); // at 300
    await tick(ROLL_MS + 20);
    c.press("sazn", "static"); // at 480
    let swappedAt = -1;
    void c.ready().then((ok) => ok && ((swappedAt = at()), c.clear()));
    await tick(400);
    expect(swappedAt).toBe(-1);
    await tick(1000);
    expect(swappedAt).toBe(MIN_STATIC_MS + CLEAR_GAP_MS);
    const clears = c.changes.filter((x) => x.kind === "clear").map((x) => x.at - t0);
    expect(clears).toEqual([300, 1300]);
  });
});

describe("reduced motion", () => {
  it("is a crossfade: 200 ms at least, and 200 ms to clear, with the same corner number", async () => {
    c.press("sazn", "fade");
    expect(c.state).toMatchObject({ look: "fade", stationId: "sazn" });
    let swappedAt = -1;
    void c.ready().then((ok) => ok && ((swappedAt = at()), c.clear()));
    await tick(CROSSFADE_MS);
    expect(swappedAt).toBe(CROSSFADE_MS);
    expect(c.state?.phase).toBe("clearing");
    await tick(CROSSFADE_MS);
    expect(cleared).toEqual([["sazn", "fade", false]]);
  });
});

describe("the radio band", () => {
  it("sweeps the needle the real distance in 400 ms, eased, from wherever it is when pressed again", async () => {
    c.press("sola", "sweep", { from: 88.3, to: 94.7 });
    const s = c.state!.sweep!;
    expect(s).toMatchObject({ from: 88.3, to: 94.7, ms: SWEEP_MS });
    expect(sweepDistance(s)).toBeCloseTo(6.4);
    // Eased: slow to start, and there on time.
    expect(needleAt(s, s.at + 40) - 88.3).toBeLessThan(6.4 * 0.1);
    expect(needleAt(s, s.at + 200)).toBeGreaterThan(88.3 + 6.4 * 0.4);
    expect(needleAt(s, s.at + SWEEP_MS)).toBeCloseTo(94.7);
    // Up the band again halfway: it goes on from where the needle is, not from 94.7.
    await tick(200);
    const mid = needleAt(s, Date.now());
    c.press("dusk", "sweep", { from: 94.7, to: 99.5 });
    const s2 = c.state!.sweep!;
    expect(s2.from).toBeCloseTo(mid);
    expect(s2.to).toBe(99.5);
    // At least the sweep's length before the station's sound can take over.
    let swappedAt = -1;
    void c.ready().then((ok) => ok && (swappedAt = at()));
    await tick(SWEEP_MS);
    expect(swappedAt).toBe(SWEEP_MS);
  });

  it("with reduced motion, the needle jumps", () => {
    c.press("sola", "sweep", { from: 88.3, to: 94.7, reduced: true });
    const s = c.state!.sweep!;
    expect(s.ms).toBe(0);
    expect(needleAt(s, s.at)).toBe(94.7);
  });
});

describe("the \"none\" look (first launch, a station coming back)", () => {
  it("draws nothing and waits no minimum, but still turns into Stand by at 8 s", async () => {
    c.press("civc", "none");
    expect(c.state).toBeNull();
    expect(states.every((s) => s === null)).toBe(true);
    await tick(STANDBY_MS);
    expect(standby).toEqual(["civc"]);
  });

  it("clears at once when the picture is there", async () => {
    c.press("civc", "none");
    expect(await c.ready()).toBe(true);
    c.clear();
    expect(cleared).toEqual([["civc", "none", false]]);
    expect(c.changes).toEqual([]);
  });
});
