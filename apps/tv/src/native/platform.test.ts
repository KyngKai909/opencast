import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RegisteredTv } from "@opencast/contracts";
import { deviceLine } from "../components/settings/about";
import { setDevice } from "../tv/device";
import { ensureRegistered } from "../tv/registration";
import { loadNativeInfo } from "./plugin";
import { nativeKind, platformFromNative, type NativeTvInfo } from "./platform";

const info = (o: Partial<NativeTvInfo>): NativeTvInfo => ({ manufacturer: "Google", model: "Chromecast", fireTv: false, googleTv: false, leanback: true, ...o });
const FIRE_STICK = info({ manufacturer: "Amazon", model: "AFTKA", fireTv: true });
const GOOGLE_TV = info({ googleTv: true });
const BRAVIA = info({ manufacturer: "Sony", model: "BRAVIA 4K VH2" });
// A desktop browser's user agent: the app's own answer wins over it.
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

describe("what kind of TV the Android app is on", () => {
  it("Fire TV by Amazon's feature, maker or model; Google TV by its home screen; else Android TV", () => {
    expect(platformFromNative(FIRE_STICK)).toBe("fire_tv");
    expect(platformFromNative(info({ manufacturer: "Amazon" }))).toBe("fire_tv");
    expect(platformFromNative(info({ manufacturer: "Toshiba", model: "AFTDCT31" }))).toBe("fire_tv");
    expect(platformFromNative(GOOGLE_TV)).toBe("google_tv");
    expect(platformFromNative(BRAVIA)).toBe("android_tv");
  });

  it("feeds registerTv, instead of the user agent's guess", async () => {
    setDevice({ tvId: null, deviceToken: null });
    const register = vi.fn(async (): Promise<RegisteredTv> => ({ tvId: "00000000-0000-4000-8000-0000000c0002", deviceToken: "tvd_fire" }));
    expect(await ensureRegistered(register, MAC, FIRE_STICK)).toBe(true);
    expect(register).toHaveBeenCalledWith("fire_tv");
    // In a browser (no answer from the app) the user agent decides, as before.
    setDevice({ tvId: null, deviceToken: null });
    await ensureRegistered(register, MAC, null);
    expect(register).toHaveBeenLastCalledWith("web");
  });

  it("names this TV in About this TV", () => {
    expect(nativeKind(FIRE_STICK)).toBe("Fire TV");
    expect(deviceLine(MAC, true, GOOGLE_TV)).toBe("Opencast app on Google TV");
    expect(deviceLine(MAC, true, BRAVIA)).toBe("Opencast app on Android TV");
    expect(deviceLine(MAC, false)).toBe("Web browser");
  });

  describe("asking the app", () => {
    beforeEach(() => setDevice({ tvId: null, deviceToken: null }));

    it("asks only inside the app, and carries on without an answer", async () => {
      const getInfo = vi.fn(async () => BRAVIA);
      expect(await loadNativeInfo({ getInfo }, false)).toBeNull();
      expect(getInfo).not.toHaveBeenCalled();
      expect(await loadNativeInfo({ getInfo }, true)).toEqual(BRAVIA);
      expect(await loadNativeInfo({ getInfo: async () => Promise.reject(new Error("no plugin")) }, true)).toBeNull();
    });
  });
});
