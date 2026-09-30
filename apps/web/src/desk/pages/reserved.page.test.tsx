// Reserved call signs on the mocks (desk-pages 02), on the reference's Saturday: the table as drawn
// (State column, row actions, the footnote), Decide, Suggest, Invite the next 10, Extend and
// Release, the market switcher, a market lead sent to their own market, and stations on the dial
// flagged against today's rules.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { MemoryRouter, Route, Routes } from "react-router";
import { ToastProvider } from "@opencast/ui";

vi.mock("../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { handlers } from "../../mocks/handlers";
import { resetSettings } from "../mocks/settingsDb";
import { getDb, resetDb, saveDb } from "../mocks/db";
import { setTokenSource } from "../../api/client";
import { MOCK_TOKEN_PREFIX } from "../../auth/mockToken";
import Reserved from "./Reserved";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// The page loads in two rounds (markets and me, then the reservations and the overview), and the
// reservation endpoints sit near the end of every area's ~265 mock handlers, which MSW walks one
// by one: about 100 ms here, about a second on a GitHub runner running files in parallel. The
// default 1 s findBy/waitFor timeout then fails a test before the page has loaded.
configure({ asyncUtilTimeout: 5000 });
const server = setupServer(...handlers);
beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
  server.listen({ onUnhandledRequest: "bypass" });
});
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear();
  resetDb();
  resetSettings();
  signInAs("dee@opencast.example");
});
afterEach(() => server.resetHandlers());

