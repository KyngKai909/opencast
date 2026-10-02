import { describe, expect, it } from "vitest";
import type { MockAiring } from "./schedule";
import { carriedPick, homeAirings } from "./home";
import { stationByRef } from "./stations";

const at = (h: number) => new Date(Date.UTC(2026, 8, 27, h)).toISOString();
function a(id: string, start: number, end: number, listed = false): MockAiring {
  return { id, stationId: "s", title: id, start: at(start), end: at(end), programId: "p", listed };
}

describe("home's mock schedule", () => {
  it("prefers what's on now, then the next airing, and skips listed city streams", () => {
    const t = new Date(at(4));
    expect(carriedPick([a("later", 6, 7), a("now", 3, 5)], t)).toEqual({ airing: expect.objectContaining({ id: "now" }), onNow: true });
    expect(carriedPick([a("listed", 5, 6, true), a("civc", 6, 7), a("over", 1, 2)], t)).toEqual({ airing: expect.objectContaining({ id: "civc" }), onNow: false });
    expect(carriedPick([a("over", 1, 2)], t)).toBeNull();
  });
  it("adds the radio rows' lines and what follows the last airing", () => {
    const list = homeAirings();
    const hall = stationByRef("HALL")!.ident.id;
    expect(list.find((x) => x.stationId === hall && x.title === "Slow beats for late work")?.note).toBe("All night");
    const quiet = list.find((x) => x.stationId === hall && x.title === "Quiet hours")!;
    const slow = list.find((x) => x.stationId === hall && x.title === "Slow beats for late work")!;
    expect(quiet.start).toBe(slow.end);
  });
});
