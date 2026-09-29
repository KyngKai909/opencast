import { describe, expect, it } from "vitest";
import { deviceKind, deviceLine } from "./about";
import { marketChoices, marketLine } from "./market";

describe("the market line on first launch", () => {
  it("says the guess out loud, with where to change it (05.3)", () => {
    expect(marketLine({ loading: false, guessed: "Inland Empire", noneOpen: false, current: "Inland Empire" })).toBe("Your market: Inland Empire, from this TV's connection. Change it any time in the menu.");
  });
  it("is quiet while the guess is on its way", () => {
    expect(marketLine({ loading: true, guessed: null, noneOpen: false, current: "Inland Empire" })).toBeNull();
  });
  it("says so when no open market matches the connection", () => {
    expect(marketLine({ loading: false, guessed: null, noneOpen: true, current: "Inland Empire" })).toBe("No market is open near this TV's connection yet, so it's showing Inland Empire. Change it any time in the menu.");
  });
  it("names a market someone already chose", () => {
    expect(marketLine({ loading: false, guessed: null, noneOpen: false, current: "High Desert" })).toBe("Your market: High Desert. Change it any time in the menu.");
    expect(marketLine({ loading: false, guessed: null, noneOpen: false, current: null })).toBeNull();
  });
});

describe("choosing a market", () => {
  const all = [
    { slug: "inland-empire", open: true },
    { slug: "closed", open: false },
    { slug: "high-desert", open: true }
  ];
  it("lists open markets and starts on the current one", () => {
    expect(marketChoices(all, "high-desert")).toEqual({ list: [all[0], all[2]], focus: 1 });
    expect(marketChoices(all, "elsewhere").focus).toBe(0);
    expect(marketChoices([], "x")).toEqual({ list: [], focus: 0 });
  });
});

describe("About this TV", () => {
  it("names the kind of TV from its browser", () => {
    expect(deviceKind("Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7285) AppleWebKit/537.36")).toBe("Fire TV");
    expect(deviceKind("Mozilla/5.0 (Linux; Android 12; Chromecast) AppleWebKit/537.36 GoogleTV")).toBe("Google TV");
    expect(deviceKind("Mozilla/5.0 (Linux; Android 11; BRAVIA 4K VH2) AppleWebKit/537.36")).toBe("Android TV");
    expect(deviceKind("Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36")).toBe("TV browser");
    expect(deviceKind("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15")).toBe("Web browser");
    expect(deviceLine("Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7285)", true)).toBe("Opencast app on Fire TV");
    expect(deviceLine("Mozilla/5.0 (Macintosh)", false)).toBe("Web browser");
  });
});
