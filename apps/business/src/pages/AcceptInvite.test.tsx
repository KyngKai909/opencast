// An invite's page (/invites/:inviteId) on the mocks: signed out it says what the invite is and
// signs in, then joins; signed in as someone else it says whose invite it is and offers the other
// address; expired and used invites say so. Sam's invite to Orange Street Coffee is the fixture's.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

vi.mock("../config", () => ({ config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" } }));

import { handlers } from "../mocks/handlers";
import { resetDb } from "../mocks/db";
import { resetSettings, settingsState } from "../mocks/fixtures/settings";
import { AuthProvider } from "../auth/AuthProvider";
import AcceptInvite from "./AcceptInvite";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OSC = U(60001);
const SAM_INVITE = U(65001);
const KEY = "oc-mock-spots-signed-in";

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear();
  resetDb();
  resetSettings();
});
afterEach(() => server.resetHandlers());

function Landed() {
  return <p>Landed on {useLocation().pathname}</p>;
}

function renderPage(as: string | null, inviteId = SAM_INVITE) {
  if (as) localStorage.setItem(KEY, as);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={[`/invites/${inviteId}`]}>
          <Routes>
            <Route path="/invites/:inviteId" element={<AcceptInvite />} />
            <Route path="*" element={<Landed />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe("an invite's page", () => {
  it("signed out, says who it's from and for whom, then signs in and joins", async () => {
    renderPage(null);
    expect(await screen.findByRole("heading", { name: "Join Orange Street Coffee" })).toBeTruthy();
    expect(screen.getByText(/invited you to Orange Street Coffee's team on Opencast, as a viewer\. Viewers see results and statements, but can't spend or change anything\./)).toBeTruthy();
    expect(screen.getByText("Sign in with s…@orangestreet.example to join.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in to join" }));
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "sam@orangestreet.example" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a code" }));
    const code = await screen.findAllByLabelText(/Code/);
    fireEvent.change(code[0]!, { target: { value: "123456" } });
    // A viewer lands on the business's results.
    expect(await screen.findByText(`Landed on /${OSC}/results`)).toBeTruthy();
    expect(settingsState().invites.find((i) => i.id === SAM_INVITE)?.acceptedAt).not.toBeNull();
  });

  it("signed in with the invited email, joins at once", async () => {
    renderPage("sam@orangestreet.example");
    expect(await screen.findByText(`Landed on /${OSC}/results`)).toBeTruthy();
  });

  it("signed in as someone else, says whose invite it is and offers the other address", async () => {
    renderPage("devon@inlandcreative.example");
    expect(await screen.findByRole("heading", { name: "This invite is for another email." })).toBeTruthy();
    expect(screen.getByText("This invite is for s…@orangestreet.example; you're signed in as devon@inlandcreative.example.")).toBeTruthy();
    expect(settingsState().invites.find((i) => i.id === SAM_INVITE)?.acceptedAt).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with another email" }));
    expect(await screen.findByLabelText("Email")).toBeTruthy();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("says when it has expired", async () => {
    settingsState().invites.find((i) => i.id === SAM_INVITE)!.expiresAt = "2026-09-20T00:00:00.000Z";
    renderPage(null);
    expect(await screen.findByRole("heading", { name: "This invite has expired." })).toBeTruthy();
    expect(screen.getByText(/Invites last a week\. Ask Jess .* to send it again\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign in to join" })).toBeNull();
  });

  it("says when someone else used it", async () => {
    const invite = settingsState().invites.find((i) => i.id === SAM_INVITE)!;
    invite.acceptedAt = "2026-09-26T10:00:00.000Z";
    invite.acceptedBy = "someone-else";
    renderPage("sam@orangestreet.example");
    expect(await screen.findByRole("heading", { name: "This invite was already used." })).toBeTruthy();
    expect(screen.getByText(/Each invite joins one person\./)).toBeTruthy();
  });

  it("says there's nothing there for an unknown invite", async () => {
    renderPage(null, U(69999));
    expect(await screen.findByRole("heading", { name: "There's nothing here." })).toBeTruthy();
  });
});
