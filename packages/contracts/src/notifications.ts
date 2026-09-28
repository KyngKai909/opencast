import { z } from "zod";
import { endpoint } from "./core.js";
import { Id, Ok, Timestamp } from "./common.js";

export const NoticeKind = z.enum([
  "reminder",
  "switch_over",
  "dead_air_warning",
  "dead_air_filled",
  "signal_lost",
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
  "code_used"
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
