import { z } from "zod";
import { endpoint } from "./core.js";
import { BusinessRole, Id, Market, Ok, StationIdent, StationRole, Timestamp } from "./common.js";
import { DeskRoleGrant } from "./desk.js";
import { Pledge } from "./ledger.js";
import { Notice, NotificationPrefs } from "./notifications.js";
import { Tv } from "./tv.js";

export const Identity = z.object({
  kind: z.enum(["email", "apple", "google", "wallet"]),
  value: z.string(),
  verifiedAt: Timestamp.nullable()
});

export const Membership = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("station"), station: StationIdent, role: StationRole }),
  z.object({
    kind: z.literal("business"),
    business: z.object({ id: Id, name: z.string() }),
    role: BusinessRole
  })
]);

/** The TV app's settings (A7, added 2026-09-28). Captions stay in `watching`; who on the Wi-Fi can change the channel in `tvs`. */
export const TvSettings = z
  .object({
    /** Which way channel up goes. */
    channelUp: z.enum(["up_the_dial", "down_the_dial"]),
    /** How long the channel banner stays. */
    bannerSeconds: z.union([z.literal(3), z.literal(5), z.literal(8)]),
    /** How long to wait after a number is typed before tuning. */
    numberWaitSeconds: z.union([z.literal(1), z.literal(1.5), z.literal(2), z.literal(3)]),
    includeRadioBand: z.boolean(),
    quality: z.enum(["auto", "data_saver", "best"]),
    /** Evening out the audio (loud ads and quiet programs). */
    eveningOut: z.boolean()
  })
  .partial();
export type TvSettings = z.infer<typeof TvSettings>;

/**
 * Notification timing (O2, added 2026-09-28), kept in `settings.notifications`. Every field is
 * optional; what's shown when a field is absent is the default the sender uses.
 */
export const NotificationTiming = z
  .object({
    /** Reminder emails: "The evening before" (the only choice drawn). Absent: with the reminder. */
    emailWhen: z.enum(["evening_before"]),
    /** How early a reminder comes, in minutes before the start. Absent: at the start (within 5 minutes). */
    leadMinutes: z.number().int().min(0).max(1440),
    /** "Nothing between 10:00 pm and 8:00 am". On unless turned off: no pushes about your viewing in the window (notices still land in the app). */
    quietHours: z.boolean(),
    /** The window, in the account's market's time. Absent: 22:00 to 08:00. */
    quietFrom: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    quietTo: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  })
  .partial();
export type NotificationTiming = z.infer<typeof NotificationTiming>;

/** The eight settings sections. Unknown keys are kept, so the apps can add settings. */
export const ViewerSettings = z
  .object({
    watching: z
      .object({
        captions: z.enum(["off", "on", "muted_only"]).optional(),
        captionSize: z.enum(["small", "medium", "large"]).optional(),
        startOn: z.enum(["dial", "last_channel"]).optional(),
        mutedPreviews: z.boolean().optional(),
        mobileQuality: z.enum(["auto", "data_saver"]).optional(),
        backgroundPlay: z.boolean().optional(),
        /**
         * "Tuning sound" (added 2026-09-29): a soft hiss when changing channel, on video. The row in
         * Watching settings and TV settings. Absent: off.
         */
        tuningSound: z.boolean().optional(),
        /** The radio band's own "Tuning sound" (added 2026-09-29), turned off on the radio band itself. Absent: on. */
        radioTuningSound: z.boolean().optional()
      })
      .partial()
      .optional(),
    market: z.object({ showNearby: z.boolean() }).partial().optional(),
    appearance: z.object({ ground: z.enum(["system", "dark", "light"]), reducedMotion: z.boolean() }).partial().optional(),
    privacy: z.object({ keepWatchHistory: z.boolean() }).partial().optional(),
    tvs: z.object({ lockScreenRemote: z.boolean(), othersOnWifiCanChange: z.boolean() }).partial().optional(),
    /** A7 (added 2026-09-28): the TV app's own rows. */
    tv: TvSettings.optional(),
    /** O2 (added 2026-09-28): reminder timing and quiet hours. */
    notifications: NotificationTiming.optional()
  })
  .loose();

/**
 * A Clear account linked through Privy's cross-app linking (Clear is the provider app, Opencast
 * the requester). `read_only`: Opencast can verify the address and pay out to it; funding happens
 * inside Clear. `full`: Opencast can also request a transfer from it, which the person confirms
 * on Clear's page. Nothing about a Clear account is known until the person links it.
 */
export const ClearLink = z.object({
  address: z.string(),
  access: z.enum(["read_only", "full"]),
  linkedAt: Timestamp
});
export type ClearLink = z.infer<typeof ClearLink>;

