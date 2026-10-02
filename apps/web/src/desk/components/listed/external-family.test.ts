// A229/A231 in the desk's words: the family line in the table, "Same brand as 15.1 RIVC" on a
// subchannel beside an external X.1, and the confirmations that name every stream a change touches.
import { describe, expect, it } from "vitest";
import type { ListedSource, StationIdent } from "@opencast/contracts";
import { andList, familyCallSignChange, familyHeadFor, familyLine, familyRemoval, sameBrandLabel } from "./external";

const ident = (channel: string, name: string, extra: Partial<StationIdent> = {}): StationIdent => ({
  id: `id-${channel}`, kind: "listed", callSign: "RIVC", handle: null, name, colour: null, band: "tv", channel, marketSlug: "inland-empire", homeCity: "Riverside", sharesCallSign: true, ...extra
});
const board = ident("15.1", "Riverside County, Board of Supervisors", { slug: "rivc" });
const works = ident("15.2", "Riverside County, Public Works", { slug: "rivc-15-2" });
const library = ident("15.3", "Riverside County Library Live", { slug: "rivc-15-3" });
const listing = (station: StationIdent, family: ListedSource["family"]): ListedSource =>
  ({ id: `l-${station.channel}`, station, name: station.name, description: null, streamUrl: "https://x", embedTerms: "unclear", calendarUrl: null, calendarSync: "not_set", listingState: "listed", lastSyncedAt: null, upcoming: 0, family }) as ListedSource;
const head = listing(board, { role: "head", head: board, members: [works, library] });
const member = listing(works, { role: "member", head: board, members: [works, library] });

describe("the family in words", () => {
  it("labels a member and X.1 in the table", () => {
    expect(familyLine(member)).toBe("Same brand as 15.1 RIVC");
    expect(familyLine(head)).toBe("Its call sign is shared by 15.2 and 15.3");
    expect(familyLine(listing(ident("9.1", "City of Redlands", { callSign: "RDLS", sharesCallSign: undefined }), null))).toBeNull();
    expect(andList(["a", "b", "c"])).toBe("a, b and c");
  });

  it("offers Same brand only on X.n beside an external X.1 on the list", () => {
    const rows = [head, member];
    expect(familyHeadFor(rows, "tv", "15.4")?.id).toBe(head.id);
    expect(sameBrandLabel(head)).toBe("Same brand as 15.1 RIVC (share its call sign)");
    expect(familyHeadFor(rows, "tv", "15.1")).toBeNull();
    expect(familyHeadFor(rows, "tv", "16.2")).toBeNull();
    expect(familyHeadFor(rows, "radio", "15.2")).toBeNull();
    expect(familyHeadFor([{ ...head, listingState: "not_listed" }], "tv", "15.4")).toBeNull();
  });

  it("names every stream a family call sign change and a removal touch", () => {
    expect(familyCallSignChange(head, "RVCO")).toEqual({
      text: "This changes the call sign of all 3 streams: 15.1 RIVC, 15.2 RIVC and 15.3 RIVC become RVCO. RIVC is held a year for them, so their old addresses still work and nobody else takes it.",
      button: "Change all 3 to RVCO"
    });
    expect(familyCallSignChange(head, "RIVC")).toBeNull();
    expect(familyCallSignChange(member, "RVCO")).toBeNull();
    expect(familyRemoval(head)).toEqual({
      members: ["15.2 RIVC, Riverside County, Public Works", "15.3 RIVC, Riverside County Library Live"],
      text: "15.2 RIVC and 15.3 RIVC share its call sign and go off the dial with it. Put back on the list, they come back together."
    });
    expect(familyRemoval(member)).toBeNull();
  });
});
