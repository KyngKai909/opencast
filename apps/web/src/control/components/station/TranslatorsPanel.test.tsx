// Translators (step A4, follow-up Phase 3) on the mocks at the reference's Saturday, 8:42 pm: BEAT
// relays everything it airs to its YouTube and Twitch, both signed in, and Twitch restarts tonight.
// Each connection state, coming back from signing in, adding by key, removing, the relay mode, what
// breaks show, the station bug, saving YouTube videos, relayed this month, restarts, the
// paid-promotion reminder, a server that can't store keys, and operators read-only. The words
// themselves are checked in relayWords.test.ts.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { handlers } from "../../mocks/handlers";
import { resetDb } from "../../mocks/db";
import { resetEarnings } from "../../mocks/fixtures/earnings";
import { resetAccounts, setAccountState } from "../../mocks/fixtures/account";
import { mockRelay, resetRelays } from "../../mocks/fixtures/relay";
import { mockPlatformsOf, resetPlatforms } from "../../mocks/handlers/platforms";
import { BEAT } from "../../mocks/fixtures/stations";
import { renderWithApi, signInAs, stubMatchMedia } from "../onair/testing";
import { signInNavigation, TranslatorsPanel } from "./TranslatorsPanel";

const server = setupServer(...handlers);
beforeAll(() => {
  stubMatchMedia();
  server.listen({ onUnhandledRequest: "bypass" });
});
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear();
  resetDb();
  resetEarnings();
  resetAccounts();
  resetPlatforms();
  resetRelays();
});
afterEach(() => server.resetHandlers());

const BASE = "/control/beat/translators";

function show({ who = "kai@example.com", owner = true, path = BASE }: { who?: string; owner?: boolean; path?: string } = {}) {
  signInAs(who);
  return renderWithApi(<TranslatorsPanel stationId={BEAT.id} callSign="BEAT" owner={owner} accountHref="/control/beat/settings/account" />, { path });
}

const platformList = () => screen.findByRole("list", { name: "Connected platforms" });
const rowOf = async (title: string) => {
  const list = await platformList();
  return within(list)
    .getAllByRole("listitem")
    .find((li) => li.querySelector(".oc-lines__title")?.textContent === title)!;
};
/** The mock's platforms, as the relay mock takes them. */
const seedRelay = () =>
  mockRelay(
    BEAT.id,
    mockPlatformsOf(BEAT.id).map((c) => ({ platformId: c.id, kind: c.kind, name: c.name, connected: c.method === "signed_in" }))
  );

