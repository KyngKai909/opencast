// The Monitor while the opener or closer airs (A242, 2026-10-02): "Signing off" and "Signing on"
// beside Program and in the line under the title (PlayoutStatus.signing), on the mocks.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { playoutApi } from "@opencast/contracts";
import { handlers } from "../../mocks/handlers";
import { playoutStatus } from "../../mocks/handlers/log";
import { dbStation, resetDb } from "../../mocks/db";
import { path } from "../../mocks/respond";
import { BEAT } from "../../mocks/fixtures/stations";
import { renderWithApi, signInAs, stubMatchMedia } from "../../components/onair/testing";
import { ShellOptionsProvider } from "../../layout/shell";
import { StationProvider } from "../../station/StationContext";
import Monitor from "./Monitor";

const server = setupServer(...handlers);
beforeAll(() => {
  stubMatchMedia();
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  HTMLMediaElement.prototype.load = () => undefined;
  server.listen({ onUnhandledRequest: "bypass" });
});
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
  signInAs("kai@example.com");
});
afterEach(() => server.resetHandlers());

const beat = { station: BEAT, id: BEAT.id, role: "owner" as const, studio: false, base: "/control/beat", label: "BEAT 12.1", can: () => true };
const renderMonitor = (signing: "on" | "off" | null) => {
  server.use(http.get(path(playoutApi.getStatus), () => HttpResponse.json({ ...playoutStatus(dbStation(BEAT.id)!), signing })));
  return renderWithApi(
    <ShellOptionsProvider>
      <StationProvider value={beat}>
        <Monitor />
      </StationProvider>
    </ShellOptionsProvider>
  );
};

describe("the Monitor at sign-off and sign-on", () => {
  it("says Signing off while the closer airs", async () => {
    renderMonitor("off");
    expect(await screen.findByText("Signing off", { selector: ".cc-mon__signing" })).toBeTruthy();
    expect(screen.getByText(/^Signing off\. On air since/)).toBeTruthy();
  });

  it("says Signing on while the opener airs", async () => {
    renderMonitor("on");
    expect(await screen.findByText("Signing on", { selector: ".cc-mon__signing" })).toBeTruthy();
  });

  it("says neither the rest of the time", async () => {
    renderMonitor(null);
    expect(await screen.findByText(/^On air since/)).toBeTruthy();
    expect(screen.queryByText(/Signing (on|off)/)).toBeNull();
  });
});
