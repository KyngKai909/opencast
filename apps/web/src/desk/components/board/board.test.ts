// The board's figures (network-desk 01.1): the two bands' answers put together as the frame shows them.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { callAndChannel, coverage, marketLine, slotNumber, slotLabel, statCaptions } from "./board";

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
    expect(c).toMatchObject({ localSharePercent: 71, claimableOnAir: 2, saidYesNotSetUp: 4, waitlistHere: 26, stations: 8, listed: 4, catalog: 1, claimable: 3 });
    expect(c.deadAirComing.map(callAndChannel)).toEqual(["HALL 90.8"]);
    expect(statCaptions(c).deadAir).toBe("Station with dead air coming, HALL 90.8");
    expect(marketLine(c)).toBe("8 stations, 2 claimable stations on air, 4 external city streams and the catalog station. 26 people on the waitlist here.");
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
    expect(slotNumber(tv.slots.find((s) => s.major === 9)!, "tv")).toBe("9.1–3");
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
    expect(DESK_RAIL[0]!.items.map((i) => i.label)).toEqual(["Market board", "Creator pipeline", "External sources", "Catalog"]);
    const [tv] = boards();
    const nine = tv.slots.find((s) => s.major === 9)!;
    expect(slotLabel(nine, "tv")).toContain("External city stream");
  });
});
