// Relay viewers on a business's results (follow-up Phase 3), on the mocks at the reference's
// Saturday, 8:42 pm: BEAT relays to YouTube and Twitch, and Orange Street Coffee is local. The
// month's "Relay viewers" section (YouTube's billed share, Twitch never billed, what's still waiting
// for YouTube's location data), relay spend in the totals, and each airing's proof: waiting,
// settled with its working, and Twitch's reason. The words for each state are checked directly too.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { MemoryRouter, Route, Routes } from "react-router";
import type { RelayViewersLine, RelayViewersPart } from "@opencast/contracts";

vi.mock("../../config", () => ({ config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" } }));

import { handlers } from "../../mocks/handlers";
import { resetDb } from "../../mocks/db";
import { resetResults } from "../../mocks/fixtures/results";
import { OSC_ID } from "../../mocks/fixtures/businesses";
import { buildResults, rangeFor } from "../../mocks/handlers/results";
import { AuthProvider } from "../../auth/AuthProvider";
import { BusinessProvider } from "../../business/BusinessContext";
import { can } from "../../business/abilities";
import { ShellOptionsProvider } from "../../layout/shell";
import { relayLineDetail, relayPartWords } from "../../components/results/format";
import Airings from "./Airings";
import Results from "./Results";

const NOW = new Date("2026-09-27T03:42:12Z");
const server = setupServer(...handlers);
beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
  server.listen({ onUnhandledRequest: "bypass" });
});
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear();
  resetDb();
  resetResults();
});
afterEach(() => server.resetHandlers());

