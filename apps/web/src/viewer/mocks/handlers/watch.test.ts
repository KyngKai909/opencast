// The viewer's mock for watch data (follow-up Phase 1): the public config's "Not for me" switch,
// read from the desk's rules, and the vote, in the contract's shapes and the API's words.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { audienceApi, configApi } from "@opencast/contracts";
import { now } from "../../../lib/clock";
import { resetSettings, saveSettings, settingsDb } from "../../../desk/mocks/settingsDb";
import { resetDb } from "../db";
import { AIRINGS } from "../fixtures/schedule";
import { applySignOff } from "../fixtures/signoff";
import { stationByRef } from "../fixtures/stations";
import { MOCK_TOKEN } from "../respond";
import { meHandlers } from "./me";
import { resetWatch, watchHandlers } from "./watch";

const server = setupServer(...meHandlers, ...watchHandlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear();
  resetDb();
  resetSettings();
  resetWatch();
});
afterEach(() => server.resetHandlers());

const BASE = "http://api.test/v1";
const req = (method: string, path: string, body?: unknown, token: string | null = null) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
const beat = () => stationByRef("BEAT")!.ident.id;
const session = "00000000-0000-4000-8000-000000000777";
const tuneIn = (stationId = beat()) => req("POST", "/heartbeat", { stationId, sessionId: session, platform: "web", mediaTimeMs: 30_000, playing: true });

describe("the public config", () => {
  it("has \"Not for me\" off by default, and on once the desk's rule says so", async () => {
    expect(configApi.getConfig.response.parse(await (await req("GET", "/config")).json())).toEqual({ features: { notForMe: false } });
    settingsDb().rules.push({ id: "00000000-0000-4000-8000-000000009999", key: "features.not_for_me", scope: "", value: { enabled: true }, effectiveFrom: new Date(now().getTime() - 60_000).toISOString(), setBy: null, note: null, createdAt: now().toISOString() });
    saveSettings();
    expect((await (await req("GET", "/config")).json()).features.notForMe).toBe(true);
  });
});

describe("\"Not for me\"", () => {
  it("is taken from a session tuned in, once per airing, signed in or not, with the flag off", async () => {
    const before = await req("POST", `/stations/${beat()}/not-for-me`, { sessionId: session });
    expect(before.status).toBe(400);
    expect((await before.json()).error.message).toBe("Tune in to this station first.");
    await tuneIn();
    const first = audienceApi.voteNotForMe.response.parse(await (await req("POST", `/stations/${beat()}/not-for-me`, { sessionId: session })).json());
    expect(first).toEqual({ ok: true, status: "recorded" });
    const again = audienceApi.voteNotForMe.response.parse(await (await req("POST", `/stations/${beat()}/not-for-me`, { sessionId: session }, MOCK_TOKEN)).json());
    expect(again).toEqual({ ok: true, status: "already_recorded" });
  });

  it("needs something on", async () => {
    const prep = stationByRef("PREP")!.ident.id;
    const t = now().getTime();
    applySignOff(AIRINGS, prep, new Date(t - 60_000).toISOString(), new Date(t + 10 * 60_000).toISOString());
    await tuneIn(prep);
    const r = await req("POST", `/stations/${prep}/not-for-me`, { sessionId: session });
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe("nothing_on");
  });
});
