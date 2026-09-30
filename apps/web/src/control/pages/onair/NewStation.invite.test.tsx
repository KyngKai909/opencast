// A waitlist invite's link (/control/new?reservation=<id>, added 2026-09-29) on the mocks: signed
// in with the reserved email, setup opens with the call sign filled in and locked and the channel
// held chosen, and the first save starts the station from the reservation; choosing another channel
// lets the held one go. Signed out it says what's held and signs in; signed in as someone else it
// says whose invite it is; an ended hold says so, with the waitlist's link. The fixture: SKAT with
// TV 38.1 for skat@example.com; GOLD, ended.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { ToastProvider } from "@opencast/ui";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z", siteUrl: "https://site.test" }
}));

import { handlers } from "../../mocks/handlers";
import { getDb, resetDb } from "../../mocks/db";
import { GOLD_RESERVATION, SKAT_RESERVATION, mockReservations, resetReservations } from "../../mocks/fixtures/onair";
import { MOCK_SIGNED_IN_KEY } from "../../../auth/mockAuth";
import { personByEmail } from "../../../mocks/people";
import { AuthProvider } from "../../../auth/AuthProvider";
import { stubMatchMedia } from "../../components/onair/testing";
import NewStation from "./NewStation";

const server = setupServer(...handlers);
beforeAll(() => {
  stubMatchMedia();
  server.listen({ onUnhandledRequest: "bypass" });
});
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear();
  resetDb();
  resetReservations();
});
afterEach(() => server.resetHandlers());

function Landed() {
  const loc = useLocation();
  return <p>Landed on {loc.pathname}</p>;
}

function renderPage(as: string | null, reservationId = SKAT_RESERVATION) {
  if (as) localStorage.setItem(MOCK_SIGNED_IN_KEY, as);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/control/new?reservation=${reservationId}`]}>
          <AuthProvider>
            <Routes>
              <Route path="/control/new" element={<NewStation />} />
              <Route path="*" element={<Landed />} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

const skat = () => mockReservations().find((r) => r.id === SKAT_RESERVATION)!;
const callSignField = () => screen.getByLabelText("Call sign") as HTMLInputElement;

describe("setup from a waitlist invite", () => {
  it("fills in the call sign, locked, and chooses the channel held in its market", async () => {
    renderPage("skat@example.com");
    await waitFor(() => expect(callSignField().value).toBe("SKAT"));
    expect(callSignField().disabled).toBe(true);
    expect(screen.getByText("Held for you on the waitlist")).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText("Market") as HTMLInputElement).value).toBe("Inland Empire"));
    const held = await screen.findByRole("radio", { name: "38" });
    expect(held.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("38.1 is held for you. If you choose another, 38.1 is let go.")).toBeTruthy();

    // The first save starts the station from the reservation.
    fireEvent.change(screen.getByLabelText("Station name"), { target: { value: "Skate Crew TV" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue to library" }));
    expect(await screen.findByText(/Landed on \/control\/setup\/.+\/library/)).toBeTruthy();
    const made = getDb().stations.find((s) => s.ident.name === "Skate Crew TV")!;
    expect(made.ident).toMatchObject({ callSign: "SKAT", band: "tv", channel: "38.1" });
    expect(skat()).toMatchObject({ stationId: made.ident.id, channel: "38.1" });
  });

  it("lets the held channel go when another is chosen", async () => {
    renderPage("skat@example.com");
    await waitFor(() => expect(callSignField().value).toBe("SKAT"));
    fireEvent.change(screen.getByLabelText("Station name"), { target: { value: "Skate Crew TV" } });
    fireEvent.click(await screen.findByRole("radio", { name: "36" }));
    expect(await screen.findByText(/Landed on \/control\/setup\/.+\/station/)).toBeTruthy();
    const made = getDb().stations.find((s) => s.ident.name === "Skate Crew TV")!;
    expect(made.ident).toMatchObject({ callSign: "SKAT", channel: "36.1" });
    expect(skat()).toMatchObject({ stationId: made.ident.id, channel: null });
  });

  it("signed out, says what's held and asks for sign-in", async () => {
    renderPage(null);
    expect(await screen.findByRole("heading", { name: "Sign on as SKAT" })).toBeTruthy();
    expect(screen.getByText("SKAT is held for you in the Inland Empire until December 29. So is channel 38.1.")).toBeTruthy();
    expect(screen.getByText("Sign in with s…@example.com to set up your station.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in to set up" }));
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "skat@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a code" }));
    const code = await screen.findAllByLabelText(/Code/);
    fireEvent.change(code[0]!, { target: { value: "123456" } });
    await waitFor(() => expect(callSignField().value).toBe("SKAT"), { timeout: 4000 });
    expect(callSignField().disabled).toBe(true);
  });

  it("signed in as someone else, says whose invite it is", async () => {
    renderPage("sam@example.com");
    expect(await screen.findByRole("heading", { name: "This invite is for another email." })).toBeTruthy();
    expect(screen.getByText("This invite is for s…@example.com; you're signed in as sam@example.com.")).toBeTruthy();
    expect(screen.queryByLabelText("Call sign")).toBeNull();
  });

  it("says when the hold has ended, with the waitlist's link", async () => {
    renderPage(null, GOLD_RESERVATION);
    expect(await screen.findByRole("heading", { name: "This invite has ended." })).toBeTruthy();
    expect(screen.getByText("GOLD was held for you until September 25. If it's still free, you can reserve it again on the waitlist.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Join the waitlist" }).getAttribute("href")).toBe("https://site.test/#join");
    expect(screen.queryByRole("button", { name: "Sign in to set up" })).toBeNull();
  });

  it("carries on at their station once it's started, and says it's used to anyone else", async () => {
    const station = getDb().stations[0]!.ident.id;
    skat().stationId = station;
    getDb().members.push({ stationId: station, personId: personByEmail("skat@example.com").id, role: "owner", hosts: null, hostProgramIds: [], lastInAt: null });
    const theirs = renderPage("skat@example.com");
    expect(await screen.findByText(`Landed on /control/setup/${station}/station`)).toBeTruthy();
    theirs.unmount();
    localStorage.clear();
    renderPage("sam@example.com");
    expect(await screen.findByRole("heading", { name: "This invite has ended." })).toBeTruthy();
    expect(screen.getByText("A station has already been set up as SKAT. You can reserve another call sign on the waitlist.")).toBeTruthy();
  });
});
