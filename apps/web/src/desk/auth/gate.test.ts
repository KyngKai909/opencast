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

  it("opens for a rights reviewer or a market lead too (desk roles, 2026-09-29)", () => {
    const market = { id: "00000000-0000-4000-8000-000000090003", slug: "high-desert", name: "High Desert", timezone: "America/Los_Angeles", open: true };
    expect(gateFor({ ready: true, signedIn: true, me: { isAdmin: false, deskRoles: [{ role: "rights_reviewer", market: null }] } })).toBe("desk");
    expect(gateFor({ ready: true, signedIn: true, me: { isAdmin: false, deskRoles: [{ role: "market_lead", market }] } })).toBe("desk");
    expect(gateFor({ ready: true, signedIn: true, me: { isAdmin: false, deskRoles: [] } })).toBe("not-admin");
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
