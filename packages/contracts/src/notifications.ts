import { z } from "zod";
import { endpoint } from "./core.js";
import { Id, Ok, Timestamp } from "./common.js";

export const NoticeKind = z.enum([
  "reminder",
  "switch_over",
  "dead_air_warning",
  "dead_air_filled",
  "signal_lost",
  /** Added 2026-09: a file in the next hour isn't on the playout server yet; or one was missing at air. */
  "file_not_ready",
  "spot_paused",
  "spot_back",
  "low_balance",
  "sponsorship_request",
  "sponsorship_answered",
  "carriage_request",
  "carriage_answered",
  "carried_program_changed",
  "order_update",
  "rights_claim",
  "invite",
  "weekly_summary",
  "code_used",
  /** O1 (added 2026-09-28), viewer: a preset station starts a live program. Off unless turned on. */
  "preset_live",
  /** O1, viewer: news from a station you support. Off unless turned on. */
  "station_news",
  /** O1, station team: the station signed on or off. */
  "signed_on_off",
  /** O1, business: a station added your spot to its rotation. */
  "spot_added",
  /**
   * Pay-as-you-go (added 2026-09-29), station owners, always on: the month's usage, a charge that
   * failed, the grace period starting and ending soon, relays and live hours paused and resumed,
   * a cap reached, a payment to approve in Clear.
   */
  "station_account",
  /**
   * Relays (added 2026-09-30, follow-up Phase 3), station team (and the Network desk when a relay
   * stops): a relay stopped or is back, a platform restart the station has to do, paid promotion to
   * mark on a destination Opencast can't mark.
   */
  "relay",
  /**
   * External stations (added 2026-09-30, follow-up Phase 6), the Network desk: an external station
   * left the dial because its stream was down 5 minutes, or it's back on the dial.
   */
  "external_station",
  /**
   * A234 (added 2026-09-30), the Network desk: a full station sharing X.1's call sign no longer
   * shares an owner with X.1 ("12.2 BEAT Beat Tapes no longer shares an owner with 12.1 BEAT Inland
   * Beat"). Once per split; nothing changes on air by itself. Push and email on by default.
   */
  "call_sign_owners"
]);

export const Notice = z.object({
  id: Id,
  kind: NoticeKind,
  title: z.string(),
  body: z.string(),
  /** Where the notice takes you in the app. */
  link: z.string().nullable(),
  scope: z.object({ kind: z.enum(["viewer", "station", "business"]), id: Id.nullable() }),
  createdAt: Timestamp,
  readAt: Timestamp.nullable()
});

/** Per person, per station or business. Some can't be turned off (dead air coming; spots about to pause; rights claims). */
export const NotificationPrefs = z.record(z.string(), z.object({ push: z.boolean(), email: z.boolean() }));

export const notificationsApi = {
  listNotices: endpoint({
    method: "GET",
    path: "/me/notices",
    auth: "user",
    summary: "In-app notices, newest first",
    query: z.object({ unread: z.coerce.boolean().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }),
    response: z.array(Notice)
  }),
  markRead: endpoint({
    method: "POST",
    path: "/me/notices/read",
    auth: "user",
    summary: "Mark notices read",
    body: z.object({ ids: z.array(Id).optional(), all: z.boolean().optional() }),
    response: Ok
  }),
  getPrefs: endpoint({
    method: "GET",
    path: "/me/notification-prefs",
    auth: "user",
    summary: "Notification settings for a scope",
    query: z.object({ scope: z.enum(["viewer", "station", "business"]), scopeId: Id.optional() }),
    response: z.object({ prefs: NotificationPrefs, alwaysOn: z.array(NoticeKind) })
  }),
  setPrefs: endpoint({
    method: "PUT",
    path: "/me/notification-prefs",
    auth: "user",
    summary: "Change notification settings. Always-on kinds stay on.",
    body: z.object({ scope: z.enum(["viewer", "station", "business"]), scopeId: Id.nullable(), prefs: NotificationPrefs }),
    response: z.object({ prefs: NotificationPrefs, alwaysOn: z.array(NoticeKind) })
  })
};

export type NoticeKind = z.infer<typeof NoticeKind>;
export type Notice = z.infer<typeof Notice>;
export type NotificationPrefs = z.infer<typeof NotificationPrefs>;
