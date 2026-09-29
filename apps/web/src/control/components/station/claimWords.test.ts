import { describe, expect, it } from "vitest";
import type { ClaimX } from "../../api/ext/station";
import { BEAT, HALL, stationByRef, uid } from "../../mocks/fixtures/stations";
import { attestation, claimedLine, headline, itemLine, openTimeline, resolvedSummary, resolvedTimeline, stateWords, takedownLine, takedownTag, BASIS_WORDS } from "./claimWords";

const TZ = "America/Los_Angeles";
const NOW = new Date("2026-09-27T03:42:12Z");
const local = (s: string) => new Date(`${s}-07:00`).toISOString();

const open: ClaimX = {
  id: uid(1),
  item: { id: uid(2), title: "Crate Session 03" },
  station: BEAT,
  claimantName: "Westside Tapes LLC",
  claimantRole: "Says they own the master recording",
  workKind: "A master recording",
  workNoun: "recording",
  claimText: "…",
  rangeStartMs: 760_000,
  rangeEndMs: 1_865_000,
  swornStatement: true,
  state: "open",
  receivedAt: local("2026-09-26T15:12:00"),
  answerDueAt: local("2026-10-05T15:12:00"),
  daysToAnswer: 9,
  answer: null,
  takedowns: [{ station: BEAT, pulledAt: local("2026-09-26T15:12:00"), airingsReplaced: 1, replacedWith: "Late Crate, ep. 13", restoredAt: null }]
};

const SAZN = stationByRef("SAZN")!;
const carried: ClaimX = {
  ...open,
  item: { id: uid(3), title: "Late Crate, ep. 12" },
  claimantName: "R. Delgado",
  workKind: "A sample in the second segment",
  state: "restored",
  receivedAt: local("2026-08-19T11:02:00"),
  answer: { basis: "made_it", note: null, attachmentUrl: null, answeredAt: local("2026-08-20T10:15:00"), claimantReplyDueAt: local("2026-09-03T10:15:00") },
  takedowns: [
    { station: BEAT, pulledAt: local("2026-08-19T11:02:00"), airingsReplaced: 2, replacedWith: "ep. 13", restoredAt: local("2026-08-30T09:00:00") },
    { station: HALL, pulledAt: local("2026-08-19T11:02:00"), airingsReplaced: 3, replacedWith: "the next episode", restoredAt: local("2026-08-30T09:00:00"), term: "barter" },
    { station: SAZN, pulledAt: local("2026-08-19T11:02:00"), airingsReplaced: 1, replacedWith: "ep. 11", restoredAt: local("2026-08-30T09:00:00"), term: "barter" }
  ]
};

describe("the rights list's words (rights 01.1)", () => {
  it("says each state as the frame does", () => {
    expect(stateWords(open, "BEAT")).toEqual({ text: "Off air, 9 days to answer", tone: "standby" });
    expect(stateWords({ ...open, daysToAnswer: 1 }, "BEAT").text).toBe("Off air, 1 day to answer");
    expect(stateWords(carried, "BEAT").text).toBe("Answered, back on air");
    expect(stateWords({ ...open, state: "removed" }, "BEAT").text).toBe("Removed by BEAT");
    expect(stateWords({ ...open, state: "expired" }, "BEAT").text).toBe("Removed");
    expect(stateWords({ ...open, state: "withdrawn" }, "BEAT").text).toBe("Back on air");
  });

  it("describes the item", () => {
    expect(itemLine(open, true)).toBe("Imported from a link. Claim: the recording is theirs");
    expect(itemLine(carried, false)).toBe("A sample in the second segment");
  });
});

describe("an open claim (rights 02.1)", () => {
  it("heads it in the claimant's name", () => {
    expect(headline(open)).toBe("Westside Tapes LLC says they own this recording.");
    expect(headline(open, true)).toBe("Westside Tapes says they own this recording");
    expect(claimedLine(open, "12:40 to 31:05")).toBe("12:40 to 31:05, a master recording");
  });

  it("lays out what happens next", () => {
    const t = openTimeline(open, "BEAT", NOW, TZ);
    expect(t.map((x) => [x.state, x.when, x.title])).toEqual([
      ["done", "Today, 3:12 pm", "Claim received, item off air"],
      ["current", "By October 5", "BEAT removes it or answers"],
      ["future", "If answered", "Westside Tapes has 10 business days to take it further"],
      ["future", "If no answer", "Removed from the library on October 5"]
    ]);
    expect(t[1]!.detail).toBe("9 days left");
    expect(t[3]!.detail).toBe("Counts as removed, not upheld");
  });

  it("offers the library's three answers in the station's name", () => {
    expect(BASIS_WORDS.made_it.helper("BEAT", "recording")).toBe("BEAT owns the recording outright");
    expect(attestation(open, "BEAT").bold).toBe("I understand this answer goes to Westside Tapes with BEAT's legal name and contact,");
  });
});

describe("a claim on a carried program (rights 04.1)", () => {
  it("sums it up in a line", () => {
    expect(resolvedSummary(carried, "BEAT", TZ)).toBe("Received August 19 from R. Delgado. Answered August 20. Back on air August 30.");
  });

  it("tells the timeline", () => {
    expect(resolvedTimeline(carried, "BEAT", TZ).map((x) => [x.when, x.title, x.detail])).toEqual([
      ["Aug 19", "Claim, pulled from 3 stations", undefined],
      ["Aug 20", "BEAT answered", "We made it"],
      ["Aug 30", "No further action from the claimant", "Back on air on all 3 stations"]
    ]);
  });

  it("lists where it was pulled, the maker's way and a carrier's", () => {
    expect(takedownLine(carried.takedowns[0]!, true)).toBe("2 airings, replaced with ep. 13");
    expect(takedownLine(carried.takedowns[1]!, false)).toBe("Carries on barter. 3 airings replaced with the next episode");
    expect(takedownLine(carried.takedowns[2]!, false)).toBe("Carries on barter. 1 airing replaced with ep. 11");
    expect(takedownTag(carried, carried.takedowns[0]!)).toBe("Back on air");
    expect(takedownTag({ ...open, state: "removed" }, open.takedowns[0]!)).toBe("Removed");
    expect(takedownTag(open, open.takedowns[0]!)).toBe("Pulled");
  });
});
