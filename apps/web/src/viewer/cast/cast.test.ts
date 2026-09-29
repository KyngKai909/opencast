import { describe, expect, it } from "vitest";
import { CAST_NAMESPACE, parseCastCommand } from "@opencast/player";
import { changedByOther, commandMessage, isReceiverReady, parseState, phoneName, sessionMessage, SIGNED_OUT_NAME } from "./messages";
import { TARGET_KINDS, orderTargets, primaryLabel, uniqueTargets } from "./targets";
import { aboutTime, batteryLine, minutesLeft, type BatteryReading } from "./mirroring";
import type { CastTarget, RemoteCommand } from "./types";

describe("the phone's name on the TV's chip", () => {
  it("is the account's first name", () => {
    expect(phoneName("Kai M.")).toBe("Kai's phone");
    expect(phoneName("Dana Whitfield")).toBe("Dana's phone");
    expect(phoneName("Kai.")).toBe("Kai's phone");
  });
  it("falls back to 'a phone' (\"Playing from a phone\") with no name", () => {
    expect(phoneName(null)).toBe(SIGNED_OUT_NAME);
    expect(phoneName("   ")).toBe("a phone");
  });
});

describe("messages on the Cast namespace", () => {
  it("introduces the phone with exactly the receiver's session shape", () => {
    expect(sessionMessage({ from: "Kai's phone", marketSlug: "inland-empire", othersCanChange: true })).toEqual({ type: "session", from: "Kai's phone", marketSlug: "inland-empire", othersCanChange: true });
  });
  it("names the phone on every command, in shapes the receiver's parser accepts", () => {
    const commands: RemoteCommand[] = [
      { type: "channel", dir: "up" },
      { type: "tune", channel: "24.1" },
      { type: "preset", key: 2 },
      { type: "last" },
      { type: "info" },
      { type: "pause" },
      { type: "play" },
      { type: "sleep", until: "end_of_program" },
      { type: "sleep", until: 30 }
    ];
    for (const c of commands) {
      const m = commandMessage(c, "Kai's phone");
      expect(m.from).toBe("Kai's phone");
      expect(parseCastCommand(m)).not.toBeNull();
    }
    expect(CAST_NAMESPACE).toBe("urn:x-cast:org.useopencast.tv");
  });
  it("reads the receiver's state from an object (the mock) or a string (a real session)", () => {
    const s = { type: "state", stationId: "b", paused: true, changedBy: "Dana's phone", sleepEndsAt: 123 };
    expect(parseState(s)).toEqual({ stationId: "b", paused: true, changedBy: "Dana's phone", sleepEndsAt: 123 });
    expect(parseState(JSON.stringify(s))).toEqual(parseState(s));
    expect(parseState({ type: "state", stationId: null })).toEqual({ stationId: null, paused: false, changedBy: null, sleepEndsAt: null });
    expect(parseState({ type: "receiver-ready" })).toBeNull();
    expect(parseState("not json")).toBeNull();
    expect(isReceiverReady({ type: "receiver-ready" })).toBe(true);
  });
  it("says another phone changed the channel only when the state names someone else", () => {
    const st = (changedBy: string | null) => ({ stationId: "b", paused: false, changedBy, sleepEndsAt: null });
    expect(changedByOther(st("Dana's phone"), "Kai's phone")).toBe("Dana's phone");
    expect(changedByOther(st("Kai's phone"), "Kai's phone")).toBeNull();
    expect(changedByOther(st(null), "Kai's phone")).toBeNull();
    expect(changedByOther(null, "Kai's phone")).toBeNull();
  });
});

describe("Watch on: target kinds", () => {
  const living: CastTarget = { id: "l", name: "Living room TV", kind: "chromecast" };
  const bedroom: CastTarget = { id: "a", name: "Bedroom TV", kind: "airplay" };
  const den: CastTarget = { id: "d", name: "Den TV", kind: "tv_app" };

  it("sends each kind the way that works best (the note: Cast, Mirror, Open the app)", () => {
    expect(TARGET_KINDS.chromecast).toMatchObject({ action: "cast", verb: "Cast", kindLine: "Chromecast" });
    expect(TARGET_KINDS.airplay).toMatchObject({ action: "mirror", verb: "Mirror", kindLine: "AirPlay" });
    expect(TARGET_KINDS.tv_app).toMatchObject({ action: "open_app", verb: "Open the app" });
  });
  it("labels the button by the choice", () => {
    expect(primaryLabel({ kind: "tv", target: living }, null)).toBe("Cast to Living room TV");
    expect(primaryLabel({ kind: "tv", target: bedroom }, null)).toBe("Mirror to Bedroom TV");
    expect(primaryLabel({ kind: "tv", target: den }, null)).toBe("Open the app on Den TV");
    expect(primaryLabel({ kind: "tv", target: living }, living)).toBe("Open the remote");
    expect(primaryLabel({ kind: "phone" }, living)).toBe("Watch on this phone");
    expect(primaryLabel({ kind: "tv", target: { id: "p", name: "A TV with Chromecast", kind: "chromecast", picker: true } }, null)).toBe("Cast to a TV");
    expect(primaryLabel(null, null)).toBeNull();
  });
  it("puts a TV with the app first and lists each TV once", () => {
    expect(orderTargets([living, bedroom, den]).map((t) => t.id)).toEqual(["d", "l", "a"]);
    expect(uniqueTargets([living, { ...living, id: "l2", name: "living room tv" }, bedroom]).map((t) => t.id)).toEqual(["l", "a"]);
  });
});

describe("the battery line while mirroring", () => {
  const t0 = Date.parse("2026-09-27T03:32:00Z");
  const r = (min: number, level: number, charging = false): BatteryReading => ({ level, charging, at: t0 + min * 60e3 });

  it("says the frame's line from ten minutes of readings", () => {
    const readings = [r(0, 0.676), r(10, 0.64)];
    expect(Math.round(minutesLeft(readings)!)).toBe(178);
    expect(batteryLine(readings)).toBe("Battery: 64%, about 3 hours at this rate.");
  });
  it("says nothing until there's a rate (under five minutes, or not falling)", () => {
    expect(batteryLine([r(0, 0.64)])).toBeNull();
    expect(batteryLine([r(0, 0.65), r(3, 0.64)])).toBeNull();
    expect(batteryLine([r(0, 0.64), r(10, 0.64)])).toBeNull();
  });
  it("says when it's charging, and measures only since it stopped", () => {
    expect(batteryLine([r(0, 0.5), r(10, 0.55, true)])).toBe("Battery: 55%, charging.");
    expect(minutesLeft([r(0, 0.9), r(5, 0.6, true), r(6, 0.6), r(8, 0.59)])).toBeNull();
  });
  it("rounds the time left the way people say it", () => {
    expect(aboutTime(178)).toBe("3 hours");
    expect(aboutTime(80)).toBe("1 hour");
    expect(aboutTime(42)).toBe("40 minutes");
    expect(aboutTime(2)).toBe("5 minutes");
  });
});
