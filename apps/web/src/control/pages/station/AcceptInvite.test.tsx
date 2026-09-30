// A station invite's page (/control/invites/:inviteId) on the mocks: signed out it says what the
// invite is and signs in, then joins and opens the station; signed in as someone else it says whose
// invite it is and offers the other address; expired and used invites say so. The fixture's invite
// is Dee's (dee@example.com), to BEAT as an operator.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { ToastProvider } from "@opencast/ui";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { handlers } from "../../mocks/handlers";
import { getDb, resetDb } from "../../mocks/db";
import { resetStationState, stationState } from "../../mocks/fixtures/station";
import { BEAT } from "../../mocks/fixtures/stations";
import { uid } from "../../../mocks/people";
import { MOCK_SIGNED_IN_KEY } from "../../../auth/mockAuth";
import { AuthProvider } from "../../../auth/AuthProvider";
import { stubMatchMedia } from "../../components/onair/testing";
import AcceptInvite from "./AcceptInvite";

const DEE_INVITE = uid(7_000_201);

const server = setupServer(...handlers);
beforeAll(() => {
  stubMatchMedia();
  server.listen({ onUnhandledRequest: "bypass" });
});
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear();
  resetDb();
  resetStationState();
});
afterEach(() => server.resetHandlers());

function Landed() {
  return <p>Landed on {useLocation().pathname}</p>;
}

function renderPage(as: string | null, inviteId = DEE_INVITE) {
  if (as) localStorage.setItem(MOCK_SIGNED_IN_KEY, as);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/control/invites/${inviteId}`]}>
          <AuthProvider>
            <Routes>
              <Route path="/control/invites/:inviteId" element={<AcceptInvite />} />
              <Route path="*" element={<Landed />} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

const dee = () => stationState().invites.find((i) => i.id === DEE_INVITE)!;

describe("a station invite's page", () => {
  it("signed out, says who it's from and for whom, then signs in and joins", async () => {
    renderPage(null);
    expect(await screen.findByRole("heading", { name: "Join Inland Beat" })).toBeTruthy();
    expect(screen.getByText("Kai M. invited you to BEAT, Inland Beat's team, as an operator. Operators run the station day to day, but not money or the team.")).toBeTruthy();
    expect(screen.getByText("Sign in with d…@example.com to join.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in to join" }));
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "dee@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a code" }));
    const code = await screen.findAllByLabelText(/Code/);
    fireEvent.change(code[0]!, { target: { value: "123456" } });
    expect(await screen.findByText("Landed on /control/beat", {}, { timeout: 4000 })).toBeTruthy();
    expect(dee().acceptedAt).not.toBeNull();
    expect(getDb().members.some((m) => m.stationId === BEAT.id && m.role === "operator" && m.personId === dee().acceptedBy)).toBe(true);
  });

  it("signed in with the invited email, joins at once", async () => {
    renderPage("dee@example.com");
    expect(await screen.findByText("Landed on /control/beat")).toBeTruthy();
  });

  it("signed in as someone else, says whose invite it is and offers the other address", async () => {
    renderPage("sam@example.com");
    expect(await screen.findByRole("heading", { name: "This invite is for another email." })).toBeTruthy();
    expect(screen.getByText("This invite is for d…@example.com; you're signed in as sam@example.com.")).toBeTruthy();
    expect(dee().acceptedAt).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with another email" }));
    expect(await screen.findByLabelText("Email")).toBeTruthy();
    expect(localStorage.getItem(MOCK_SIGNED_IN_KEY)).toBeNull();
  });

  it("says when it has expired", async () => {
    dee().expiresAt = "2026-09-20T00:00:00.000Z";
    renderPage(null);
    expect(await screen.findByRole("heading", { name: "This invite has expired." })).toBeTruthy();
    expect(screen.getByText("Invites last a week. Ask Kai M. to send it again from Settings, Team.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign in to join" })).toBeNull();
  });

  it("says when someone else used it", async () => {
    dee().acceptedAt = "2026-09-26T10:00:00.000Z";
    dee().acceptedBy = uid(4);
    renderPage("dee@example.com");
    expect(await screen.findByRole("heading", { name: "This invite was already used." })).toBeTruthy();
  });

  it("says there's nothing there for an unknown invite", async () => {
    renderPage(null, uid(7_999_999));
    expect(await screen.findByRole("heading", { name: "There's nothing here." })).toBeTruthy();
  });
});
