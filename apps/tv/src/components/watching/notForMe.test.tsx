// "Not for me" in TV mode (follow-up Phase 1): the menu offers it only while the switch in
// `/config` is on and a program is airing; OK sends one vote per airing with the heartbeat's
// session and the quiet line says what's kept; "already said" and nothing airing have their words.
// The TV's own mock answers `/config` (off unless `?notForMe=on`) and the vote.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

vi.mock("../../config", () => ({ config: { apiBase: "http://api.test", mock: true, viewerUrl: "http://localhost:5174", castAppId: null, mockClock: "2026-09-27T03:42:00Z" } }));

const { sessionId } = await import("@opencast/player");
const { notForMeAsked, notForMeHandlers, resetNotForMe, setNotForMe } = await import("../../mocks/handlers/notForMe");
const { nowNext } = await import("../../mocks/fixtures/schedule");
const { stationByRef } = await import("../../mocks/fixtures/stations");
const { now } = await import("../../lib/clock");
const { menuItems } = await import("./menu");
const { forgetNotForMe, notForMeLine, offersNotForMe, useNotForMe, useNotForMeFlag } = await import("./notForMe");

const server = setupServer(...notForMeHandlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  sessionStorage.clear();
  resetNotForMe();
  forgetNotForMe();
});
afterEach(() => server.resetHandlers());

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const beat = () => stationByRef("BEAT")!.ident;
const airingNow = () => {
  const on = nowNext(beat().id, now()).now!;
  return { logEntryId: on.id, startsAt: on.start, title: on.title };
};

describe("the menu rail", () => {
  it("has \"Not for me\" after the station line only while it's offered", () => {
    expect(menuItems({ mode: "tv", station: { kind: "station" } })).not.toContain("notForMe");
    expect(menuItems({ mode: "tv", station: { kind: "station" }, notForMe: true })).toEqual(["guide", "presets", "sleep", "band", "market", "captions", "settings", "pledge", "notForMe", "account"]);
    // A Cast receiver counts its own session, so it's there too.
    expect(menuItems({ mode: "cast", station: { kind: "station" }, notForMe: true })).toEqual(["guide", "presets", "sleep", "band", "pledge", "notForMe"]);
  });

  it("offers it with the switch on and a program on a station's log", () => {
    const airing = { kind: "program" };
    expect(offersNotForMe({ flag: false, stationKind: "station", airing })).toBe(false);
    expect(offersNotForMe({ flag: true, stationKind: "station", airing })).toBe(true);
    expect(offersNotForMe({ flag: true, stationKind: "station", airing: null })).toBe(false);
    expect(offersNotForMe({ flag: true, stationKind: "station", airing: { kind: "off_air" } })).toBe(false);
    expect(offersNotForMe({ flag: true, stationKind: "listed", airing })).toBe(false);
  });
});

describe("the switch", () => {
  it("is off by default, and on once /config says so", async () => {
    const off = renderHook(() => useNotForMeFlag(), { wrapper });
    await new Promise((r) => setTimeout(r, 50));
    expect(off.result.current).toBe(false);
    setNotForMe(true);
    const on = renderHook(() => useNotForMeFlag(), { wrapper });
    await waitFor(() => expect(on.result.current).toBe(true));
  });

  it("the mock's address turns it on", () => {
    expect(notForMeAsked("?notForMe=on")).toBe(true);
    expect(notForMeAsked("?offAir=CIVC")).toBe(false);
  });
});

describe("OK on \"Not for me\"", () => {
  it("sends one vote for the airing, with the heartbeat's session, and says what's kept", async () => {
    const bodies: unknown[] = [];
    server.events.on("request:start", async ({ request }) => {
      if (request.method === "POST") bodies.push(await request.clone().json());
    });
    const airing = airingNow();
    const h = renderHook(() => useNotForMe(beat().id, airing), { wrapper });
    expect(h.result.current.said).toBe(false);
    await act(() => h.result.current.say());
    expect(h.result.current.said).toBe(true);
    expect(h.result.current.line).toBe("Noted. Only a count is kept, never who said it.");
    // Again, in the same airing: nothing is sent.
    await act(() => h.result.current.say());
    expect(h.result.current.line).toBe(`You've already said ${airing.title} isn't for you.`);
    expect(bodies).toEqual([{ sessionId: sessionId() }]);
    server.events.removeAllListeners();
  });

  it("the API had it already (the app restarted in the same session)", async () => {
    const airing = airingNow();
    await fetch(`http://api.test/v1/stations/${beat().id}/not-for-me`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: sessionId() }) });
    const h = renderHook(() => useNotForMe(beat().id, airing), { wrapper });
    await act(() => h.result.current.say());
    expect(h.result.current.line).toBe(`You've already said ${airing.title} isn't for you.`);
  });

  it("nothing on: says so, and doesn't count it as said", async () => {
    server.use(http.post("*/v1/stations/:stationId/not-for-me", () => HttpResponse.json({ error: { code: "nothing_on", message: "There's nothing on the log to vote on right now." } }, { status: 409 })));
    const h = renderHook(() => useNotForMe(beat().id, airingNow()), { wrapper });
    await act(() => h.result.current.say());
    expect(h.result.current.line).toBe("Nothing is airing right now.");
    expect(h.result.current.said).toBe(false);
    expect(notForMeLine("nothing_on", "x")).toBe("Nothing is airing right now.");
  });
});
