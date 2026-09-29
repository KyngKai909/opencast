// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { MarketLookup, RegisteredTv, TvCode, TvCodeStatus } from "@opencast/contracts";
import { afterPoll } from "../../components/settings/codeFlow";
import { MOCK_TV_ID } from "../db";
import { MOCK_DEVICE_TOKEN } from "../respond";
import { approveAll, makeCode, signInHandlers } from "./signIn";

const server = setupServer(...signInHandlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

async function api(path: string, method = "GET", token?: string, body?: unknown) {
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`http://localhost/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

describe("registering the TV, mocked (B2)", () => {
  it("answers registerTv as the contract says, as this TV (the Den TV)", async () => {
    const r = await api("/tv/devices", "POST", undefined, { platform: "fire_tv" });
    expect(r.status).toBe(201);
    expect(RegisteredTv.parse(r.body)).toEqual({ tvId: MOCK_TV_ID, deviceToken: MOCK_DEVICE_TOKEN });
  });
});

describe("TV sign-in by code, mocked (B2)", () => {
  it("gives the frame's code first, then new ones, never 0/O or 1/I", () => {
    expect(makeCode(() => false)).toBe("K7Q4MP");
    const c = makeCode((x) => x === "K7Q4MP", () => 0.5);
    expect(c).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });

  it("makes codes only for a registered TV", async () => {
    expect((await api("/tv/codes", "POST")).status).toBe(401);
  });

  it("runs the whole flow in the contract's shapes: pending, approved once, then expired", async () => {
    const created = await api("/tv/codes", "POST", MOCK_DEVICE_TOKEN);
    expect(created.status).toBe(201);
    const code = TvCode.parse(created.body);
    expect(code).toMatchObject({ code: "K7Q4MP", enterAt: "localhost:5174/tv", pollSeconds: 3 });
    expect(code.qrUrl).toMatch(/\/tv\?code=K7Q4MP$/);
    const ask = async () => TvCodeStatus.parse((await api(`/tv/codes/${code.pollToken}`)).body);
    const pending = await ask();
    expect(afterPoll(pending, code, Date.parse(code.expiresAt) - 60_000)).toEqual({ next: "poll" });
    expect(approveAll()).toBe(1);
    const approved = await ask();
    expect(approved).toEqual({ status: "approved", token: "mock-access-token", signedInAs: "Kai M." });
    expect(afterPoll(approved, code, 0)).toEqual({ next: "approved", token: "mock-access-token", signedInAs: "Kai M." });
    // Handed over once.
    expect(await ask()).toEqual({ status: "expired" });
  });

  it("doesn't know a made-up poll token", async () => {
    const r = await api("/tv/codes/poll-nope");
    expect(r.status).toBe(404);
  });

  it("signs this TV out with its device token or its session", async () => {
    expect((await api("/tv/session", "DELETE")).status).toBe(401);
    expect((await api("/tv/session", "DELETE", MOCK_DEVICE_TOKEN)).body).toEqual({ ok: true });
    expect((await api("/tv/session", "DELETE", "mock-access-token")).body).toEqual({ ok: true });
  });
});

describe("the market from the connection, mocked (S10)", () => {
  it("is the Inland Empire, with the nearest others and their miles", async () => {
    const r = MarketLookup.parse((await api("/markets/by-connection")).body);
    expect(r.market).toMatchObject({ slug: "inland-empire", name: "Inland Empire" });
    expect(r.nearby.map((n) => n.market.slug)).not.toContain("inland-empire");
    expect(r.nearby.every((n) => typeof n.miles === "number")).toBe(true);
  });
});