export const Me = z.object({
  id: Id,
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  market: Market.nullable(),
  isAdmin: z.boolean(),
  identities: z.array(Identity),
  memberships: z.array(Membership),
  settings: ViewerSettings,
  /** The linked Clear account (added 2026-09-28), or null. Absent from older servers. */
  clear: ClearLink.nullable().optional(),
  /**
   * Added 2026-09-29: the person's Network desk roles (admin, rights reviewer, market lead for a
   * market). Empty for someone not on the Opencast team; `isAdmin` still says admin, as before.
   * Absent from older servers.
   */
  deskRoles: z.array(DeskRoleGrant).optional(),
  /**
   * Added 2026-10-07 (invite-only sign-ups): false until the person is let in, by an invite code,
   * a team invite, or the desk. Until then the account can only redeem a code, sign out or be
   * deleted. Absent from older servers (everyone was in).
   */
  admitted: z.boolean().optional()
});
export type Me = z.infer<typeof Me>;

export const Preset = z.object({
  station: StationIdent,
  /** 1 to 6, or null for "More presets". */
  key: z.number().int().min(1).max(6).nullable(),
  position: z.number().int()
});

export const Reminder = z.object({
  id: Id,
  switchMeOver: z.boolean(),
  /** An airing on a station's log, or a listed city meeting. */
  airing: z.object({
    title: z.string(),
    startsAt: Timestamp,
    station: StationIdent,
    listed: z.boolean(),
    logEntryId: Id.nullable(),
    listedAiringId: Id.nullable()
  }),
  createdAt: Timestamp
});

export const TeamMember = z.object({
  userId: Id,
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  role: z.string(),
  note: z.string().nullable(),
  lastInAt: Timestamp.nullable(),
  /** A4 (added 2026-09-29): a station host's live programs (absent for other roles and businesses). */
  programIds: z.array(Id).optional()
});

export const Invite = z.object({
  id: Id,
  email: z.string().nullable(),
  phone: z.string().nullable(),
  role: z.enum(["operator", "host", "manager", "viewer"]),
  expiresAt: Timestamp,
  acceptedAt: Timestamp.nullable(),
  createdAt: Timestamp,
  /** A4 (added 2026-09-29): the live programs a host invite hosts once accepted. */
  programIds: z.array(Id).optional()
});

export const Team = z.object({ members: z.array(TeamMember), invites: z.array(Invite) });

/**
 * An invite as its link's page shows it (added 2026-09-29): the team, the role, a hint of the
 * address it's for, and whether it can still be used. Anyone with the link can read it; the
 * address itself is never shown.
 */
export const InvitePreview = z.object({
  id: Id,
  team: z.object({
    kind: z.enum(["station", "business"]),
    id: Id,
    name: z.string(),
    /** A station's call sign (master control's address for it); null for a business or a station without one yet. */
    callSign: z.string().nullable()
  }),
  role: z.enum(["operator", "host", "manager", "viewer"]),
  /** Who sent it: their display name, or null. */
  invitedBy: z.string().nullable(),
  /** The invited address, masked (`j…@example.com`); null for a phone invite. */
  emailHint: z.string().nullable(),
  state: z.enum(["open", "expired", "accepted"]),
  expiresAt: Timestamp,
  /** Signed in: the account's own email, for "you're signed in as". Null signed out, or with no email. */
  signedInAs: z.string().nullable(),
  /**
   * Signed in: whether the account has the invited email (a verified email, Google or Apple
   * address). Null signed out, for a phone invite, or when the check is off.
   */
  emailMatches: z.boolean().nullable(),
  /** Signed in: whether this account is the one that accepted it. */
  acceptedByYou: z.boolean()
});

/**
 * Watch history and the last channel (A2, added 2026-09-28). Kept from signed-in heartbeats only
 * while `settings.privacy.keepWatchHistory` is on (unset counts as on, as the settings show it),
 * for 30 days. `keep` says whether it's being kept now.
 */
export const WatchHistory = z.object({
  keep: z.boolean(),
  /** The station watched most recently, for "It opens tuned in". */
  lastChannel: z.object({ station: StationIdent, at: Timestamp }).nullable(),
  /** Newest first: each stretch of watching one station. */
  items: z.array(z.object({ station: StationIdent, startedAt: Timestamp, endedAt: Timestamp }))
});
export type WatchHistory = z.infer<typeof WatchHistory>;

/** A receipt for a pledge payment (E1). */
export const PledgeReceipt = z.object({ id: Id, on: z.iso.date(), amountMicros: z.number().int(), url: z.string().nullable() });

