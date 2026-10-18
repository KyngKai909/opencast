import { describe, expect, it } from "vitest";
import { checkCallSign, cleanCallSign, suggestNumber } from "./callsign";

const none = () => null;
const dial = (cs: string) => (cs === "BEAT" ? "12.1 in Inland Empire" : null);

describe("checkCallSign", () => {
  it("passes a free name", () => {
    const c = checkCallSign("TACO", dial);
    expect(c.ok).toBe(true);
    expect(c.message).toBe("TACO is free. Reserve it and we hold it for 120 days.");
    expect(c.rows.every((r) => r.ok)).toBe(true);
  });
  it("takes three and five letters", () => {
    expect(checkCallSign("SUN", none).ok).toBe(true);
    expect(checkCallSign("RADIO", none).ok).toBe(true);
  });
  it("refuses the wrong length or other characters", () => {
    for (const v of ["AB", "TOOLONG", "B3AT", "BE-AT"]) {
      const c = checkCallSign(v, none);
      expect(c.ok, v).toBe(false);
      expect(c.letters, v).toBe(false);
    }
    expect(checkCallSign("AB", none).message).toBe("Letters only, three to five of them.");
  });
  it("refuses four letters starting with K or W, but not three or five", () => {
    expect(checkCallSign("KFRO", none)).toMatchObject({ ok: false, kw: true, message: "Too close to a real FCC call sign. Try three or five letters." });
    expect(checkCallSign("WAVE", none).kw).toBe(true);
    expect(checkCallSign("KFROG", none).ok).toBe(true);
    expect(checkCallSign("WIN", none).ok).toBe(true);
  });
  it("refuses networks, brands and alert words, the API's way", () => {
    for (const v of ["FOX", "ESPN", "ESPNX", "NPR", "ALERT", "SOS", "EAS"]) expect(checkCallSign(v, none)).toMatchObject({ ok: false, brand: true, message: "That one belongs to someone else." });
    // Three letters or fewer match exactly: FOXY is fine, FOX isn't.
    expect(checkCallSign("FOXY", none).ok).toBe(true);
  });
  it("refuses a name already on the dial", () => {
    const c = checkCallSign("beat", dial);
    expect(c).toMatchObject({ ok: false, taken: "12.1 in Inland Empire", message: "BEAT is taken. Try another." });
    expect(c.rows[3]).toEqual({ ok: false, text: "Already 12.1 in Inland Empire" });
  });
  it("asks for a name when empty", () => expect(checkCallSign("", none)).toMatchObject({ ok: false, message: "Type a call sign to check it." }));
});

describe("cleanCallSign", () => {
  it("keeps letters, capitals, five at most", () => {
    expect(cleanCallSign("be-at1")).toBe("BEAT");
    expect(cleanCallSign("abcdefg")).toBe("ABCDE");
  });
});

describe("suggestNumber", () => {
  it("is stable and skips numbers in use", () => {
    expect(suggestNumber("TACO", new Set())).toBe("63.4");
    expect(suggestNumber("TACO", new Set())).toBe(suggestNumber("TACO", new Set()));
    expect(suggestNumber("TACO", new Set(["63.4"]))).not.toBe("63.4");
  });
});
