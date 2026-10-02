// The Translators page's words (step A4, follow-up Phase 3): every way back from signing in, each
// platform's line, the modes with their price, relayed this month, restarts and the relay's state.

import { describe, expect, it } from "vitest";
import type { PlatformConnection, RelayRestart, RelayView } from "@opencast/contracts";
import { modeChoices, modeToast, offerLine, platformHeading, platformLine, relayedThisMonth, relayStateNotice, restartDetail, signInReturn } from "./relayWords";

const back = (q: string) => signInReturn(new URLSearchParams(q));

describe("back from signing in", () => {
  it("connected", () => {
    expect(back("platform=youtube&connected=1")).toEqual({ ok: true, text: "YouTube is connected." });
    expect(back("platform=twitch&connected=1")).toEqual({ ok: true, text: "Twitch is connected." });
  });

  it("each error the callback sends", () => {
    const said = (e: string) => back(`platform=youtube&error=${e}`);
    expect(said("denied")).toEqual({ ok: false, text: "YouTube wasn't connected: the sign-in was cancelled." });
    expect(said("expired")).toEqual({ ok: false, text: "That sign-in took too long. Try again." });
    expect(said("scopes")).toEqual({ ok: false, text: "YouTube needs every permission Opencast asked for. Try again and leave them all on." });
    expect(said("not_set_up")).toEqual({ ok: false, text: "Signing in to YouTube isn't set up here yet. Add it with its address and stream key instead." });
    expect(said("secrets_key_missing")).toEqual({ ok: false, text: "YouTube wasn't connected: stream keys can't be stored on this server yet. Nothing was saved." });
    expect(said("failed")).toEqual({ ok: false, text: "YouTube didn't connect. Try again in a moment." });
    expect(said("something_new")).toEqual({ ok: false, text: "YouTube didn't connect. Try again in a moment." });
    expect(back("platform=nowhere&error=expired")?.text).toBe("That sign-in took too long. Try again.");
  });

  it("anything else isn't a return", () => {
    expect(back("")).toBeNull();
    expect(back("platform=youtube")).toBeNull();
    expect(back("connected=1")).toBeNull();
  });
});

const conn = (over: Partial<PlatformConnection>): PlatformConnection => ({
  id: "00000000-0000-4000-b770-000000000001",
  kind: "youtube",
  method: "signed_in",
  name: "Inland Beat channel",
  account: "Inland Beat channel",
  rtmpUrl: "rtmps://a.rtmps.youtube.com/live2",
  hasStreamKey: true,
  status: "connected",
  countsViewers: true,
  reportsLocation: true,
  paidPromotion: "automatic",
  paidPromotionOn: false,
  broadcast: null,
  lastViewers: null,
  connectedAt: "2026-09-14T17:02:00.000Z",
  ...over
});

describe("a platform's line", () => {
  it("signed in, by key, and needing a new sign-in", () => {
    expect(platformLine(conn({}))).toBe("Inland Beat channel, signed in. Opencast starts each broadcast for you");
    expect(platformLine(conn({ kind: "twitch", name: "inlandbeat on Twitch", account: "inlandbeat" }))).toBe("inlandbeat, signed in");
    expect(platformLine(conn({ kind: "facebook", method: "manual", name: "Facebook", account: null }))).toBe("Added with its address and key. Viewers there can't be counted");
    expect(platformLine(conn({ kind: "facebook", method: "manual", name: "Inland Beat Page", account: null }))).toBe("Inland Beat Page. Added with its address and key. Viewers there can't be counted");
    const again = conn({ status: "needs_sign_in" });
    expect(platformHeading(again)).toBe("YouTube needs you to sign in again");
    expect(platformLine(again)).toBe("It stopped accepting Opencast's sign-in, so viewers there aren't counted and paid promotion isn't marked. Relays keep going with its key.");
    expect(platformHeading(conn({ kind: "custom", method: "manual", name: "My server" }))).toBe("My server");
  });

  it("YouTube and Twitch before they're connected", () => {
    expect(offerLine("youtube", true)).toBe("Not connected. Sign in, and Opencast starts each broadcast and counts viewers");
    expect(offerLine("twitch", false)).toBe("Signing in to Twitch isn't set up here yet. Add it with its address and stream key instead.");
  });
});

