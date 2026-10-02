import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RegisteredTv } from "@opencast/contracts";
import { getDevice, setDevice } from "./device";
import { ensureRegistered, platformFor, registerAgain } from "./registration";

const FIRE = "Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7233) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 Mobile Safari/537.36";
const GOOGLE = "Mozilla/5.0 (Linux; Android 12; Chromecast) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 Safari/537.36 GoogleTV/12";
const ANDROID = "Mozilla/5.0 (Linux; Android 11; BRAVIA 4K VH2 Build/RTM1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 Safari/537.36";
const LG = "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0 Safari/537.36 WebAppManager";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

const TV: RegisteredTv = { tvId: "00000000-0000-4000-8000-0000000c0001", deviceToken: "tvd_one" };

describe("registering this TV", () => {
  beforeEach(() => setDevice({ tvId: null, deviceToken: null }));

  it("names its platform from what kind of TV this is", () => {
    expect([FIRE, GOOGLE, ANDROID, LG, MAC].map(platformFor)).toEqual(["fire_tv", "google_tv", "android_tv", "tv_browser", "web"]);
  });

  it("registers once, however many ask at the same time, and keeps the token", async () => {
    const register = vi.fn(async () => TV);
    const [a, b] = await Promise.all([ensureRegistered(register, FIRE), ensureRegistered(register, FIRE)]);
    expect(a && b).toBe(true);
    expect(register).toHaveBeenCalledOnce();
    expect(register).toHaveBeenCalledWith("fire_tv");
    expect(getDevice()).toMatchObject({ tvId: TV.tvId, deviceToken: "tvd_one" });
    // Next launch: it already has its token.
    expect(await ensureRegistered(register, FIRE)).toBe(true);
    expect(register).toHaveBeenCalledOnce();
    expect(JSON.parse(localStorage.getItem("oc-tv-device")!)).toMatchObject({ tvId: TV.tvId, deviceToken: "tvd_one" });
  });

  it("tries again next time when the API can't be reached", async () => {
    const register = vi.fn<(p: string) => Promise<RegisteredTv>>().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(TV);
    await expect(ensureRegistered(register, MAC)).rejects.toThrow("offline");
    expect(await ensureRegistered(register, MAC)).toBe(true);
    expect(register).toHaveBeenCalledTimes(2);
  });

  it("registers again when the API has forgotten this TV", async () => {
    setDevice({ tvId: "old", deviceToken: "tvd_old" });
    const register = vi.fn(async () => ({ tvId: TV.tvId, deviceToken: "tvd_new" }));
    expect(await registerAgain(register)).toBe(true);
    expect(getDevice().deviceToken).toBe("tvd_new");
  });
});
