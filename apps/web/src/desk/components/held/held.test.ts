// Held earnings' words and figures (network-desk 07.1).
import { beforeAll, describe, expect, it, vi } from "vitest";
import { heldFigures, rowHeld, shortAddress, stationDetail, stationTitle, statusOf } from "./held";

const NOW = new Date("2026-09-27T03:42:12Z");
beforeAll(() => vi.useFakeTimers({ toFake: ["Date"], now: NOW }));

describe("held earnings", () => {
  it("reads as drawn", async () => {
    localStorage.clear();
    const db = await import("../../mocks/db");
    db.resetDb();
    const h = db.heldView();
    const tz = "America/Los_Angeles";
    expect(heldFigures(h)).toEqual({ total: "$227.00", heldAcross: "Held across 2 stations", invitations: 2, moved: "$0.00", period: "3 years" });
    expect(h.stations.map((s) => [stationTitle(s), stationDetail(s, tz, NOW), statusOf(s, tz).text])).toEqual([
      ["102.0 CRAT, for Marcus Reyes", "On air since August 12, with permission", "Claim link sent"],
      ["92.0 FLDR, for Mojave Field Recordings", "On air since September 20, under CC BY 4.0", "Invited Sept 24"],
      ["33.1 LUPE, for Lupe Ortiz", "Signs on Monday", "Not on air yet"]
    ]);
    expect(shortAddress(h.contractAddress!)).toBe("0x5ee2…a41d");
  });

  it("takes the API's count of stations holding money when it gives one (A125)", async () => {
    const db = await import("../../mocks/db");
    db.resetDb();
    const h = db.heldView();
    expect(heldFigures({ ...h, stationsHoldingMoney: 3 }).heldAcross).toBe("Held across 3 stations");
    expect(heldFigures({ ...h, stationsHoldingMoney: undefined }).heldAcross).toBe("Held across 2 stations");
  });

  it("adds money owed but not deposited yet to the row, so the rows add up to the total", () => {
    expect(rowHeld({ heldMicros: 10_000_000, owedNotYetDepositedMicros: 2_500_000 })).toBe(12_500_000);
  });
});
