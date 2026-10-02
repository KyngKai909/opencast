// Your station's share option (A229): a subchannel beside the owner's own X.1, sharing its call
// sign unless they untick it, and the family's words in setup and settings.

import { describe, expect, it } from "vitest";
import { BEAT, HALL, TAPE } from "../../mocks/fixtures/stations";
import {
  besideFor,
  channelChanged,
  chooseChannelBody,
  familyChannelNote,
  familyHelp,
  familyLine,
  isSubchannel,
  ownSubchannelOptions,
  ownSubchannelWords,
  shareHelper,
  shareLabel,
  shownCallSign,
  signOnFamilyNote
} from "./family";

const offered = [{ channel: "12.3", beside: BEAT }];
const NEW = { self: "new-station", band: "tv" as const, channel: null, sharesWith: null };

describe("the subchannels offered beside your own station", () => {
  it("are the API's, on the TV band only", () => {
    expect(ownSubchannelOptions(offered, NEW)).toEqual(offered);
    expect(ownSubchannelOptions(offered, { ...NEW, band: "radio" })).toEqual([]);
    expect(ownSubchannelOptions(undefined, NEW)).toEqual([]);
  });

  it("never beside the station itself", () => {
    expect(ownSubchannelOptions(offered, { ...NEW, self: BEAT.id, channel: "12.1" })).toEqual([]);
  });

  it("keep the one the station is already on, in place of the next one", () => {
    expect(ownSubchannelOptions(offered, { ...NEW, self: TAPE.id, channel: "12.2", sharesWith: BEAT })).toEqual([{ channel: "12.2", beside: BEAT }]);
    // Not sharing, but on BEAT's major: still beside BEAT.
    expect(ownSubchannelOptions(offered, { ...NEW, self: TAPE.id, channel: "12.2" })).toEqual([{ channel: "12.2", beside: BEAT }]);
    // On another station's main channel: the offer stands.
    expect(ownSubchannelOptions(offered, { ...NEW, channel: "13.1" })).toEqual(offered);
  });

  it("names the station beside it", () => {
    expect(besideFor("12.3", offered)).toBe(BEAT);
    expect(besideFor("13.1", offered)).toBeNull();
    expect(besideFor(null, offered)).toBeNull();
    expect(ownSubchannelWords(offered[0]!)).toBe("12.3 next to 12.1 BEAT");
  });

  it("knows a subchannel", () => {
    expect(isSubchannel("12.2", "tv")).toBe(true);
    expect(isSubchannel("12.1", "tv")).toBe(false);
    expect(isSubchannel("88.4", "radio")).toBe(false);
  });
});

describe("choosing it", () => {
  it("sends shareCallSign only beside their own station", () => {
    expect(chooseChannelBody("m", "tv", "12.3", BEAT, true)).toEqual({ marketId: "m", band: "tv", channel: "12.3", shareCallSign: true });
    expect(chooseChannelBody("m", "tv", "12.3", BEAT, false)).toEqual({ marketId: "m", band: "tv", channel: "12.3", shareCallSign: false });
    expect(chooseChannelBody("m", "tv", "13.1", null, true)).toEqual({ marketId: "m", band: "tv", channel: "13.1" });
  });

  it("shows X.1's call sign, locked, while sharing; what's typed otherwise", () => {
    expect(shownCallSign("", BEAT, true)).toBe("BEAT");
    expect(shownCallSign("TAPE", BEAT, true)).toBe("BEAT");
    expect(shownCallSign("TAPE", BEAT, false)).toBe("TAPE");
    expect(shownCallSign("TAPE", null, true)).toBe("TAPE");
  });

  it("saves the channel again when sharing is turned on or off", () => {
    const saved = { channel: "12.2", band: "tv" as const, sharing: true };
    expect(channelChanged(saved, { channel: "12.2", band: "tv", beside: BEAT, share: true })).toBe(false);
    expect(channelChanged(saved, { channel: "12.2", band: "tv", beside: BEAT, share: false })).toBe(true);
    expect(channelChanged(saved, { channel: "13.1", band: "tv", beside: null, share: true })).toBe(true);
    expect(channelChanged(saved, { channel: null, band: "tv", beside: null, share: false })).toBe(false);
  });

  it("says what sharing means", () => {
    expect(shareLabel(BEAT)).toBe("Share 12.1 BEAT's call sign");
    expect(shareHelper(BEAT, "12.2", true, null)).toBe("Viewers see BEAT 12.2: the channel tells your stations apart. Once it signs on, it keeps this call sign.");
    expect(shareHelper(BEAT, "12.2", true, "TAPE")).toMatch(/ TAPE is let go\.$/);
    expect(shareHelper(BEAT, "12.2", false, "TAPE")).toBe("It picks a call sign of its own.");
  });
});

describe("the family's words", () => {
  const member = { station: TAPE, sharesCallSignWith: BEAT, callSignFamily: [], fixed: false };
  const head = { station: BEAT, sharesCallSignWith: null, callSignFamily: [TAPE], fixed: false };

  it("on a member and on X.1", () => {
    expect(familyLine(member)).toBe("Shares 12.1 BEAT's call sign");
    expect(familyLine(head)).toBe("12.2 Beat Tapes shares this call sign");
    expect(familyLine({ sharesCallSignWith: null, callSignFamily: [TAPE, { ...TAPE, channel: "12.3", name: "Beat Live" }] })).toBe("12.2 Beat Tapes and 12.3 Beat Live share this call sign");
    expect(familyLine({ sharesCallSignWith: null, callSignFamily: [] })).toBeNull();
    expect(familyLine({})).toBeNull();
  });

  it("say the call sign is fixed once on air", () => {
    expect(familyHelp({ ...member, fixed: true })).toBe("Shares 12.1 BEAT's call sign. Fixed since the first sign-on.");
    expect(familyHelp(member)).toBe("Shares 12.1 BEAT's call sign. The channel tells them apart.");
    expect(familyHelp(head)).toBe("12.2 Beat Tapes shares this call sign. A change here changes theirs too, until one of them signs on.");
    expect(familyHelp({ ...head, fixed: true })).toBe("12.2 Beat Tapes shares this call sign. Fixed since the first sign-on.");
    expect(familyHelp({ station: HALL, sharesCallSignWith: null, callSignFamily: [], fixed: true })).toBeNull();
  });

  it("keep X.1 on its channel while it has a family", () => {
    expect(familyChannelNote(head)).toBe("12.2 Beat Tapes shares this call sign, so 12.1 stays while it does.");
    expect(familyChannelNote(member)).toBeNull();
  });

  it("beside Sign on", () => {
    expect(signOnFamilyNote(member)).toBe("It keeps 12.1 BEAT's call sign once it's on air.");
    expect(signOnFamilyNote(head)).toBe("Once it's on air, the call sign it shares with 12.2 Beat Tapes is fixed.");
    expect(signOnFamilyNote({ sharesCallSignWith: null, callSignFamily: [] })).toBeNull();
  });
});
