import { describe, expect, it } from "vitest";
import { erc20TransferData, shortAddress } from "../../auth/clear";
import { ladderWithPartners } from "../station/breakRule";
import { partnerAdsDetail } from "../earnings/lines";

describe("Connect Clear helpers", () => {
  it("shortens an address", () => {
    expect(shortAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
  });

  it("builds ERC-20 transfer calldata", () => {
    const data = erc20TransferData("0x00000000000000000000000000000000000000Ab", "1000000");
    expect(data.slice(0, 10)).toBe("0xa9059cbb");
    expect(data).toHaveLength(2 + 8 + 64 + 64);
    expect(data.endsWith((1_000_000).toString(16).padStart(64, "0"))).toBe(true);
    expect(data.slice(10, 74).endsWith("ab")).toBe(true);
  });
});

describe("Ads from partners", () => {
  const rule = { lengthMs: 120_000, fillOrder: ["SPT", "UND", "BMP", "SID"] as const, adsFromPartners: false };

  it("sits after the rotation and thank-you credit, before the bumper and station ID", () => {
    const rows = ladderWithPartners({ ...rule, fillOrder: [...rule.fillOrder] });
    expect(rows.map((r) => (r.partner ? "partners" : r.code))).toEqual(["SPT", "UND", "partners", "BMP", "SID"]);
    expect(rows.map((r) => r.n)).toEqual([1, 2, 3, 4, 5]);
    expect(rows[2]).toMatchObject({ detail: "Off. Only time still open", time: "0:00 – 1:00", fillIndex: null });
  });

  it("says on when it's on", () => {
    expect(ladderWithPartners({ ...rule, fillOrder: [...rule.fillOrder], adsFromPartners: true })[2].detail).toBe("On. Only time still open");
  });

  it("reads as the earnings frame draws it", () => {
    expect(partnerAdsDetail({ on: false, micros: 0, pendingMicros: 0 })).toBe("Off. Turn it on in Breaks settings. Paid when partners pay, 30 to 90 days after airing");
    expect(partnerAdsDetail({ on: true, micros: 0, pendingMicros: 12_500_000 })).toBe("$12.50 to come. Paid when partners pay, 30 to 90 days after airing");
  });
});