describe("connected platforms", () => {
  it("YouTube and Twitch signed in, as A4 draws them, then Add a platform", async () => {
    show();
    const list = await platformList();
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByText("YouTube")).toBeTruthy();
    expect(within(items[0]!).getByText("Inland Beat channel, signed in. Opencast starts each broadcast for you")).toBeTruthy();
    expect(within(items[1]!).getByText("Twitch")).toBeTruthy();
    expect(within(items[1]!).getByText("inlandbeat, signed in")).toBeTruthy();
    expect(within(items[2]!).getByText("Add a platform")).toBeTruthy();
    expect(within(items[2]!).getByText("Sign in to YouTube or Twitch, or add any other service with its RTMP address and stream key")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove YouTube" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Twitch" })).toBeTruthy();
  });

  it("not connected: Connect with Google", async () => {
    mockPlatformsOf(BEAT.id).splice(0, 1);
    show();
    const row = await rowOf("YouTube");
    expect(within(row).getByText("Not connected. Sign in, and Opencast starts each broadcast and counts viewers")).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Connect with Google" })).toBeTruthy();
  });

  it("needs signing in again: says why, and offers Sign in again", async () => {
    mockPlatformsOf(BEAT.id)[0]!.status = "needs_sign_in";
    show();
    const row = await rowOf("YouTube needs you to sign in again");
    expect(within(row).getByText("It stopped accepting Opencast's sign-in, so viewers there aren't counted and paid promotion isn't marked. Relays keep going with its key.")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Sign in again" }));
    // The mock reconnects the same account and comes back here.
    expect(await screen.findByText("YouTube is connected.")).toBeTruthy();
    expect(await rowOf("YouTube")).toBeTruthy();
    expect(mockPlatformsOf(BEAT.id)[0]!.status).toBe("connected");
  });

  it("connecting YouTube: signs in, comes back, and says it's connected", async () => {
    mockPlatformsOf(BEAT.id).splice(0, 1);
    show();
    fireEvent.click(within(await rowOf("YouTube")).getByRole("button", { name: "Connect with Google" }));
    const said = (await screen.findByText("YouTube is connected.")).closest<HTMLElement>('[role="status"]')!;
    expect(said).toBeTruthy();
    await waitFor(async () => expect(within(await rowOf("YouTube")).getByText("Inland Beat channel, signed in. Opencast starts each broadcast for you")).toBeTruthy());
    fireEvent.click(within(said).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("YouTube is connected.")).toBeNull();
  });

  it("a platform's own sign-in page is left for (not a move inside the app)", async () => {
    const away = vi.spyOn(signInNavigation, "away").mockImplementation(() => {});
    server.use(http.post("*/v1/stations/:stationId/platforms/oauth/:provider/start", () => HttpResponse.json({ url: "https://accounts.google.com/o/oauth2/v2/auth?state=abc" })));
    mockPlatformsOf(BEAT.id).splice(0, 1);
    show();
    fireEvent.click(within(await rowOf("YouTube")).getByRole("button", { name: "Connect with Google" }));
    await waitFor(() => expect(away).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?state=abc"));
    away.mockRestore();
  });

  it("back from signing in with an error: says what happened", async () => {
    show({ path: `${BASE}?platform=youtube&error=denied` });
    expect(within(await screen.findByRole("alert")).getByText("YouTube wasn't connected: the sign-in was cancelled.")).toBeTruthy();
  });

  it("back from signing in on Twitch, connected", async () => {
    show({ path: `${BASE}?platform=twitch&connected=1` });
    expect(await screen.findByText("Twitch is connected.")).toBeTruthy();
  });

  it("adds Facebook by address and key; the key is never shown back", async () => {
    show();
    fireEvent.click(within(await rowOf("Add a platform")).getByRole("button", { name: "Add" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a platform" });
    // YouTube and Twitch are signed in already, so only the form.
    expect(within(dialog).queryByRole("button", { name: /^Sign in to/ })).toBeNull();
    expect((within(dialog).getByLabelText("Platform") as HTMLSelectElement).value).toBe("facebook");
    expect((within(dialog).getByLabelText("RTMP or RTMPS address") as HTMLInputElement).value).toBe("rtmps://live-api-s.facebook.com:443/rtmp/");
    expect(within(dialog).getByText("Stream keys are encrypted and never shown again.")).toBeTruthy();
    // A key first, and an address that isn't RTMP.
    fireEvent.change(within(dialog).getByLabelText("RTMP or RTMPS address"), { target: { value: "https://facebook.com/live" } });
    fireEvent.change(within(dialog).getByLabelText("Stream key"), { target: { value: "FB-1234-secret" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(await within(dialog).findByText("Use an rtmp:// or rtmps:// address.")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("RTMP or RTMPS address"), { target: { value: "rtmps://live-api-s.facebook.com:443/rtmp/" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Facebook is added.")).toBeTruthy();
    const row = await rowOf("Facebook");
    expect(within(row).getByText("Added with its address and key. Viewers there can't be counted")).toBeTruthy();
    expect(document.body.textContent).not.toContain("FB-1234-secret");
    expect(mockPlatformsOf(BEAT.id).find((c) => c.kind === "facebook")).toMatchObject({ method: "manual", hasStreamKey: true });
  });

  it("Add a platform offers signing in to what isn't connected yet", async () => {
    mockPlatformsOf(BEAT.id).splice(1, 1);
    show();
    fireEvent.click(within(await rowOf("Add a platform")).getByRole("button", { name: "Add" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a platform" });
    expect(within(dialog).getByRole("button", { name: "Sign in to Twitch" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Sign in to YouTube" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Sign in to Twitch" }));
    expect(await screen.findByText("Twitch is connected.")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Add a platform" })).toBeNull();
  });

  it("removes Twitch in one click, confirmed", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Remove Twitch" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove Twitch?" });
    expect(within(dialog).getByText("BEAT stops relaying there at once. Its stream key and sign-in are erased from Opencast. Viewer numbers and bills so far stay.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Twitch removed. BEAT no longer relays there.")).toBeTruthy();
    await waitFor(async () => expect(within(await rowOf("Twitch")).getByRole("button", { name: "Connect with Twitch" })).toBeTruthy());
    expect(mockPlatformsOf(BEAT.id).some((c) => c.kind === "twitch")).toBe(false);
  });

  it("a server that can't store keys: says so, and nothing can be added", async () => {
    server.use(
      http.get("*/v1/stations/:stationId/platforms", () =>
        HttpResponse.json({ platforms: mockPlatformsOf(BEAT.id), signIn: { youtube: true, twitch: true, facebook: false }, canStoreKeys: false })
      )
    );
    show();
    expect(await screen.findByText("Stream keys can't be stored on this server yet, so nothing can be connected or added. Platforms already connected keep relaying.")).toBeTruthy();
    expect((within(await rowOf("Add a platform")).getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("what gets relayed", () => {
  it("Everything BEAT airs, at its hourly price; switching to Live shows only", async () => {
    show();
    const modes = await screen.findByRole("radiogroup", { name: "What gets relayed" });
    const everything = within(modes).getByRole("radio", { name: /Everything BEAT airs/ });
    const live = within(modes).getByRole("radio", { name: /Live shows only/ });
    expect(everything.getAttribute("aria-checked")).toBe("true");
    expect(within(everything).getByText("$0.20 an hour")).toBeTruthy();
    expect(within(live).getByText("Free")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Station account" }).getAttribute("href")).toBe("/control/beat/settings/account");
    fireEvent.click(live);
    expect(await screen.findByText("BEAT relays its live shows only, free.")).toBeTruthy();
    await waitFor(() => expect(within(screen.getByRole("radiogroup", { name: "What gets relayed" })).getByRole("radio", { name: /Live shows only/ }).getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "What gets relayed" })).getByRole("radio", { name: /Everything BEAT airs/ }));
    expect(await screen.findByText("BEAT relays everything it airs, at $0.20 an hour.")).toBeTruthy();
  });

  it("paused by the unpaid bill: live shows still go out, the channel stays on air", async () => {
    setAccountState(BEAT.id, "paused");
    show();
    expect(await screen.findByText("Relays of everything you air are paused")).toBeTruthy();
    expect(screen.getByText("A bill is unpaid. Live shows still go out, and your channel stays on air.")).toBeTruthy();
  });
});

describe("on every relay", () => {
  it("during breaks: your spots, then the station ID slate", async () => {
    show();
    const breaks = await screen.findByRole("radiogroup", { name: "During breaks, relays show" });
    expect(within(breaks).getByRole("radio", { name: "Your spots" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("With spots on, YouTube streams are marked as containing paid promotion for you. Time filled by ads from partners always shows the slate.")).toBeTruthy();
    fireEvent.click(within(breaks).getByRole("radio", { name: "Station ID slate" }));
    await waitFor(() => expect(within(screen.getByRole("radiogroup", { name: "During breaks, relays show" })).getByRole("radio", { name: "Station ID slate" }).getAttribute("aria-checked")).toBe("true"));
    expect(seedRelay().settings.breakHandling).toBe("station_id_slate");
  });

  it("the station bug on relays: on, then off", async () => {
    show();
    const bug = await screen.findByRole("switch", { name: "Station bug on relays" });
    expect(bug.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(bug);
    await waitFor(() => expect(screen.getByRole("switch", { name: "Station bug on relays" }).getAttribute("aria-checked")).toBe("false"));
    expect(seedRelay().settings.bugOnRelays).toBe(false);
  });

  it("saving relays as YouTube videos: explained, off, then on", async () => {
    show();
    const save = await screen.findByRole("switch", { name: "Save relays as YouTube videos" });
    expect(screen.getByText("YouTube saves only broadcasts under 12 hours. With this on, Opencast starts a new broadcast about every 11 hours, during a break.")).toBeTruthy();
    expect(save.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(save);
    await waitFor(() => expect(screen.getByRole("switch", { name: "Save relays as YouTube videos" }).getAttribute("aria-checked")).toBe("true"));
  });

  it("no YouTube signed in: no YouTube videos to save", async () => {
    mockPlatformsOf(BEAT.id).splice(0, 1);
    show();
    await screen.findByRole("switch", { name: "Station bug on relays" });
    expect(screen.queryByRole("switch", { name: "Save relays as YouTube videos" })).toBeNull();
  });

  it("relayed this month: hours and cost so far, where it's heading, the cap", async () => {
    show();
    expect(await screen.findByText("156.9 hours, $31.39 so far")).toBeTruthy();
    expect(screen.getByText("About $36.00 by the month's end, at $0.20 an hour. Capped at $60.00 a month.")).toBeTruthy();
  });
});

describe("restarts", () => {
  it("each platform's next restart, and the log", async () => {
    show();
    const next = await screen.findByRole("list", { name: "Next restarts" });
    expect(within(next).getByText("Twitch restarts Saturday at 11:59 pm, during a break")).toBeTruthy();
    expect(within(next).getByText("Twitch caps how long one broadcast can run. Only Twitch restarts; the other platforms keep streaming.")).toBeTruthy();
    const log = screen.getByRole("list", { name: "Lately" });
    expect(within(log).getByText("Twitch restarted Friday at 12:59 am, during a break")).toBeTruthy();
  });
});

describe("the paid-promotion reminder", () => {
  it("asks the station to mark it there, until it's done", async () => {
    // Facebook, added by key, had spots on it.
    const fb = { ...mockPlatformsOf(BEAT.id)[1]!, id: "00000000-0000-4000-b770-000000000555", kind: "facebook" as const, method: "manual" as const, name: "Facebook", account: null, paidPromotion: "remind" as const };
    mockPlatformsOf(BEAT.id).push(fb);
    seedRelay().paid[fb.id] = "remind";
    show();
    const notice = (await screen.findByText("Spots are airing on Facebook. Mark the stream as containing paid promotion there.")).closest(".oc-notice") as HTMLElement;
    fireEvent.click(within(notice).getByRole("button", { name: "Done, it's marked" }));
    expect(await screen.findByText("No more reminders for Facebook until its next broadcast.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Spots are airing on Facebook. Mark the stream as containing paid promotion there.")).toBeNull());
  });
});

describe("operators", () => {
  it("see everything, change nothing", async () => {
    show({ who: "marcus@example.com", owner: false });
    await platformList();
    expect(screen.getByText("Only owners connect platforms and change what's relayed.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
    for (const r of within(screen.getByRole("radiogroup", { name: "What gets relayed" })).getAllByRole("radio")) expect(r.getAttribute("aria-disabled")).toBe("true");
    for (const r of within(screen.getByRole("radiogroup", { name: "During breaks, relays show" })).getAllByRole("radio")) expect((r as HTMLButtonElement).disabled || r.getAttribute("aria-disabled") === "true").toBe(true);
    expect((screen.getByRole("switch", { name: "Station bug on relays" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("switch", { name: "Save relays as YouTube videos" }) as HTMLButtonElement).disabled).toBe(true);
    // What they can read: the month and the restarts.
    expect(screen.getByText("156.9 hours, $31.39 so far")).toBeTruthy();
    expect(screen.getByText("Twitch restarts Saturday at 11:59 pm, during a break")).toBeTruthy();
  });
});
