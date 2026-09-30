// What the Translators page says (step A4 of master control, follow-up Phase 3): each platform's
// line, the words for coming back from signing in, the relay modes with their price, "Relayed this
// month", restarts and the relay's state. The frame's words where it draws them; the rest are the
// API's and docs/apps/new-copy.md's. Amounts stay in micros; hours through the Station account's
// words, so both pages say them alike.

import { money } from "@opencast/ui";
import { PLATFORM_NAMES, type OAuthProvider, type PlatformConnection, type PlatformKind, type RelayMode, type RelayRestart, type RelayView } from "@opencast/contracts";
import { hoursText, priceText } from "../account/usage";

/** Each platform's square (the frame's YT, TW and RT): YouTube and Twitch in their own colours, anything else in slate. */
export const PLATFORM_MARKS: Record<PlatformKind, { mark: string; colour: string }> = {
  youtube: { mark: "YT", colour: "#B8261A" },
  twitch: { mark: "TW", colour: "#6441A5" },
  facebook: { mark: "FB", colour: "#525C73" },
  kick: { mark: "KI", colour: "#525C73" },
  custom: { mark: "RT", colour: "#525C73" }
};

/** The sign-in buttons: YouTube signs in with Google. */
export const CONNECT_WITH: Record<OAuthProvider, string> = { youtube: "Connect with Google", twitch: "Connect with Twitch" };

/** What the page calls a platform: "YouTube", "Facebook", or a custom destination's own name. */
export function platformTitle(c: Pick<PlatformConnection, "kind" | "name">): string {
  return c.kind === "custom" ? c.name : PLATFORM_NAMES[c.kind];
}

/** The line under a connected platform's name (A4: "Inland Beat channel, signed in. Opencast starts each broadcast for you"). */
export function platformLine(c: PlatformConnection): string {
  if (c.status === "needs_sign_in") return "It stopped accepting Opencast's sign-in, so viewers there aren't counted and paid promotion isn't marked. Relays keep going with its key.";
  if (c.method === "signed_in") {
    const who = c.account ?? c.name;
    return c.kind === "youtube" ? `${who}, signed in. Opencast starts each broadcast for you` : `${who}, signed in`;
  }
  const named = c.kind !== "custom" && c.name !== PLATFORM_NAMES[c.kind] ? `${c.name}. ` : "";
  return `${named}Added with its address and key. Viewers there can't be counted`;
}

/** The bold line of a platform's row: its name, or "YouTube needs you to sign in again". */
export function platformHeading(c: PlatformConnection): string {
  return c.status === "needs_sign_in" ? `${platformTitle(c)} needs you to sign in again` : platformTitle(c);
}

/** The row offering YouTube or Twitch before it's connected. */
export function offerLine(provider: OAuthProvider, signInSetUp: boolean): string {
  if (!signInSetUp) return `Signing in to ${PLATFORM_NAMES[provider]} isn't set up here yet. Add it with its address and stream key instead.`;
  return provider === "youtube" ? "Not connected. Sign in, and Opencast starts each broadcast and counts viewers" : "Not connected. Sign in, and Opencast gets the stream key and counts viewers";
}

export const ADD_A_PLATFORM_LINE = "Sign in to YouTube or Twitch, or add any other service with its RTMP address and stream key";

export const CANT_STORE_KEYS = "Stream keys can't be stored on this server yet, so nothing can be connected or added. Platforms already connected keep relaying.";

// ---- Coming back from signing in (`?platform=youtube&connected=1` or `&error=…`) ----

export interface SignInReturn {
  ok: boolean;
  text: string;
}

/** What the page says when the platform sends the owner back; null when the address isn't a return. */
export function signInReturn(params: URLSearchParams): SignInReturn | null {
  const platform = params.get("platform");
  if (!platform) return null;
  const connected = params.get("connected");
  const error = params.get("error");
  if (!connected && !error) return null;
  const name = PLATFORM_NAMES[platform as PlatformKind] ?? "The platform";
  if (connected === "1" && !error) return { ok: true, text: `${name} is connected.` };
  switch (error) {
    case "denied":
      return { ok: false, text: `${name} wasn't connected: the sign-in was cancelled.` };
    case "expired":
      return { ok: false, text: "That sign-in took too long. Try again." };
    case "scopes":
      return { ok: false, text: `${name} needs every permission Opencast asked for. Try again and leave them all on.` };
    case "not_set_up":
      return { ok: false, text: `Signing in to ${name} isn't set up here yet. Add it with its address and stream key instead.` };
    case "secrets_key_missing":
      return { ok: false, text: `${name} wasn't connected: stream keys can't be stored on this server yet. Nothing was saved.` };
    default:
      return { ok: false, text: `${name} didn't connect. Try again in a moment.` };
  }
}

