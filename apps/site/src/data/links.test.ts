import { describe, expect, it } from "vitest";
import { claim, contact, LAUNCH_MODE, offerShow, orderSpot, requestProgram, startSpot, waitlist, watch } from "./links";

describe("links in waitlist mode (the default)", () => {
  it("defaults to waitlist", () => expect(LAUNCH_MODE).toBe("waitlist"));
  it("opens the sheet with the right role and prefill", () => {
    expect(claim({ number: "44.1", callSign: "TACO" })).toEqual({ href: "#waitlist", attrs: { "data-waitlist": JSON.stringify({ role: "station", number: "44.1", callSign: "TACO" }) } });
    expect(JSON.parse(offerShow().attrs["data-waitlist"]!)).toEqual({ role: "producer" });
    expect(JSON.parse(requestProgram({ id: "p1", title: "Late Crate" }).attrs["data-waitlist"]!)).toEqual({ role: "station", about: "Late Crate", details: { program: "p1" } });
    expect(JSON.parse(startSpot({ where: "shop", kind: "cafe", times: "evening", budget: "300", cap: "15" }).attrs["data-waitlist"]!)).toEqual({ role: "business", details: { where: "shop", kind: "cafe", times: "evening", budget: "300", cap: "15" } });
    expect(JSON.parse(orderSpot().attrs["data-waitlist"]!)).toEqual({ role: "business", about: "Order a spot" });
    expect(waitlist({ role: "viewer" }).href).toBe("#waitlist");
  });
  it("sends Watch to the home guide", () => expect(watch("12.1")).toEqual({ href: "/", attrs: {} }));
  it("sends Contact to the page, with the desk", () => {
    expect(contact().href).toBe("/contact");
    expect(contact("rights").href).toBe("/contact?desk=rights");
  });
});

describe("links in live mode", () => {
  it("links into the apps", () => {
    expect(claim({ number: "44.1", callSign: "TACO" }, "live")).toEqual({ href: "/control/claim?number=44.1&callsign=TACO", attrs: {} });
    expect(claim({}, "live").href).toBe("/control/claim");
    expect(offerShow("live").href).toBe("/control/offer");
    expect(requestProgram({ id: "p 1", title: "x" }, "live").href).toBe("/control/market?program=p+1");
    expect(startSpot({ where: "online", kind: "shop", times: "night", budget: "50", cap: "5" }, "live").href).toBe("/spots/new?where=online&kind=shop&times=night&budget=50&cap=5");
    expect(orderSpot("live").href).toBe("/orders/new");
    expect(watch("12.1", "live").href).toBe("/?ch=12.1");
  });
});
