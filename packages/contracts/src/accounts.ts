import { z } from "zod";
import { endpoint } from "./core.js";
import { BusinessRole, Id, Market, Ok, StationIdent, StationRole, Timestamp } from "./common.js";

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
        backgroundPlay: z.boolean().optional()
      })
      .partial()
      .optional(),
    market: z.object({ showNearby: z.boolean() }).partial().optional(),
    appearance: z.object({ ground: z.enum(["system", "dark", "light"]), reducedMotion: z.boolean() }).partial().optional(),
    privacy: z.object({ keepWatchHistory: z.boolean() }).partial().optional(),
    tvs: z.object({ lockScreenRemote: z.boolean(), othersOnWifiCanChange: z.boolean() }).partial().optional()
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
  clear: ClearLink.nullable().optional()
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
  lastInAt: Timestamp.nullable()
});

export const Invite = z.object({
  id: Id,
  email: z.string().nullable(),
  phone: z.string().nullable(),
  role: z.enum(["operator", "host", "manager", "viewer"]),
  expiresAt: Timestamp,
  acceptedAt: Timestamp.nullable(),
  createdAt: Timestamp
});

export const Team = z.object({ members: z.array(TeamMember), invites: z.array(Invite) });

const StationParams = z.object({ stationId: Id });
const BusinessParams = z.object({ businessId: Id });

export const accountsApi = {
  getMe: endpoint({
    method: "GET",
    path: "/me",
    auth: "user",
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
    auth: "user",
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
    auth: "user",
    summary: "Keep presets and reminders saved on this device before signing in",
    body: z.object({
      presets: z.array(z.object({ stationId: Id, key: z.number().int().min(1).max(6).nullable() })),
      reminders: z.array(z.object({ logEntryId: Id.optional(), listedAiringId: Id.optional(), switchMeOver: z.boolean() }))
    }),
    response: z.object({ presets: z.array(Preset), reminders: z.array(Reminder) })
  }),

  listPresets: endpoint({ method: "GET", path: "/me/presets", auth: "user", summary: "Presets in order", response: z.array(Preset) }),
  savePreset: endpoint({
    method: "POST",
    path: "/me/presets",
    auth: "user",
    summary:
      "Save a station. With a key that's taken, the old station moves to More presets (never deleted). With no key, it goes to More presets.",
    body: z.object({ stationId: Id, key: z.number().int().min(1).max(6).nullable() }),
    response: z.array(Preset)
  }),
  reorderPresets: endpoint({
    method: "PUT",
    path: "/me/presets",
    auth: "user",
    summary: "Set the whole order and keys at once (drag to reorder)",
    body: z.array(z.object({ stationId: Id, key: z.number().int().min(1).max(6).nullable() })),
    response: z.array(Preset)
  }),
  removePreset: endpoint({
    method: "DELETE",
    path: "/me/presets/:stationId",
    auth: "user",
    summary: "Remove a preset",
    params: StationParams,
    response: z.array(Preset)
  }),
  suggestPresetKey: endpoint({
    method: "GET",
    path: "/me/presets/suggested-key",
    auth: "user",
    summary: "The key to suggest replacing when all six are full: the one used least in the last month",
    response: z.object({ key: z.number().int().min(1).max(6).nullable() })
  }),
  usePresetKey: endpoint({
    method: "POST",
    path: "/me/presets/keys/:key/use",
    auth: "user",
    summary: "Count a press of a preset key",
    params: z.object({ key: z.coerce.number().int().min(1).max(6) }),
    response: Ok
  }),

  listReminders: endpoint({ method: "GET", path: "/me/reminders", auth: "user", summary: "Upcoming reminders", response: z.array(Reminder) }),
  addReminder: endpoint({
    method: "POST",
    path: "/me/reminders",
    auth: "user",
    summary: "Remind me of an airing. Switch me over is off unless asked for.",
    body: z
      .object({ logEntryId: Id.optional(), listedAiringId: Id.optional(), switchMeOver: z.boolean().default(false) })
      .refine((b) => Boolean(b.logEntryId) !== Boolean(b.listedAiringId), "Give an airing or a listed meeting"),
    response: Reminder
  }),
  updateReminder: endpoint({
    method: "PATCH",
    path: "/me/reminders/:reminderId",
    auth: "user",
    summary: "Turn switch me over on or off",
    params: z.object({ reminderId: Id }),
    body: z.object({ switchMeOver: z.boolean() }),
    response: Reminder
  }),
  removeReminder: endpoint({
    method: "DELETE",
    path: "/me/reminders/:reminderId",
    auth: "user",
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
      note: z.string().max(120).optional()
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

  resendInvite: endpoint({
    method: "POST",
    path: "/invites/:inviteId/resend",
    auth: "user",
    summary: "Send an invite again and extend it a week",
    params: z.object({ inviteId: Id }),
    response: Invite
  }),
  acceptInvite: endpoint({
    method: "POST",
    path: "/invites/:inviteId/accept",
    auth: "user",
    summary: "Join the team the invite is for",
    params: z.object({ inviteId: Id }),
    response: Me
  })
};

export type Identity = z.infer<typeof Identity>;
export type Membership = z.infer<typeof Membership>;
export type ViewerSettings = z.infer<typeof ViewerSettings>;
export type Preset = z.infer<typeof Preset>;
export type Reminder = z.infer<typeof Reminder>;
export type TeamMember = z.infer<typeof TeamMember>;
export type Invite = z.infer<typeof Invite>;
export type Team = z.infer<typeof Team>;
