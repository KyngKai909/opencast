// "Watch on" with the Opencast TV app (B2): the account's TV apps and TVs paired by code in the
// targets table, platform labels, the offline words, pairing by code, and remembering cast targets.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tv } from "@opencast/contracts";
import { ApiError } from "../api/client";
import { forgetPairing, loadPairings, normalisePairCode, pairWithCode, PAIR_CODE_SHORT, pairingFor, savePairing } from "./pairings";
import { castTargetToRemember, rememberCastTarget } from "./remember";
import type { CastSession } from "./session";
import { PLATFORM_LABELS, TARGET_KINDS, offlineLine, orderTargets, pairedTargets, platformLabel, primaryLabel, targetLine, tvAppTargets, uniqueTargets } from "./targets";
import type { CastTarget } from "./types";

const DEN = "00000000-0000-4000-8000-0000000c0001";
const tv = (o: Partial<Tv> & Pick<Tv, "id" | "name" | "kind">): Tv => ({ platform: null, signedIn: false, lastUsedAt: null, online: false, castingNow: false, ...o });
const ACCOUNT: Tv[] = [
  tv({ id: "00000000-0000-4000-8000-000000000701", name: "Living room TV", kind: "chromecast" }),
  tv({ id: "00000000-0000-4000-8000-000000000704", name: "Kitchen TV", kind: "tv_app", platform: "android_tv", signedIn: true, online: false }),
  tv({ id: DEN, name: "Den TV", kind: "tv_app", platform: "fire_tv", signedIn: true, online: true }),
  tv({ id: "00000000-0000-4000-8000-000000000705", name: "Old TV", kind: "tv_app", platform: "web", signedIn: false })
];

beforeEach(() => localStorage.removeItem("oc-tv-pairings"));

describe("platform labels", () => {
  it("names every platform as the apps do", () => {
    expect(PLATFORM_LABELS).toEqual({ android_tv: "Android TV", fire_tv: "Fire TV", google_tv: "Google TV", tv_browser: "TV browser", web: "Web" });
    expect(platformLabel("fire_tv")).toBe("Fire TV");
    expect(platformLabel(null)).toBeNull();
  });
});

describe("the account's TV apps in Watch on", () => {
  it("lists signed-in TV apps only, not cast targets or signed-out apps", () => {
    expect(tvAppTargets(ACCOUNT).map((t) => t.name)).toEqual(["Kitchen TV", "Den TV"]);
    expect(tvAppTargets(ACCOUNT)[1]).toEqual({ id: DEN, name: "Den TV", kind: "tv_app", online: true, platformLabel: "Fire TV" });
  });

  it("puts TV apps that are on first, then cast and mirror targets, then TV apps that aren't on", () => {
    const chromecast: CastTarget = { id: "cc", name: "Living room TV", kind: "chromecast" };
    const airplay: CastTarget = { id: "airplay:Bedroom TV", name: "Bedroom TV", kind: "airplay" };
    const ordered = orderTargets([chromecast, ...tvAppTargets(ACCOUNT), airplay, ...pairedTargets([{ tvId: "p1", tvName: "Mum's TV", phoneToken: "t" }])]);
    expect(ordered.map((t) => t.name)).toEqual(["Den TV", "Mum's TV", "Living room TV", "Bedroom TV", "Kitchen TV"]);
  });

  it("says the platform, or that the TV app isn't on", () => {
    const [kitchen, den] = tvAppTargets(ACCOUNT);
    expect(targetLine(den!)).toBe("Opencast app on Fire TV");
    expect(targetLine(kitchen!)).toBe("Opencast app, not on now");
    expect(targetLine(pairedTargets([{ tvId: "p1", tvName: "Mum's TV", phoneToken: "t" }])[0]!)).toBe("Opencast app");
    expect(targetLine({ id: "cc", name: "Living room TV", kind: "chromecast" })).toBe("Chromecast");
    expect(offlineLine("Den TV")).toBe("Den TV isn't on. Open Opencast on the TV and try again.");
  });

  it("opens the app, from the targets table", () => {
    const [, den] = tvAppTargets(ACCOUNT);
    expect(TARGET_KINDS.tv_app.action).toBe("open_app");
    expect(primaryLabel({ kind: "tv", target: den! }, null)).toBe("Open the app on Den TV");
    expect(primaryLabel({ kind: "tv", target: den! }, den!)).toBe("Open the remote");
  });

  it("shows a TV that's on the account and paired by code once, as the account's", () => {
    const rows = uniqueTargets([...tvAppTargets(ACCOUNT), ...pairedTargets([{ tvId: DEN, tvName: "Den TV", phoneToken: "t" }])]);
    expect(rows.filter((r) => r.id === DEN)).toEqual([expect.objectContaining({ online: true, platformLabel: "Fire TV" })]);
    expect(rows.find((r) => r.id === DEN)?.paired).toBeUndefined();
  });
});

