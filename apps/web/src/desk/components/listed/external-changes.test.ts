// A215 in words (follow-up Phase 6): what a change will do, said before saving; the change history;
// a listing taken off the dial; and an outage that ended because the address changed or it was
// taken off. On the mock clock's Saturday, 8:42 pm in the Inland Empire.
import { describe, expect, it } from "vitest";
import type { ListedSource, StreamPermission } from "@opencast/contracts";
import { changeWarning, changeWords, outageWords, removedWords } from "./external";

const TZ = "America/Los_Angeles";
const NOW = new Date("2026-09-27T03:42:12Z");
const OLD = "https://colton.example.gov/live.m3u8";
const NEW = "https://stream.colton.example.gov/live.m3u8";

const permission: StreamPermission = { id: "p", grantedBy: "Maria Lopez, City Clerk", grantedOn: "2026-09-24", evidence: "Email", documentUrl: null, streamUrl: OLD, recordedAt: "2026-09-24T17:00:00.000Z", recordedBy: "Dee A.", creatorId: null };

const colt: ListedSource = {
  id: "s",
  station: { id: "st", kind: "listed", callSign: "COLT", handle: "colt", name: "City of Colton", colour: null, band: "tv", channel: "9.2", marketSlug: "inland-empire", homeCity: null },
  name: "City of Colton",
  description: null,
  streamUrl: OLD,
  embedTerms: "unclear",
  calendarUrl: null,
  calendarSync: "not_set",
  listingState: "listed",
  lastSyncedAt: null,
  upcoming: 0,
  plays: "stream_link",
  streamFormat: "hls",
  evidence: { basis: "written_permission", termsUrl: null, termsCheckedOn: null, publicBasis: null, permission, note: null },
  onDial: true,
  waiting: null,
  creatorId: null
};
const rdls: ListedSource = {
  ...colt,
  station: { ...colt.station, callSign: "RDLS", channel: "9.1" },
  name: "City of Redlands",
  streamUrl: "https://redlands.example.gov/player",
  embedTerms: "allowed",
  plays: "embed",
  streamFormat: null,
  evidence: { basis: "embed_terms", termsUrl: "https://redlands.example.gov/terms", termsCheckedOn: "2026-09-21", publicBasis: null, permission: null, note: null }
};

describe("what a change will do, said before saving", () => {
  it("says a stream link with written permission waits for a new address, and not for one a kept permission covers", () => {
    expect(changeWarning(colt, { plays: "stream_link", streamUrl: OLD, embedTerms: "unclear" })).toBeNull();
    expect(changeWarning(colt, { plays: "stream_link", streamUrl: NEW, embedTerms: "unclear" })).toEqual({
      waits: true,
      text: `Their written permission covers ${OLD} only. Saving takes COLT off the dial until new evidence is recorded for the new address. The permission is kept as it was.`
    });
    const back = { ...colt, streamUrl: NEW, evidence: { ...colt.evidence!, permission: { ...permission, streamUrl: NEW } }, earlierPermissions: [permission] };
    expect(changeWarning(back, { plays: "stream_link", streamUrl: OLD, embedTerms: "unclear" })).toMatchObject({ waits: false });
  });

  it("keeps a public basis, keeps embed terms on the same host, and waits on another host or a new way to play", () => {
    const pub = { ...colt, evidence: { ...colt.evidence!, basis: "public_source" as const, permission: null, publicBasis: "US government, public" } };
    expect(changeWarning(pub, { plays: "stream_link", streamUrl: NEW, embedTerms: "unclear" })).toEqual({ waits: false, text: "The public basis stays: it's about the source. The new address is checked from the next minute." });
    expect(changeWarning(rdls, { plays: "embed", streamUrl: "https://redlands.example.gov/player?v=2", embedTerms: "allowed" })).toEqual({ waits: false, text: "Same host, so their terms stay as checked. The new address is checked from the next minute." });
    expect(changeWarning(rdls, { plays: "embed", streamUrl: "https://video.example-host.com/redlands", embedTerms: "allowed" })).toEqual({
      waits: true,
      text: "Their terms were checked for redlands.example.gov. Saving takes RDLS off the dial until the terms for video.example-host.com are checked."
    });
    expect(changeWarning(rdls, { plays: "embed", streamUrl: rdls.streamUrl, embedTerms: "unclear" })).toEqual({ waits: true, text: "Saving takes RDLS off the dial until their terms allow embedding." });
    expect(changeWarning(rdls, { plays: "stream_link", streamUrl: "https://redlands.example.gov/live.m3u8", embedTerms: "allowed" })?.text).toBe(
      "A stream link needs their written permission, or a clearly public basis. Saving takes RDLS off the dial until one is recorded."
    );
    expect(changeWarning(colt, { plays: "embed", streamUrl: OLD, embedTerms: "allowed" })?.text).toBe("An official embed needs its terms page and the day it was checked. Saving takes COLT off the dial until they're recorded.");
  });
});

