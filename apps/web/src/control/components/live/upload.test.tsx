// Direct uploads in master control (follow-up Phase 4), on the mocks: the library's drop zone sends
// each file straight to "storage" in parts (the mock's local protocol), shows it Uploading, then
// Checking, and once the mock has made the items says "2 files are being prepared for air." A part
// that fails is sent again by itself; a big file goes in several parts; Pause and Resume carry on
// from the parts storage already has; a refusal shows its reason;
// and a relay background on a TV station is refused before anything is sent.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { LOCAL_UPLOAD_PART_PATH } from "@opencast/contracts";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { handlers } from "../../mocks/handlers";
import { getDb, resetDb } from "../../mocks/db";
import { BEAT } from "../../mocks/fixtures/stations";
import { renderWithApi, signInAs, stubMatchMedia } from "../onair/testing";
import { UploadDrop } from "./LibraryParts";
import { RelayBackground } from "../station/RelayBackground";

const server = setupServer(...handlers);
const parts: string[] = [];
beforeAll(() => {
  stubMatchMedia();
  server.listen({ onUnhandledRequest: "bypass" });
  server.events.on("request:start", ({ request }) => {
    if (request.method === "PUT" && request.url.includes("/data?")) parts.push(new URL(request.url).pathname);
  });
});
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
  parts.length = 0;
  signInAs("kai@example.com");
});
afterEach(() => server.resetHandlers());

const choose = (input: HTMLElement, files: File[]) => fireEvent.change(input, { target: { files } });
const fileInput = (container: HTMLElement) => container.querySelector('input[type="file"]') as HTMLInputElement;

describe("the library's drop zone", () => {
  it("uploads each file in parts, then checks it, then says it's being prepared for air", async () => {
    const before = getDb().library.items.length;
    const { container } = renderWithApi(<UploadDrop stationId={BEAT.id} />);
    choose(fileInput(container), [new File([new Uint8Array(20 * 1024 * 1024)], "Night shift, ep. 4.mp4", { type: "video/mp4" }), new File([new Uint8Array(2048)], "BEAT station ID.mp4", { type: "video/mp4" })]);
    const list = await screen.findByRole("list", { name: "Uploading to the library" });
    expect(within(list).getByText("Night shift, ep. 4.mp4")).toBeTruthy();
    expect(within(list).getByText("21 MB")).toBeTruthy();
    // Checking, once every part is in.
    await within(list).findAllByText("Checking");
    expect(await screen.findByText("2 files are being prepared for air.", {}, { timeout: 8000 })).toBeTruthy();
    // 20 MiB is two 16 MiB parts; the small one is one.
    expect(parts.filter((p) => p.endsWith("/data"))).toHaveLength(3);
    const made = getDb().library.items.slice(before);
    expect(made.map((i) => i.title).sort()).toEqual(["BEAT station ID", "Night shift, ep. 4"]);
    expect(within(list).getAllByText("Uploaded. It's in the library below")).toHaveLength(2);
  });

  it("sends a part that failed again by itself", async () => {
    let failures = 0;
    server.use(
      http.put(`*/v1${LOCAL_UPLOAD_PART_PATH}`, () => {
        if (failures++ === 0) return new HttpResponse("Slow down", { status: 503 });
        return undefined;
      })
    );
    const { container } = renderWithApi(<UploadDrop stationId={BEAT.id} />);
    choose(fileInput(container), [new File([new Uint8Array(4096)], "Retry me.mp4", { type: "video/mp4" })]);
    expect(await screen.findByText("Retry me.mp4 is being prepared for air.", {}, { timeout: 10000 })).toBeTruthy();
    expect(failures).toBeGreaterThanOrEqual(2);
  });

  it("pauses, and resumes from the parts storage already has", async () => {
    const listed: string[] = [];
    server.events.on("request:start", ({ request }) => {
      if (request.method === "GET" && /\/v1\/uploads\/[^/]+\/parts$/.test(new URL(request.url).pathname)) listed.push(request.url);
    });
    let sent = 0;
    // Parts take a moment each, so there's time to pause; the first one is in before the pause.
    server.use(
      http.put(`*/v1${LOCAL_UPLOAD_PART_PATH}`, async () => {
        if (sent++ > 0) await new Promise((r) => setTimeout(r, 400));
        return undefined;
      })
    );
    const { container } = renderWithApi(<UploadDrop stationId={BEAT.id} />);
    choose(fileInput(container), [new File([new Uint8Array(40 * 1024 * 1024)], "Long night.mp4", { type: "video/mp4" })]);
    const pause = await screen.findByRole("button", { name: "Pause Long night.mp4" });
    fireEvent.click(pause);
    expect(await screen.findByText(/^Paused at \d+%$/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume Long night.mp4" }));
    expect(await screen.findByText("Long night.mp4 is being prepared for air.", {}, { timeout: 10000 })).toBeTruthy();
    // Resuming asked storage which parts it had.
    expect(listed.length).toBeGreaterThanOrEqual(1);
  });

  it("shows why a file was refused, and clears it", async () => {
    const { container } = renderWithApi(<UploadDrop stationId={BEAT.id} />);
    choose(fileInput(container), [new File([new Uint8Array(100)], "notes.txt", { type: "text/plain" })]);
    const list = await screen.findByRole("list", { name: "Uploading to the library" });
    expect(await within(list).findByText("That file isn't video or audio.", {}, { timeout: 8000 })).toBeTruthy();
    // Refused by the API: sending it again wouldn't help.
    expect(within(list).queryByRole("button", { name: "Retry notes.txt" })).toBeNull();
    expect(await screen.findByText("notes.txt: That file isn't video or audio.")).toBeTruthy();
    fireEvent.click(within(list).getByRole("button", { name: "Clear notes.txt" }));
    await waitFor(() => expect(screen.queryByRole("list", { name: "Uploading to the library" })).toBeNull());
  });
});

describe("a relay background", () => {
  it("is refused on a TV station before anything is sent", async () => {
    const { container } = renderWithApi(<RelayBackground stationId={BEAT.id} callSign="BEAT" channel="12.1" colour="#1D4ED8" canEdit />);
    await screen.findByRole("button", { name: "Upload" });
    choose(fileInput(container), [new File([new Uint8Array(100)], "bg.png", { type: "image/png" })]);
    expect((await screen.findAllByRole("alert")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Backgrounds are for radio stations' relays. A TV station relays its own picture.").length).toBeGreaterThan(0);
    expect(parts).toHaveLength(0);
  });
});
