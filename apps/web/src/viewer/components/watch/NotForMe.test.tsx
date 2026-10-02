// "Not for me" in the viewer's player (follow-up Phase 1): hidden while the switch in `/config` is
// off (the default), a quiet button while it's on, one vote per airing with the heartbeat's
// session, "Noted" and a toast after, the words for "already said" and for nothing airing.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, controlUrl: "http://control.test", tvUrl: "http://tv.test", mockClock: "2026-09-27T03:42:00Z" }
}));

const { ToastProvider } = await import("@opencast/ui");
const { sessionId } = await import("@opencast/player");
const { meHandlers } = await import("../../mocks/handlers/me");
const { resetWatch, watchHandlers, notForMeAsked } = await import("../../mocks/handlers/watch");
const { resetDb } = await import("../../mocks/db");
const { stationByRef } = await import("../../mocks/fixtures/stations");
const { nowNext } = await import("../../mocks/fixtures/schedule");
const { now } = await import("../../../lib/clock");
const { resetSettings, saveSettings, settingsDb } = await import("../../../desk/mocks/settingsDb");
const { forgetNotForMe, offersNotForMe, notForMeWords, airingKey } = await import("../../data/notForMe");
const { NotForMe } = await import("./NotForMe");
type W = Parameters<typeof NotForMe>[0]["w"];

const server = setupServer(...meHandlers, ...watchHandlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetDb();
  resetSettings();
  resetWatch();
  forgetNotForMe();
});
afterEach(() => server.resetHandlers());

const beat = () => stationByRef("BEAT")!.ident;

function switchOn() {
  settingsDb().rules.push({ id: "00000000-0000-4000-8000-000000009999", key: "features.not_for_me", scope: "", value: { enabled: true }, effectiveFrom: new Date(now().getTime() - 60_000).toISOString(), setBy: null, note: null, createdAt: now().toISOString() });
  saveSettings();
}

/** The heartbeat has carried this tab's session on BEAT (as the player's does once the picture is on). */
async function tunedIn() {
  const r = await fetch("http://api.test/v1/heartbeat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stationId: beat().id, sessionId: sessionId(), platform: "web", mediaTimeMs: 30_000, playing: true }) });
  expect(r.ok).toBe(true);
}

function watch(o: { status?: string } = {}): W {
  const st = beat();
  const on = nowNext(st.id, now()).now!;
  return {
    state: { status: o.status ?? "playing", currentId: st.id, pendingId: null },
    row: { station: st },
    now: { logEntryId: on.id, startsAt: on.start, endsAt: on.end, title: on.title, kind: "program" }
  } as unknown as W;
}

function renderIt(w: W) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <NotForMe w={w} />
      </ToastProvider>
    </QueryClientProvider>
  );
}

const button = () => screen.queryByRole("button", { name: /^Not for me/ });

describe("\"Not for me\" in the player", () => {
  it("isn't there while the switch is off (the default)", async () => {
    let asked = 0;
    server.events.on("request:start", ({ request }) => {
      if (new URL(request.url).pathname === "/v1/config") asked++;
    });
    renderIt(watch());
    await waitFor(() => expect(asked).toBe(1));
    // Give the answer a moment to land: still nothing.
    await new Promise((r) => setTimeout(r, 50));
    expect(button()).toBeNull();
    server.events.removeAllListeners();
  });

  it("shows while it's on, and says it once for the airing: Noted, with a toast", async () => {
    switchOn();
    await tunedIn();
    const w = watch();
    let votes = 0;
    server.events.on("request:start", ({ request }) => {
      if (request.method === "POST" && new URL(request.url).pathname.endsWith("/not-for-me")) votes++;
    });
    const { unmount } = renderIt(w);
    const b = await screen.findByRole("button", { name: `Not for me: ${w.now!.title}` });
    fireEvent.click(b);
    expect(await screen.findByText("Noted. Only a count is kept, never who said it.")).toBeTruthy();
    expect(screen.getByText("Noted")).toBeTruthy();
    expect(button()).toBeNull();
    expect(votes).toBe(1);
    // Back on the page later in the same airing: still said.
    unmount();
    renderIt(w);
    await waitFor(() => expect(screen.getByText("Noted")).toBeTruthy());
    expect(button()).toBeNull();
    expect(votes).toBe(1);
    server.events.removeAllListeners();
  });

  it("already said from this session (another tab of it): says so gently", async () => {
    switchOn();
    await tunedIn();
    await fetch(`http://api.test/v1/stations/${beat().id}/not-for-me`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: sessionId() }) });
    const w = watch();
    renderIt(w);
    fireEvent.click(await screen.findByRole("button", { name: /^Not for me/ }));
    expect(await screen.findByText(`You've already said ${w.now!.title} isn't for you.`)).toBeTruthy();
    expect(screen.getByText("Noted")).toBeTruthy();
  });

  it("nothing on: says so, and the button stays", async () => {
    switchOn();
    server.use(http.post("*/v1/stations/:stationId/not-for-me", () => HttpResponse.json({ error: { code: "nothing_on", message: "There's nothing on the log to vote on right now." } }, { status: 409 })));
    renderIt(watch());
    fireEvent.click(await screen.findByRole("button", { name: /^Not for me/ }));
    expect(await screen.findByText("Nothing is airing right now.")).toBeTruthy();
    expect(button()).toBeTruthy();
  });

  it("only while tuned in to a program on a station's log", () => {
    const airing = { kind: "program", logEntryId: "x" };
    expect(offersNotForMe({ flag: false, stationKind: "station", airing, tuned: true })).toBe(false);
    expect(offersNotForMe({ flag: true, stationKind: "station", airing, tuned: true })).toBe(true);
    expect(offersNotForMe({ flag: true, stationKind: "station", airing, tuned: false })).toBe(false);
    expect(offersNotForMe({ flag: true, stationKind: "station", airing: null, tuned: true })).toBe(false);
    expect(offersNotForMe({ flag: true, stationKind: "listed", airing, tuned: true })).toBe(false);
    expect(offersNotForMe({ flag: true, stationKind: "station", airing: { kind: "off_air" }, tuned: true })).toBe(false);
    expect(airingKey("s", { logEntryId: "e", startsAt: "t" })).toBe("s:e");
    expect(airingKey("s", { logEntryId: null, startsAt: "t" })).toBe("s:t");
    expect(notForMeWords("nothing_on", "x")).toBe("Nothing is airing right now.");
  });

  it("the mock's address switch turns it on or off whatever the desk says", () => {
    expect(notForMeAsked("?notForMe=on")).toBe(true);
    expect(notForMeAsked("?notForMe=off")).toBe(false);
    expect(notForMeAsked("?other=1")).toBeNull();
  });
});
