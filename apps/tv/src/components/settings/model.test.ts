import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../tv/device";
import { changed, channelUpHelp, ends, fromAccount, isSection, labelOf, OPTIONS, SECTIONS, step, toAccount } from "./model";

describe("TV settings rows", () => {
  it("has the five sections in the frame's order", () => {
    expect(SECTIONS.map((s) => s.label)).toEqual(["Watching", "Remote and phones", "Picture and sound", "Account", "About this TV"]);
    expect(isSection("watching")).toBe(true);
    expect(isSection("nope")).toBe(false);
    expect(isSection(undefined)).toBe(false);
  });

  it("steps with ◀ ▶ and stops at the ends; OK goes round", () => {
    const o = OPTIONS.captions;
    expect(step(o, "on", 1)).toBe("muted_only");
    expect(step(o, "on", -1)).toBe("off");
    expect(step(o, "muted_only", 1)).toBe("muted_only");
    expect(step(o, "off", -1)).toBe("off");
    expect(step(o, "muted_only", 1, true)).toBe("off");
    // An unknown value starts from the first option.
    expect(step(o, "loud" as never, 1)).toBe("off");
    expect(ends(o, "off")).toEqual({ first: true, last: false });
    expect(ends(o, "muted_only")).toEqual({ first: false, last: true });
  });

  it("reads each value as the frame writes it", () => {
    expect(labelOf(OPTIONS.captions, "on")).toBe("On");
    expect(labelOf(OPTIONS.bannerSeconds, 5)).toBe("5 seconds");
    expect(labelOf(OPTIONS.numberWaitSeconds, 1)).toBe("1 second");
    expect(labelOf(OPTIONS.numberWaitSeconds, 2)).toBe("2 seconds");
    expect(labelOf(OPTIONS.channelUp, "up_the_dial")).toBe("Up the dial");
    // The number wait's default (2 seconds, decided) is one of its options.
    expect(OPTIONS.numberWaitSeconds.map((x) => x.value)).toEqual([1, 1.5, 2, 3]);
    expect(OPTIONS.numberWaitSeconds.some((x) => x.value === DEFAULT_SETTINGS.numberWaitSeconds)).toBe(true);
    expect(OPTIONS.bannerSeconds.some((x) => x.value === DEFAULT_SETTINGS.bannerSeconds)).toBe(true);
  });

  it("says which way channel up goes with this market's first two channels", () => {
    expect(channelUpHelp("up_the_dial", ["7.1", "9.1", "12.1"])).toBe("Up the dial, 7.1 to 9.1, like most TVs");
    expect(channelUpHelp("down_the_dial", ["7.1", "9.1"])).toBe("Down the dial, 9.1 to 7.1");
    expect(channelUpHelp("up_the_dial", ["7.1"])).toBe("Up the dial, like most TVs");
  });
});

describe("where TV settings are kept", () => {
  it("puts captions in watching, the Wi-Fi rule in tvs, and the TV-only rows under a top-level tv key", () => {
    expect(toAccount({ captions: "off", captionSize: "large", othersOnWifiCanChange: false, bannerSeconds: 8, includeRadioBand: true })).toEqual({
      watching: { captions: "off", captionSize: "large" },
      tvs: { othersOnWifiCanChange: false },
      tv: { bannerSeconds: 8, includeRadioBand: true }
    });
    expect(toAccount({})).toEqual({});
  });

  it("sends each section it touches whole, with the account's other values (updateMe replaces sections)", () => {
    const current = { watching: { captions: "on", startOn: "dial", mutedPreviews: true }, tvs: { lockScreenRemote: true, othersOnWifiCanChange: true }, tv: { channelUp: "down_the_dial", quality: "best" } } as const;
    expect(toAccount({ captions: "off", bannerSeconds: 8 }, current)).toEqual({
      watching: { captions: "off", startOn: "dial", mutedPreviews: true },
      tv: { channelUp: "down_the_dial", quality: "best", bannerSeconds: 8 }
    });
    expect(toAccount({ othersOnWifiCanChange: false }, current)).toEqual({ tvs: { lockScreenRemote: true, othersOnWifiCanChange: false } });
  });

  it("reads the account back, ignoring what isn't a TV setting or isn't valid", () => {
    const s = { watching: { captions: "muted_only", captionSize: "small", mutedPreviews: true }, tvs: { othersOnWifiCanChange: false }, tv: { channelUp: "down_the_dial", numberWaitSeconds: 1.5 } } as const;
    expect(fromAccount(s as never)).toEqual({ captions: "muted_only", captionSize: "small", othersOnWifiCanChange: false, channelUp: "down_the_dial", numberWaitSeconds: 1.5 });
    expect(fromAccount({ tv: { bannerSeconds: 4 } } as never)).toEqual({});
    expect(fromAccount(undefined)).toEqual({});
  });

  it("round-trips every TV setting through the account", () => {
    const all = { ...DEFAULT_SETTINGS, othersOnWifiCanChange: true };
    const { startOn: _startOn, ...kept } = all;
    expect(fromAccount(toAccount(all))).toEqual(kept);
  });

  it("keeps Tuning sound with the watching settings: on for both bands unless turned off", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ tuningSound: true, radioTuningSound: true });
    expect(labelOf(OPTIONS.tuningSound, false)).toBe("Off");
    expect(labelOf(OPTIONS.tuningSound, true)).toBe("On");
    expect(toAccount({ tuningSound: true }, { watching: { captions: "on" } })).toEqual({ watching: { captions: "on", tuningSound: true } });
    expect(fromAccount({ watching: { tuningSound: true, radioTuningSound: false } })).toEqual({ tuningSound: true, radioTuningSound: false });
    expect(fromAccount({ watching: { captions: "on" } })).toEqual({ captions: "on" });
  });

  it("changes only what differs", () => {
    expect(changed({ ...DEFAULT_SETTINGS }, { captions: "on", bannerSeconds: 8 })).toEqual({ bannerSeconds: 8 });
  });
});