// ---- What gets relayed ----

export interface ModeWords {
  value: RelayMode;
  title: string;
  helper: string;
  end: string;
}

/** A4's two choices, with "Everything {BEAT} airs" priced per hour (Phase 2's price; "Price not set yet" before it is). */
export function modeChoices(callSign: string, priceMicros: number | null): ModeWords[] {
  return [
    { value: "live_only", title: "Live shows only", helper: `Your live blocks go to every connected platform. The rest of ${callSign}'s schedule stays on Opencast.`, end: "Free" },
    {
      value: "everything",
      title: `Everything ${callSign} airs`,
      helper: "The whole schedule as one continuous stream, to every connected platform at once. Pay as you go, per hour relayed, not per platform",
      end: priceText("hour", priceMicros)
    }
  ];
}

/** The toast after changing the mode. */
export function modeToast(mode: RelayMode, callSign: string, priceMicros: number | null): string {
  if (mode === "live_only") return `${callSign} relays its live shows only, free.`;
  const price = priceText("hour", priceMicros);
  return price === "Price not set yet" ? `${callSign} relays everything it airs. The price isn't set yet, so nothing is charged.` : `${callSign} relays everything it airs, at ${price}.`;
}

// ---- Relayed this month ----

/** "Relayed this month": A4's "Nothing yet", or the hours and what they cost so far, with a line on where it's heading. */
export function relayedThisMonth(m: RelayView["month"]): { value: string; note: string | null } {
  if (m.hours <= 0 && m.liveOnlyHours <= 0) return { value: "Nothing yet", note: null };
  if (m.hours <= 0) return { value: `${hoursText(m.liveOnlyHours)} of live shows, free`, note: null };
  const value = `${hoursText(m.hours)}, ${money(m.soFarMicros)} so far`;
  const parts: string[] = [];
  if (m.priceMicros !== null) parts.push(`About ${money(m.estimateMicros)} by the month's end, at ${priceText("hour", m.priceMicros)}.`);
  else parts.push("The price isn't set yet, so nothing is charged.");
  if (m.capMicros !== null) parts.push(`Capped at ${money(m.capMicros)} a month.`);
  if (m.liveOnlyHours > 0) parts.push(`Live shows relayed free: ${hoursText(m.liveOnlyHours)}.`);
  return { value, note: parts.join(" ") };
}

// ---- Restarts ----

/** Under a planned restart: why it's needed, and that the others keep streaming. */
export function restartDetail(r: RelayRestart): string {
  const name = PLATFORM_NAMES[r.kind];
  if (!r.automatic) return `Opencast can't restart a stream added with a key. The other platforms keep streaming.`;
  const why = r.reason === "save_video" ? "So YouTube saves each broadcast as a video." : `${name} caps how long one broadcast can run.`;
  return `${why} Only ${name} restarts; the other platforms keep streaming.`;
}

// ---- The relay's state ----

/** A notice when relays stopped or are paused (the channel is never affected); null while all's well. */
export function relayStateNotice(v: Pick<RelayView, "status" | "pausedBecause">): { title: string; detail: string; account: boolean } | null {
  if (v.status === "stopped") return { title: "Relays stopped", detail: "Your channel is still on air on Opencast. The relay keeps trying and starts again on its own.", account: false };
  if (v.status === "paused") {
    const why = v.pausedBecause === "cap" ? "The cap for relays is reached for this month" : "A bill is unpaid";
    return { title: "Relays of everything you air are paused", detail: `${why}. Live shows still go out, and your channel stays on air.`, account: true };
  }
  return null;
}

/** A manual destination spots aired on: the station marks paid promotion there itself. */
export function paidPromotionReminder(name: string): string {
  return `Spots are airing on ${name}. Mark the stream as containing paid promotion there.`;
}

/** The foot's line (A4). */
export function relayStopsNote(callSign: string): string {
  return `If a relay stops, ${callSign} keeps airing on Opencast. Only the copies elsewhere pause, and they restart on their own.`;
}

/** The page's lede (A4). */
export function translatorsLede(callSign: string): string {
  return `Simulcast ${callSign} to the platforms you already use. Opencast stays ${callSign}'s home; everything here is optional and can be added any time.`;
}

/** An address as the Add form checks it (the API's rule): rtmp:// or rtmps:// and a host. */
export function isRtmpAddress(url: string): boolean {
  return /^rtmps?:\/\/[^\s/]+/i.test(url.trim());
}

/** Where each manual platform's ingest usually is, to start the address field with. */
export const MANUAL_ADDRESS: Partial<Record<PlatformKind, string>> = {
  facebook: "rtmps://live-api-s.facebook.com:443/rtmp/"
};
