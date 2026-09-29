import { describe, expect, it } from "vitest";
import { airedLabel, blockDetail, blockPhase, canContinueSetup, countdown, dayLabel, descriptionCount, elapsed, librarySummary, nextBlock, readyLine, relativeLabel, signalWords, whenLabel } from "./logic";

const TZ = "America/Los_Angeles";
// Saturday, September 26, 8:42:12 pm in Redlands.
const NOW = Date.parse("2026-09-27T03:42:12Z");
const pt = (s: string) => new Date(`${s}-07:00`).toISOString();

describe("a live block's phase", () => {
  const b = { startsAt: pt("2026-09-27T19:00:00"), endsAt: pt("2026-09-27T20:00:00") };
  it("stands by until its block starts, by itself", () => {
    expect(blockPhase(b, Date.parse(pt("2026-09-27T18:57:46")))).toBe("standby");
    expect(blockPhase(b, Date.parse(pt("2026-09-27T19:00:00")))).toBe("on_air");
    expect(blockPhase(b, Date.parse(pt("2026-09-27T20:00:00")))).toBe("ended");
  });
  it("ends when it's ended early", () => {
    expect(blockPhase(b, Date.parse(pt("2026-09-27T19:30:00")), pt("2026-09-27T19:20:00"))).toBe("ended");
    expect(blockPhase(b, Date.parse(pt("2026-09-27T19:10:00")), pt("2026-09-27T19:20:00"))).toBe("on_air");
  });
});

describe("the countdown", () => {
  it("reads as the frames do", () => {
    expect(countdown(pt("2026-09-27T19:00:00"), Date.parse(pt("2026-09-27T18:57:46")))).toBe("2:14");
    expect(countdown(pt("2026-09-27T19:00:00"), Date.parse(pt("2026-09-27T18:59:18")))).toBe("0:42");
    expect(countdown(pt("2026-09-27T19:00:00"), Date.parse(pt("2026-09-27T18:59:59.4")))).toBe("0:01");
    expect(countdown(pt("2026-09-27T19:00:00"), Date.parse(pt("2026-09-27T19:00:02")))).toBe("0:00");
    expect(countdown(pt("2026-09-27T19:00:00"), NOW)).toBe("22:17:48");
  });
  it("says how long it's been on", () => {
    expect(elapsed(pt("2026-09-27T19:00:00"), Date.parse(pt("2026-09-27T19:24:10")))).toBe("24:10 in");
  });
});

describe("day labels", () => {
  it("say tonight, a weekday, or a weekday and date a week out", () => {
    expect(dayLabel(pt("2026-09-26T21:01:00"), NOW, TZ)).toBe("Tonight");
    expect(dayLabel(pt("2026-09-27T00:00:00"), NOW, TZ)).toBe("Sunday");
    expect(dayLabel(pt("2026-09-30T19:00:00"), NOW, TZ)).toBe("Wednesday");
    expect(dayLabel(pt("2026-10-03T20:30:00"), NOW, TZ)).toBe("Saturday");
    expect(dayLabel(pt("2026-10-03T21:00:00"), NOW, TZ)).toBe("Saturday Oct 3");
  });
  it("write the item page's times", () => {
    expect(whenLabel(pt("2026-09-26T22:00:00"), NOW, TZ)).toBe("Tonight, 10:00 pm");
    expect(whenLabel(pt("2026-09-27T00:00:00"), NOW, TZ)).toBe("Sunday, 12:00 am");
    expect(airedLabel(pt("2026-09-26T03:00:00"), TZ)).toBe("Saturday, September 26, 3:00 am");
    expect(relativeLabel(pt("2026-09-26T22:00:00"), NOW, TZ)).toBe("In 1 hr 18 min");
    expect(relativeLabel(pt("2026-09-27T00:00:00"), NOW, TZ)).toBe("Tomorrow");
  });
});

describe("the live sources table", () => {
  const tonight = { startsAt: pt("2026-09-26T21:00:00"), endsAt: pt("2026-09-26T22:00:00"), repeatGroupId: null };
  it("says when a block starts soon, or that it's weekly", () => {
    expect(blockDetail(tonight, NOW)).toBe("Starts in 18 min");
    expect(blockDetail({ ...tonight, startsAt: pt("2026-09-30T19:00:00"), endsAt: pt("2026-09-30T20:00:00"), repeatGroupId: "x" }, NOW)).toBe("Weekly");
  });
  it("reads the signal, or Next week for a block a week out", () => {
    expect(signalWords({ signal: "receiving", quality: "1080p" }, tonight, NOW)).toEqual({ text: "Receiving, 1080p", tone: "ok" });
    expect(signalWords({ signal: "not_connected" }, tonight, NOW)).toEqual({ text: "Not connected yet", tone: "no" });
    expect(signalWords({ signal: "receiving" }, { startsAt: pt("2026-10-03T21:00:00") }, NOW).text).toBe("Next week");
  });
});

describe("which block /live opens", () => {
  const e = (id: string, start: string, end: string, programId: string, kind = "live") => ({ id, kind, startsAt: pt(start), endsAt: pt(end), programId, liveSourceId: null });
  const log = [
    e("reel", "2026-09-26T20:30:00", "2026-09-26T20:59:00", "reel", "program"),
    e("btl", "2026-09-26T21:01:00", "2026-09-26T21:58:00", "btl"),
    e("ct", "2026-09-27T19:00:00", "2026-09-27T20:00:00", "ct")
  ];
  it("gives anyone who isn't a host the next live block", () => {
    expect(nextBlock(log, NOW, null)?.id).toBe("btl");
  });
  it("gives a host only their own", () => {
    expect(nextBlock(log, NOW, { programIds: ["ct"] })?.id).toBe("ct");
    expect(nextBlock(log, NOW, { programIds: [] })).toBeNull();
  });
  it("counts a block on air now", () => {
    expect(nextBlock(log, Date.parse(pt("2026-09-26T21:30:00")), null)?.id).toBe("btl");
  });
});

describe("listings and the library", () => {
  it("counts to 160 and refuses more", () => {
    expect(descriptionCount("a".repeat(131))).toEqual({ label: "131 of 160", over: false });
    expect(descriptionCount("a".repeat(161)).over).toBe(true);
  });
  it("sums the setup library", () => {
    const s = librarySummary([
      { code: "PGM", durationMs: 28.5 * 60_000, rights: {} },
      { code: "PGM", durationMs: 58 * 60_000 + 40_000, rights: null },
      { code: "SID", durationMs: 5000, rights: {} },
      { code: "BMP", durationMs: 10_000, rights: {} }
    ]);
    expect(s).toEqual({ count: 4, programs: "1 hr 28 min", shorts: ":15", needRights: 1 });
  });
  it("needs a program and a station ID to go on", () => {
    expect(canContinueSetup([{ code: "PGM" }])).toBe(false);
    expect(canContinueSetup([{ code: "PGM" }, { code: "SID" }])).toBe(true);
  });
  it("writes a ready item's line", () => {
    expect(readyLine({ picture: { height: 720 }, mediaKind: "video", audioLayout: "stereo" })).toBe("720p, stereo");
  });
});