describe("what gets relayed", () => {
  it("the modes, priced per hour from the Station account", () => {
    expect(modeChoices("BEAT", 200_000).map((m) => [m.title, m.end])).toEqual([
      ["Live shows only", "Free"],
      ["Everything BEAT airs", "$0.20 an hour"]
    ]);
    expect(modeChoices("BEAT", null)[1]!.end).toBe("Price not set yet");
    expect(modeToast("everything", "BEAT", 200_000)).toBe("BEAT relays everything it airs, at $0.20 an hour.");
    expect(modeToast("everything", "BEAT", null)).toBe("BEAT relays everything it airs. The price isn't set yet, so nothing is charged.");
    expect(modeToast("live_only", "BEAT", 200_000)).toBe("BEAT relays its live shows only, free.");
  });

  it("relayed this month", () => {
    const m = (over: Partial<RelayView["month"]>): RelayView["month"] => ({ month: "2026-09", hours: 0, soFarMicros: 0, estimateMicros: 0, priceMicros: 200_000, capMicros: null, liveOnlyHours: 0, ...over });
    expect(relayedThisMonth(m({}))).toEqual({ value: "Nothing yet", note: null });
    expect(relayedThisMonth(m({ liveOnlyHours: 3.5 }))).toEqual({ value: "3.5 hours of live shows, free", note: null });
    expect(relayedThisMonth(m({ hours: 156.9, soFarMicros: 31_390_000, estimateMicros: 36_000_000, capMicros: 60_000_000, liveOnlyHours: 4 }))).toEqual({
      value: "156.9 hours, $31.39 so far",
      note: "About $36.00 by the month's end, at $0.20 an hour. Capped at $60.00 a month. Live shows relayed free: 4 hours."
    });
    expect(relayedThisMonth(m({ hours: 2, priceMicros: null })).note).toBe("The price isn't set yet, so nothing is charged.");
  });
});

describe("restarts and the relay's state", () => {
  const r = (over: Partial<RelayRestart>): RelayRestart => ({
    id: "00000000-0000-4000-8000-000007100001",
    platformId: "p",
    kind: "twitch",
    reason: "limit",
    status: "scheduled",
    at: "2026-09-27T06:59:00.000Z",
    deadline: "2026-09-27T07:59:00.000Z",
    duringBreak: true,
    automatic: true,
    label: "Twitch restarts Saturday at 11:59 pm, during a break",
    doneAt: null,
    ...over
  });

  it("why each restart", () => {
    expect(restartDetail(r({}))).toBe("Twitch caps how long one broadcast can run. Only Twitch restarts; the other platforms keep streaming.");
    expect(restartDetail(r({ kind: "youtube", reason: "save_video" }))).toBe("So YouTube saves each broadcast as a video. Only YouTube restarts; the other platforms keep streaming.");
    expect(restartDetail(r({ kind: "facebook", automatic: false, status: "due" }))).toBe("Opencast can't restart a stream added with a key. The other platforms keep streaming.");
  });

  it("stopped and paused; nothing while relaying", () => {
    expect(relayStateNotice({ status: "relaying", pausedBecause: null })).toBeNull();
    expect(relayStateNotice({ status: "stopped", pausedBecause: null })).toMatchObject({ title: "Relays stopped", detail: "Your channel is still on air on Opencast. The relay keeps trying and starts again on its own." });
    expect(relayStateNotice({ status: "paused", pausedBecause: "cap" })).toMatchObject({ title: "Relays of everything you air are paused", detail: "The cap for relays is reached for this month. Live shows still go out, and your channel stays on air." });
  });
});
