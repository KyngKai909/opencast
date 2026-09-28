// Fields and endpoints the You area needs that the contracts don't have yet: TVs on the account
// (B2), the card and receipts on a pledge and changing monthly or once (E1), signing out
// everywhere (A1), watch history (A2), your data (A3), notification kinds and timing (O1, O2).
// Each names its request in docs/contract-requests.md. The mocks answer them; against the real
// API they 404 until the request lands, and the screens say so in the API's words.

import { endpoint, Id, Ok, Pledge, Timestamp } from "@opencast/contracts";
import { z } from "zod";

// ---------- B2: TVs on the account ----------

/** A TV that's watched with this account: the Opencast app (signed in), or a cast target (only remembered). */
export const Tv = z.object({
  id: Id,
  name: z.string(),
  /** tv_app: the Opencast app on a TV, signed in. chromecast and airplay: cast targets, remembered only for the list. */
  kind: z.enum(["tv_app", "chromecast", "airplay"]),
  /** For the app: "Fire TV", "Android TV", "Google TV". */
  platform: z.string().nullable(),
  signedIn: z.boolean(),
  lastUsedAt: Timestamp.nullable(),
  /** Known to the phone that's casting, not the account: the mock says so for the list. */
  castingNow: z.boolean()
});
export type Tv = z.infer<typeof Tv>;

export const tvsApi = {
  listTvs: endpoint({ method: "GET", path: "/me/tvs", auth: "user", summary: "B2: TVs signed in to the account, and cast targets", response: z.array(Tv) }),
  signOutTv: endpoint({
    method: "DELETE",
    path: "/me/tvs/:tvId",
    auth: "user",
    summary: "B2: sign a TV out (or forget a cast target)",
    params: z.object({ tvId: Id }),
    response: z.array(Tv)
  }),
  approveTvCode: endpoint({
    method: "POST",
    path: "/tv/codes/:code/approve",
    auth: "user",
    summary: "B2: sign in the TV showing this code",
    params: z.object({ code: z.string() }),
    response: Tv
  })
};

// ---------- E1: pledges ----------

export const Receipt = z.object({ id: Id, on: z.iso.date(), amountMicros: z.number().int(), url: z.string().nullable() });
export type Receipt = z.infer<typeof Receipt>;

export const PledgeX = Pledge.extend({
  /** E1: the card on file. */
  card: z.object({ label: z.string(), expired: z.boolean() }).nullable().optional(),
  receipts: Pledge.shape.receipts.extend({ items: z.array(Receipt).optional() })
});
export type PledgeX = z.infer<typeof PledgeX>;
export const PledgesX = z.array(PledgeX);

export const pledgesApiX = {
  /** updatePledge with E1's `cadence`: monthly or once. */
  updatePledge: endpoint({
    method: "PATCH",
    path: "/me/pledges/:pledgeId",
    auth: "user",
    summary: "Change the amount, on-air credit or cadence (E1), or stop",
    params: z.object({ pledgeId: Id }),
    body: z.object({ amountMicros: z.number().int().min(1_000_000), creditOnAir: z.boolean(), cadence: z.enum(["monthly", "once"]), stop: z.literal(true) }).partial(),
    response: PledgeX
  }),
  /** E1: a card-update page (Stripe's), made when asked for. */
  cardSession: endpoint({
    method: "POST",
    path: "/me/pledges/:pledgeId/card-session",
    auth: "user",
    summary: "E1: a page to change the card on a pledge",
    params: z.object({ pledgeId: Id }),
    response: z.object({ url: z.string() })
  })
};

// ---------- A1, A2, A3: account ----------

export const accountApiX = {
  signOutEverywhere: endpoint({ method: "POST", path: "/me/sign-out-everywhere", auth: "user", summary: "A1: sign out every phone, computer and TV", response: Ok }),
  clearWatchHistory: endpoint({ method: "DELETE", path: "/me/watch-history", auth: "user", summary: "A2: clear watch history and the last channel", response: Ok }),
  exportData: endpoint({
    method: "POST",
    path: "/me/export",
    auth: "user",
    summary: "A3: email a download of everything the account holds",
    response: z.object({ email: z.string(), readyBy: Timestamp })
  }),
  deleteAccount: endpoint({ method: "DELETE", path: "/me", auth: "user", summary: "A3: delete the account; pledges stop after this month", response: Ok })
};

// ---------- O1, O2: notifications ----------

/** O1: the kinds the viewer's Notifications screen needs besides reminder and switch_over. */
export const VIEWER_NOTICE_KINDS = { reminder: "reminder", presetLive: "preset_live", stationNews: "station_news" } as const;

/** O2 (and A7): notification timing, kept in settings until the prefs carry it. */
export const NotificationTiming = z.object({
  /** "The evening before". */
  emailWhen: z.enum(["evening_before"]).optional(),
  /** "At the start". */
  leadMinutes: z.number().int().min(0).optional(),
  /** "Nothing between 10:00 pm and 8:00 am", on by default. */
  quietHours: z.boolean().optional()
});
export type NotificationTiming = z.infer<typeof NotificationTiming>;
