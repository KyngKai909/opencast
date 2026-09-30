// A rule's value as form fields and back: dollars and percent in the form, micros and basis points
// stored; "Not set yet" as an empty price.
import { describe, expect, it } from "vitest";
import { RULE_KEYS, RULES, RuleGroup } from "@opencast/contracts";
import { fieldsFor, fromWords, GROUPS, shortKey, valueFrom } from "./rules";

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

describe("the Rules page's groups (watch data and features added 2026-09-29)", () => {
  it("draws every group the registry has, so no rule is left off the page", () => {
    expect(GROUPS.map((g) => g.id)).toEqual(expect.arrayContaining(["watch_data", "features"]));
    expect(GROUPS.find((g) => g.id === "watch_data")?.label).toBe("Watch data");
    expect(GROUPS.find((g) => g.id === "features")?.label).toBe("Features");
    const drawn = new Set(GROUPS.map((g) => g.id));
    const groupsWithRules = new Set(RULE_KEYS.map((k) => RULES[k].group));
    // Numbering and escrow have their own sections (Markets, Escrow signers).
    for (const g of RuleGroup.options.filter((x) => x !== "numbering" && x !== "escrow" && groupsWithRules.has(x))) expect(drawn.has(g)).toBe(true);
  });

  it("types how long sessions are kept, and the minimum audience, as numbers", () => {
    const kept = fieldsFor(RULES["watch_data.retention"].fallback);
    expect(kept.map((f) => [f.name, f.label, f.kind, f.text])).toEqual([["days", "Days", "number", "30"]]);
    expect(valueFrom({ days: 30 }, [{ ...kept[0]!, text: "45" }])).toEqual({ value: { days: 45 } });
    const min = fieldsFor(RULES["watch_data.minimum_audience"].fallback);
    expect(min.map((f) => [f.name, f.label, f.kind, f.text])).toEqual([
      ["viewers", "Viewers at once", "number", "20"],
      ["carriedAirings", "Other stations' airings, together", "number", "2"]
    ]);
    expect(valueFrom(RULES["watch_data.minimum_audience"].fallback, [{ ...min[0]!, text: "25" }, min[1]!])).toEqual({ value: { viewers: 25, carriedAirings: 2 } });
  });

  it("switches \"Not for me\" on or off", () => {
    const f = fieldsFor(RULES["features.not_for_me"].fallback);
    expect(f.map((x) => [x.name, x.label, x.kind, x.text])).toEqual([["enabled", "In the apps", "choice", "false"]]);
    expect(f[0]!.options?.map((o) => o.label)).toEqual(["On", "Off"]);
    expect(valueFrom({ enabled: false }, [{ ...f[0]!, text: "true" }])).toEqual({ value: { enabled: true } });
    expect(valueFrom({ enabled: true }, [{ ...f[0]!, text: "false" }])).toEqual({ value: { enabled: false } });
  });
});
