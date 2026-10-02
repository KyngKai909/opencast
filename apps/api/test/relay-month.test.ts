// The Phase 3 STOP demo's billing half (relay-month.ts): a week of the same spot bought by an online
// and a local business on BEAT, relayed to YouTube and Twitch, through October's end.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { relayReport, runRelayMonth, type RelayMonth } from "./relay-month.js";

let run: RelayMonth;
beforeAll(async () => {
  run = await runRelayMonth();
}, 120_000);
afterAll(() => run?.h.close());

const $ = (dollars: number) => Math.round(dollars * 1_000_000);

describe("October, relayed", () => {
  it("the online business paid for Opencast's viewers and every relay viewer", async () => {
    const results = (await run.owners.lee.get(`/v1/businesses/${run.clicky}/results?month=2026-10`).expect(200)).body;
    // Opencast 100 a night ($4.00); YouTube 1,020 ($8.16) and Twitch 250 ($2.00) viewers reported.
    expect(results.totals).toMatchObject({ spentMicros: $(4 + 8.16 + 2), relaySpentMicros: $(10.16), relayWaitingMicros: 0 });
  });

  it("the local business paid for viewers in its area: YouTube's share when its data came, not Wednesday's (none), not Friday's (returned)", async () => {
    const results = (await run.owners.jess.get(`/v1/businesses/${run.orange}/results?month=2026-10`).expect(200)).body;
    // Opencast 70 a night ($2.80); YouTube 120 + 81 + 147 viewers in the area ($2.784); Twitch never.
    expect(results.totals).toMatchObject({ spentMicros: $(2.8) + 2_784_000, relaySpentMicros: 2_784_000, relayWaitingMicros: 0 });
    const youtube = results.relayViewers.find((l: { platform: string }) => l.platform === "youtube");
    expect(youtube).toMatchObject({ airings: 5, viewersAddedUp: 1020, billedViewersAddedUp: 348, spentMicros: 2_784_000 });
    expect(youtube.returnedMicros).toBeGreaterThan(0);
    expect(results.relayViewers.find((l: { platform: string }) => l.platform === "twitch")).toMatchObject({ airings: 5, spentMicros: 0 });
  });

  it("prints the month, and the ledger balances with nothing left held", async () => {
    const report = await relayReport(run);
    expect(report).toContain("Ledger: every entry balances; still held $0.00.");
    expect(report).toContain("Relay viewers, as reported by YouTube");
    expect(report).toContain("returned");
  });
});
