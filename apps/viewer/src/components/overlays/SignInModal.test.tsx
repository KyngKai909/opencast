// The sign-in hand-off, end to end on the mock API: saving while signed out opens sign-in named for
// it; signing in asks the first sign-in's questions and keeps what's on this device; the button
// that names the action finishes it; a returning sign-in goes straight to the action; closing
// before signing in keeps it on this device.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router";
import { setupServer } from "msw/node";
import { GroundProvider, ToastProvider } from "@opencast/ui";

vi.mock("../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, controlUrl: "http://control.test", mockClock: "2026-09-27T03:42:00Z" }
}));

import { AuthProvider } from "../../auth/AuthProvider";
import { useViewerActions } from "../../data/viewer";
import { getDevice, setDevice } from "../../device/store";
import { getDb, resetDb, saveDb } from "../../mocks/db";
import { handlers } from "../../mocks/handlers";
import { stationByRef } from "../../mocks/fixtures/stations";
import SignInModal from "./SignInModal";

const server = setupServer(...handlers);
const id = (cs: string) => stationByRef(cs)!.ident.id;

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
  server.listen({ onUnhandledRequest: "bypass" });
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear();
  resetDb();
  setDevice({ marketSlug: "inland-empire", presets: [], reminders: [], settings: {}, lastStationId: null });
});

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.search}</output>;
}

function Save({ cs }: { cs: string }) {
  const { savePreset } = useViewerActions();
  const s = stationByRef(cs)!.ident;
  return (
    <button type="button" onClick={() => savePreset(s)}>
      Save {cs}
    </button>
  );
}

function renderApp(cs: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GroundProvider>
        <ToastProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={["/watch/x"]}>
              <Save cs={cs} />
              <SignInModal />
              <Where />
            </MemoryRouter>
          </AuthProvider>
        </ToastProvider>
      </GroundProvider>
    </QueryClientProvider>
  );
}

async function signInWithCode() {
  fireEvent.change(screen.getByRole("textbox", { name: "Email" }), { target: { value: "kai@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Email me a code" }));
  const code = await screen.findByRole("textbox", { name: "Six-digit code" });
  fireEvent.change(code, { target: { value: "481516" } });
}

describe("sign-in hand-off", () => {
  it("names the action, asks the first sign-in's questions, keeps the device's presets, then finishes the save", async () => {
    // Free key 6 on the account; this device has SAZN (already on the account) and PREP.
    const db = getDb();
    db.presets = db.presets.filter((p) => p.stationId !== id("HALL"));
    saveDb();
    setDevice({ presets: [{ stationId: id("PREP"), key: 1 }, { stationId: id("SAZN"), key: 2 }], reminders: [] });

    renderApp("CIVC");
    fireEvent.click(screen.getByRole("button", { name: "Save CIVC" }));
    expect(await screen.findByText("To save CIVC 7.1 as a preset")).toBeTruthy();
    await signInWithCode();

    expect(await screen.findByText("You're signed in.", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText("2 presets you made before signing in")).toBeTruthy();
    expect(screen.getByText("Two things before you go back to CIVC.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save CIVC 7.1 and go back" }));

    await waitFor(() => expect(screen.queryByText("You're signed in.")).toBeNull());
    // PREP from the device took the free key 6; SAZN was already there; CIVC was already key 2.
    await waitFor(() => {
      const keys = Object.fromEntries(getDb().presets.map((p) => [p.stationId, p.key]));
      expect(keys[id("PREP")]).toBe(6);
      expect(keys[id("SAZN")]).toBeNull();
      expect(keys[id("CIVC")]).toBe(2);
    });
    expect(getDevice().presets).toEqual([]);
  });

  it("a returning sign-in goes straight to the action, and all six taken opens the replace dialog", async () => {
    renderApp("PREP");
    fireEvent.click(screen.getByRole("button", { name: "Save PREP" }));
    await signInWithCode();
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(`?modal=replace-key&station=${id("PREP")}`), { timeout: 3000 });
    expect(screen.queryByText("You're signed in.")).toBeNull();
    expect(getDb().presets.some((p) => p.stationId === id("PREP"))).toBe(false);
  });

  it("a returning sign-in with a free key saves at once", async () => {
    const db = getDb();
    db.presets = db.presets.filter((p) => p.stationId !== id("NITE"));
    saveDb();
    renderApp("PREP");
    fireEvent.click(screen.getByRole("button", { name: "Save PREP" }));
    await signInWithCode();
    await waitFor(() => expect(getDb().presets.find((p) => p.stationId === id("PREP"))?.key).toBe(3), { timeout: 3000 });
  });

  it("closing before signing in keeps it on this device, with Undo", async () => {
    renderApp("CIVC");
    fireEvent.click(screen.getByRole("button", { name: "Save CIVC" }));
    await screen.findByText("To save CIVC 7.1 as a preset");
    act(() => void fireEvent.click(screen.getByRole("button", { name: "Close" })));
    expect(getDevice().presets).toEqual([{ stationId: id("CIVC"), key: 1 }]);
    expect(await screen.findByText("CIVC 7.1 saved on this device")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(getDevice().presets).toEqual([]);
  });

  it("a wrong code says so and stays on the code", async () => {
    renderApp("CIVC");
    fireEvent.click(screen.getByRole("button", { name: "Save CIVC" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Email" }), { target: { value: "kai@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Email me a code" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Six-digit code" }), { target: { value: "000000" } });
    expect(await screen.findByText("That code didn't work. Check it, or send a new one.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Check your email" })).toBeTruthy();
  });
});
