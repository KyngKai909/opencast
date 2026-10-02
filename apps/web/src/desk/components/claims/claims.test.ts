// The Rights claims page's words (desk-pages 01): the rows, the figures and the timeline, from the
// shared contract code that builds a claim's steps.
import { describe, expect, it } from "vitest";
import { claimNext, claimTimeline, type ClaimFacts, type DeskClaim, type DeskClaims } from "@opencast/contracts";
import { claimLine, claimStats, nextText, outcomeChoices, programLine, shortClaimant, shortDay, stateTag, timelineItems } from "./claims";

const TZ = "America/Los_Angeles";
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const BEAT = { id: U(106), kind: "station" as const, callSign: "BEAT", handle: "beat", name: "Inland Beat", colour: "#8C3B7A", band: "tv" as const, channel: "12.1", marketSlug: "inland-empire", homeCity: "Redlands" };
const REEL = { ...BEAT, id: U(108), callSign: "REEL", name: "Reel Inland", channel: "24.1" };

function claim(over: Partial<DeskClaim> = {}): DeskClaim {
  const facts: ClaimFacts = {
    kind: over.kind ?? "copyright",
    state: over.state ?? "open",
    receivedAt: "2026-09-12T21:04:00.000Z",
    answerDueAt: "2026-09-26T21:04:00.000Z",
    closedAt: null,
    answer: over.answer ?? null,
    takedowns: [{ pulledAt: "2026-09-12T21:04:00.000Z", restoredAt: over.answer ? over.answer.answeredAt : null }]
  };
  return {
    id: U(1),
    kind: facts.kind,
    item: { id: U(2), title: "Late Crate, ep. 9" },
    station: BEAT,
    claimantName: "Northside Records",
    claimantRole: null,
    workKind: "Two tracks in the second half",
    claimText: "Two of our masters.",
    rangeStartMs: null,
    rangeEndMs: null,
    swornStatement: true,
    state: facts.state,
    receivedAt: facts.receivedAt,
    answerDueAt: facts.answerDueAt,
    daysToAnswer: 2,
    answer: null,
    takedowns: [],
    phase: "open",
    claimantContact: "rights@northside.example",
    market: null,
    next: claimNext(facts),
    carriers: [{ station: REEL, airingsPulled: 1, pulledAt: facts.receivedAt, restoredAt: null }],
    timeline: claimTimeline(facts),
    stationEmail: null,
    attachments: [],
    ...over
  };
}

describe("the rows", () => {
  it("say the program, the claim, the state and what's next", () => {
    const c = claim();
    expect(programLine(c)).toBe("Late Crate, ep. 9, on BEAT 12.1");
    expect(claimLine(c)).toBe("Northside Records: two tracks in the second half");
    expect(stateTag(c)).toEqual({ text: "Off air", variant: "off" });
    expect(nextText(c, TZ)).toBe("BEAT answers by Sept 26");
    expect(nextText(claim({ kind: "privacy" }), TZ)).toBe("Privacy, not copyright");
    const answer = { basis: "owner_permission", note: null, attachmentUrl: "https://files.example/l.pdf", answeredAt: "2026-09-15T17:30:00.000Z", claimantReplyDueAt: "2026-10-14T17:30:00.000Z" };
    const answered = claim({ state: "answered", answer });
    expect(stateTag(answered).text).toBe("Counter-notice sent");
    expect(nextText(answered, TZ)).toBe("Northside has until Oct 14");
  });

  it("shorten names and dates as the frame does", () => {
    expect(shortClaimant("Westside Tapes LLC")).toBe("Westside Tapes");
    expect(shortClaimant("Northside Records")).toBe("Northside");
    expect(shortClaimant("A Riverside resident")).toBe("A Riverside resident");
    expect(shortDay("2026-10-01T06:00:00.000Z", TZ)).toBe("Sept 30");
    expect(shortDay("2026-06-02T17:00:00.000Z", TZ)).toBe("June 2");
  });
});

describe("the timeline", () => {
  it("reads an open claim as received, off air on the station and its carriers, and the answer's date", () => {
    const items = timelineItems(claim(), TZ, new Date("2026-09-24T19:00:00.000Z"));
    expect(items.map((i) => [i.when, i.title, i.state])).toEqual([
      ["Sept 12, 2:04 pm", "Claim received", "done"],
      ["Sept 12, 2:04 pm", "Off air on BEAT and 1 carrier", "done"],
      ["By Sept 26", "BEAT answers or removes it", "current"]
    ]);
    expect(items[2]!.detail).toBe("2 days left. With no answer, it's removed from the library");
  });

  it("reads an answered claim through the counter-notice to the claimant's date", () => {
    const answer = { basis: "owner_permission", note: null, attachmentUrl: "https://files.example/l.pdf", answeredAt: "2026-09-15T17:30:00.000Z", claimantReplyDueAt: "2026-09-29T17:30:00.000Z" };
    const items = timelineItems(claim({ state: "answered", answer }), TZ, new Date("2026-09-24T19:00:00.000Z"));
    expect(items.map((i) => i.title)).toEqual(["Claim received", "Off air on BEAT and 1 carrier", "BEAT answered", "Counter-notice sent to the claimant", "Back on air on BEAT and 1 carrier", "Northside's time to take legal action ends"]);
    expect(items[2]!.detail).toBe('"The owner gave permission," with the licence attached');
    expect(items[5]).toMatchObject({ when: "Sept 29", state: "current" });
  });

  it("reads a privacy complaint as waiting on Opencast's review", () => {
    const items = timelineItems(claim({ kind: "privacy" }), TZ, new Date("2026-09-24T19:00:00.000Z"));
    expect(items.map((i) => i.title)).toEqual(["Privacy complaint received", "Off air on BEAT and 1 carrier", "Opencast reviews it"]);
    expect(outcomeChoices(claim({ kind: "privacy" }))[0]!.helper).toMatch(/don't count toward the repeat limit/);
  });
});

describe("the figures", () => {
  const stats = (s: Partial<DeskClaims["stats"]>) =>
    claimStats({ claims: [], stations: [], rules: { repeatLimit: 3, answerDays: 14, counterNoticeBusinessDays: 10 }, canResolve: true, stats: { open: 4, offAir: 4, answersDue: 1, soonestAnswerDays: 2, carryingStations: 11, nearRepeatLimit: 0, ...s } }).map((x) => `${x.value} ${x.caption}`);

  it("say them as the frame does", () => {
    expect(stats({})).toEqual(["4 Open claims, all off air", "1 Station answer due in 2 days", "11 Stations carrying something that was claimed", "0 Stations near the repeat limit"]);
    expect(stats({ offAir: 3, answersDue: 2, soonestAnswerDays: 0 }).slice(0, 2)).toEqual(["4 Open claims, 3 off air", "2 Station answers due, the first today"]);
    expect(stats({ open: 0, offAir: 0, answersDue: 0, soonestAnswerDays: null }).slice(0, 2)).toEqual(["0 Open claims", "0 Station answers due in the next 3 days"]);
  });
});
