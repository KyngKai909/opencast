import { describe, expect, it } from "vitest";
import { waitlistApi } from "@opencast/contracts";
import { COPY, cleanCallSign, cleanZip, confirmation, fieldErrorsFrom, toBody, validate, type Joined, type WaitlistDraft } from "./waitlist";

const IE = { id: "00000000-0000-4000-8000-000000090001", slug: "inland-empire", name: "Inland Empire", timezone: "America/Los_Angeles", open: false };
const draft = (d: Partial<WaitlistDraft> = {}): WaitlistDraft => ({ role: "viewer", email: "kai@example.com", zip: "92373", callSign: "", ...d });

describe("the ZIP", () => {
  it("keeps digits only, five at most", () => {
    expect(cleanZip("92373")).toBe("92373");
    expect(cleanZip("92373-1234")).toBe("92373");
    expect(cleanZip(" 9a2 3")).toBe("923");
  });

  it("is required, and five digits, as the contract says", () => {
    expect(validate(draft({ zip: "" })).zip).toBe(COPY.zipMissing);
    expect(validate(draft({ zip: "923" })).zip).toBe(COPY.zipInvalid);
    expect(validate(draft()).zip).toBeUndefined();
    expect(waitlistApi.join.body.safeParse(toBody(draft({ zip: "923" }))).success).toBe(false);
  });
});

describe("the email", () => {
  it("says the reference's words when it isn't an address", () => {
    expect(validate(draft({ email: "" })).email).toBe("Enter an email address");
    expect(validate(draft({ email: "kai@" })).email).toBe("Enter an email address");
    expect(validate(draft({ email: " kai@example.com " })).email).toBeUndefined();
  });
});

describe("the call sign", () => {
  it("is cleaned as it's typed: letters only, capitals, five at most", () => {
    expect(cleanCallSign("beat")).toBe("BEAT");
    expect(cleanCallSign("be-at1")).toBe("BEAT");
    expect(cleanCallSign("k 9 x y z w q")).toBe("KXYZW");
    expect(cleanCallSign("123")).toBe("");
  });

  it("is three to five letters when a station gives one, and optional", () => {
    expect(validate(draft({ role: "station", callSign: "KX" })).callSign).toBe(COPY.callSignShort);
    expect(validate(draft({ role: "station", callSign: "KXYZ" })).callSign).toBeUndefined();
    expect(validate(draft({ role: "station", callSign: "" })).callSign).toBeUndefined();
  });

  it("goes only with a station: switching role drops it from what's sent", () => {
    expect(toBody(draft({ role: "station", callSign: "KXYZ" }))).toEqual({ role: "station", email: "kai@example.com", zip: "92373", callSign: "KXYZ" });
    for (const role of ["viewer", "producer", "business"] as const) {
      const body = toBody(draft({ role, callSign: "KXYZ" }));
      expect(body).not.toHaveProperty("callSign");
      expect(waitlistApi.join.body.safeParse(body).success).toBe(true);
    }
    expect(validate(draft({ role: "viewer", callSign: "KX" })).callSign).toBeUndefined();
    expect(toBody(draft({ role: "station" }))).not.toHaveProperty("callSign");
  });
});

describe("the confirmation", () => {
  const joined = (j: Partial<Joined>): Joined => ({ role: "viewer", market: IE, message: "You're on the list.", heldCallSign: null, ...j });

  it("uses the API's message as the headline, with a curly apostrophe", () => {
    expect(confirmation(joined({})).heading).toBe("You’re on the list.");
    expect(confirmation(joined({ role: "station", message: "BEAT is on hold for you.", heldCallSign: "BEAT" })).heading).toBe("BEAT is on hold for you.");
  });

  it("says the paragraph for each role", () => {
    expect(confirmation(joined({})).paragraph).toBe("We’ll write when the Inland Empire dial opens.");
    expect(confirmation(joined({ role: "station", heldCallSign: "KXYZ" })).paragraph).toBe("We’ll write when your market opens, and your call sign is held until then.");
    expect(confirmation(joined({ role: "station" })).paragraph).toBe("We’ll write when your market opens.");
    expect(confirmation(joined({ role: "producer" })).paragraph).toBe("We’ll write when the syndication market opens to makers.");
    expect(confirmation(joined({ role: "business" })).paragraph).toBe("We’ll write when the first spot market opens near you.");
  });

  it("handles a ZIP outside every market", () => {
    expect(confirmation(joined({ market: null })).paragraph).toBe("Your ZIP isn’t in a market yet. We’ll write when a dial opens near you.");
    expect(confirmation(joined({ role: "station", market: null, heldCallSign: "KXYZ" })).paragraph).toBe("Your ZIP isn’t in a market yet. We’ll write when one opens near you, and your call sign is held until then.");
    expect(confirmation(joined({ role: "station", market: null })).paragraph).toBe("Your ZIP isn’t in a market yet. We’ll write when one opens near you.");
    expect(confirmation(joined({ role: "producer", market: null })).paragraph).toBe("We’ll write when the syndication market opens to makers.");
    expect(confirmation(joined({ role: "business", market: null })).paragraph).toBe("We’ll write when the first spot market opens near you.");
  });

  it("handles a market that's already open", () => {
    expect(confirmation(joined({ market: { ...IE, open: true } })).paragraph).toBe("The Inland Empire dial is already on. We’ll write when there’s more to watch.");
  });
});

describe("server errors", () => {
  it("land on the right fields; the rest are for the form", () => {
    expect(fieldErrorsFrom({ zip: "Invalid", email: "Invalid email address", body: "Only stations hold a call sign" })).toEqual({
      fields: { zip: "Invalid", email: "Invalid email address" },
      rest: ["Only stations hold a call sign"]
    });
    expect(fieldErrorsFrom(undefined)).toEqual({ fields: {}, rest: [] });
  });
});
