import { z } from "zod";
import { endpoint } from "./core.js";
import { CallSign, Id, Market, Timestamp } from "./common.js";
import { CallSignRefusal } from "./callSigns.js";

export const WaitlistRole = z.enum(["viewer", "station", "producer", "business"]);

/**
 * Where a reservation stands, for the desk's State column (added 2026-09-29, desk-pages 02). One
 * state, the first that applies: `held_after_sign_off` (a station that signed off for good keeps
 * its call sign a year), `not_allowed` (the name breaks `call_signs.refused` now), `same_name`
 * (someone else asked for it too and the desk hasn't decided), `ending` (within the reminder's
 * days of its end), `signing_on` (invited and setting up the station), `invited`, `waiting`.
 */
export const ReservationState = z.enum(["waiting", "invited", "signing_on", "same_name", "not_allowed", "ending", "held_after_sign_off"]);
export type ReservationState = z.infer<typeof ReservationState>;

export const Reservation = z.object({
  id: Id,
  callSign: CallSign,
  email: z.string().nullable(),
  market: Market.nullable(),
  channel: z.string().nullable(),
  /** When it ends: 120 days from the day it was reserved (`call_signs.hold`), later when extended. */
  heldUntil: Timestamp.nullable(),
  /** Its place in line: "Invite the next 10" goes in this order. */
  createdAt: Timestamp,
  // Added 2026-09-29 (desk-pages 02).
  state: ReservationState,
  reason: z.enum(["waitlist", "signed_off", "admin"]),
  /** Who asked, as they wrote it on the waitlist ("Ruth O."), and what for ("Community choir, Riverside"). */
  name: z.string().nullable(),
  about: z.string().nullable(),
  invitedAt: Timestamp.nullable(),
  /** The reminder before the end went. */
  remindedAt: Timestamp.nullable(),
  extendedAt: Timestamp.nullable(),
  /** The station they're setting up with it. */
  stationId: Id.nullable(),
  /** Others holding the same name, undecided. */
  sameName: z.array(Id),
  /** Kept when the desk decided between two people. */
  decidedAt: Timestamp.nullable(),
  refusal: CallSignRefusal.nullable()
});
export type Reservation = z.infer<typeof Reservation>;

/** A station on the dial whose call sign breaks today's rules. Nothing changes for it; the desk sees it. */
export const FlaggedStation = z.object({ stationId: Id, callSign: CallSign, name: z.string(), channel: z.string().nullable(), refusal: CallSignRefusal });
export type FlaggedStation = z.infer<typeof FlaggedStation>;

export const ReservationsOverview = z.object({
  market: Market,
  /** Active reservations in the market, and how many hold a channel. */
  held: z.number().int(),
  withChannel: z.number().int(),
  /** Waiting for an invite and able to have one ("Invite the next 10"). */
  toInvite: z.number().int(),
  /** Same name twice, or not allowed. */
  needsDecision: z.number().int(),
  holdDays: z.number().int(),
  reminderDays: z.number().int(),
  flaggedStations: z.array(FlaggedStation)
});
export type ReservationsOverview = z.infer<typeof ReservationsOverview>;

