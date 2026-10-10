import { describe, expect, it } from "vitest";
import { clearance, dateIn, licenceEnding, notClearedNote, OUTLETS, type ClearanceItem, type ClearanceLicence, type Outlet } from "../src/index.js";

// Programming Phase 6: one function says where an item may air, with the reason.
const at = new Date("2026-10-20T19:00:00.000Z");
const opts = { at, timeZone: "America/Los_Angeles" };
const everywhere = (item: ClearanceItem, country: string | null = "US") => OUTLETS.map((o) => [o, clearance(item, o, country, opts).cleared]);
const allTrue = OUTLETS.map((o) => [o, true]);
const only = (...yes: Outlet[]) => OUTLETS.map((o) => [o, yes.includes(o)]);

const licence = (more: Partial<ClearanceLicence> = {}): ClearanceLicence => ({
  id: "lic-1",
  licensor: "Prairie Films",
  outlets: ["opencast", "other_apps", "relays"],
  worldwide: false,
  countries: ["US", "CA"],
  startsOn: "2026-10-01",
  endsOn: "2026-10-31",
  ...more
});

describe("clearance by rights basis", () => {
  it("airs nowhere without rights", () => {
    expect(clearance({ rights: null }, "opencast", "US", opts)).toEqual({ cleared: false, reason: "rights_not_confirmed" });
    expect(everywhere({ rights: null })).toEqual(only());
  });

  it("clears everything the station made, and what's in the public domain", () => {
    expect(everywhere({ rights: { basis: "made_it" } })).toEqual(allTrue);
    expect(everywhere({ rights: { basis: "public_domain", outlets: ["opencast"] } })).toEqual(allTrue);
  });

  it("follows the outlets the owner allowed, opencast always, and opencast and relays by default", () => {
    for (const basis of ["owner_permission", "permission_record"] as const) {
      expect(everywhere({ rights: { basis } })).toEqual(only("opencast", "relays"));
      expect(everywhere({ rights: { basis, outlets: null } })).toEqual(only("opencast", "relays"));
      expect(everywhere({ rights: { basis, outlets: [] } })).toEqual(only("opencast"));
      expect(everywhere({ rights: { basis, outlets: ["other_apps", "recording"] } })).toEqual(only("opencast", "other_apps", "recording"));
      expect(clearance({ rights: { basis, outlets: ["opencast"] } }, "relays", null, opts)).toEqual({ cleared: false, reason: "not_in_rights" });
    }
  });

  it("clears every outlet under CC0, CC BY and CC BY-SA, keeping the attribution", () => {
    expect(everywhere({ rights: { basis: "licence_record", licence: "cc0", outlets: ["opencast"] } })).toEqual(allTrue);
    for (const cc of ["cc_by", "cc_by_sa"] as const) {
      expect(everywhere({ rights: { basis: "licence_record", licence: cc, outlets: ["opencast"] } })).toEqual(allTrue);
      expect(clearance({ rights: { basis: "licence_record", licence: cc } }, "fast", "US", opts)).toEqual({ cleared: true, reason: "cleared", attribution: true });
    }
    expect(clearance({ rights: { basis: "licence_record", licence: "cc0" } }, "fast", "US", opts)).toEqual({ cleared: true, reason: "cleared" });
  });

  it("keeps non-commercial licences off FAST platforms, and other licences to their outlets", () => {
    for (const nc of ["cc_by_nc", "cc_by_nc_sa", "cc_by_nc_nd"] as const) {
      expect(clearance({ rights: { basis: "licence_record", licence: nc, outlets: ["opencast", "fast", "relays"] } }, "fast", "US", opts)).toEqual({ cleared: false, reason: "licence_not_commercial" });
      expect(clearance({ rights: { basis: "licence_record", licence: nc } }, "relays", null, opts)).toMatchObject({ cleared: true, attribution: true });
      expect(clearance({ rights: { basis: "licence_record", licence: nc } }, "other_apps", "US", opts)).toEqual({ cleared: false, reason: "not_in_rights" });
    }
    expect(everywhere({ rights: { basis: "licence_record", licence: "cc_by_nd" } })).toEqual(only("opencast", "relays"));
    expect(everywhere({ rights: { basis: "licence_record", licence: "other", outlets: ["fast"] } })).toEqual(only("opencast", "fast"));
  });
});

describe("clearance under carriage", () => {
  it("allows only the agreement's outlets, opencast always, on top of the maker's rights", () => {
    const made = { basis: "made_it" as const };
    expect(everywhere({ rights: made, carriage: { outlets: ["opencast"] } })).toEqual(only("opencast"));
    expect(clearance({ rights: made, carriage: { outlets: ["opencast"] } }, "relays", null, opts)).toEqual({ cleared: false, reason: "not_in_carriage" });
    // Agreements made before outlets: opencast and relays.
    expect(everywhere({ rights: made, carriage: {} })).toEqual(only("opencast", "relays"));
    expect(everywhere({ rights: made, carriage: { outlets: ["relays", "other_apps"] } })).toEqual(only("opencast", "other_apps", "relays"));
    // The maker's rights still count.
    expect(clearance({ rights: { basis: "owner_permission", outlets: ["opencast"] }, carriage: { outlets: ["relays"] } }, "relays", null, opts)).toEqual({ cleared: false, reason: "not_in_rights" });
  });
});