describe("pairing with a code from the TV", () => {
  it("takes four digits, however they're typed", () => {
    expect(normalisePairCode("48 21")).toBe("4821");
    expect(normalisePairCode("4a8-2 19")).toBe("4821");
  });

  it("says a short code is short, without asking the API", async () => {
    const pair = vi.fn();
    expect(await pairWithCode("48", "Kai's phone", pair)).toEqual({ ok: false, error: PAIR_CODE_SHORT });
    expect(pair).not.toHaveBeenCalled();
  });

  it("pairs with the phone's name and keeps the pairing on the device", async () => {
    const pair = vi.fn(async () => ({ tvId: DEN, tvName: "Den TV", phoneToken: "tvp_1" }));
    const r = await pairWithCode("4821", "Kai's phone", pair);
    expect(pair).toHaveBeenCalledWith({ code: "4821", name: "Kai's phone" });
    expect(r).toEqual({ ok: true, pairing: { tvId: DEN, tvName: "Den TV", phoneToken: "tvp_1" } });
    expect(loadPairings()).toEqual([{ tvId: DEN, tvName: "Den TV", phoneToken: "tvp_1" }]);
    // Pairing again replaces it; forgetting drops it.
    savePairing({ tvId: DEN, tvName: "Den TV", phoneToken: "tvp_2" });
    expect(loadPairings()).toHaveLength(1);
    expect(pairingFor(DEN)?.phoneToken).toBe("tvp_2");
    forgetPairing(DEN);
    expect(loadPairings()).toEqual([]);
  });

  it("says the API's words when the code is wrong or tried too often, keeping nothing", async () => {
    const wrong = await pairWithCode("1111", "a phone", async () => {
      throw new ApiError(404, "code_not_found", "That code isn't right, or it's run out. Check the code on the TV.");
    });
    expect(wrong).toEqual({ ok: false, error: "That code isn't right, or it's run out. Check the code on the TV." });
    const many = await pairWithCode("1111", "a phone", async () => {
      throw new ApiError(429, "too_many_tries", "Too many wrong codes. Wait a few minutes and try again.");
    });
    expect(many).toEqual({ ok: false, error: "Too many wrong codes. Wait a few minutes and try again." });
    expect(loadPairings()).toEqual([]);
  });

  it("ignores a garbled store", () => {
    localStorage.setItem("oc-tv-pairings", '[{"tvId":1},"x",{"tvId":"a","tvName":"A","phoneToken":"t"}]');
    expect(loadPairings()).toEqual([{ tvId: "a", tvName: "A", phoneToken: "t" }]);
    localStorage.setItem("oc-tv-pairings", "{nope");
    expect(loadPairings()).toEqual([]);
  });
});

describe("remembering cast targets for Your TVs", () => {
  const idle: CastSession = { status: "idle", error: null };
  const living: CastTarget = { id: "cc-1", name: "Living room TV", kind: "chromecast" };
  const casting = (target: CastTarget): CastSession => ({ status: "casting", target, me: "Kai's phone", receiver: null });
  const mirroring = (name: string): CastSession => ({ status: "mirroring", target: { id: `airplay:${name}`, name: name || "the TV", kind: "airplay" }, receiver: null });

  it("remembers a Chromecast when a cast starts, and an AirPlay TV when mirroring connects", () => {
    expect(castTargetToRemember(idle, casting(living))).toEqual({ kind: "chromecast", name: "Living room TV" });
    expect(castTargetToRemember({ status: "connecting", target: living }, casting(living))).toEqual({ kind: "chromecast", name: "Living room TV" });
    expect(castTargetToRemember(idle, mirroring("Bedroom TV"))).toEqual({ kind: "airplay", name: "Bedroom TV" });
  });

  it("doesn't for the TV app, Chrome's picker, a nameless mirror, or a session that carries on", () => {
    expect(castTargetToRemember(idle, casting({ id: DEN, name: "Den TV", kind: "tv_app" }))).toBeNull();
    expect(castTargetToRemember(idle, casting({ id: "p", name: "A TV with Chromecast", kind: "chromecast", picker: true }))).toBeNull();
    expect(castTargetToRemember(idle, mirroring(""))).toBeNull();
    expect(castTargetToRemember(casting(living), casting(living))).toBeNull();
  });

  it("calls recordCastTarget signed in only, and shrugs off a failure", async () => {
    const record = vi.fn(async () => ({}));
    expect(await rememberCastTarget(idle, casting(living), false, record)).toBeNull();
    expect(record).not.toHaveBeenCalled();
    expect(await rememberCastTarget(idle, casting(living), true, record)).toEqual({ kind: "chromecast", name: "Living room TV" });
    expect(record).toHaveBeenCalledWith({ kind: "chromecast", name: "Living room TV" });
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await rememberCastTarget(idle, mirroring("Bedroom TV"), true, failing)).toBeNull();
    expect(failing).toHaveBeenCalledWith({ kind: "airplay", name: "Bedroom TV" });
  });
});
