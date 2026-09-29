// The permission page's words and states (network-desk 06.1, 06.2).
import { describe, expect, it } from "vitest";
import { PERMISSION_COPY as C } from "./copy";
import { mainNoun, pageState, whenLine, worksLine } from "./words";

const works = [
  ...Array.from({ length: 6 }, (_, i) => ({ id: `f${i}`, title: `Film ${i}`, durationMs: 40 * 60_000, included: true, leftOutReason: null, groupLabel: "Full-length skate films", noun: "film" })),
  ...Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, title: `Short ${i}`, durationMs: 8 * 60_000, included: true, leftOutReason: null, groupLabel: "Park session edits", noun: "short" })),
  { id: "x", title: "Sponsor edit for a shoe brand", durationMs: 4 * 60_000, included: false, leftOutReason: "Likely someone else's rights", groupLabel: null, noun: "edit" }
];

describe("what they'd say yes to", () => {
  it("names the works in a line, from the page's summary when it has one", () => {
    expect(worksLine({ works, summary: { included: "6 skate films and 7 park session edits", leftOut: "the shoe sponsor edit" } })).toEqual({ included: "6 skate films and 7 park session edits", leftOut: "the shoe sponsor edit" });
    expect(worksLine({ works, summary: null })).toEqual({ included: "6 full-length skate films and 7 park session edits", leftOut: "the sponsor edit for a shoe brand" });
  });

  it("reads the frame's words", () => {
    expect(C.title(mainNoun(works), "Inland Empire")).toBe("A station of your films, on the Inland Empire dial.");
    expect(C.works("6 skate films and 7 park session edits", "Vimeo", "the shoe sponsor edit")).toBe("6 skate films and 7 park session edits from your Vimeo. Not the shoe sponsor edit");
    expect(C.works("48 cooking videos", "YouTube", null)).toBe("48 cooking videos from your YouTube");
    expect(C.station("films", whenLine({ schedulePreview: [{ time: "19:00", title: "a", source: "creator" }] }), "Desert Skate Films")).toBe('Your films in the evenings, other programming in between. Labelled "Run by Opencast for Desert Skate Films"');
    expect(C.saidYes(13, "September 27 at 10:15 am")).toBe("13 works, on September 27 at 10:15 am. We've emailed you a copy");
  });
});

describe("the page's state", () => {
  const base = { answer: null, stoppedAt: null, claim: null };
  const yes = { answer: "yes" as const, answeredAt: "2026-09-27T17:15:00.000Z", works: 13 };
  it("goes unanswered → yes → claiming, or → stopped; a no is final", () => {
    expect(pageState(base)).toBe("unanswered");
    expect(pageState({ ...base, answer: yes })).toBe("yes");
    expect(pageState({ ...base, answer: { ...yes, answer: "no" } })).toBe("no");
    expect(pageState({ ...base, answer: yes, claim: { handoverId: "h", status: "verifying", startedAt: yes.answeredAt } })).toBe("claiming");
    expect(pageState({ ...base, answer: yes, claim: { handoverId: "h", status: "cancelled", startedAt: yes.answeredAt } })).toBe("yes");
    expect(pageState({ ...base, answer: yes, stoppedAt: "2026-09-28T00:00:00.000Z" })).toBe("stopped");
  });
});

describe("works with no group", () => {
  it("are counted by what they are", () => {
    const walks = Array.from({ length: 10 }, (_, i) => ({ id: `b${i}`, title: `Bird walk ${i + 1}`, durationMs: 22 * 60_000, included: true, leftOutReason: null, groupLabel: null, noun: "video" }));
    expect(worksLine({ works: walks, summary: null })).toEqual({ included: "10 videos", leftOut: null });
    expect(worksLine({ works: walks.slice(0, 1), summary: null }).included).toBe("Bird walk 1");
  });
});
