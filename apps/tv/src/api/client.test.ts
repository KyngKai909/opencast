import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountsApi, audienceApi, stationsApi, tvApi } from "@opencast/contracts";
import { call, send, setAuthHandlers, setTokenSource, tokenFor } from "./client";

vi.mock("../config", () => ({ config: { apiBase: "http://api.test", mock: false, viewerUrl: "http://localhost:5174", castAppId: null, mockClock: null } }));

const both = { device: "tvd_device", session: "tvs_session" };

describe("which token each endpoint gets", () => {
  it("sends the device token to the TV's own endpoints, or the session when there's no device token", () => {
    expect(tokenFor(tvApi.createTvCode, both)).toBe("tvd_device");
    expect(tokenFor(tvApi.tvRemoteEvents, both)).toBe("tvd_device");
    expect(tokenFor(tvApi.signOutThisTv, both)).toBe("tvd_device");
    expect(tokenFor(tvApi.createPairCode, { device: null, session: "tvs_session" })).toBe("tvs_session");
  });

  it("sends the TV session to the account endpoints a TV may use, signed in only", () => {
    expect(accountsApi.getMe.tvSession).toBe(true);
    expect(tokenFor(accountsApi.getMe, both)).toBe("tvs_session");
    expect(tokenFor(accountsApi.listPresets, both)).toBe("tvs_session");
    expect(tokenFor(accountsApi.getMe, { device: "tvd_device", session: null })).toBeNull();
  });

  it("sends nothing to public endpoints, or to a user endpoint a TV session can't use", () => {
    expect(tokenFor(tvApi.registerTv, both)).toBeNull();
    expect(tokenFor(tvApi.pollTvCode, both)).toBeNull();
    expect(tokenFor(stationsApi.getDial, both)).toBeNull();
    expect(tokenFor(audienceApi.heartbeat, both)).toBeNull();
    expect(tokenFor(tvApi.listTvs, both)).toBeNull();
  });
});

describe("sending", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    setTokenSource(() => ({ ...both }));
    setAuthHandlers({});
  });
  afterEach(() => vi.unstubAllGlobals());

  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const authOf = (i: number) => (fetchMock.mock.calls[i]![1]!.headers as Record<string, string>).authorization;

  it("puts the chosen token in Authorization", async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true }));
    await call(tvApi.postRemoteState, { body: { stationId: null, paused: false, changedBy: null, sleepEndsAt: null } });
    expect(fetchMock.mock.calls[0]![0]).toBe("http://api.test/v1/tv/remote/state");
    expect(authOf(0)).toBe("Bearer tvd_device");
    fetchMock.mockResolvedValue(json(200, { status: "pending" }));
    await call(tvApi.pollTvCode, { params: { pollToken: "p1" } });
    expect(authOf(1)).toBeUndefined();
  });

  it("drops the session when the API says this TV was signed out", async () => {
    const onSessionEnded = vi.fn();
    setAuthHandlers({ onSessionEnded });
    fetchMock.mockResolvedValue(json(401, { error: { code: "tv_signed_out", message: "This TV was signed out. Sign in again on your phone." } }));
    await expect(call(accountsApi.getMe)).rejects.toMatchObject({ status: 401, code: "tv_signed_out" });
    expect(onSessionEnded).toHaveBeenCalledOnce();
  });

  it("registers again when the API doesn't know the device token, then tries once more", async () => {
    let device = "tvd_old";
    setTokenSource(() => ({ device, session: null }));
    const onDeviceUnknown = vi.fn(async () => {
      device = "tvd_new";
      return true;
    });
    setAuthHandlers({ onDeviceUnknown });
    fetchMock.mockResolvedValueOnce(json(401, { error: { code: "unauthorized", message: "This TV isn't registered. Restart the app." } })).mockResolvedValueOnce(json(201, { code: "4821", expiresAt: "2026-09-27T03:47:00.000Z" }));
    await expect(call(tvApi.createPairCode)).resolves.toEqual({ code: "4821", expiresAt: "2026-09-27T03:47:00.000Z" });
    expect(onDeviceUnknown).toHaveBeenCalledOnce();
    expect(authOf(0)).toBe("Bearer tvd_old");
    expect(authOf(1)).toBe("Bearer tvd_new");
  });

  it("asks for an event stream with the device token", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200, headers: { "content-type": "text/event-stream" } }));
    const ctl = new AbortController();
    await send(tvApi.tvRemoteEvents, {}, { signal: ctl.signal, accept: "text/event-stream" });
    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.headers).toMatchObject({ authorization: "Bearer tvd_device", accept: "text/event-stream" });
    expect(init.signal).toBe(ctl.signal);
  });
});
