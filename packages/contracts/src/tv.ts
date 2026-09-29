// The TV app (added 2026-09-28): a TV registers itself, signs in by a code approved on a phone
// (B2), and is driven by phones through the API's relay, with the same commands and state as the
// Cast receiver (Android TV and Fire TV have no Cast).
//
// Tokens, all opaque and sent as `Authorization: Bearer`:
// - `deviceToken` (`registerTv`): the TV itself. Endpoints marked `device`.
// - the TV session (`pollTvCode`, approved): the TV signed in to a person's account. Accepted by
//   `device` endpoints, and as `user` by endpoints marked `tvSession: true` (getMe, updateMe,
//   mergeDevice, presets, reminders, listMyPledges).
// - `phoneToken` (`pairPhone`): a guest's phone paired with one TV, for that TV's remote only.

import { z } from "zod";
import { endpoint } from "./core.js";
import { Id, Ok, Timestamp } from "./common.js";

// ---------- Devices and sign-in by code (B2) ----------

export const TvPlatform = z.enum(["android_tv", "fire_tv", "google_tv", "tv_browser", "web"]);
export type TvPlatform = z.infer<typeof TvPlatform>;

export const RegisteredTv = z.object({
  tvId: Id,
  /** Keep it on the TV: it's the TV's identity from now on. Shown once. */
  deviceToken: z.string()
});
export type RegisteredTv = z.infer<typeof RegisteredTv>;

/** A code for this TV, shown until a phone approves it or it runs out (10 minutes). */
export const TvCode = z.object({
  /** Six letters and numbers with no 0, O, 1 or I ("K7Q4MP"); the TV shows it as "K7Q 4MP". */
  code: z.string().regex(/^[A-Z0-9]{6}$/),
  /** What the QR opens: the viewer's /tv page with the code filled in. */
  qrUrl: z.string(),
  /** The address to type, as the TV shows it ("app.useopencast.org/tv"), like OAuth's verification_uri. */
  enterAt: z.string(),
  expiresAt: Timestamp,
  /** Only this TV knows it: it asks with it whether the code has been approved. */
  pollToken: z.string(),
  /** How often to ask, in seconds. */
  pollSeconds: z.number().int().positive()
});
export type TvCode = z.infer<typeof TvCode>;

/**
 * Where a code stands. `approved` carries the TV's session token, handed over once: the next ask
 * answers `expired`. `signedInAs` is the person's display name, if they have one.
 */
export const TvCodeStatus = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("approved"), token: z.string().min(1), signedInAs: z.string().nullable() }),
  z.object({ status: z.literal("expired") })
]);
export type TvCodeStatus = z.infer<typeof TvCodeStatus>;

/** A TV that's watched with this account: the Opencast app (signed in), or a cast target (remembered). */
export const Tv = z.object({
  id: Id,
  name: z.string(),
  /** tv_app: the Opencast app on a TV, signed in. chromecast and airplay: cast targets, remembered only for the list. */
  kind: z.enum(["tv_app", "chromecast", "airplay"]),
  /** The app's platform; null for cast targets. The apps label it ("Fire TV"). */
  platform: TvPlatform.nullable(),
  signedIn: z.boolean(),
  lastUsedAt: Timestamp.nullable(),
  /** The TV app is connected to the relay now (with a few seconds' grace). Always false for cast targets. */
  online: z.boolean(),
  /** A phone on this account is connected to its remote now. The server can't know it for cast targets: false. */
  castingNow: z.boolean()
});
export type Tv = z.infer<typeof Tv>;

// ---------- The remote (the same messages as the Cast receiver) ----------

/**
 * A command from a phone: the shapes `parseCastCommand` (@opencast/player) accepts, without `from`
 * (the relay says who sent it). `sleep.until` is minutes (1 to 240), "end_of_program", or null to cancel.
 */
export const RemoteCommand = z.discriminatedUnion("type", [
  z.object({ type: z.literal("channel"), dir: z.enum(["up", "down"]) }),
  z.object({ type: z.literal("digit"), digit: z.number().int().min(0).max(9) }),
  z.object({ type: z.literal("dot") }),
  z.object({ type: z.literal("tune"), channel: z.string().regex(/^\d{1,3}\.\d$/) }),
  z.object({ type: z.literal("preset"), key: z.number().int().min(1).max(6) }),
  z.object({ type: z.literal("savePreset"), key: z.number().int().min(1).max(6) }),
  z.object({ type: z.literal("last") }),
  z.object({ type: z.literal("info") }),
  z.object({ type: z.literal("guide") }),
  z.object({ type: z.literal("presets") }),
  z.object({ type: z.literal("menu") }),
  z.object({ type: z.literal("back") }),
  z.object({ type: z.literal("select") }),
  z.object({ type: z.literal("focus"), dir: z.enum(["up", "down", "left", "right"]) }),
  z.object({ type: z.literal("pause") }),
  z.object({ type: z.literal("play") }),
  z.object({ type: z.literal("togglePlay") }),
  z.object({ type: z.literal("backToLive") }),
  z.object({ type: z.literal("sleep"), until: z.union([z.null(), z.literal("end_of_program"), z.number().positive().max(240)]) })
]);
export type RemoteCommand = z.infer<typeof RemoteCommand>;

