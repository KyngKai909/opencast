// The Station area's small rules: the colour check, what an invite takes, when an answer can go,
// the switcher's rows, the claim page's steps, and which notifications a role sees.

import { describe, expect, it } from "vitest";
import { claimSteps } from "../../pages/station/ClaimStation";
import { switchRow } from "../overlays/StationSwitcher";
import { BEAT, HALL, LAB } from "../../mocks/fixtures/stations";
import { answerBlocker } from "./AnswerClaim";
import { colourCheck } from "./ColourPicker";
import { contactOf } from "./settings/InviteModal";
import { groupsFor } from "./settings/NotificationsSection";
import { peopleLine, ROLE_TABLE } from "./settings/TeamSection";
import { can } from "../../station/abilities";

const NOW = new Date("2026-09-27T03:42:12Z");

describe("a station colour holds 4.5:1 against white", () => {
  it("passes BEAT's plum and says the ratio", () => {
    expect(colourCheck("#8C3B7A")).toEqual({ ok: true, line: "White text reads at 6.9:1" });
  });
  it("won't save a colour white text can't be read on, and says why", () => {
    const c = colourCheck("#F0B43C");
    expect(c.ok).toBe(false);
    expect(c.line).toMatch(/^White text reads at \d\.\d:1\. Station colours need 4\.5:1, so this one can't be saved\.$/);
  });
  it("asks for a whole hex code", () => {
    expect(colourCheck("#8C3B7").ok).toBe(false);
  });
});

describe("inviting someone (station-settings 03.2)", () => {
  it("takes an email or a phone number", () => {
    expect(contactOf(" Dana@Example.com ")).toEqual({ email: "dana@example.com" });
    expect(contactOf("(909) 555-0142")).toEqual({ phone: "9095550142" });
    expect(contactOf("+1 909 555 0142")).toEqual({ phone: "+19095550142" });
    expect(contactOf("dana")).toBeNull();
  });
  it("counts the team with invites waiting", () => {
    expect(peopleLine(4, "BEAT")).toBe("4 people run BEAT.");
    expect(peopleLine(1, "BEAT")).toBe("1 person runs BEAT.");
  });
  it("draws the role table from the same rules the app checks", () => {
    const roles = ["owner", "operator", "host"] as const;
    const abilityFor = ["live", "programming", "spots", "seeMoney", "manage"] as const;
    ROLE_TABLE.forEach((row, i) =>
      roles.forEach((r, j) => {
        const cell = row.can[j];
        expect(can(r, abilityFor[i]!)).toBe(cell === true || cell === "See only");
      })
    );
    expect(can("operator", "moveMoney")).toBe(false);
  });
});

describe("answering a claim (rights 03.1)", () => {
  const base = { basis: null, file: false, note: "", attested: false };
  it("won't send until a basis is chosen, backed up, and attested", () => {
    expect(answerBlocker(base)).toBe("Choose which is true.");
    expect(answerBlocker({ ...base, basis: "owner_permission" })).toBe("Attach the permission or licence.");
    expect(answerBlocker({ ...base, basis: "public_domain" })).toBe("Say where it came from.");
    expect(answerBlocker({ ...base, basis: "made_it" })).toBe("Tick the statement to send it.");
    expect(answerBlocker({ ...base, basis: "owner_permission", file: true, attested: true })).toBeNull();
    expect(answerBlocker({ ...base, basis: "made_it", attested: true })).toBeNull();
  });
});

describe("the station switcher (station-settings 04.1, 05.2)", () => {
  const beat = { kind: "station" as const, station: BEAT, role: "owner" as const };
  const hall = { kind: "station" as const, station: HALL, role: "operator" as const };
  const deadAir = new Date(NOW.getTime() + 40 * 60_000).toISOString();

  it("says your role and whether it's on air, and marks where you are", () => {
    const r = switchRow(beat, { stationId: BEAT.id, onAir: true, deadAirAt: null }, BEAT.id, NOW, false);
    expect(r).toMatchObject({ href: "/beat/monitor", channel: "12.1", name: "BEAT", line: "Owner. On air", attention: null, current: true });
  });
  it("flags dead air coming beside the row on the web, and in the line on the phone", () => {
    const status = { stationId: HALL.id, onAir: true, deadAirAt: deadAir };
    expect(switchRow(hall, status, BEAT.id, NOW, false)).toMatchObject({ line: "Operator. On air", attention: "Dead air in 40 min", current: false });
    expect(switchRow(hall, status, BEAT.id, NOW, true)).toMatchObject({ line: "Operator. Dead air in 40 min", attention: null });
  });
  it("sends a studio to its programs", () => {
    const r = switchRow({ kind: "station", station: LAB, role: "owner" }, undefined, BEAT.id, NOW, false);
    expect(r).toMatchObject({ href: "/inland-sound-lab/programs", channel: null, name: "Inland Sound Lab", line: "Owner. Studio" });
  });
  it("leaves the air state out until it's known", () => {
    expect(switchRow(beat, undefined, BEAT.id, NOW, false).line).toBe("Owner");
  });
});

describe("claiming a station (rights 05.1)", () => {
  const h = (status: "verifying" | "waiting_period" | "completed", kind: "claim" | "stop" = "claim") => ({ handover: { handoverId: "x", kind, status, payableAfter: null } });
  it("starts at signing in", () => {
    expect(claimSteps({ handover: null }, false)).toEqual({ signIn: "current", prove: "todo", takeOver: "todo" });
  });
  it("moves through showing it's you, the wait, and taking over", () => {
    expect(claimSteps({ handover: null }, true)).toEqual({ signIn: "done", prove: "current", takeOver: "todo" });
    expect(claimSteps(h("verifying"), true)).toEqual({ signIn: "done", prove: "current", takeOver: "todo" });
    expect(claimSteps(h("waiting_period"), true)).toEqual({ signIn: "done", prove: "done", takeOver: "current" });
    expect(claimSteps(h("completed"), true)).toEqual({ signIn: "done", prove: "done", takeOver: "done" });
  });
});

describe("notifications per role (station-settings 05.1)", () => {
  it("shows owners and operators every row", () => {
    expect(groupsFor("owner").flatMap((g) => g.rows).length).toBe(7);
    expect(groupsFor("operator").flatMap((g) => g.rows).length).toBe(7);
  });
  it("shows a host only what's about their blocks", () => {
    expect(groupsFor("host").flatMap((g) => g.rows.map((r) => r.key))).toEqual(["dead_air_warning", "signal_lost"]);
  });
});

describe("a studio's notifications", () => {
  it("leaves out what's about going out", () => {
    expect(groupsFor("owner", true).map((g) => g.title)).toEqual(["Spots and money", "Carriage"]);
  });
});