function signInAs(email: string) {
  setTokenSource(async () => `${MOCK_TOKEN_PREFIX}${email}`);
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/desk/reserved-call-signs" element={<Reserved />} />
            <Route path="/desk/reserved-call-signs/:marketSlug" element={<Reserved />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

const table = () => screen.getByRole("table", { name: "Reserved call signs" });
const rowOf = (name: RegExp) => within(table()).getByRole("row", { name });

describe("the page as drawn", () => {
  it("shows each reservation's channel, who asked, since when, its state and its action", async () => {
    renderAt("/desk/reserved-call-signs/inland-empire");
    expect(await screen.findByRole("heading", { level: 1, name: "Reserved call signs" })).toBeTruthy();
    expect(await screen.findByText("26 held from the waitlist in the Inland Empire, 4 with a channel held.")).toBeTruthy();
    const halo = rowOf(/^HOOP/);
    for (const words of ["52.1", "Ruth O.", "Community choir, Riverside", "Aug 30", "Invited, signing on"]) expect(within(halo).getByText(words)).toBeTruthy();
    expect(within(halo).getByRole("button", { name: "Open HOOP" })).toBeTruthy();
    const vale = rowOf(/^VALE/);
    for (const words of ["2 people", "A skate crew, Fontana; A church, Fontana", "Sept 8, Sept 11", "Same name twice"]) expect(within(vale).getByText(words)).toBeTruthy();
    expect(within(vale).getByRole("button", { name: "Decide VALE" })).toBeTruthy();
    const kfro = rowOf(/^KFRO/);
    expect(within(kfro).getByText("Not allowed")).toBeTruthy();
    expect(within(kfro).getByText("Wanted a real-looking call sign")).toBeTruthy();
    expect(within(kfro).getByRole("button", { name: "Suggest KFRO" })).toBeTruthy();
    const gold = rowOf(/^TACO/);
    for (const words of ["41.1", "Hank V.", "May 30", "Ends tomorrow"]) expect(within(gold).getByText(words)).toBeTruthy();
    expect(within(gold).getByRole("button", { name: "Extend TACO" })).toBeTruthy();
    expect(within(gold).getByRole("button", { name: "Release TACO" })).toBeTruthy();
    const dusk = rowOf(/^DUSK/);
    expect(within(dusk).getByText("Waiting for an invite")).toBeTruthy();
    expect(within(dusk).getByRole("button", { name: "Invite DUSK" })).toBeTruthy();
    expect(screen.getByText("Reservations last 120 days, unless the person signs on or the desk extends them. 14 days before the end, they get a reminder.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "On the dial, against the rules now" })).toBeNull();
  });

  it("flags stations on the dial whose call signs break today's rules, without changing them", async () => {
    const d = getDb();
    const beat = d.stations.find((s) => s.ident.callSign === "BEAT")!;
    d.stations.push({ ...beat, ident: { ...beat.ident, id: U(4444), callSign: "KILN", handle: "kiln", name: "Kiln", channel: "44.2" } });
    saveDb();
    renderAt("/desk/reserved-call-signs/inland-empire");
    const flagged = await screen.findByRole("region", { name: "On the dial, against the rules now" });
    const kiln = within(flagged).getByRole("row", { name: /KILN/ });
    expect(within(kiln).getByText("Four letters starting with K or W look like a real broadcast call sign.")).toBeTruthy();
    expect(within(kiln).getByText("44.2")).toBeTruthy();
  });
});

describe("the row actions", () => {
  it("Decide keeps the name for one and holds a suggestion for the other", async () => {
    renderAt("/desk/reserved-call-signs/inland-empire");
    fireEvent.click(await screen.findByRole("button", { name: "Decide VALE" }));
    const dialog = await screen.findByRole("dialog", { name: "VALE: 2 people asked" });
    const instead = within(dialog).getByLabelText("Hold instead for Pastor Ellis") as HTMLInputElement;
    await waitFor(() => expect(instead.value).toBe("VALEY"));
    fireEvent.change(instead, { target: { value: "VALES" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep it for Dani R." }));
    expect(await screen.findByText("VALE stays with Dani R. VALES is held instead for the other.")).toBeTruthy();
    await waitFor(() => expect(within(rowOf(/^VALE\b/)).getByText("Waiting for an invite")).toBeTruthy());
    expect(within(rowOf(/^VALES/)).getByText("Pastor Ellis")).toBeTruthy();
    expect(within(rowOf(/^VALES/)).getByText("Sept 11")).toBeTruthy();
  });

  it("Suggest holds an allowed name in place of one that isn't allowed", async () => {
    renderAt("/desk/reserved-call-signs/inland-empire");
    fireEvent.click(await screen.findByRole("button", { name: "Suggest KFRO" }));
    const dialog = await screen.findByRole("dialog", { name: "KFRO isn't allowed" });
    expect(within(dialog).getByText("Four letters starting with K or W look like a real broadcast call sign.")).toBeTruthy();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Hold FRO instead" }));
    expect(await screen.findByText("FRO is held for J. Park instead of KFRO.")).toBeTruthy();
    await waitFor(() => expect(within(table()).queryByRole("row", { name: /^KFRO/ })).toBeNull());
    expect(within(rowOf(/^FRO/)).getByText("Waiting for an invite")).toBeTruthy();
  });

  it("Invite the next 10 invites in reservation order", async () => {
    renderAt("/desk/reserved-call-signs/inland-empire");
    fireEvent.click(await screen.findByRole("button", { name: "Invite the next 10" }));
    const dialog = await screen.findByRole("dialog", { name: "Invite the next 10" });
    expect(within(dialog).getByText("12 more after these.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send 10 invites" }));
    expect(await screen.findByText("Invited 10: TACO, SKAT, GOSP, BRUN, CHLO, EAST, FARM, GRIT, HOME, INKY.")).toBeTruthy();
    await waitFor(() => expect(within(rowOf(/^SKAT/)).getByText("Invited")).toBeTruthy());
    expect(within(rowOf(/^DUSK/)).getByText("Waiting for an invite")).toBeTruthy();
  });

  it("Extend holds it 120 days more; Release frees it after asking", async () => {
    renderAt("/desk/reserved-call-signs/inland-empire");
    fireEvent.click(await screen.findByRole("button", { name: "Extend TACO" }));
    expect(await screen.findByText("TACO is held until January 25.")).toBeTruthy();
    await waitFor(() => expect(within(rowOf(/^TACO/)).getByText("Waiting for an invite")).toBeTruthy());
    fireEvent.click(within(rowOf(/^HOOP/)).getByRole("button", { name: "Open HOOP" }));
    const open = await screen.findByRole("dialog", { name: "HOOP" });
    fireEvent.click(within(open).getByRole("button", { name: "Release" }));
    const confirm = await screen.findByRole("dialog", { name: "Release HOOP?" });
    expect(within(confirm).getByText("Ruth O.'s hold ends now, and channel 52.1 is free again. They get an email saying so.")).toBeTruthy();
    fireEvent.click(within(confirm).getByRole("button", { name: "Release HOOP" }));
    expect(await screen.findByText("HOOP and 52.1 are free.")).toBeTruthy();
    await waitFor(() => expect(within(table()).queryByRole("row", { name: /^HOOP/ })).toBeNull());
  });
});

describe("markets", () => {
  it("switches market from the title", async () => {
    renderAt("/desk/reserved-call-signs/inland-empire");
    fireEvent.click(await screen.findByRole("button", { name: "Market" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "High Desert" }));
    expect(await screen.findByText("3 held from the waitlist in the High Desert, 1 with a channel held.")).toBeTruthy();
    expect(within(rowOf(/^DUST/)).getByText("92.4")).toBeTruthy();
  });

  it("sends a market lead to their own market, with no other to switch to", async () => {
    signInAs("lee@opencast.example");
    renderAt("/desk/reserved-call-signs/inland-empire");
    expect(await screen.findByText("3 held from the waitlist in the High Desert, 1 with a channel held.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Market" })).toBeNull();
  });
});
