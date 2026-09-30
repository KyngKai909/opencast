// External sources on the mocks (network-desk 05.1, reworked in follow-up Phase 6), on the
// reference's Saturday, 8:42 pm: the six rows as drawn (how each plays, what's on, right now), a
// row's details and outage history, List a source (a stream link with their written permission
// goes on the dial; an embed without its terms page waits), and Record evidence putting a waiting
// listing on the dial.
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
const table = () => screen.getByRole("grid", { name: "External sources" });
const rowOf = (name: RegExp) => within(table()).getByRole("row", { name });
const has = (row: HTMLElement, words: string[]) => {
  for (const w of words) expect(within(row).getByText(w)).toBeTruthy();
};

describe("the page as drawn", () => {
  it("shows the six rows: how each plays, what's on and right now", async () => {
    renderAt(PAGE);
    expect(await screen.findByRole("heading", { level: 1, name: "External sources" })).toBeTruthy();
    await screen.findByText("City of Redlands");
    for (const h of ["Source", "Channel", "How it plays", "What's on", "Right now"]) expect(within(table()).getByRole("columnheader", { name: h })).toBeTruthy();
    has(rowOf(/^City of Redlands/), ["Council and planning meetings", "9.1 RDLS", "Official embed", "Their own player, embedding allowed (checked Sept 21)", "Their agenda calendar", "Up"]);
    // A215: Colton plays on the City Clerk's written permission here (the reference draws a public basis).
    has(rowOf(/^City of Colton/), ["9.2 COLT", "Stream link", "Their written permission, Sept 24", "Their agenda calendar", "Up"]);
    has(rowOf(/^San Bernardino County/), ["9.3 SBCO", "Official embed", "No schedule found", "Banner shows name and Live", "Down 14 min", "Hidden from the dial"]);
    has(rowOf(/^NASA/), ["61.1 NASA", "Stream link", "US government, public", "Guide data", "Checked, from their published schedule", "Up"]);
    const rusd = rowOf(/^Riverside Unified School District/);
    has(rusd, ["Official embed", "Terms unclear, asked Sept 22", "Waiting"]);
    expect(within(rusd).getAllByText("Not on the dial")).toHaveLength(2);
    const ictv = rowOf(/^Inland Community TV/);
    has(ictv, ["From an IPTV list. A community channel's raw stream", "Stream link", "Needs their permission. In the creator pipeline", "Waiting"]);
    expect(within(ictv).getAllByText("Not on the dial")).toHaveLength(2);
    // On the dial first, by channel; then the rest by name.
    const names = within(table()).getAllByRole("row").slice(1).map((r) => r.querySelector(".oc-lines__title")?.textContent);
    // A229: Riverside County's streams sit together on 15, the one sharing 15.1's call sign says so.
    expect(names).toEqual(["City of Redlands", "City of Colton", "San Bernardino County", "Loma Linda Community Access", "Riverside County, Board of Supervisors", "Riverside County Library Live", "NASA", "Inland Community TV", "Riverside Unified School District"]);
    has(rowOf(/^Riverside County Library Live/), ["15.3 RIVC", "Same brand as 15.1 RIVC"]);
    has(rowOf(/^Riverside County, Board of Supervisors/), ["15.1 RIVC", "Its call sign is shared by 15.3"]);
    // A201: a DASH stream link, on the dial now that DASH stream links are played.
    has(rowOf(/^Loma Linda Community Access/), ["9.7 LOMA", "Stream link", "Up"]);
    expect(screen.getByRole("heading", { name: "Opencast catalog station" })).toBeTruthy();
  });

  it("opens a row's details: its evidence, what's on, right now, and the outage history", async () => {
    renderAt(PAGE);
    fireEvent.click(await screen.findByText("San Bernardino County"));
    const d = await screen.findByRole("dialog", { name: "San Bernardino County" });
    has(d, ["Allow embedding", "https://sanbernardino.example.gov/website-terms", "Their player's address", "https://sanbernardino.example.gov/live"]);
    expect(within(d).getAllByText(/checked Sept 18/).length).toBeGreaterThan(0);
    expect(within(d).getByText(/Hidden from the dial\. Last checked September 26 at 8:42 pm\. HTTP 503/)).toBeTruthy();
    const history = await within(d).findByRole("list", { name: "Outages" });
    await waitFor(() => expect(within(history).getAllByRole("listitem")).toHaveLength(2));
    expect(within(history).getByText("Down since 8:28 pm, hidden from the dial at 8:33 pm. HTTP 503")).toBeTruthy();
    expect(within(history).getByText("Down 8:43 pm to 9:02 pm, 19 minutes, hidden from the dial at 8:48 pm. HTTP 503")).toBeTruthy();
    expect(within(d).queryByRole("button", { name: "Record evidence" })).toBeNull();
  });

  it("says a blip came back before it left the dial", async () => {
    renderAt(PAGE);
    fireEvent.click(await screen.findByText("City of Colton"));
    const d = await screen.findByRole("dialog", { name: "City of Colton" });
    expect(await within(d).findByText("Down 2 minutes, back before it left the dial. No answer in 5 seconds")).toBeTruthy();
    expect(within(d).getByText("Their written permission")).toBeTruthy();
  });
});

