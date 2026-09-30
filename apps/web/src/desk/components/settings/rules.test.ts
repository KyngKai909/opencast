// A rule's value as form fields and back: dollars and percent in the form, micros and basis points
// stored; "Not set yet" as an empty price.
import { describe, expect, it } from "vitest";
import { RULES } from "@opencast/contracts";
import { fieldsFor, fromWords, shortKey, valueFrom } from "./rules";

describe("rule values in the form", () => {
  it("types the call sign rules as yes or no and lists of capital letters (added 2026-09-29)", () => {
    const fields = fieldsFor(RULES["call_signs.refused"].fallback);
    expect(fields.map((f) => [f.name, f.label, f.kind])).toEqual([
      ["refuseKwFourLetters", "Refuse K or W and three letters", "choice"],
      ["impersonation", "Brands and stations", "letters"],
      ["denylist", "Denylist", "letters"]
    ]);
    expect(fields[2]!.text).toBe("ALERT, EAS, SOS");
    const changed = [{ ...fields[0]!, text: "false" }, fields[1]!, { ...fields[2]!, text: "alert, eas sos,, gritz" }];
    expect(valueFrom(RULES["call_signs.refused"].fallback, changed)).toEqual({ value: { ...RULES["call_signs.refused"].fallback, refuseKwFourLetters: false, denylist: ["ALERT", "EAS", "SOS", "GRITZ"] } });
    expect(valueFrom(RULES["call_signs.refused"].fallback, [fields[0]!, fields[1]!, { ...fields[2]!, text: "OK, NO-WAY" }])).toEqual({ error: "NO-WAY isn't 2 to 12 letters.", field: "denylist" });
    expect(fieldsFor(RULES["call_signs.hold"].fallback).map((f) => [f.label, f.text])).toEqual([
      ["Days", "120"],
      ["Reminder, days before the end", "14"]
    ]);
  });

  it("types prices in dollars, empty for not set yet", () => {
    const fields = fieldsFor(RULES["prices.storage"].fallback);
    expect(fields).toEqual([{ name: "perGbMonthMicros", label: "Price a GB a month", kind: "dollars", nullable: true, text: "" }]);
    expect(valueFrom({ perGbMonthMicros: null }, [{ ...fields[0]!, text: "0.021" }])).toEqual({ value: { perGbMonthMicros: 21_000 } });
    expect(valueFrom({ perGbMonthMicros: 21_000 }, [{ ...fields[0]!, text: "" }])).toEqual({ value: { perGbMonthMicros: null } });
  });

  it("types shares in percent, stored in basis points", () => {
    const fields = fieldsFor({ spotBps: 1000, pledgeBps: 0, productionBps: 250 });
    expect(fields.map((f) => [f.label, f.text])).toEqual([
      ["Spots and sponsorships", "10"],
      ["Pledges", "0"],
      ["Production", "2.5"]
    ]);
    expect(valueFrom({ spotBps: 1000, pledgeBps: 0, productionBps: 250 }, fields.map((f, i) => (i === 0 ? { ...f, text: "12.5" } : f)))).toEqual({ value: { spotBps: 1250, pledgeBps: 0, productionBps: 250 } });
    expect(valueFrom({ spotBps: 0 }, [{ ...fields[0]!, text: "ten" }])).toEqual({ error: "Enter a number, 0 or more.", field: "spotBps" });
  });

  it("keeps US only fixed, and edits lists as JSON", () => {
    const pd = fieldsFor(RULES["rights.public_domain_us"].fallback);
    expect(pd.map((f) => f.name)).toEqual(["termYears", "renewalRequiredThrough", "noticeRequiredThrough"]);
    expect(valueFrom(RULES["rights.public_domain_us"].fallback, pd)).toEqual({ value: RULES["rights.public_domain_us"].fallback });
    const limits = fieldsFor(RULES["relays.platform_limits"].fallback);
    expect(limits[0]).toMatchObject({ name: "platforms", kind: "json" });
    expect(valueFrom(RULES["relays.platform_limits"].fallback, [{ ...limits[0]!, text: "[" }])).toEqual({ error: "That isn't valid JSON.", field: "platforms" });
  });

  it("chooses the payout schedule from a list", () => {
    const f = fieldsFor("weekly");
    expect(f[0]).toMatchObject({ kind: "choice", text: "weekly" });
    expect(valueFrom("weekly", [{ ...f[0]!, text: "monthly" }])).toEqual({ value: "monthly" });
  });

  it("says when a version starts, and shortens keys", () => {
    expect(fromWords("1970-01-01T00:00:00.000Z", () => "")).toBe("Since the start");
    expect(fromWords("2026-11-01T00:00:00.000Z", () => "November 1")).toBe("From November 1");
    expect(shortKey("0x70997970C51812dc3A010C7d01b50e0d17dc79C8")).toBe("0x7099…79C8");
  });
});
