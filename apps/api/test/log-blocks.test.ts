// A244: programming blocks' membership, worked out with no database: by start, a member running
// past the span's end, one starting before it, an empty span, off-air time inside (two pieces).
import { describe, expect, it } from "vitest";
import { blockAt, isMember, memberOf, memberships, overlaps, type SpanRow } from "../src/v1/modules/log/blocks.js";

const d = (hhmm: string) => new Date(`2026-10-03T${hhmm}:00-07:00`);
const span = (id: string, from: string, to: string): SpanRow => ({ id, stationId: "s", blockId: `block-${id}`, startsAt: d(from), endsAt: d(to), repeatGroupId: null, templateDate: null, createdBy: null, createdAt: new Date(0) });
const entry = (id: string, from: string, to: string, kind = "program") => ({ id, kind, startsAt: d(from), endsAt: d(to) });

describe("membership", () => {
  const rows = [entry("early", "20:30", "21:30"), entry("crate", "21:30", "22:30"), entry("reel", "22:30", "23:40"), entry("off", "23:40", "23:50", "off_air")];

  it("is by start: one starting before isn't a member, one running past the end is, and the block airs first member to last", () => {
    const [m] = memberships([span("a", "21:00", "23:30")], rows, []);
    expect(m.members.map((e) => e.id)).toEqual(["crate", "reel"]);
    expect([m.airsFrom, m.airsUntil]).toEqual([d("21:30").getTime(), d("23:40").getTime()]);
    expect(m.pieces).toEqual([{ s: d("21:30").getTime(), e: d("23:40").getTime() }]);
    expect(isMember(span("b", "23:40", "23:59"), rows[3])).toBe(false);
  });

  it("an empty span airs nothing", () => {
    const [m] = memberships([span("a", "18:00", "19:00")], rows, []);
    expect(m).toMatchObject({ members: [], airsFrom: null, airsUntil: null, pieces: [] });
  });

  it("off air between members splits it in two; open time between them doesn't", () => {
    const gap = [entry("one", "21:00", "21:50"), entry("two", "22:00", "23:00"), entry("three", "23:30", "23:59")];
    const [m] = memberships([span("a", "21:00", "23:59")], gap, [{ s: d("23:00").getTime(), e: d("23:30").getTime() }]);
    expect(m.pieces).toEqual([
      { s: d("21:00").getTime(), e: d("23:00").getTime() },
      { s: d("23:30").getTime(), e: d("23:59").getTime() }
    ]);
    expect(blockAt([m], d("21:55").getTime())?.id).toBe("a");
    expect(blockAt([m], d("23:10").getTime())).toBeNull();
    expect([...memberOf([m]).keys()]).toEqual(["one", "two", "three"]);
  });

  it("overlap is any shared time", () => {
    expect(overlaps(span("a", "21:00", "22:00"), span("b", "22:00", "23:00"))).toBe(false);
    expect(overlaps(span("a", "21:00", "22:01"), span("b", "22:00", "23:00"))).toBe(true);
  });
});