describe("List a source", () => {
  const fill = (d: HTMLElement, label: string, value: string) => fireEvent.change(within(d).getByLabelText(label), { target: { value } });

  it("checks the form, then puts a stream link with their written permission on the dial", async () => {
    renderAt(`${PAGE}?add=1`);
    const d = await screen.findByRole("dialog", { name: "List a source" });
    fireEvent.click(within(d).getByRole("radio", { name: "Stream link" }));
    fireEvent.click(within(d).getByRole("button", { name: "List it" }));
    expect(await within(d).findByText("Say whose stream it is.")).toBeTruthy();
    expect(within(d).getByText("Paste the stream's address.")).toBeTruthy();
    expect(within(d).getByText("Say who said yes, and for whom.")).toBeTruthy();
    fill(d, "Whose stream", "City of Rialto");
    fill(d, "Channel", "9.4");
    // A229: beside an external 9.1, "Same brand" is offered, on; Rialto is its own brand.
    const same = within(d).getByRole("checkbox", { name: /Same brand as 9.1 RDLS \(share its call sign\)/ });
    expect((same as HTMLInputElement).checked).toBe(true);
    fireEvent.click(same);
    fill(d, "Call sign", "RIAL");
    fill(d, "Stream address", "https://rialto.example.gov/live/council.m3u8");
    fill(d, "Who said yes", "Maria Lopez, City Clerk, City of Rialto");
    fill(d, "Said yes on", "2026-09-24");
    fill(d, "Where it's kept", "Email to network@opencast.tv, Sept 24");
    fill(d, "Calendar or feed", "https://rialto.example.gov/agenda.ics");
    expect(within(d).getByText(/Recorded once and never edited/)).toBeTruthy();
    fireEvent.click(within(d).getByRole("button", { name: "List it" }));
    expect(await screen.findByText("City of Rialto is on the dial at 9.4.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "List a source" })).toBeNull());
    const row = await waitFor(() => rowOf(/^City of Rialto/));
    has(row, ["9.4 RIAL", "Stream link", "Their written permission, Sept 24", "Not checked yet"]);
  });

  it("saves an embed without its terms page, and says it waits", async () => {
    renderAt(`${PAGE}?add=1`);
    const d = await screen.findByRole("dialog", { name: "List a source" });
    fill(d, "Whose stream", "City of Fontana");
    fill(d, "Channel", "9.4");
    fireEvent.click(within(d).getByRole("checkbox", { name: /Same brand as 9.1 RDLS/ }));
    fill(d, "Call sign", "FONT");
    fill(d, "Their player's address", "https://fontana.example.gov/live");
    expect(within(d).getByText("Without the terms page and the day it was checked, it's saved but not on the dial.")).toBeTruthy();
    fireEvent.click(within(d).getByRole("radio", { name: "None" }));
    expect(within(d).getByText("The banner shows the station's name, External, Live and the source. Nothing is made up.")).toBeTruthy();
    fireEvent.click(within(d).getByRole("button", { name: "List it" }));
    expect(await screen.findByText("City of Fontana is saved. It goes on the dial once the terms page and the day it was checked are recorded.")).toBeTruthy();
    const row = await waitFor(() => rowOf(/^City of Fontana/));
    has(row, ["Terms page not recorded", "Waiting"]);
  });

  it("says when a channel is taken", async () => {
    renderAt(`${PAGE}?add=1`);
    const d = await screen.findByRole("dialog", { name: "List a source" });
    fill(d, "Whose stream", "City of Upland");
    fill(d, "Channel", "12.1");
    fill(d, "Call sign", "UPLD");
    fill(d, "Their player's address", "https://upland.example.gov/live");
    fireEvent.click(within(d).getByRole("radio", { name: "None" }));
    fireEvent.click(within(d).getByRole("button", { name: "List it" }));
    expect(await within(d).findByText("12.1 is taken. Pick another.")).toBeTruthy();
  });
});

describe("Record evidence", () => {
  it("puts a waiting embed on the dial once its terms are recorded", async () => {
    renderAt(PAGE);
    fireEvent.click(await screen.findByText("Riverside Unified School District"));
    const d = await screen.findByRole("dialog", { name: "Riverside Unified School District" });
    expect(within(d).getByText("Not recorded yet")).toBeTruthy();
    fireEvent.click(within(d).getByRole("button", { name: "Record evidence" }));
    const f = await screen.findByRole("dialog", { name: "Record evidence" });
    fireEvent.click(within(f).getByRole("radio", { name: "Allow embedding" }));
    fireEvent.change(within(f).getByLabelText("Terms page"), { target: { value: "https://rusd.example.org/terms" } });
    fireEvent.change(within(f).getByLabelText("Checked on"), { target: { value: "2026-09-26" } });
    fireEvent.change(within(f).getByLabelText(/^Note/), { target: { value: "" } });
    fireEvent.click(within(f).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Riverside Unified School District is on the dial.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Record evidence" })).toBeNull());
    const d2 = await screen.findByRole("dialog", { name: "Riverside Unified School District" });
    expect(await within(d2).findByText(/Their own player, embedding allowed \(checked Sept 26\)/)).toBeTruthy();
  });

  it("records that a lead's stream is clearly public, and it goes on the dial", async () => {
    renderAt(PAGE);
    fireEvent.click(await screen.findByText("Inland Community TV"));
    const d = await screen.findByRole("dialog", { name: "Inland Community TV" });
    fireEvent.click(within(d).getByRole("button", { name: "Record evidence" }));
    const f = await screen.findByRole("dialog", { name: "Record evidence" });
    fireEvent.click(within(f).getByRole("radio", { name: "Clearly public" }));
    fireEvent.change(within(f).getByLabelText("The basis"), { target: { value: "Public access, stream published for the public" } });
    fireEvent.click(within(f).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Inland Community TV is on the dial.")).toBeTruthy();
  });
});

// A229/A231: one brand's streams sharing a call sign on 15 (15.1 and 15.3 RIVC in the mock).
describe("the same brand on one channel", () => {
  it("lists 15.2 as the same brand as 15.1 RIVC, sharing its call sign", async () => {
    renderAt(`${PAGE}?add=1`);
    const d = await screen.findByRole("dialog", { name: "List a source" });
    fireEvent.click(within(d).getByRole("radio", { name: "Stream link" }));
    fireEvent.change(within(d).getByLabelText("Whose stream"), { target: { value: "Riverside County, Public Works" } });
    fireEvent.change(within(d).getByLabelText("Channel"), { target: { value: "15.2" } });
    const same = within(d).getByRole("checkbox", { name: /Same brand as 15.1 RIVC \(share its call sign\)/ });
    expect((same as HTMLInputElement).checked).toBe(true);
    const cs = within(d).getByLabelText("Call sign") as HTMLInputElement;
    expect([cs.value, cs.disabled]).toEqual(["RIVC", true]);
    expect(within(d).getByText("The channel tells them apart: 15.2 RIVC.")).toBeTruthy();
    fireEvent.change(within(d).getByLabelText("Stream address"), { target: { value: "https://riverside.example.gov/live/works/index.m3u8" } });
    fireEvent.click(within(d).getByRole("radio", { name: /public/i }));
    fireEvent.change(within(d).getByLabelText("The basis"), { target: { value: "County government, stream published for the public" } });
    fireEvent.click(within(d).getByRole("radio", { name: "None" }));
    fireEvent.click(within(d).getByRole("button", { name: "List it" }));
    expect(await screen.findByText("Riverside County, Public Works is on the dial at 15.2.")).toBeTruthy();
    const row = await waitFor(() => rowOf(/^Riverside County, Public Works/));
    has(row, ["15.2 RIVC", "Same brand as 15.1 RIVC"]);
    has(rowOf(/^Riverside County, Board of Supervisors/), ["Its call sign is shared by 15.2 and 15.3"]);
  });

  it("names the family before changing X.1's call sign or taking it off the dial", async () => {
    renderAt(`${PAGE}?source=${"00000000-0000-4000-8000-000000000751"}`);
    const details = await screen.findByRole("dialog", { name: "Riverside County, Board of Supervisors" });
    fireEvent.click(within(details).getByRole("button", { name: "Change" }));
    const f = await screen.findByRole("dialog", { name: "Change the listing" });
    expect((within(f).getByLabelText("Channel") as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(within(f).getByLabelText("Call sign"), { target: { value: "RVCO" } });
    expect(within(f).getByText(/This changes the call sign of both streams: 15.1 RIVC and 15.3 RIVC become RVCO/)).toBeTruthy();
    fireEvent.click(within(f).getByRole("button", { name: "Change both to RVCO" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Change the listing" })).toBeNull());
    await waitFor(() => has(rowOf(/^Riverside County Library Live/), ["15.3 RVCO"]));
  });

  it("takes X.1 off with its family, naming each stream", async () => {
    renderAt(`${PAGE}?source=${"00000000-0000-4000-8000-000000000751"}`);
    const details = await screen.findByRole("dialog", { name: "Riverside County, Board of Supervisors" });
    fireEvent.click(within(details).getByRole("button", { name: "Take off the dial for good" }));
    const d = await screen.findByRole("dialog", { name: "Take 15.1 RIVC and its family off the dial for good?" });
    expect(within(d).getByText("15.3 RIVC, Riverside County Library Live")).toBeTruthy();
    fireEvent.click(within(d).getByRole("button", { name: "Take both off the dial" }));
    await waitFor(() => expect(screen.queryByText("Riverside County Library Live")).toBeNull());
  });
});