/** Everything the account holds, as one JSON file (A3, added 2026-09-28). */
export const AccountExport = z.object({
  exportedAt: Timestamp,
  account: z.object({
    id: Id,
    displayName: z.string().nullable(),
    email: z.string().nullable(),
    market: Market.nullable(),
    createdAt: Timestamp,
    settings: ViewerSettings
  }),
  identities: z.array(Identity),
  memberships: z.array(Membership),
  presets: z.array(Preset),
  reminders: z.array(Reminder),
  watchHistory: WatchHistory.shape.items,
  pledges: z.array(Pledge),
  notificationPrefs: z.array(z.object({ scope: z.enum(["viewer", "station", "business"]), scopeId: Id.nullable(), prefs: NotificationPrefs })),
  notices: z.array(Notice),
  tvs: z.array(Tv),
  clear: ClearLink.nullable()
});
export type AccountExport = z.infer<typeof AccountExport>;

/** An Opencast admin, for "Run by" (A6). */
export const OpencastTeamMember = z.object({ id: Id, name: z.string(), email: z.string() });
export type OpencastTeamMember = z.infer<typeof OpencastTeamMember>;

/**
 * A5 (added 2026-09-29): a station you're on, for the switcher: on air, and the next dead air
 * within the next six hours ("Dead air in 40 min"), with when it ends (how long it lasts).
 * Off air, there's no dead air to warn about.
 */
export const StationStatus = z.object({
  stationId: Id,
  onAir: z.boolean(),
  deadAirAt: Timestamp.nullable(),
  deadAirEndsAt: Timestamp.nullable().optional()
});
export type StationStatus = z.infer<typeof StationStatus>;

const StationParams = z.object({ stationId: Id });
const BusinessParams = z.object({ businessId: Id });

