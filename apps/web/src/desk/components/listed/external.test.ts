// External stations in words (follow-up Phase 6): the small lines under How it plays, What's on and
// Right now, and the outage history, on the mock clock's Saturday, 8:42 pm in the Inland Empire.
import { describe, expect, it } from "vitest";
import type { ListedSource } from "@opencast/contracts";
import { browserNote, downFor, nativeOnlyNote, nowWords, onceWords, outageWords, playsDetail, scheduleWords, sourceDetail, transportLine } from "./external";

const TZ = "America/Los_Angeles";
const NOW = new Date("2026-09-27T03:42:12Z");

const base: ListedSource = {
  id: "s",
  station: { id: "st", kind: "listed", callSign: "COLT", handle: "colt", name: "City of Colton", colour: null, band: "tv", channel: "9.2", marketSlug: "inland-empire", homeCity: null },
  name: "City of Colton",
  description: "Council meetings",
  streamUrl: "https://colton.example.gov/live.m3u8",
  embedTerms: "unclear",
  calendarUrl: null,
  calendarSync: "not_set",
  listingState: "listed",
  lastSyncedAt: null,
  upcoming: 0,
  plays: "stream_link",
  streamFormat: "hls",
  evidence: { basis: null, termsUrl: null, termsCheckedOn: null, publicBasis: null, permission: null, note: null },
  schedule: { source: "none", format: null, url: null, checkedAgainst: null, checkedOn: null },
  onDial: true,
  waiting: null,
  health: { state: "up", since: null, lastCheckedAt: null, detail: null },
  outages: [],
  creatorId: null
};
const s = (x: Partial<ListedSource>): ListedSource => ({ ...base, ...x });

describe("how it plays", () => {
  it("names the basis, or what it's waiting for", () => {
    const permission = { id: "p", grantedBy: "Maria Lopez", grantedOn: "2026-09-24", evidence: "Email", documentUrl: null, streamUrl: base.streamUrl, recordedAt: NOW.toISOString(), recordedBy: null, creatorId: null };
    expect(playsDetail(s({ evidence: { ...base.evidence!, basis: "written_permission", permission } }), TZ)).toBe("Their written permission, Sept 24");
    expect(playsDetail(s({ evidence: { ...base.evidence!, basis: "public_source", publicBasis: "US government, public" } }), TZ)).toBe("US government, public");
    expect(playsDetail(s({ plays: "embed", evidence: { ...base.evidence!, basis: "embed_terms", termsCheckedOn: "2026-09-21" } }), TZ)).toBe("Their own player, embedding allowed (checked Sept 21)");
    expect(playsDetail(s({ plays: "embed", waiting: "terms_unclear", evidence: { ...base.evidence!, note: "Asked Sept 22" } }), TZ)).toBe("Terms unclear, asked Sept 22");
    expect(playsDetail(s({ waiting: "needs_permission", creatorId: "c" }), TZ)).toBe("Needs their permission. In the creator pipeline");
    expect(playsDetail(s({ waiting: "dash_not_played" }), TZ)).toBe("DASH stream, not played yet");
    expect(playsDetail(s({ waiting: "other_market" }), TZ)).toBe("Outside this market");
    expect(sourceDetail(s({ creatorId: "c", description: "A community channel's raw stream" }))).toBe("From an IPTV list. A community channel's raw stream");
  });
});

describe("an http:// stream link (A237)", () => {
  const http = { streamUrl: "http://colton.example.gov/live.m3u8" };
  it("says how it reaches viewers: over https, through the secure relay, or waiting for an https address", () => {
    expect(transportLine(s({ ...http, playsOver: "relay", relayed: true }))).toBe("Plays through Opencast's secure relay (its address is http)");
    expect(transportLine(s({ ...http, playsOver: "https" }))).toBe("Plays over https (its listed address is http)");
    expect(transportLine(s({ ...http, playsOver: "needs_https", waiting: "needs_https", onDial: false }))).toBeNull();
    expect(playsDetail(s({ ...http, playsOver: "needs_https", waiting: "needs_https", onDial: false }), TZ)).toBe("Needs an https address");
    expect(onceWords(s({ waiting: "needs_https" }))).toBe("its source answers over https, or Opencast's secure relay is set up");
    // https links, and listings from before A237, say nothing more.
    expect(transportLine(s({}))).toBeNull();
    expect(transportLine(s({ playsOver: null }))).toBeNull();
  });
});