describe("the change history, in words", () => {
  it("says who changed what, from and to, and what it did", () => {
    expect(
      changeWords({ id: "c", at: "2026-09-27T03:42:00.000Z", by: "Dee A.", action: "changed", fields: [{ field: "streamUrl", from: OLD, to: NEW }], effects: ["waits_for_evidence", "checks_restart"] }, TZ)
    ).toEqual({ when: "Sept 26", text: `Dee A. changed Address from ${OLD} to ${NEW}, 8:42 pm. It waits for new evidence. Checked afresh` });
    expect(
      changeWords({ id: "c", at: "2026-09-27T03:42:00.000Z", by: null, action: "changed", fields: [{ field: "plays", from: "embed", to: "stream_link" }, { field: "schedule", from: "none", to: "feed" }], effects: [] }, TZ).text
    ).toBe("Opencast changed How it plays from Official embed to Stream link; What's on from None to Their calendar or schedule feed, 8:42 pm");
    expect(changeWords({ id: "c", at: "2026-09-27T03:42:00.000Z", by: "Dee A.", action: "removed", fields: [], effects: [] }, TZ).text).toBe("Dee A. took it off the dial for good, 8:42 pm");
    expect(changeWords({ id: "c", at: "2026-09-27T03:42:00.000Z", by: "Dee A.", action: "restored", fields: [{ field: "channel", from: "9.1", to: "9.3" }], effects: [] }, TZ).text).toBe("Dee A. put it back on the list at 9.3, 8:42 pm");
  });

  it("says when a listing was taken off and where its channel stands", () => {
    const off = { ...rdls, removed: { at: "2026-09-27T03:42:00.000Z", by: "Dee A.", channel: "9.1", channelHeldUntil: "2026-12-26T03:42:00.000Z" } };
    expect(removedWords(off, TZ, NOW)).toEqual({ text: "Taken off the dial Sept 26 by Dee A.", detail: "9.1 held for it until December 25" });
    expect(removedWords(off, TZ, new Date("2027-01-01T00:00:00Z"))?.detail).toBe("9.1 freed December 25");
    expect(removedWords(rdls, TZ, NOW)).toBeNull();
  });

  it("says an outage ended because the address changed, or because it was taken off", () => {
    const o = { id: "o", downSince: "2026-09-27T03:43:00.000Z", hiddenAt: "2026-09-27T03:48:00.000Z", backAt: "2026-09-27T03:55:00.000Z", detail: "HTTP 503" };
    expect(outageWords({ ...o, ended: "address_changed" }, TZ).text).toBe("Down 8:43 pm to 8:55 pm, when the address was changed, hidden from the dial at 8:48 pm. HTTP 503");
    expect(outageWords({ ...o, hiddenAt: null, ended: "removed" }, TZ).text).toBe("Down 8:43 pm to 8:55 pm, when it was taken off the dial. HTTP 503");
    expect(outageWords(o, TZ).text).toBe("Down 8:43 pm to 8:55 pm, 12 minutes, hidden from the dial at 8:48 pm. HTTP 503");
  });
});