export const accountsApi = {
  getMe: endpoint({
    method: "GET",
    path: "/me",
    auth: "user",
    beforeAdmitted: true,
    tvSession: true,
    summary: "The signed-in person, their identities, stations and businesses",
    response: Me
  }),
  linkClear: endpoint({
    method: "POST",
    path: "/me/clear",
    auth: "user",
    summary: "After the app links Clear with Privy's cross-app linking, record it: the API reads the person's Clear cross-app account from Privy and stores its address and access. 409 if Privy has no Clear account linked.",
    response: ClearLink
  }),
  unlinkClear: endpoint({
    method: "DELETE",
    path: "/me/clear",
    auth: "user",
    summary: "Forget the linked Clear account (the app also unlinks it in Privy). Funding sources and payout destinations that used it stop working.",
    response: Ok
  }),
  updateMe: endpoint({
    method: "PATCH",
    path: "/me",
    auth: "user", tvSession: true,
    summary: "Change display name, market or settings",
    body: z.object({
      displayName: z.string().min(1).max(80).nullable().optional(),
      marketId: Id.nullable().optional(),
      settings: ViewerSettings.optional()
    }),
    response: Me
  }),
  /** First sign-in: "Keep what's on this phone: 3 presets and 1 reminder". */
  mergeDevice: endpoint({
    method: "POST",
    path: "/me/merge-device",
    auth: "user", tvSession: true,
    summary: "Keep presets and reminders saved on this device before signing in",
    body: z.object({
      presets: z.array(z.object({ stationId: Id, key: z.number().int().min(1).max(6).nullable() })),
      reminders: z.array(z.object({ logEntryId: Id.optional(), listedAiringId: Id.optional(), switchMeOver: z.boolean() }))
    }),
    response: z.object({ presets: z.array(Preset), reminders: z.array(Reminder) })
  }),

  listPresets: endpoint({ method: "GET", path: "/me/presets", auth: "user", tvSession: true, summary: "Presets in order", response: z.array(Preset) }),
  savePreset: endpoint({
    method: "POST",
    path: "/me/presets",
    auth: "user", tvSession: true,
    summary:
      "Save a station. With a key that's taken, the old station moves to More presets (never deleted). With no key, it goes to More presets.",
    body: z.object({ stationId: Id, key: z.number().int().min(1).max(6).nullable() }),
    response: z.array(Preset)
  }),
  reorderPresets: endpoint({
    method: "PUT",
    path: "/me/presets",
    auth: "user", tvSession: true,
    summary: "Set the whole order and keys at once (drag to reorder)",
    body: z.array(z.object({ stationId: Id, key: z.number().int().min(1).max(6).nullable() })),
    response: z.array(Preset)
  }),
  removePreset: endpoint({
    method: "DELETE",
    path: "/me/presets/:stationId",
    auth: "user", tvSession: true,
    summary: "Remove a preset",
    params: StationParams,
    response: z.array(Preset)
  }),
  suggestPresetKey: endpoint({
    method: "GET",
    path: "/me/presets/suggested-key",
    auth: "user", tvSession: true,
    summary: "The key to suggest replacing when all six are full: the one used least in the last month",
    response: z.object({ key: z.number().int().min(1).max(6).nullable() })
  }),
  usePresetKey: endpoint({
    method: "POST",
    path: "/me/presets/keys/:key/use",
    auth: "user", tvSession: true,
    summary: "Count a press of a preset key",
    params: z.object({ key: z.coerce.number().int().min(1).max(6) }),
    response: Ok
  }),

  listReminders: endpoint({ method: "GET", path: "/me/reminders", auth: "user", tvSession: true, summary: "Upcoming reminders", response: z.array(Reminder) }),
  addReminder: endpoint({
    method: "POST",
    path: "/me/reminders",
    auth: "user", tvSession: true,
    summary: "Remind me of an airing. Switch me over is off unless asked for.",
    body: z
      .object({ logEntryId: Id.optional(), listedAiringId: Id.optional(), switchMeOver: z.boolean().default(false) })
      .refine((b) => Boolean(b.logEntryId) !== Boolean(b.listedAiringId), "Give an airing or a listed meeting"),
    response: Reminder
  }),
  updateReminder: endpoint({
    method: "PATCH",
    path: "/me/reminders/:reminderId",
    auth: "user", tvSession: true,
    summary: "Turn switch me over on or off",
    params: z.object({ reminderId: Id }),
    body: z.object({ switchMeOver: z.boolean() }),
    response: Reminder
  }),
  removeReminder: endpoint({
    method: "DELETE",
    path: "/me/reminders/:reminderId",
    auth: "user", tvSession: true,
    summary: "Remove a reminder",
    params: z.object({ reminderId: Id }),
    response: Ok
  }),

  getStationTeam: endpoint({
    method: "GET",
    path: "/stations/:stationId/team",
    auth: "user",
    summary: "Members and invites (owner and operator)",
    params: StationParams,
    response: Team
  }),
  inviteToStation: endpoint({
    method: "POST",
    path: "/stations/:stationId/team/invites",
    auth: "user",
    summary: "Invite by email or phone as operator or host (owner only). Expires after a week.",
    params: StationParams,
    body: z.object({
      email: z.email().optional(),
      phone: z.string().optional(),
      role: z.enum(["operator", "host"]),
      note: z.string().max(120).optional(),
      /** A4 (added 2026-09-29): for a host, the live programs they'll host. They must be this station's live programs. */
      programIds: z.array(Id).max(50).optional()
    }),
    response: Invite
  }),
  updateStationMember: endpoint({
    method: "PATCH",
    path: "/stations/:stationId/team/:userId",
    auth: "user",
    summary: "Change a member's role or note (owner only). Ownership moves with transferOwnership.",
    params: z.object({ stationId: Id, userId: Id }),
    body: z.object({ role: z.enum(["operator", "host"]).optional(), note: z.string().max(120).nullable().optional() }),
    response: Team
  }),
  removeStationMember: endpoint({
    method: "DELETE",
    path: "/stations/:stationId/team/:userId",
    auth: "user",
    summary: "Remove a member (owner only)",
    params: z.object({ stationId: Id, userId: Id }),
    response: Team
  }),
  transferStationOwnership: endpoint({
    method: "POST",
    path: "/stations/:stationId/team/transfer",
    auth: "user",
    summary: "Make an existing member the owner; the old owner becomes an operator",
    params: StationParams,
    body: z.object({ toUserId: Id }),
    response: Team
  }),

  getBusinessTeam: endpoint({
    method: "GET",
    path: "/businesses/:businessId/team",
    auth: "user",
    summary: "Members and invites",
    params: BusinessParams,
    response: Team
  }),
  inviteToBusiness: endpoint({
    method: "POST",
    path: "/businesses/:businessId/team/invites",
    auth: "user",
    summary: "Invite a manager or viewer (owner only). An agency is a manager with a note.",
    params: BusinessParams,
    body: z.object({
      email: z.email().optional(),
      phone: z.string().optional(),
      role: z.enum(["manager", "viewer"]),
      note: z.string().max(120).optional()
    }),
    response: Invite
  }),
  updateBusinessMember: endpoint({
    method: "PATCH",
    path: "/businesses/:businessId/team/:userId",
    auth: "user",
    summary: "Change a member's role or note (owner only)",
    params: z.object({ businessId: Id, userId: Id }),
    body: z.object({ role: z.enum(["manager", "viewer"]).optional(), note: z.string().max(120).nullable().optional() }),
    response: Team
  }),
  removeBusinessMember: endpoint({
    method: "DELETE",
    path: "/businesses/:businessId/team/:userId",
    auth: "user",
    summary: "Remove a member (owner only)",
    params: z.object({ businessId: Id, userId: Id }),
    response: Team
  }),

  getInvite: endpoint({
    method: "GET",
    path: "/invites/:inviteId",
    auth: "optional",
    summary:
      "Added 2026-09-29: an invite as its link's page shows it: the team, the role, the invited address masked, and whether it's open, expired or accepted. Signed in, it also says whether the account has the invited email. 404 for an unknown invite.",
    params: z.object({ inviteId: Id }),
    response: InvitePreview
  }),
  resendInvite: endpoint({
    method: "POST",
    path: "/invites/:inviteId/resend",
    auth: "user",
    summary:
      "Send an invite's email again and extend it a week (owner only). Changed 2026-09-29: it emails again. 429 `resend_too_soon` within 10 minutes of the last send; 409 `invite_used` once accepted; 502 `email_not_sent` when the email couldn't go (nothing changes).",
    params: z.object({ inviteId: Id }),
    response: Invite
  }),
  acceptInvite: endpoint({
    method: "POST",
    path: "/invites/:inviteId/accept",
    auth: "user",
    beforeAdmitted: true,
    summary:
      "Join the team the invite is for. Changed 2026-09-29: an invite to an email needs that email on the signed-in account (403 `invite_email_mismatch`; INVITE_EMAIL_MATCH=off turns the check off). 409 `invite_used` when someone else accepted it (accepting your own again changes nothing); 422 `invite_expired`.",
    params: z.object({ inviteId: Id }),
    response: Me
  }),

  // ---- Added 2026-09-28: A1, A2, A3, A6 ----

  signOutEverywhere: endpoint({
    method: "POST",
    path: "/me/sign-out-everywhere",
    auth: "user",
    beforeAdmitted: true,
    summary:
      "A1: sign out every phone, computer and TV. Every Privy token issued before now, and every later token of a session seen before now, answers 401 `signed_out`; TVs signed in to the account are signed out and their phones dropped. This device signs out too.",
    response: Ok
  }),
  getWatchHistory: endpoint({
    method: "GET",
    path: "/me/watch-history",
    auth: "user",
    tvSession: true,
    summary: "A2: the last channel and the last 30 days of watching (empty while keepWatchHistory is off)",
    response: WatchHistory
  }),
  clearWatchHistory: endpoint({
    method: "DELETE",
    path: "/me/watch-history",
    auth: "user",
    tvSession: true,
    summary: "A2: clear watch history and the last channel",
    response: Ok
  }),
  exportData: endpoint({
    method: "POST",
    path: "/me/export",
    auth: "user",
    summary: "A3: email a link to download everything the account holds (the link opens the app, which calls downloadData). 409 `no_email` without an email.",
    response: z.object({ email: z.string(), readyBy: Timestamp })
  }),
  downloadData: endpoint({
    method: "GET",
    path: "/me/export",
    auth: "user",
    summary: "A3: everything the account holds, as JSON (save it as a file)",
    response: AccountExport
  }),
  deleteAccount: endpoint({
    method: "DELETE",
    path: "/me",
    auth: "user",
    beforeAdmitted: true,
    summary:
      "A3: delete the account now (no grace period). Presets, reminders, watch history, notices and TVs go; pledges stop after this month; team places are left. 409 `owns_station` or `owns_business` while the person owns one: hand it over (or close it) first.",
    response: Ok
  }),
  listOpencastTeam: endpoint({
    method: "GET",
    path: "/admin/team",
    auth: "admin",
    summary: "A6: the Opencast team (admins), who can run a claimable station",
    response: z.array(OpencastTeamMember)
  }),

  // ---- Added 2026-09-29: A5 ----

  myStationStatus: endpoint({
    method: "GET",
    path: "/me/stations/status",
    auth: "user",
    summary: "A5: each station you're on: on air, and the next dead air within six hours, in the order of your memberships",
    response: z.array(StationStatus)
  })
};

export type Identity = z.infer<typeof Identity>;
export type Membership = z.infer<typeof Membership>;
export type ViewerSettings = z.infer<typeof ViewerSettings>;
export type Preset = z.infer<typeof Preset>;
export type Reminder = z.infer<typeof Reminder>;
export type TeamMember = z.infer<typeof TeamMember>;
export type Invite = z.infer<typeof Invite>;
export type InvitePreview = z.infer<typeof InvitePreview>;
export type Team = z.infer<typeof Team>;
