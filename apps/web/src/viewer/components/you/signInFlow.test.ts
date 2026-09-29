import { describe, expect, it, vi } from "vitest";
import { asksAnything, completeFirstSignIn, firstSignInQuestions, introLine, keepLine, looksLikeEmail, type Held } from "./signInFlow";

const held: Held = {
  presets: [
    { stationId: "a", key: 1 },
    { stationId: "b", key: 2 },
    { stationId: "c", key: null }
  ],
  reminders: [{ logEntryId: "r", switchMeOver: false, title: "Beat Tape Live", startsAt: "2026-09-27T04:00:00Z", stationId: "s" }]
};
const none: Held = { presets: [], reminders: [] };

describe("when the first sign-in's questions are asked", () => {
  it("asks when this device holds presets or reminders", () => {
    const q = firstSignInQuestions(held, { displayName: "Kai M." });
    expect(q).toEqual({ keep: true, nameMissing: false });
    expect(asksAnything(q)).toBe(true);
  });
  it("asks for a name the account doesn't have", () => expect(asksAnything(firstSignInQuestions(none, { displayName: null }))).toBe(true));
  it("goes straight to the action on a returning sign-in", () => expect(asksAnything(firstSignInQuestions(none, { displayName: "Kai M." }))).toBe(false));
});

describe("the step's words", () => {
  it("counts what's on the device", () => {
    expect(keepLine(held)).toBe("3 presets and 1 reminder you made before signing in");
    expect(keepLine({ presets: [held.presets[0]!], reminders: [] })).toBe("1 preset you made before signing in");
    expect(keepLine({ presets: [], reminders: [...held.reminders, ...held.reminders] })).toBe("2 reminders you made before signing in");
  });
  it("names where it goes back to", () => {
    expect(introLine({ keep: true, nameMissing: false }, "CIVC")).toBe("Two things before you go back to CIVC.");
    expect(introLine({ keep: false, nameMissing: true }, undefined)).toBe("One thing before you go back.");
  });
  it("checks an email address loosely", () => {
    expect(looksLikeEmail(" kai@example.com ")).toBe(true);
    expect(looksLikeEmail("kai@example")).toBe(false);
  });
});

describe("going back after the first sign-in", () => {
  const io = () => {
    const order: string[] = [];
    return {
      order,
      io: {
        mergeDevice: vi.fn(async () => void order.push("merge")),
        clearDevice: vi.fn(() => void order.push("clear")),
        updateName: vi.fn(async (n: string) => void order.push(`name ${n}`)),
        finish: vi.fn(async () => void order.push("finish"))
      }
    };
  };

  it("keeps what's on the device, then clears it, then names, then finishes the action", async () => {
    const t = io();
    await completeFirstSignIn({ keep: true, held, name: " Kai ", currentName: null }, t.io);
    expect(t.order).toEqual(["merge", "clear", "name Kai", "finish"]);
    expect(t.io.mergeDevice).toHaveBeenCalledWith(held);
  });
  it("both questions can be skipped: the action still runs", async () => {
    const t = io();
    await completeFirstSignIn({ keep: false, held, name: "", currentName: null }, t.io);
    expect(t.order).toEqual(["finish"]);
  });
  it("doesn't send a name that hasn't changed, or merge an empty device", async () => {
    const t = io();
    await completeFirstSignIn({ keep: true, held: none, name: "Kai M.", currentName: "Kai M." }, t.io);
    expect(t.order).toEqual(["finish"]);
  });
  it("stops before the action if keeping fails, so nothing lands out of order", async () => {
    const t = io();
    t.io.mergeDevice.mockRejectedValueOnce(new Error("Sign in to do that."));
    await expect(completeFirstSignIn({ keep: true, held, name: "", currentName: null }, t.io)).rejects.toThrow("Sign in to do that.");
    expect(t.io.finish).not.toHaveBeenCalled();
    expect(t.io.clearDevice).not.toHaveBeenCalled();
  });
});