export const waitlistApi = {
  join: endpoint({
    method: "POST",
    path: "/waitlist",
    auth: "public",
    summary: "Join the waitlist. A station can ask for a call sign; it's held for 120 days (`call_signs.hold`). 422 `call_sign_refused` for a name Opencast won't allow; someone else asking for the same name is allowed, and the desk decides.",
    body: z
      .object({
        role: WaitlistRole,
        email: z.email(),
        zip: z.string().regex(/^\d{5}$/),
        callSign: CallSign.optional(),
        /** Added 2026-09-29: who's asking, and what for (the desk's "Reserved by"). */
        name: z.string().trim().min(1).max(80).optional(),
        about: z.string().trim().min(1).max(140).optional()
      })
      .refine((b) => b.role === "station" || !b.callSign, { message: "Only stations hold a call sign", path: ["callSign"] }),
    response: z.object({
      role: WaitlistRole,
      market: Market.nullable(),
      /** "BEAT is on hold for you." / "Your programs are on the list." / "Your business is on the list." */
      message: z.string(),
      heldCallSign: CallSign.nullable()
    }),
    status: 201
  }),
  checkCallSign: endpoint({
    method: "GET",
    path: "/call-signs/:callSign",
    auth: "optional",
    summary: "Whether a call sign is free. Signed in, a name held for you is available to you",
    params: z.object({ callSign: z.string() }),
    response: z.object({
      callSign: z.string(),
      valid: z.boolean(),
      /** A station could take it now: no station has it, and it isn't held for someone else (or it's held for you). */
      available: z.boolean(),
      // Added 2026-09-29.
      /** The waitlist would take it: free, or asked for by someone else and not decided yet. */
      reservable: z.boolean(),
      heldForYou: z.boolean(),
      /** Why Opencast won't allow it (`call_signs.refused`); `available` and `reservable` are false. */
      refusal: CallSignRefusal.nullable(),
      /** Up to three free names to offer instead, when it's refused or taken. */
      suggestions: z.array(CallSign)
    })
  }),
  listReservations: endpoint({
    method: "GET",
    path: "/admin/reservations",
    auth: "desk",
    summary: "Reserved call signs and the channels held for them",
    query: z.object({ marketId: Id.optional() }),
    response: z.array(Reservation)
  }),
  holdChannel: endpoint({
    method: "POST",
    path: "/admin/reservations/:reservationId/channel",
    auth: "admin",
    summary: "Hold a channel number for a reservation; no other station can take it",
    params: z.object({ reservationId: Id }),
    body: z.object({ marketId: Id, band: z.enum(["tv", "radio"]), channel: z.string().regex(/^\d{1,3}\.\d$/) }),
    response: z.object({ ok: z.literal(true) })
  }),
  // Reserved call signs on the desk (added 2026-09-29, desk-pages 02). All `desk`: an admin, or the
  // reservation's market lead (403 `desk_role` otherwise; a reservation with no market is admins').
  reservationsOverview: endpoint({
    method: "GET",
    path: "/admin/reservations/overview",
    auth: "desk",
    summary: "The market's reservations in numbers, the hold's rule, and stations on the dial whose call signs break the rules now",
    query: z.object({ marketId: Id }),
    response: ReservationsOverview
  }),
  callSignSuggestions: endpoint({
    method: "GET",
    path: "/admin/call-signs/:callSign/suggestions",
    auth: "desk",
    summary: "Free names to offer in place of this one (Suggest, Decide)",
    params: z.object({ callSign: z.string() }),
    response: z.object({ callSign: z.string(), refusal: CallSignRefusal.nullable(), suggestions: z.array(CallSign) })
  }),
  inviteReservation: endpoint({
    method: "POST",
    path: "/admin/reservations/:reservationId/invite",
    auth: "desk",
    summary: "Email them to sign on with their call sign (again, if they were invited before). 422 `not_allowed`, `same_name`, `no_email`",
    params: z.object({ reservationId: Id }),
    body: z.object({}).optional(),
    response: Reservation
  }),
  inviteNextReservations: endpoint({
    method: "POST",
    path: "/admin/reservations/invite-next",
    auth: "desk",
    summary: "Invite the next ones waiting in the market, in reservation order (Invite the next 10)",
    body: z.object({ marketId: Id, count: z.number().int().min(1).max(50).default(10) }),
    response: z.object({ invited: z.array(Reservation), left: z.number().int() })
  }),
  extendReservation: endpoint({
    method: "POST",
    path: "/admin/reservations/:reservationId/extend",
    auth: "desk",
    summary: "Hold it longer: the hold's days again, from its end (or from today, if that's later)",
    params: z.object({ reservationId: Id }),
    body: z.object({ note: z.string().trim().max(500).optional() }).optional(),
    response: Reservation
  }),
  releaseReservation: endpoint({
    method: "POST",
    path: "/admin/reservations/:reservationId/release",
    auth: "desk",
    summary: "End the hold now: the name and any channel held with it are free. They get an email",
    params: z.object({ reservationId: Id }),
    body: z.object({ note: z.string().trim().max(500).optional() }).optional(),
    response: z.object({ ok: z.literal(true), callSign: CallSign, channel: z.string().nullable() })
  }),
  decideReservation: endpoint({
    method: "POST",
    path: "/admin/reservations/:reservationId/decide",
    auth: "desk",
    summary: "Same name twice: keep this one. Each other is told, with a free name held for them instead in the same place in line (chosen here, or the first suggestion)",
    params: z.object({ reservationId: Id }),
    body: z.object({ suggestions: z.array(z.object({ reservationId: Id, callSign: CallSign })).max(10).optional(), note: z.string().trim().max(500).optional() }).optional(),
    response: z.object({ kept: Reservation, told: z.array(z.object({ reservationId: Id, email: z.string().nullable(), suggestion: CallSign.nullable() })) })
  }),
  suggestCallSign: endpoint({
    method: "POST",
    path: "/admin/reservations/:reservationId/suggest",
    auth: "desk",
    summary: "Not allowed: hold `callSign` for them instead, in the same place in line, and tell them why (with up to three other free names)",
    params: z.object({ reservationId: Id }),
    body: z.object({ callSign: CallSign, alternatives: z.array(CallSign).max(3).optional(), note: z.string().trim().max(500).optional() }),
    response: Reservation
  }),
  listSignups: endpoint({
    method: "GET",
    path: "/admin/waitlist",
    auth: "admin",
    summary: "Everyone on the waitlist, per market",
    query: z.object({ marketId: Id.optional(), role: WaitlistRole.optional() }),
    response: z.array(z.object({ id: Id, role: WaitlistRole, email: z.string(), zip: z.string(), market: Market.nullable(), callSign: z.string().nullable(), createdAt: Timestamp }))
  })
};

export type WaitlistRole = z.infer<typeof WaitlistRole>;
