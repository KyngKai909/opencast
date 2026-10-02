// "Use a code from the TV": typing the code, the API's words when it's wrong, and the pairing kept.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setupServer } from "msw/node";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, controlUrl: "http://control.test", tvUrl: "http://tv.test", mockClock: "2026-09-27T03:42:00Z" }
}));

const { tvHandlers, resetTvMockForTests } = await import("../../mocks/handlers/tvs");
const { PairTvSheet } = await import("./PairTv");
const { loadPairings } = await import("../../cast/pairings");

const server = setupServer(...tvHandlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  localStorage.removeItem("oc-tv-pairings");
  resetTvMockForTests();
});
afterEach(() => server.resetHandlers());

function setup() {
  const onPaired = vi.fn();
  render(<PairTvSheet phoneName="a phone" onBack={() => {}} onClose={() => {}} onPaired={onPaired} />);
  const input = screen.getByLabelText("Code on the TV") as HTMLInputElement;
  const pair = screen.getByRole("button", { name: "Pair this phone" });
  return { onPaired, input, pair };
}

describe("pairing with a code from the TV", () => {
  it("keeps only digits, four of them", () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: "48a2-19" } });
    expect(input.value).toBe("4821");
    expect(input.inputMode).toBe("numeric");
  });

  it("says a short code is short", async () => {
    const { input, pair } = setup();
    fireEvent.change(input, { target: { value: "48" } });
    fireEvent.click(pair);
    expect(await screen.findByText("The code on the TV has four numbers.")).toBeTruthy();
  });

  it("says the API's words for a wrong code, and keeps nothing", async () => {
    const { input, pair, onPaired } = setup();
    fireEvent.change(input, { target: { value: "1234" } });
    fireEvent.click(pair);
    expect(await screen.findByText("That code isn't right, or it's run out. Check the code on the TV.")).toBeTruthy();
    expect(onPaired).not.toHaveBeenCalled();
    expect(loadPairings()).toEqual([]);
  });

  it("pairs with Den TV's 4821 and keeps the pairing on the device", async () => {
    const { input, pair, onPaired } = setup();
    fireEvent.change(input, { target: { value: "4821" } });
    fireEvent.click(pair);
    await waitFor(() => expect(onPaired).toHaveBeenCalled());
    expect(onPaired.mock.calls[0]![0]).toMatchObject({ tvId: "00000000-0000-4000-8000-0000000c0001", tvName: "Den TV" });
    expect(loadPairings()).toEqual([expect.objectContaining({ tvId: "00000000-0000-4000-8000-0000000c0001", tvName: "Den TV" })]);
  });
});
