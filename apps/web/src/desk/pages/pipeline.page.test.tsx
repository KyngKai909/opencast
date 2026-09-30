// The creator pipeline's IPTV leads on the mocks (follow-up Phase 6), on the reference's Saturday:
// a pasted M3U read into a checklist (channels already on the desk can't be ticked), the ticked
// ones imported as leads, a lead's row (From an IPTV list, its stream), and List as external
// station opening External sources' form filled in from the lead.
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
import Pipeline from "./Pipeline";

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
            <Route path="/desk/markets/:marketSlug/pipeline" element={<Pipeline />} />
            <Route path="/desk/markets/:marketSlug/listed" element={<Listed />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

const PIPELINE = "/desk/markets/inland-empire/pipeline";
const table = () => screen.getByRole("table", { name: "Creators" });
const rowOf = (name: RegExp) => within(table()).getByRole("row", { name });

const M3U = `#EXTM3U
#EXTINF:-1 tvg-id="FontanaPublicAccess.us" tvg-country="US" group-title="Public",Fontana Public Access
https://fontana-access.example.net/live/playlist.m3u8
#EXTINF:-1 tvg-id="OntarioCityTV.us" tvg-country="US" group-title="Legislative",Ontario City TV
https://ontario-city.example.net/live/index.m3u8
#EXTINF:-1 group-title="General",Inland Community TV
https://ictv.example.net/live/index.m3u8
#EXTINF:-1 group-title="Public",Rialto Community Access
https://rialto-access.example.net/hls/live.m3u8
#EXTINF:-1,No address
`;

describe("Import from an IPTV list", () => {
  it("reads a pasted list, holds back channels already on the desk, and imports the ticked ones as leads", async () => {
    renderAt(PIPELINE);
    fireEvent.click(await screen.findByRole("button", { name: "Import from an IPTV list" }));
    const d = await screen.findByRole("dialog", { name: "Import from an IPTV list" });
    expect(within(d).getByText(/Channels on public IPTV lists are leads, not listings\./)).toBeTruthy();
    fireEvent.change(within(d).getByLabelText("M3U or JSON"), { target: { value: M3U } });
    fireEvent.click(within(d).getByRole("button", { name: "Read the list" }));
    const list = await within(d).findByRole("list", { name: "Channels" });
    expect(within(d).getByText("4 channels. 1 entry skipped: no stream address.")).toBeTruthy();
    const box = (name: string) => within(list).getByRole("checkbox", { name: new RegExp(`^${name}`) }) as HTMLInputElement;
    expect(box("Inland Community TV").disabled).toBe(true);
    expect(within(list).getByText(/Already an external station/)).toBeTruthy();
    expect(box("Rialto Community Access").disabled).toBe(true);
    expect(within(list).getByText(/Already a lead/)).toBeTruthy();
    expect(within(list).getByText("https://fontana-access.example.net/live/playlist.m3u8")).toBeTruthy();
    // The filter, then Select all picks only what's shown and can be ticked.
    fireEvent.change(within(d).getByLabelText("Filter"), { target: { value: "legislative" } });
    expect(within(list).queryByText("Fontana Public Access")).toBeNull();
    fireEvent.click(within(d).getByRole("button", { name: "Select all" }));
    expect(within(d).getByRole("button", { name: "Import 1 as a lead" })).toBeTruthy();
    fireEvent.change(within(d).getByLabelText("Filter"), { target: { value: "" } });
    fireEvent.click(box("Fontana Public Access"));
    fireEvent.click(within(d).getByRole("button", { name: "Import 2 as leads" }));
    expect(await screen.findByText("2 leads added to the pipeline.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Import from an IPTV list" })).toBeNull());
    const row = await waitFor(() => rowOf(/^Ontario City TV/));
    for (const w of ["From an IPTV list, Legislative", "https://ontario-city.example.net/live/index.m3u8", "Ask for permission, or confirm it's public"]) expect(within(row).getByText(w)).toBeTruthy();
  });

  it("says when a list has no channels", async () => {
    renderAt(`${PIPELINE}?import=1`);
    const d = await screen.findByRole("dialog", { name: "Import from an IPTV list" });
    fireEvent.change(within(d).getByLabelText("M3U or JSON"), { target: { value: "#EXTM3U\n" } });
    fireEvent.click(within(d).getByRole("button", { name: "Read the list" }));
    expect(await within(d).findByText("No channels with a stream address were found in that list.")).toBeTruthy();
  });
});

describe("a lead in the pipeline", () => {
  it("shows where it was found and its stream, and says which external station a listed one became", async () => {
    renderAt(PIPELINE);
    await screen.findByText("Rialto Community Access");
    const rialto = rowOf(/^Rialto Community Access/);
    for (const w of ["From an IPTV list, Public", "https://rialto-access.example.net/hls/live.m3u8", "Ask for permission, or confirm it's public"]) expect(within(rialto).getByText(w)).toBeTruthy();
    expect(within(rialto).getByRole("button", { name: "List as external station: Rialto Community Access" })).toBeTruthy();
    const ictv = rowOf(/^Inland Community TV/);
    expect(within(ictv).getByText("External station, not on the dial yet")).toBeTruthy();
    expect(within(ictv).getByRole("button", { name: "Open: Inland Community TV" })).toBeTruthy();
  });

  it("opens List a source filled in from the lead, and lists it", async () => {
    renderAt(PIPELINE);
    fireEvent.click(await screen.findByRole("button", { name: "List as external station: Rialto Community Access" }));
    const d = await screen.findByRole("dialog", { name: "List a source" });
    expect((within(d).getByLabelText("Whose stream") as HTMLInputElement).value).toBe("Rialto Community Access");
    expect((within(d).getByLabelText(/^Stream address/) as HTMLInputElement).value).toBe("https://rialto-access.example.net/hls/live.m3u8");
    expect(within(d).getByRole("radio", { name: "Stream link" }).getAttribute("aria-checked")).toBe("true");
    expect(within(d).getByRole("radio", { name: "Not yet" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.change(within(d).getByLabelText("Channel"), { target: { value: "9.4" } });
    fireEvent.change(within(d).getByLabelText("Call sign"), { target: { value: "RCAX" } });
    fireEvent.click(within(d).getByRole("radio", { name: "None" }));
    fireEvent.click(within(d).getByRole("button", { name: "List it" }));
    expect(await screen.findByText("Rialto Community Access is saved. It goes on the dial once they say yes in writing, or it's confirmed public.")).toBeTruthy();
    const table = await screen.findByRole("grid", { name: "External sources" });
    await waitFor(() => expect(within(table).getByRole("row", { name: /^Rialto Community Access/ })).toBeTruthy());
    expect(within(within(table).getByRole("row", { name: /^Rialto Community Access/ })).getByText("Needs their permission. In the creator pipeline")).toBeTruthy();
  });
});