/** What the TV tells every phone (the Cast receiver's `state` message, without `type`). */
export const RemoteState = z.object({
  stationId: z.string().max(64).nullable(),
  paused: z.boolean(),
  /** Whoever changed it last ("Kai's phone"). */
  changedBy: z.string().max(60).nullable(),
  /** When the sleep timer ends, in ms since the epoch. */
  sleepEndsAt: z.number().int().nonnegative().nullable()
});
export type RemoteState = z.infer<typeof RemoteState>;

/** Who sent a command. The TV applies its own "who can change the channel" setting, as the Cast receiver does. */
export const RemoteFrom = z.object({ phoneId: Id, name: z.string() });
export type RemoteFrom = z.infer<typeof RemoteFrom>;

export const RemotePhone = z.object({
  id: Id,
  /** "Kai's phone". */
  name: z.string(),
  /** account: signed in to the TV's account (no pairing). guest: paired by code. */
  kind: z.enum(["account", "guest"]),
  /** Its remote is connected now. */
  connected: z.boolean(),
  pairedAt: Timestamp,
  lastCommandAt: Timestamp.nullable()
});
export type RemotePhone = z.infer<typeof RemotePhone>;

export const RemotePairCode = z.object({
  /** Four digits, shown on the TV. */
  code: z.string().regex(/^\d{4}$/),
  expiresAt: Timestamp
});
export type RemotePairCode = z.infer<typeof RemotePairCode>;

export const PairedPhone = z.object({
  tvId: Id,
  tvName: z.string(),
  /** Send it as the bearer for this TV's remote (events and commands). */
  phoneToken: z.string()
});
export type PairedPhone = z.infer<typeof PairedPhone>;

/** Events on the TV's stream. */
export const TvRemoteEvents = {
  command: z.object({ command: RemoteCommand, from: RemoteFrom, at: Timestamp }),
  /** The list of phones changed (paired, removed, connected, disconnected). Also sent when the stream opens. */
  phones: z.object({ phones: z.array(RemotePhone) }),
  /** The TV was signed out from "Your TVs": drop the session token (the device token still works). */
  signed_out: z.object({})
};

/** Events on a phone's stream. */
export const PhoneRemoteEvents = {
  /** What the TV shows. Also sent when the stream opens, if the TV has said. */
  state: RemoteState,
  /** The remote is over for this phone; the stream closes after it. */
  ended: z.object({ reason: z.enum(["tv_ended", "unpaired", "signed_out"]) })
};

const asEvents = <T extends Record<string, z.ZodType>>(events: T) =>
  z.union(Object.entries(events).map(([name, data]) => z.object({ event: z.literal(name), data })) as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]]);

const PhoneAuth =
  "A phone signed in to the TV's account (its Privy token), or a guest phone paired with this TV (its `phoneToken`). Anyone else: 403 `not_paired`.";