describe("clearance under a network licence", () => {
  const item = (more: Partial<ClearanceLicence> = {}, others: ClearanceLicence[] = []): ClearanceItem => ({ rights: { basis: "made_it" }, licences: [licence(more), ...others] });

  it("airs between its dates, both included, in the station's time zone", () => {
    expect(clearance(item(), "opencast", null, opts)).toEqual({ cleared: true, reason: "cleared", licence: { id: "lic-1", licensor: "Prairie Films", endsOn: "2026-10-31" } });
    // 11:30 pm on Oct 31 in Los Angeles is Nov 1 in UTC: still its last day.
    const lastNight = { at: new Date("2026-11-01T06:30:00.000Z"), timeZone: "America/Los_Angeles" };
    expect(clearance(item(), "opencast", null, lastNight).cleared).toBe(true);
    expect(clearance(item(), "opencast", null, { at: lastNight.at }).reason).toBe("licence_ended");
    expect(clearance(item(), "opencast", null, { at: new Date("2026-11-01T08:00:00.000Z"), timeZone: "America/Los_Angeles" })).toMatchObject({ cleared: false, reason: "licence_ended" });
    expect(clearance(item({ startsOn: "2026-10-21" }), "opencast", null, opts)).toMatchObject({ cleared: false, reason: "licence_not_started" });
  });

  it("is off every outlet once it ends, opencast too", () => {
    expect(everywhere(item({ endsOn: "2026-10-19" }))).toEqual(only());
  });

  it("allows its outlets only, opencast always", () => {
    expect(everywhere(item({ outlets: ["fast"], worldwide: true }))).toEqual(only("opencast", "fast"));
    expect(clearance(item({ outlets: [] }), "relays", "US", opts)).toMatchObject({ cleared: false, reason: "not_in_licence" });
  });

  it("checks the viewer's country, except on Opencast; with no country only a worldwide licence clears it", () => {
    expect(clearance(item(), "other_apps", "CA", opts).cleared).toBe(true);
    expect(clearance(item(), "other_apps", "ca", opts).cleared).toBe(true);
    expect(clearance(item(), "other_apps", "GB", opts)).toMatchObject({ cleared: false, reason: "outside_territory" });
    expect(clearance(item(), "relays", null, opts)).toMatchObject({ cleared: false, reason: "territory_unknown" });
    expect(clearance(item({ worldwide: true, countries: [] }), "relays", null, opts).cleared).toBe(true);
    expect(clearance(item(), "opencast", "GB", opts).cleared).toBe(true);
  });

  it("is cleared when any covering licence clears it, and otherwise says the closest one's reason", () => {
    const ended = licence({ id: "old", endsOn: "2026-09-30" });
    const worldwide = licence({ id: "world", worldwide: true, countries: [] });
    expect(clearance(item({}, [worldwide]), "relays", null, opts)).toMatchObject({ cleared: true, licence: { id: "world" } });
    expect(clearance({ rights: { basis: "made_it" }, licences: [ended, licence()] }, "relays", null, opts)).toMatchObject({ cleared: false, reason: "territory_unknown", licence: { id: "lic-1" } });
  });

  it("asks the rights and carriage first", () => {
    expect(clearance({ rights: null, licences: [licence()] }, "opencast", "US", opts).reason).toBe("rights_not_confirmed");
    expect(clearance({ rights: { basis: "made_it" }, carriage: { outlets: ["opencast"] }, licences: [licence()] }, "relays", "US", opts).reason).toBe("not_in_carriage");
  });
});

describe("a licence ending", () => {
  it("is found within two weeks of its last day, the last covering licence counting", () => {
    expect(licenceEnding([licence()], { ...opts, days: 14 })).toMatchObject({ id: "lic-1" });
    expect(licenceEnding([licence()], { ...opts, at: new Date("2026-10-10T19:00:00.000Z"), days: 14 })).toBeNull();
    expect(licenceEnding([licence(), licence({ id: "next", endsOn: "2027-03-31" })], { ...opts, days: 14 })).toBeNull();
    expect(licenceEnding([licence({ endsOn: "2026-10-19" })], { ...opts, days: 14 })).toBeNull();
    expect(licenceEnding([], { ...opts, days: 14 })).toBeNull();
  });

  it("reads dates in the time zone", () => {
    expect(dateIn(new Date("2026-11-01T06:30:00.000Z"), "America/Los_Angeles")).toBe("2026-10-31");
    expect(dateIn(new Date("2026-11-01T06:30:00.000Z"))).toBe("2026-11-01");
  });
});

describe("the log's quiet note", () => {
  it("names the station's relay platforms", () => {
    expect(notClearedNote("relays", ["YouTube"])).toBe("Not on your YouTube relay");
    expect(notClearedNote("relays", ["YouTube", "Twitch"])).toBe("Not on your YouTube and Twitch relays");
    expect(notClearedNote("relays", ["YouTube", "Twitch", "Kick"])).toBe("Not on your YouTube, Twitch and Kick relays");
    expect(notClearedNote("relays")).toBe("Not on your relays");
    expect(notClearedNote("other_apps")).toBe("Not in other apps");
  });
});