function renderAt(path: string) {
  localStorage.setItem("oc-mock-spots-signed-in", "jess@orangestreet.example");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const value = { business: { id: OSC_ID, name: "Orange Street Coffee" }, id: OSC_ID, role: "owner" as const, base: `/${OSC_ID}`, can: (a: Parameters<typeof can>[1]) => can("owner", a) };
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <ShellOptionsProvider>
            <BusinessProvider value={value}>
              <Routes>
                <Route path="/:businessId/results" element={<Results />} />
                <Route path="/:businessId/results/airings" element={<Airings />} />
                <Route path="/:businessId/results/airings/:asRunId" element={<Airings />} />
              </Routes>
            </BusinessProvider>
          </ShellOptionsProvider>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

const month = () => buildResults(OSC_ID, rangeFor(new URLSearchParams("month=2026-09"), OSC_ID, NOW), NOW);

describe("where it aired: relay viewers", () => {
  it("a line per platform, what's waiting for YouTube's location data, and relay spend inside Spent", async () => {
    renderAt(`/${OSC_ID}/results?period=month&month=2026-09`);
    const section = (await screen.findByRole("heading", { name: "Relay viewers" })).closest("section")!;
    const r = month();
    const youtube = r.relayViewers!.find((l) => l.platform === "youtube")!;
    const twitch = r.relayViewers!.find((l) => l.platform === "twitch")!;
    expect(within(section).getByText("Relay viewers, as reported by YouTube")).toBeTruthy();
    expect(within(section).getByText(relayLineDetail(youtube))).toBeTruthy();
    expect(within(section).getByText("Relay viewers, as reported by Twitch")).toBeTruthy();
    expect(within(section).getByText(`${twitch.airings} airings, ${twitch.viewersAddedUp.toLocaleString("en-US")} viewers added up. Twitch doesn't report where viewers are, so they aren't billed to local businesses`)).toBeTruthy();
    const waiting = within(section).getByText("Relay viewers, waiting for YouTube's location data");
    expect(waiting).toBeTruthy();
    expect(within(section).getByText(`${youtube.waitingAirings} airings. Held until it arrives; returned if it doesn't within 7 days`)).toBeTruthy();
    expect(within(section).getByText("$3.29")).toBeTruthy();
    expect(within(section).getByText("$8.64")).toBeTruthy();
    // Spent is Opencast's viewers and the relay viewers together.
    expect(screen.getByText("Spent, $8.64 of it on relay viewers")).toBeTruthy();
    expect(screen.getAllByText("$248.90").length).toBeGreaterThan(0);
  });
});

describe("an airing's proof: relay viewers", () => {
  it("the newest BEAT airing: waiting for YouTube's location data, Twitch shown and not billed", async () => {
    const newest = month().airings.find((a) => a.relayViewers)!;
    renderAt(`/${OSC_ID}/results/airings/${newest.asRunId}`);
    const yt = newest.relayViewers![0]!;
    expect(await screen.findByText("Relay viewers, waiting for YouTube's location data")).toBeTruthy();
    expect(screen.getByText(`${yt.viewers} tuned in. ${relayPartWords(yt).split(". ")[1]}`)).toBeTruthy();
    expect(screen.getByText(/held until it arrives$/)).toBeTruthy();
    expect(screen.getByText("Relay viewers, as reported by Twitch")).toBeTruthy();
    expect(screen.getByText(/tuned in\. Twitch doesn't report where viewers are, so they aren't billed to local businesses$/)).toBeTruthy();
    expect(screen.getByText("Tuned in on Opencast")).toBeTruthy();
  });

  it("a settled one: YouTube's share in the area, worked out", async () => {
    const settled = month().airings.find((a) => a.relayViewers?.some((p) => p.status === "settled"))!;
    renderAt(`/${OSC_ID}/results/airings/${settled.asRunId}`);
    const part = settled.relayViewers!.find((p) => p.status === "settled")!;
    expect(await screen.findByText("Relay viewers, as reported by YouTube")).toBeTruthy();
    expect(screen.getByText(part.working!)).toBeTruthy();
    expect(part.working).toContain("60% in your area");
  });
});

describe("relay words", () => {
  const part = (over: Partial<RelayViewersPart>): RelayViewersPart => ({
    platform: "youtube",
    label: "Relay viewers, as reported by YouTube",
    status: "settled",
    reason: null,
    viewers: 40,
    shareInArea: 0.62,
    billedViewers: 25,
    costMicros: 200_000,
    heldMicros: 0,
    working: "40 × 62% in your area × $8.00 ÷ 1,000 = $0.20",
    ...over
  });

  it("each state of an airing's relay part", () => {
    expect(relayPartWords(part({}))).toBe("40 × 62% in your area × $8.00 ÷ 1,000 = $0.20");
    expect(relayPartWords(part({ status: "waiting_location", label: "Relay viewers, waiting for YouTube's location data", working: null, costMicros: 0, heldMicros: 1_600_000, viewers: 200 }))).toBe("200 tuned in. $1.60 held until it arrives");
    expect(relayPartWords(part({ status: "counting", viewers: null, working: null }))).toBe("Counting. The platform's numbers come in a few minutes after the spot");
    expect(relayPartWords(part({ status: "not_billed", reason: "YouTube had no location data for these viewers, so they aren't billed", working: null, costMicros: 0 }))).toBe("40 tuned in. YouTube had no location data for these viewers, so they aren't billed");
    expect(relayPartWords(part({ status: "not_billed", viewers: 0, reason: null, working: null }))).toBe("No viewers were reported during the spot");
    expect(relayPartWords(part({ status: "returned", reason: "YouTube's location data didn't arrive in time, so this wasn't charged", returnedMicros: 560_000, working: null, costMicros: 0 }))).toBe(
      "YouTube's location data didn't arrive in time, so this wasn't charged. $0.56 went back to your balance"
    );
  });

  it("a period's line", () => {
    const line: RelayViewersLine = { platform: "youtube", label: "Relay viewers, as reported by YouTube", airings: 12, viewersAddedUp: 1840, billedViewersAddedUp: 610, spentMicros: 8_640_000, waitingMicros: 0, waitingAirings: 0, returnedMicros: 420_000 };
    expect(relayLineDetail(line)).toBe("12 airings, 1,840 viewers added up, 610 billed. $0.42 returned: no location data in time");
  });
});
