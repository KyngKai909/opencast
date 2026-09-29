// Admin sign-in only: who gets the desk.
import { describe, expect, it } from "vitest";
import { gateFor, initialsOf } from "./gate";

describe("the admin gate", () => {
  it("waits, asks to sign in, turns away anyone not on the team, and opens for the team", () => {
    expect(gateFor({ ready: false, signedIn: false, me: undefined })).toBe("loading");
    expect(gateFor({ ready: true, signedIn: false, me: undefined })).toBe("sign-in");
    expect(gateFor({ ready: true, signedIn: true, me: undefined })).toBe("loading");
    expect(gateFor({ ready: true, signedIn: true, me: { isAdmin: false } })).toBe("not-admin");
    expect(gateFor({ ready: true, signedIn: true, me: { isAdmin: true } })).toBe("desk");
  });

  it("reads the API's refusals", () => {
    expect(gateFor({ ready: true, signedIn: true, me: undefined, meError: 401 })).toBe("sign-in");
    expect(gateFor({ ready: true, signedIn: true, me: undefined, meError: 403 })).toBe("not-admin");
    expect(gateFor({ ready: true, signedIn: true, me: undefined, meError: 500 })).toBe("error");
  });

  it("puts DA in the header for Dee A.", () => {
    expect(initialsOf("Dee A.")).toBe("DA");
    expect(initialsOf(null, "sam@opencast.example")).toBe("SO");
  });
});
