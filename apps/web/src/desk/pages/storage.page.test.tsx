// Settings, Storage maintenance on the mocks (2026-09-29): admins see each job with its summary,
// check it (progress while it runs), apply it behind a dialog that says what will change, press
// Apply again until nothing is queued, and download a run's report; each apply is in the change
// log. Rights reviewers and market leads don't see the section.
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
import { resetStorage, RUN_MS, storageDb } from "../mocks/storageDb";
import { resetDb } from "../mocks/db";
import { setTokenSource } from "../../api/client";
import { MOCK_TOKEN_PREFIX } from "../../auth/mockToken";
import Settings from "./Settings";

const server = setupServer(...handlers);
beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
  server.listen({ onUnhandledRequest: "bypass" });
  // Only Date is faked, so a run's time can pass at once; polling and waitFor keep real timers.
  vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
});
afterAll(() => {
  server.close();
  vi.useRealTimers();
});
beforeEach(() => {
  localStorage.clear();
  resetDb();
  resetSettings();
  resetStorage();
  signInAs("dee@opencast.example");
});
afterEach(() => server.resetHandlers());

function signInAs(email: string) {
  setTokenSource(async () => `${MOCK_TOKEN_PREFIX}${email}`);
}

const runsOut = () => vi.setSystemTime(new Date(Date.now() + RUN_MS + 1_000));

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/desk/settings/:section" element={<Settings />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

const job = (name: string) => screen.findByRole("region", { name });

describe("Storage maintenance", () => {
  it("shows each job with what it does and its last check", async () => {
    renderAt("/desk/settings/storage");
    expect(await screen.findByRole("heading", { name: "Storage maintenance" })).toBeTruthy();
    expect(screen.getByText("The one-off storage steps, checked and applied on the server. Admins only.")).toBeTruthy();
    const items = await job("Items on their 720p copies");
    expect(within(items).getByText("2 items still airing from 720p copies")).toBeTruthy();
    expect(within(items).getByText("2 to prepare, 1 with no original stays on its copy.")).toBeTruthy();
    expect(within(items).getByText("Last check: Sam K., September 25 at 10:02 am.")).toBeTruthy();
    expect(within(items).getByRole("button", { name: "Download report: Items on their 720p copies, last check" })).toBeTruthy();
    const files = await job("Files stored by location");
    expect(within(files).getByText("Not checked yet")).toBeTruthy();
    expect(within(files).getByText(/Files from before content IDs, found by a disk path or a URL/)).toBeTruthy();
    const pins = await job("Pinata pins");
    expect(within(pins).getByText(/nothing is unpinned here/)).toBeTruthy();
  });

  it("checks a job: progress while it runs, then its summary and report", async () => {
    renderAt("/desk/settings/storage");
    const files = await job("Files stored by location");
    fireEvent.click(within(files).getByRole("button", { name: "Check: Files stored by location" }));
    expect(await within(files).findByText("Checking, 0 of 3 files")).toBeTruthy();
    expect(within(files).getByRole("progressbar", { name: "Files stored by location: checking" })).toBeTruthy();
    expect((within(files).getByRole("button", { name: "Apply: Files stored by location" }) as HTMLButtonElement).disabled).toBe(true);
    runsOut();
    expect(await within(files).findByText("3 files stored by location, 1 can't be read", {}, { timeout: 3_000 })).toBeTruthy();
    expect(within(files).queryByRole("progressbar")).toBeNull();
    expect(within(files).getByText(/^Last check: Dee A\., /)).toBeTruthy();

    const pins = await job("Pinata pins");
    fireEvent.click(within(pins).getByRole("button", { name: "Check: Pinata pins" }));
    expect(await within(pins).findByText("Checking…")).toBeTruthy();
    runsOut();
    expect(await within(pins).findByText("0 Pinata pins to copy, 2 catalog pins stay on IPFS", {}, { timeout: 3_000 })).toBeTruthy();

    const saved: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => (saved.push(b), "blob:report"));
    URL.revokeObjectURL = vi.fn();
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    fireEvent.click(within(files).getByRole("button", { name: "Download report: Files stored by location, last check" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(clicked).toHaveBeenCalledTimes(1);
    clicked.mockRestore();
    expect(saved[0]!.type).toBe("application/json");
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(saved[0]!);
    });
    expect(JSON.parse(text)).toMatchObject({ job: "relinkLocations", mode: "check", rows: 3 });
  });

  it("applies behind a dialog that says what will change, again until nothing is left, and logs it", async () => {
    const view = renderAt("/desk/settings/storage");
    const items = await job("Items on their 720p copies");
    fireEvent.click(within(items).getByRole("button", { name: "Apply: Items on their 720p copies" }));
    let dialog = await screen.findByRole("dialog", { name: "Prepare from the originals?" });
    expect(within(dialog).getByText("2 originals are queued for the worker, soon after what airs within the hour.")).toBeTruthy();
    expect(within(dialog).getByText(/originals are never deleted/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await within(items).findByText("Applying, 0 of 3 items")).toBeTruthy();
    runsOut();
    expect(await within(items).findByText("Queued for the worker: 2. Left to prepare: 2. Apply again once the worker has prepared them.", {}, { timeout: 3_000 })).toBeTruthy();
    expect(within(items).getByText(/^Last apply: Dee A\., .*0 items moved onto their originals, 2 queued for the worker\.$/)).toBeTruthy();

    // Again, once the worker has prepared them: moved, and nothing left.
    fireEvent.click(within(items).getByRole("button", { name: "Apply: Items on their 720p copies" }));
    dialog = await screen.findByRole("dialog", { name: "Prepare from the originals?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await within(items).findByText("Applying, 0 of 3 items")).toBeTruthy();
    runsOut();
    expect(await within(items).findByText("Nothing queued or left to prepare.", {}, { timeout: 3_000 })).toBeTruthy();
    view.unmount();

    renderAt("/desk/settings/log");
    expect(await screen.findByText("Items on their 720p copies: Moved 2 items onto their originals; 0 queued for preparing")).toBeTruthy();
    expect(screen.getByText("Items on their 720p copies: Moved 0 items onto their originals; 2 queued for preparing")).toBeTruthy();
  });

  it("says when Pinata isn't connected, and doesn't let it be applied", async () => {
    storageDb().pinataConnected = false;
    renderAt("/desk/settings/storage");
    const pins = await job("Pinata pins");
    expect(within(pins).getByText("Pinata isn't connected here")).toBeTruthy();
    expect(within(pins).getByText("Set PINATA_JWT on the API to connect it. Until then there's nothing to copy.")).toBeTruthy();
    expect((within(pins).getByRole("button", { name: "Apply: Pinata pins" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("isn't there for a rights reviewer or a market lead", async () => {
    for (const email of ["rae@opencast.example", "lee@opencast.example"]) {
      signInAs(email);
      const view = renderAt("/desk/settings/storage");
      expect(await screen.findByRole("heading", { name: "Rules" })).toBeTruthy();
      expect(screen.queryByRole("link", { name: "Storage maintenance" })).toBeNull();
      view.unmount();
    }
    signInAs("dee@opencast.example");
    renderAt("/desk/settings/rules");
    expect(await screen.findByRole("link", { name: "Storage maintenance" })).toBeTruthy();
  });
});