describe("a stream browsers can't load, and another app's access (A238)", () => {
  it("says a CORS-blocked stream plays through the secure relay, or can't play yet without it", () => {
    const blocked = { state: "blocked" as const, detail: "Its segments have no CORS header for Opencast's apps", checkedAt: "2026-09-27T03:00:00Z" };
    expect(transportLine(s({ playsOver: "relay", relayed: true, relayReason: "cors", cors: blocked }))).toBe("Browsers block this stream's server, so it plays through Opencast's secure relay");
    // An http link upgraded to https whose server blocks browsers says the same.
    expect(transportLine(s({ streamUrl: "http://colton.example.gov/live.m3u8", playsOver: "relay", relayed: true, relayReason: "cors", cors: blocked }))).toBe("Browsers block this stream's server, so it plays through Opencast's secure relay");
    // A237's http relay is unchanged.
    expect(transportLine(s({ streamUrl: "http://colton.example.gov/live.m3u8", playsOver: "relay", relayed: true, relayReason: "http" }))).toBe("Plays through Opencast's secure relay (its address is http)");
    const waiting = s({ playsOver: null, waiting: "browsers_blocked", onDial: false, cors: blocked });
    expect(transportLine(waiting)).toBeNull();
    expect(playsDetail(waiting, TZ)).toBe("Browsers can't play this stream yet");
    expect(onceWords(waiting)).toBe("its server lets browsers load it, or Opencast's secure relay is set up");
    expect(browserNote(waiting)).toBe("Browsers can't play this stream yet. Its server doesn't let other sites load it. Its segments have no CORS header for Opencast's apps. It plays once its server allows it, or Opencast's secure relay is set up.");
    expect(browserNote(s({ cors: { ...blocked, state: "ok", detail: null } }))).toBeNull();
  });

  it("says a platform feed uses another app's access, and to ask the licensor", () => {
    const feed = s({ waiting: "platform_feed", onDial: false, platformFeed: "Pluto via Samsung TV Plus", listingState: "checking" });
    expect(playsDetail(feed, TZ)).toBe("Uses another app's access (Pluto via Samsung TV Plus)");
    expect(browserNote(feed)).toBe("Uses another app's access (Pluto via Samsung TV Plus). Ask the channel's licensor for its own feed.");
    expect(onceWords(feed)).toBe("it has a feed of its own from the channel's licensor");
    expect(transportLine(feed)).toBeNull();
  });
});

describe("a stream only the native apps can play (A239)", () => {
  it("says it plays in the TV app only, and why", () => {
    const refused = s({ nativeOnly: true, cors: { state: "unknown", detail: "Its server refuses web pages' requests (it answers only without an Origin header), so it plays in the TV app only", checkedAt: "2026-09-27T03:00:00Z" } });
    expect(transportLine(refused)).toBe("Plays in the TV app only");
    expect(nativeOnlyNote(refused)).toBe("Its server refuses web pages' requests but answers apps. The Android TV and Fire TV app, and the Opencast app on Android, play it straight from the source; browsers, Chromecast and iPhone show Stand by on it.");
    // Still on the dial, as before: nothing else about it changes.
    expect(browserNote(refused)).toBeNull();
    expect(transportLine(s({ nativeOnly: false }))).toBeNull();
    expect(nativeOnlyNote(s({}))).toBeNull();
  });
});

describe("what's on and right now", () => {
  it("says where the schedule comes from, and never invents one", () => {
    expect(scheduleWords(s({ schedule: { ...base.schedule!, source: "feed", format: "ical" } })).text).toBe("Their agenda calendar");
    expect(scheduleWords(s({ schedule: { ...base.schedule!, source: "feed", format: "xmltv" } })).text).toBe("Their schedule feed");
    expect(scheduleWords(s({ schedule: { ...base.schedule!, source: "feed" }, calendarSync: "calendar_not_found" }))).toMatchObject({ text: "Calendar not found", tone: "warn" });
    expect(scheduleWords(s({}))).toEqual({ text: "No schedule found", detail: "Banner shows name and Live", tone: "warn" });
    expect(scheduleWords(s({ waiting: "needs_permission" }))).toEqual({ text: "Waiting", tone: "quiet" });
  });

  it("counts the minutes down, and says whether it's still on the dial", () => {
    expect(downFor("2026-09-27T03:28:00Z", NOW)).toBe("14 min");
    expect(downFor("2026-09-27T02:30:00Z", NOW)).toBe("1 hr 12 min");
    expect(downFor("2026-09-27T03:42:00Z", NOW)).toBe("1 min");
    expect(nowWords(s({ health: { state: "down", since: "2026-09-27T03:40:00Z", lastCheckedAt: null, detail: null } }), NOW)).toEqual({ text: "Down 2 min", detail: "Still on the dial", tone: "warn" });
    expect(nowWords(s({ waiting: "down", health: { state: "hidden", since: "2026-09-27T03:28:00Z", lastCheckedAt: null, detail: null } }), NOW)).toEqual({ text: "Down 14 min", detail: "Hidden from the dial", tone: "down" });
    expect(nowWords(s({ health: { state: "unchecked", since: null, lastCheckedAt: null, detail: null } }), NOW).text).toBe("Not checked yet");
    expect(nowWords(s({ waiting: "terms_unclear" }), NOW).text).toBe("Not on the dial");
    expect(onceWords(s({ waiting: "other_market" }))).toBe("Settings allows other markets' streams");
  });
});

describe("the outage history", () => {
  it("reads each outage: hidden and back, a blip, and one still going", () => {
    expect(outageWords({ id: "a", downSince: "2026-09-25T03:43:00Z", hiddenAt: "2026-09-25T03:48:00Z", backAt: "2026-09-25T04:02:00Z", detail: "HTTP 503" }, TZ)).toEqual({
      when: "Sept 24",
      text: "Down 8:43 pm to 9:02 pm, 19 minutes, hidden from the dial at 8:48 pm. HTTP 503"
    });
    expect(outageWords({ id: "b", downSince: "2026-09-26T02:10:00Z", hiddenAt: null, backAt: "2026-09-26T02:12:00Z", detail: null }, TZ).text).toBe("Down 2 minutes, back before it left the dial");
    expect(outageWords({ id: "c", downSince: "2026-09-27T03:40:00Z", hiddenAt: null, backAt: null, detail: "Not a stream playlist" }, TZ).text).toBe("Down since 8:40 pm, still on the dial. Not a stream playlist");
  });
});
