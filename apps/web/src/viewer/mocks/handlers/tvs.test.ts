// The TVs and relay-pairing mocks (B2), in the contract's shapes and the API's words, and how Your
// TVs reads them.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { tvApi, type Tv } from "@opencast/contracts";
import { castingNow, tvLine } from "../../components/you/YouSections";
import { DEN_TV_ID, resetDb } from "../db";
import { MOCK_TOKEN } from "../respond";
import { MOCK_PAIR_CODE, resetTvMockForTests, tvHandlers } from "./tvs";

const server = setupServer(...tvHandlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  localStorage.removeItem("oc-mock-db");
  resetDb();
  resetTvMockForTests();
});
afterEach(() => server.resetHandlers());

const BASE = "http://api.test/v1";
const req = (method: string, path: string, body?: unknown, signedIn = true) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { ...(signedIn ? { authorization: `Bearer ${MOCK_TOKEN}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });

describe("Your TVs in the mock", () => {
  it("lists the frames' TVs, Den TV being the Opencast app on a Fire TV, on now", async () => {
    const res = await req("GET", "/me/tvs");
    const tvs = tvApi.listTvs.response.parse(await res.json());
    expect(tvs.map((t) => t.name)).toEqual(["Living room TV", "Den TV", "Bedroom TV"]);
    expect(tvs.find((t) => t.name === "Den TV")).toMatchObject({ id: DEN_TV_ID, kind: "tv_app", platform: "fire_tv", signedIn: true, online: true });
    expect(tvs.filter((t) => t.kind !== "tv_app").every((t) => !t.online && !t.castingNow)).toBe(true);
  });

  it("wants a sign-in", async () => {
    expect((await req("GET", "/me/tvs", undefined, false)).status).toBe(401);
  });

  it("signs a TV out and answers the list", async () => {
    const res = await req("DELETE", `/me/tvs/${DEN_TV_ID}`);
    expect(tvApi.signOutTv.response.parse(await res.json()).map((t) => t.name)).toEqual(["Living room TV", "Bedroom TV"]);
  });

  it("remembers a cast target once, any case, marking it used", async () => {
    const first = await req("POST", "/me/tvs/cast-targets", { kind: "chromecast", name: "Kitchen TV" });
    expect(first.status).toBe(201);
    const a = tvApi.recordCastTarget.response.parse(await first.json());
    const b = tvApi.recordCastTarget.response.parse(await (await req("POST", "/me/tvs/cast-targets", { kind: "chromecast", name: "kitchen tv" })).json());
    expect(b.id).toBe(a.id);
    const again = tvApi.recordCastTarget.response.parse(await (await req("POST", "/me/tvs/cast-targets", { kind: "chromecast", name: "Living room TV" })).json());
    expect(again.id).toBe("00000000-0000-4000-8000-000000000701");
    const list = tvApi.listTvs.response.parse(await (await req("GET", "/me/tvs")).json());
    expect(list.filter((t) => t.name.toLowerCase() === "kitchen tv")).toHaveLength(1);
  });
});

describe("signing a TV in by its code, in the API's words", () => {
  it("signs in, then says a used code has been used", async () => {
    const ok = await req("POST", "/tv/codes/k7q%204mp/approve");
    expect(ok.status).toBe(200);
    expect(tvApi.approveTvCode.response.parse(await ok.json())).toMatchObject({ kind: "tv_app", platform: "android_tv", signedIn: true });
    const used = await req("POST", "/tv/codes/K7Q4MP/approve");
    expect(used.status).toBe(409);
    expect(await used.json()).toEqual({ error: { code: "code_used", message: "That code has been used. The TV will show a new one." } });
  });

  it("says a wrong code is wrong, and too many wrong codes are too many", async () => {
    const wrong = await req("POST", "/tv/codes/000000/approve");
    expect(wrong.status).toBe(404);
    expect(await wrong.json()).toEqual({ error: { code: "code_not_found", message: "That code isn't right, or it's run out. Check the code on the TV." } });
    for (let i = 0; i < 9; i++) await req("POST", "/tv/codes/000000/approve");
    const many = await req("POST", "/tv/codes/ABCDEF/approve");
    expect(many.status).toBe(429);
    expect((await many.json()).error.code).toBe("too_many_tries");
  });
});

describe("pairing a phone with Den TV", () => {
  it("pairs with 4821, signed in or not", async () => {
    const res = await req("POST", "/tv/remote/pair", { code: MOCK_PAIR_CODE, name: "a phone" }, false);
    expect(res.status).toBe(201);
    const paired = tvApi.pairPhone.response.parse(await res.json());
    expect(paired).toMatchObject({ tvId: DEN_TV_ID, tvName: "Den TV" });
    expect(paired.phoneToken).toMatch(/^tvp_/);
  });

  it("refuses other codes with the API's 404 words", async () => {
    const res = await req("POST", "/tv/remote/pair", { code: "1234", name: "Kai's phone" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "code_not_found", message: "That code isn't right, or it's run out. Check the code on the TV." } });
  });
});

describe("Your TVs' rows", () => {
  const den: Tv = { id: DEN_TV_ID, name: "Den TV", kind: "tv_app", platform: "fire_tv", signedIn: true, lastUsedAt: null, online: true, castingNow: false };
  const living: Tv = { id: "00000000-0000-4000-8000-000000000701", name: "Living room TV", kind: "chromecast", platform: null, signedIn: false, lastUsedAt: null, online: false, castingNow: false };
  const now = new Date("2026-09-27T03:42:00Z");

  it("labels the platform and says whether the TV app is on", () => {
    expect(tvLine(den, now)).toBe("Opencast app on Fire TV, on now");
    expect(tvLine({ ...den, online: false }, now)).toBe("Opencast app on Fire TV, signed in");
    expect(tvLine({ ...den, platform: "tv_browser", online: false }, now)).toBe("Opencast app on TV browser, signed in");
    expect(tvLine(living, now)).toBe("Chromecast");
  });

  it("is casting now when the server says so, or when this phone is casting to it", () => {
    expect(castingNow({ ...den, castingNow: true }, null)).toBe(true);
    expect(castingNow(den, { id: DEN_TV_ID, name: "Den TV", kind: "tv_app" })).toBe(true);
    expect(castingNow(living, { id: "cast-device-9", name: "living room tv", kind: "chromecast" })).toBe(true);
    expect(castingNow(living, { id: "airplay:Living room TV", name: "Living room TV", kind: "airplay" })).toBe(false);
    expect(castingNow(living, null)).toBe(false);
  });
});
