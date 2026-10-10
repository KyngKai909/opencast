// You's "Watch in other apps" (programming Phase 5): both addresses, a copy button for each, a line
// for each app, and Plex said plainly.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "https://api.opencast.test", privyAppId: null, controlUrl: "http://control.test", tvUrl: "http://tv.test", mockClock: "2026-09-27T03:42:00Z" }
}));

const { ToastProvider } = await import("@opencast/ui");
const { OtherAppsSection, OTHER_APPS, iptvUrls } = await import("./OtherAppsSection");

afterEach(cleanup);

function show(form: "web" | "phone", props: { apiBase?: string; origin?: string } = {}) {
  return render(
    <ToastProvider>
      <OtherAppsSection form={form} {...props} />
    </ToastProvider>
  );
}

describe("Watch in other apps", () => {
  it("shows the channel list and the guide from the API's origin", () => {
    show("web");
    expect(screen.getByRole("heading", { name: "Watch in other apps" })).toBeTruthy();
    expect(screen.getByText("https://api.opencast.test/v1/iptv/channels.m3u")).toBeTruthy();
    expect(screen.getByText("https://api.opencast.test/v1/iptv/xmltv.xml")).toBeTruthy();
  });

  it("uses the page's own origin when the API shares it", () => {
    expect(iptvUrls("", "https://opencast.tv/")).toEqual({ channels: "https://opencast.tv/v1/iptv/channels.m3u", guide: "https://opencast.tv/v1/iptv/xmltv.xml" });
    show("phone", { apiBase: "", origin: "http://localhost:5173" });
    expect(screen.getByText("http://localhost:5173/v1/iptv/channels.m3u")).toBeTruthy();
  });

  it("copies each address", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    show("web");
    fireEvent.click(screen.getByRole("button", { name: "Copy the channel list address" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://api.opencast.test/v1/iptv/channels.m3u"));
    expect(await screen.findByText("Channel list copied.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy the guide address" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://api.opencast.test/v1/iptv/xmltv.xml"));
  });

  it("has a line for each app, and says Plex has no M3U support of its own", () => {
    show("phone");
    expect(OTHER_APPS.map((a) => a.app)).toEqual(["TiviMate", "Jellyfin", "Channels DVR", "Kodi", "VLC"]);
    for (const { app } of OTHER_APPS) expect(screen.getByText(app, { selector: "b" })).toBeTruthy();
    expect(screen.getByText(/PVR IPTV Simple Client/)).toBeTruthy();
    expect(screen.getByText(/Plex has no M3U support of its own/)).toBeTruthy();
  });
});
