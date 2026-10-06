// A249: a guide's read in the desk's words: what was read, its size, how often, the guide files
// found for a channel, and a guide's problems. Every guide here is made up.
import { describe, expect, it } from "vitest";
import type { GuideRead, ListedSource } from "@opencast/contracts";
import { channelWords, guideCadence, guideProblem, guideSize, guideSummary, optionLabel, optionState, sizeWords } from "./guides";
import { scheduleWords } from "./external";

const read: GuideRead = {
  channel: "5f00000000000000000a0001",
  channelName: "Anime Corner",
  channels: 427,
  programmes: 33,
  compressedBytes: 965_313,
  bytes: 7_396_565,
  gzip: true,
  large: true,
  readAt: "2026-10-06T17:00:00.000Z",
  unchangedAt: null,
  limit: null
};

describe("what was read from a guide", () => {
  it("says the channel, of how many, and its size gzipped and not", () => {
    expect(guideSummary(read)).toBe("Read 33 airings to come for Anime Corner, one of 427 channels in the guide");
    expect(guideSummary({ ...read, channels: 1, programmes: 1, channelName: null })).toBe("Read 1 airing to come for 5f00000000000000000a0001");
    expect(channelWords(read)).toBe("Anime Corner (5f00000000000000000a0001)");
    expect(channelWords({ channel: null, channelName: null })).toBeNull();
    expect(guideSize(read)).toBe("965 KB as it downloads (gzipped), 7.4 MB unzipped");
    expect(guideSize({ ...read, gzip: false, bytes: 212_000 })).toBe("212 KB");
    expect(sizeWords(840)).toBe("840 bytes");
    expect(sizeWords(42_300_000)).toBe("42 MB");
    expect(guideCadence(read)).toBe("Read every hour (every 30 minutes at most while it runs out), asking first whether it changed.");
  });

  it("names a guide file found, and one the file no longer has", () => {
    expect(optionLabel({ label: "Pluto TV (US)", via: "i.mjh.nz" })).toBe("Pluto TV (US), via i.mjh.nz");
    expect(optionState({ inGuide: true })).toBeNull();
    expect(optionState({ inGuide: false })).toBe("Not in the guide right now");
    expect(optionState({ inGuide: null })).toBe("Couldn't check the guide just now");
  });

  it("explains a guide's problem, and the table says it shortly", () => {
    const s = (calendarSync: ListedSource["calendarSync"], guide: GuideRead | null = read) =>
      ({ calendarSync, calendarUrl: "https://i.mjh.nz/PlutoTV/us.xml.gz", waiting: null, schedule: { source: "guide_data", format: "xmltv", url: null, checkedAgainst: null, checkedOn: null, guide } }) as unknown as ListedSource;
    expect(guideProblem(s("pick_channel", { ...read, channel: null }))).toBe(
      "This guide has 427 channels, and none is picked, so nothing from it is listed. Change, then Find this channel's guide (or add #channel= and its id to the address)."
    );
    expect(guideProblem(s("not_in_guide"))).toContain("isn't in the guide right now: what it listed before stays");
    expect(guideProblem(s("too_big", { ...read, limit: "bytes" }))).toBe("It's over 300 MB unzipped, so it wasn't read: what it listed before stays.");
    expect(guideProblem(s("too_big", { ...read, limit: "programmes" }))).toBe("It lists over 5,000 airings to come for the channel, so it wasn't read: what it listed before stays.");
    expect(guideProblem(s("synced"))).toBeNull();
    expect(scheduleWords(s("pick_channel"))).toMatchObject({ text: "Guide needs a channel", tone: "warn" });
    expect(scheduleWords(s("too_big"))).toMatchObject({ text: "Guide too big to read" });
    expect(scheduleWords(s("synced"))).toMatchObject({ text: "Guide data" });
  });
});
