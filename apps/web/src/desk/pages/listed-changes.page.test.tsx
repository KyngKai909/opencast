// A215 on External sources (follow-up Phase 6, mocks), on the reference's Saturday, 8:42 pm:
// Change opens List a source filled in and says plainly, before saving, when saving makes the
// station wait for evidence; recording the new evidence puts it back; the details show the changes
// next to the outages; Take off the dial for good asks first, naming the station and what happens;
// the ones taken off are listed with Put back on the list.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { MemoryRouter, Route, Routes } from "react-router";
import { ToastProvider } from "@opencast/ui";

vi.mock("../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { handlers } from "../../mocks/handlers";
import { resetSettings } from "../mocks/settingsDb";
import { resetDb } from "../mocks/db";
import { setTokenSource } from "../../api/client";
import { MOCK_TOKEN_PREFIX } from "../../auth/mockToken";
import Listed from "./Listed";

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
  setTokenSource(async () => `${MOCK_TOKEN_PREFIX}dee@opencast.example`);
});
afterEach(() => server.resetHandlers());

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/desk/markets/:marketSlug/listed" element={<Listed />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

const PAGE = "/desk/markets/inland-empire/listed";
const NEW = "https://stream.colton.example.gov/council/index.m3u8";

describe("Change", () => {
  it("opens the form filled in, says before saving that COLT waits for evidence, and puts it back once it's recorded", async () => {
    renderAt(PAGE);
    fireEvent.click(await screen.findByText("City of Colton"));
    const d = await screen.findByRole("dialog", { name: "City of Colton" });
    fireEvent.click(within(d).getByRole("button", { name: "Change" }));
    const f = await screen.findByRole("dialog", { name: "Change the listing" });
    expect((within(f).getByLabelText("Whose stream") as HTMLInputElement).value).toBe("City of Colton");
    expect((within(f).getByLabelText("Channel") as HTMLInputElement).value).toBe("9.2");
    expect((within(f).getByLabelText("Call sign") as HTMLInputElement).value).toBe("COLT");
    expect((within(f).getByLabelText("Stream address") as HTMLInputElement).value).toBe("https://colton.example.gov/live/council.m3u8");
    // Nothing changed yet: nothing to warn about, and nothing to save.
    fireEvent.click(within(f).getByRole("button", { name: "Save changes" }));
    expect(await within(f).findByText("Nothing to change yet.")).toBeTruthy();
    fireEvent.change(within(f).getByLabelText("Stream address"), { target: { value: NEW } });
    expect(
      within(f).getByText(
        "Their written permission covers https://colton.example.gov/live/council.m3u8 only. Saving takes COLT off the dial until new evidence is recorded for the new address. The permission is kept as it was."
      )
    ).toBeTruthy();
    fireEvent.click(within(f).getByRole("button", { name: "Save, and wait for evidence" }));
    expect(await screen.findByText("Saved. City of Colton goes on the dial once they say yes in writing, or it's confirmed public.")).toBeTruthy();
    // Straight on to recording the new evidence, for the new address.
    const r = await screen.findByRole("dialog", { name: "Record evidence" });
    expect(within(r).getByText(NEW)).toBeTruthy();
    fireEvent.change(within(r).getByLabelText("Who said yes"), { target: { value: "Maria Lopez, City Clerk, City of Colton" } });
    fireEvent.change(within(r).getByLabelText("Said yes on"), { target: { value: "2026-09-26" } });
    fireEvent.change(within(r).getByLabelText("Where it's kept"), { target: { value: "Email to network@opencast.tv, Sept 26" } });
    fireEvent.click(within(r).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("City of Colton is on the dial at 9.2.")).toBeTruthy();

    // The details: the old permission kept, and the change next to the outages.
    const d2 = await screen.findByRole("dialog", { name: "City of Colton" });
    expect(await within(d2).findByText("Earlier permission")).toBeTruthy();
    const changes = await within(d2).findByRole("list", { name: "Changes" });
    await waitFor(() =>
      expect(within(changes).getByText(`Dee A. changed Address from https://colton.example.gov/live/council.m3u8 to ${NEW}, 8:42 pm. It waits for new evidence. Checked afresh`)).toBeTruthy()
    );
    expect(within(d2).getByRole("list", { name: "Outages" })).toBeTruthy();
  });

  it("says a public basis stays when NASA's address changes", async () => {
    renderAt(PAGE);
    fireEvent.click(await screen.findByText("NASA"));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "NASA" })).getByRole("button", { name: "Change" }));
    const f = await screen.findByRole("dialog", { name: "Change the listing" });
    fireEvent.change(within(f).getByLabelText("Stream address"), { target: { value: "https://nasa.example.gov/live/v2.m3u8" } });
    expect(within(f).getByText("The public basis stays: it's about the source. The new address is checked from the next minute.")).toBeTruthy();
    fireEvent.click(within(f).getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("NASA is saved. It's on the dial at 61.1.")).toBeTruthy();
  });
});

describe("Take off the dial for good", () => {
  it("asks first, naming the station and what happens, then lists it under Taken off the dial to put back", async () => {
    renderAt(PAGE);
    fireEvent.click(await screen.findByText("City of Redlands"));
    const d = await screen.findByRole("dialog", { name: "City of Redlands" });
    fireEvent.click(within(d).getByRole("button", { name: "Take off the dial for good" }));
    const c = await screen.findByRole("dialog", { name: "Take 9.1 RDLS off the dial for good?" });
    expect(within(c).getByText("City of Redlands leaves the dial, the guide, search and the swipe order now.")).toBeTruthy();
    expect(within(c).getByText("Anyone watching sees Stand by, then that it's no longer on the dial. Its station page goes.")).toBeTruthy();
    // 90 days on, in the market's time.
    expect(within(c).getByText("9.1 stays held for it until December 25, then it's freed. RDLS stays its own.")).toBeTruthy();
    expect(within(c).getByText("Its permission records, outages and history are kept.")).toBeTruthy();
    fireEvent.click(within(c).getByRole("button", { name: "Take it off the dial" }));
    expect(await screen.findByText("City of Redlands is off the dial for good. It's under Taken off the dial.")).toBeTruthy();
    await waitFor(() => expect(within(screen.getByRole("grid", { name: "External sources" })).queryByText("City of Redlands")).toBeNull());

    fireEvent.click(await screen.findByRole("radio", { name: "Taken off the dial (1)" }));
    const gone = await screen.findByRole("grid", { name: "Taken off the dial" });
    const row = within(gone).getByRole("row", { name: /^City of Redlands/ });
    expect(within(row).getByText("9.1 RDLS")).toBeTruthy();
    expect(within(row).getByText("Taken off the dial Sept 26 by Dee A.")).toBeTruthy();
    expect(within(row).getByText("9.1 held for it until December 25")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Put back on the list" }));
    const back = await screen.findByRole("dialog", { name: "Put City of Redlands back on the list?" });
    expect((within(back).getByLabelText("Channel") as HTMLInputElement).value).toBe("9.1");
    fireEvent.click(within(back).getByRole("button", { name: "Put it back" }));
    expect(await screen.findByText("City of Redlands is back on the list at 9.1. It's checked from the next minute.")).toBeTruthy();
    await waitFor(() => expect(within(screen.getByRole("grid", { name: "External sources" })).getByText("City of Redlands")).toBeTruthy());
  });
});
