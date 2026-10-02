// Reserved call signs' rows and words (desk-pages 02): the frame's short dates, the State column,
// the actions each state has, and two people asking for one name drawn as one row.
import { describe, expect, it } from "vitest";
import type { Reservation } from "@opencast/contracts";
import { actionsFor, linesOf, nextToInvite, reservedBy, shortDay, sinceWords, stateWords } from "./reserved";

const TZ = "America/Los_Angeles";
const NOW = new Date("2026-09-27T03:42:12Z");

const r = (id: string, callSign: string, fields: Partial<Reservation> = {}): Reservation => ({
  id,
  callSign,
  email: `${callSign.toLowerCase()}@example.com`,
  market: null,
  channel: null,
  heldUntil: "2027-01-01T17:00:00.000Z",
  createdAt: "2026-09-01T17:00:00.000Z",
  state: "waiting",
  reason: "waitlist",
  name: null,
  about: null,
  invitedAt: null,
  remindedAt: null,
  extendedAt: null,
  stationId: null,
  sameName: [],
  decidedAt: null,
  refusal: null,
  ...fields
});

describe("reserved call signs' words", () => {
  it("writes dates as the frame does", () => {
    expect(["2026-08-30T17:00:00Z", "2026-09-03T17:00:00Z", "2026-06-02T17:00:00Z", "2026-03-09T17:00:00Z"].map((d) => shortDay(d, TZ))).toEqual(["Aug 30", "Sept 3", "June 2", "March 9"]);
  });

  it("names each state, and when an ending hold ends", () => {
    expect(stateWords(r("1", "HALO", { state: "signing_on" }), NOW, TZ)).toEqual({ label: "Invited, signing on", tone: "on" });
    expect(stateWords(r("1", "VALE", { state: "same_name" }), NOW, TZ)).toEqual({ label: "Same name twice", tone: "wait" });
    expect(stateWords(r("1", "KFRO", { state: "not_allowed" }), NOW, TZ)).toEqual({ label: "Not allowed", tone: "off" });
    expect(stateWords(r("1", "GOLD", { state: "ending", heldUntil: "2026-09-27T17:00:00Z" }), NOW, TZ).label).toBe("Ends tomorrow");
    expect(stateWords(r("1", "GOLD", { state: "ending", heldUntil: "2026-09-27T05:00:00Z" }), NOW, TZ).label).toBe("Ends today");
    expect(stateWords(r("1", "GOLD", { state: "ending", heldUntil: "2026-10-03T17:00:00Z" }), NOW, TZ).label).toBe("Ends Oct 3");
    expect([actionsFor("waiting"), actionsFor("same_name"), actionsFor("not_allowed"), actionsFor("ending"), actionsFor("invited")]).toEqual([["invite"], ["decide"], ["suggest"], ["extend", "release"], ["open"]]);
  });

  it("draws two people asking for one name as one row, in reservation order", () => {
    const rows = [
      r("c", "VALE", { state: "same_name", createdAt: "2026-09-11T17:00:00Z", about: "A church, Fontana", sameName: ["b"] }),
      r("a", "DUSK", { createdAt: "2026-09-03T17:00:00Z", name: "Marco T.", about: "Late-night film club, Redlands" }),
      r("b", "VALE", { state: "same_name", createdAt: "2026-09-08T17:00:00Z", about: "A skate crew, Fontana", sameName: ["c"] })
    ];
    const lines = linesOf(rows);
    expect(lines.map((l) => [l.callSign, l.rows.length])).toEqual([
      ["DUSK", 1],
      ["VALE", 2]
    ]);
    expect(reservedBy(lines[1]!)).toEqual({ name: "2 people", detail: "A skate crew, Fontana; A church, Fontana" });
    expect(sinceWords(lines[1]!, TZ)).toBe("Sept 8, Sept 11");
    expect(reservedBy(lines[0]!)).toEqual({ name: "Marco T.", detail: "Late-night film club, Redlands" });
    expect(nextToInvite(rows).map((x) => x.callSign)).toEqual(["DUSK"]);
  });
});