export const tvApi = {
  registerTv: endpoint({
    method: "POST",
    path: "/tv/devices",
    auth: "public",
    summary: "A TV app registers itself on first launch. Keep the deviceToken; it's shown once.",
    body: z.object({ platform: TvPlatform, name: z.string().trim().min(1).max(60).optional() }),
    response: RegisteredTv,
    status: 201
  }),
  createTvCode: endpoint({
    method: "POST",
    path: "/tv/codes",
    auth: "device",
    summary: "A sign-in code for this TV (10 minutes). A new code replaces the TV's earlier ones.",
    response: TvCode,
    status: 201
  }),
  pollTvCode: endpoint({
    method: "GET",
    path: "/tv/codes/:pollToken",
    auth: "public",
    summary: "Has a phone approved this TV's code? Approved carries the TV session token, once. Unknown poll token: 404.",
    params: z.object({ pollToken: z.string().min(1).max(200) }),
    response: TvCodeStatus
  }),
  approveTvCode: endpoint({
    method: "POST",
    path: "/tv/codes/:code/approve",
    auth: "user",
    summary:
      "Sign in the TV showing this code (spaces and lower case are fine). Wrong or run-out: 404 `code_not_found`; already used: 409 `code_used`; 10 wrong in 15 minutes: 429 `too_many_tries`.",
    params: z.object({ code: z.string().min(1).max(20) }),
    response: Tv
  }),
  signOutThisTv: endpoint({
    method: "DELETE",
    path: "/tv/session",
    auth: "device",
    summary: "The TV signs itself out (its session ends on the server). Phones on the account are told `ended`.",
    response: Ok
  }),
  listTvs: endpoint({
    method: "GET",
    path: "/me/tvs",
    auth: "user",
    summary: "TVs signed in to the account (the TV app), and remembered cast targets",
    response: z.array(Tv)
  }),
  signOutTv: endpoint({
    method: "DELETE",
    path: "/me/tvs/:tvId",
    auth: "user",
    summary: "Sign a TV out remotely (or forget a cast target). Returns the list.",
    params: z.object({ tvId: Id }),
    response: z.array(Tv)
  }),
  recordCastTarget: endpoint({
    method: "POST",
    path: "/me/tvs/cast-targets",
    auth: "user",
    summary: "Remember a Chromecast or AirPlay TV by name for Your TVs (again: it's marked used now)",
    body: z.object({ kind: z.enum(["chromecast", "airplay"]), name: z.string().trim().min(1).max(60) }),
    response: Tv,
    status: 201
  }),

  // The relay: the TV's side
  tvRemoteEvents: endpoint({
    method: "GET",
    path: "/tv/remote/events",
    auth: "device",
    summary: "The TV's stream (SSE): `command` from phones, with who sent it, and `phones` when the list changes. Open while the app runs; it makes the TV `online`.",
    events: TvRemoteEvents,
    response: asEvents(TvRemoteEvents)
  }),
  postRemoteState: endpoint({
    method: "POST",
    path: "/tv/remote/state",
    auth: "device",
    summary: "What the TV shows now, for every phone driving it (sent after each change)",
    body: RemoteState,
    response: Ok
  }),
  endRemote: endpoint({
    method: "POST",
    path: "/tv/remote/end",
    auth: "device",
    summary: "The TV ended the session (the sleep timer ran out): every phone is told `ended`. Pairings stay.",
    response: Ok
  }),
  createPairCode: endpoint({
    method: "POST",
    path: "/tv/remote/pair-code",
    auth: "device",
    summary: "A 4-digit code for a guest's phone to pair with this TV (5 minutes; a new one replaces the last)",
    response: RemotePairCode,
    status: 201
  }),
  listRemotePhones: endpoint({
    method: "GET",
    path: "/tv/remote/phones",
    auth: "device",
    summary: "Phones that can drive this TV: guests paired by code, and account phones that have connected",
    response: z.array(RemotePhone)
  }),
  removeRemotePhone: endpoint({
    method: "DELETE",
    path: "/tv/remote/phones/:phoneId",
    auth: "device",
    summary: "Unpair a guest's phone (its token stops working), or drop an account phone from the list until it connects again. It's told `ended`.",
    params: z.object({ phoneId: Id }),
    response: z.array(RemotePhone)
  }),

  // The relay: a phone's side
  pairPhone: endpoint({
    method: "POST",
    path: "/tv/remote/pair",
    auth: "optional",
    summary: "Pair this phone with the TV showing the code. Wrong or run-out: 404 `code_not_found`; 10 wrong in 10 minutes: 429 `too_many_tries`.",
    body: z.object({ code: z.string().regex(/^\d{4}$/), name: z.string().trim().min(1).max(60) }),
    response: PairedPhone,
    status: 201
  }),
  phoneRemoteEvents: endpoint({
    method: "GET",
    path: "/tv/remote/:tvId/events",
    auth: "optional",
    summary: `A phone's stream for one TV (SSE): \`state\` and \`ended\`. ${PhoneAuth}`,
    params: z.object({ tvId: Id }),
    events: PhoneRemoteEvents,
    response: asEvents(PhoneRemoteEvents)
  }),
  sendRemoteCommand: endpoint({
    method: "POST",
    path: "/tv/remote/:tvId/commands",
    auth: "optional",
    summary: `Send a command to the TV, with the phone's name ("Kai's phone"). The TV isn't connected: 409 \`tv_not_connected\`. ${PhoneAuth}`,
    params: z.object({ tvId: Id }),
    body: z.object({ command: RemoteCommand, name: z.string().trim().min(1).max(60) }),
    response: Ok,
    status: 202
  })
};
