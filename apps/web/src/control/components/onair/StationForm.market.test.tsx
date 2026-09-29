// Your station, step 1: changing the market keeps the one picked (it used to snap back to the first
// in the list), clears a channel chosen in the old market, and lists the new market's channels.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http } from "msw";
import { setupServer } from "msw/node";
import { stationsApi } from "@opencast/contracts";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { handlers } from "../../mocks/handlers";
import { resetDb } from "../../mocks/db";
import { MARKET } from "../../mocks/fixtures/stations";
import { path, reply } from "../../mocks/respond";
import { StationForm } from "./StationForm";
import { renderWithApi, signInAs, stubMatchMedia } from "./testing";

const DESERT = { ...MARKET, id: "00000000-0000-4000-a000-00000000de51", slug: "high-desert", name: "High Desert", open: true };
const asked: string[] = [];

const server = setupServer(
  http.get(path(stationsApi.listMarkets), () => reply(stationsApi.listMarkets.response, [DESERT, { ...MARKET, open: true }])),
  http.get(path(stationsApi.availableChannels), ({ params }) => {
    // Noted, then answered by the usual mock.
    asked.push(String(params.marketSlug));
  }),
  ...handlers
);
beforeAll(() => {
  stubMatchMedia();
  server.listen({ onUnhandledRequest: "bypass" });
});
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
  asked.length = 0;
  signInAs("kai@example.com");
});
afterEach(() => server.resetHandlers());

describe("the market on a new station", () => {
  it("keeps the market picked, and asks for that market's channels", async () => {
    renderWithApi(<StationForm setup={null} />);
    await waitFor(() => expect((screen.getByLabelText("Market") as HTMLInputElement).value).toBeTruthy());
    const first = (screen.getByLabelText("Market") as HTMLInputElement).value;
    const other = first === DESERT.name ? MARKET : DESERT;
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.change(screen.getByLabelText("Market"), { target: { value: other.id } });
    await waitFor(() => expect((screen.getByLabelText("Market") as HTMLInputElement).value).toBe(other.name));
    await waitFor(() => expect(asked).toContain(other.slug));
  });
});
