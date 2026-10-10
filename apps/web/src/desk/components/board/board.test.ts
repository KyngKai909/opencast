// The board's figures (network-desk 01.1): the two bands' answers put together as the frame shows them.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { callAndChannel, coverage, marketLine, ownersApartDetail, ownersApartOn, ownersApartSlot, ownersApartTitle, slotNumber, slotLabel, statCaptions } from "./board";
import { slotLines } from "./SlotDetail";

const NOW = new Date("2026-09-27T03:42:12Z");
let db: typeof import("../../mocks/db");

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  db = await import("../../mocks/db");
});
beforeEach(() => {
  localStorage.clear();
  db.resetDb();
});

const boards = (slug = "inland-empire") => {
  const m = db.marketBySlug(slug)!;
  return [db.boardView(m, "tv"), db.boardView(m, "radio")] as const;
};

describe("coverage", () => {
  // Phase 6 added NASA on 61.1: four external stations on the board.
  it("is the frame's: 71%, 2 claimable on air, 4 yeses not set up, HALL 90.8", () => {
    const c = coverage(...boards());
    // A229 added Riverside County's two streams sharing RIVC on 15; A234 Beat Tapes on 12.2; A248 Attic Channel on 36.1.
    expect(c).toMatchObject({ localSharePercent: 71, claimableOnAir: 2, saidYesNotSetUp: 4, waitlistHere: 26, stations: 9, listed: 8, catalog: 1, claimable: 3 });
    expect(c.deadAirComing.map(callAndChannel)).toEqual(["HALL 90.8"]);
    expect(statCaptions(c).deadAir).toBe("Station with dead air coming, HALL 90.8");
    expect(marketLine(c)).toBe("9 stations, 2 claimable stations on air, 8 external city streams and the catalog station. 26 people on the waitlist here.");
  });

  it("adds the bands' counts when the API sends no market-wide stats, and takes the TV band's share", () => {
    const [tv, radio] = boards();
    const strip = (b: typeof tv) => ({ ...b, stats: { ...b.stats, market: undefined } });
    const c = coverage(strip(tv), strip(radio));
    expect(c.localSharePercent).toBe(74);
    expect(c.claimableOnAir).toBe(2);
    expect(c.deadAirComing.map((s) => s.callSign)).toEqual(["HALL"]);
  });

  it("says so when a market has nothing yet", () => {
    const c = coverage(...boards("los-angeles"));
    expect(c.localSharePercent).toBeNull();
    expect(marketLine(c)).toBe("No stations yet.");
  });
});

describe("slots", () => {
  it("write their numbers as the board does", () => {
    const [tv, radio] = boards();
    // 9.1 to 9.3 in the frame, and LOMA 9.7 since A201.
    expect(slotNumber(tv.slots.find((s) => s.major === 9)!, "tv")).toBe("9.1–7");
    expect(slotNumber(tv.slots.find((s) => s.major === 33)!, "tv")).toBe("33");
    expect(slotNumber(radio.slots.find((s) => s.major === 884)!, "radio")).toBe("88.4");
    expect(slotLabel(tv.slots.find((s) => s.major === 41)!, "tv")).toBe("Channel 41, TACO, Held for the waitlist");
  });
});

describe("external sources", () => {
  it("are called External in the board's key and the rail, as network-desk 01.1 and 05.1 draw them", async () => {
    const { SLOT_STATE_LABELS } = await import("@opencast/contracts");
    const { DESK_RAIL } = await import("@opencast/ui");
    expect(Object.values(SLOT_STATE_LABELS)).toEqual(["Independent station", "Claimable, run by Opencast", "External city stream", "Opencast catalog", "Held for the waitlist", "Open"]);
    // The Markets group (Network's Analytics comes first since A251).
    expect(DESK_RAIL.find((g) => g.label === "Markets")!.items.map((i) => i.label)).toEqual(["Market board", "Creator pipeline", "External sources", "Catalog"]);
    const [tv] = boards();
    const nine = tv.slots.find((s) => s.major === 9)!;
    expect(slotLabel(nine, "tv")).toContain("External city stream");
  });
});

describe("a shared call sign whose stations no longer share an owner (A234)", () => {
  const TZ = "America/Los_Angeles";

  it("is on the TV board only, named by channel and call sign, with who owns each now", () => {
    const [tv, radio] = boards();
    expect(radio.ownersApart).toEqual([]);
    expect(tv.ownersApart).toHaveLength(1);
    const a = tv.ownersApart![0]!;
    expect(ownersApartTitle(a)).toBe("12.2 BEAT Beat Tapes no longer shares an owner with 12.1 BEAT Inland Beat");
    expect(ownersApartDetail(a, TZ)).toBe("Since September 25. Jen Park owns 12.2, Kai M. owns 12.1. BEAT is fixed on air, so nothing changes by itself");
    expect(ownersApartSlot(a)).toBe("12");
    // A market with none.
    expect(boards("high-desert")[0].ownersApart).toEqual([]);
  });

  it("says what's left to the owners before the member signs on, and when nobody owns one", () => {
    const [tv] = boards();
    const a = { ...tv.ownersApart![0]!, fixed: false, headOwners: [], memberOwners: ["Jen Park", "Ana R."] };
    expect(ownersApartDetail(a, TZ)).toBe("Since September 25. Jen Park and Ana R. own 12.2, nobody owns 12.1. Nothing changes by itself. Before 12.2 signs on, its owner can give it a call sign of its own");
  });

  it("flags the member's line in the slot's detail, each subchannel with its own master control", () => {
    const [tv] = boards();
    const twelve = tv.slots.find((s) => s.major === 12)!;
    expect(slotNumber(twelve, "tv")).toBe("12.1–2");
    expect(ownersApartOn(tv.ownersApart, twelve).size).toBe(1);
    const lines = slotLines({ slot: twelve, band: "tv", marketSlug: "inland-empire", timeZone: TZ, creator: undefined, ownersApart: tv.ownersApart });
    expect(lines.map((l) => [l.title, l.detail])).toEqual([
      ["12.1–2, selected", "Independent stations. Inland Beat, Redlands"],
      ["12.1 BEAT", "Inland Beat"],
      ["12.2 BEAT", "Beat Tapes. No longer shares an owner with 12.1 BEAT. Since September 25. Jen Park owns 12.2, Kai M. owns 12.1. BEAT is fixed on air, so nothing changes by itself"]
    ]);
    // Without the API's field (an older API), the lines are the same, unflagged.
    expect(slotLines({ slot: twelve, band: "tv", marketSlug: "inland-empire", timeZone: TZ, creator: undefined })[2]!.detail).toBe("Beat Tapes");
  });
});
