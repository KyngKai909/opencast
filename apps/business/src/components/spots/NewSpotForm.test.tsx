// A new spot's file goes straight to storage in parts (follow-up Phase 4), on the mocks: "Upload and
// check" starts the draft, the file shows its progress (Uploading, then Checking) and, once the mock
// has checked it, the spot comes back with its checks.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";

vi.mock("../../config", () => ({ config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" } }));

import { handlers } from "../../mocks/handlers";
import { getDb, resetDb } from "../../mocks/db";
import { OSC_ID } from "../../mocks/fixtures/businesses";
import { AuthProvider } from "../../auth/AuthProvider";
import type { SpotX } from "../../api/ext/spots";
import { NewSpotForm } from "./NewSpotForm";

const server = setupServer(...handlers);
const parts: string[] = [];
beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
  server.listen({ onUnhandledRequest: "bypass" });
  server.events.on("request:start", ({ request }) => {
    if (request.method === "PUT" && request.url.includes("/data?")) parts.push(request.url);
  });
});
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear();
  resetDb();
  parts.length = 0;
  localStorage.setItem("oc-mock-spots-signed-in", "jess@orangestreet.example");
});
afterEach(() => server.resetHandlers());

describe("a new spot's file", () => {
  it("goes to storage in parts, is checked, and comes back with its checks", async () => {
    const done = vi.fn<(spot: SpotX) => void>();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <NewSpotForm business={{ id: OSC_ID, category: "Coffee and food" }} onDone={done} />
        </AuthProvider>
      </QueryClientProvider>
    );
    fireEvent.change(screen.getByLabelText("Call it"), { target: { value: "Fall menu" } });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(18 * 1024 * 1024)], "fall-menu.mp4", { type: "video/mp4" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload and check" }));
    const list = await screen.findByRole("list", { name: "Uploading the spot" });
    expect(within(list).getByText("fall-menu.mp4")).toBeTruthy();
    await waitFor(() => expect(done).toHaveBeenCalled(), { timeout: 8000 });
    const spot = done.mock.calls[0]![0];
    expect(spot).toMatchObject({ title: "Fall menu", state: "draft", file: { originalFilename: "fall-menu.mp4" } });
    expect(spot.file!.checks.map((c) => c.check)).toContain("length");
    // 18 MiB: two parts.
    expect(parts).toHaveLength(2);
    expect(getDb().spots.find((s) => s.id === spot.id)?.file?.originalFilename).toBe("fall-menu.mp4");
  });
});
