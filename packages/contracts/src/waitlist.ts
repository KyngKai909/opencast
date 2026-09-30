import { z } from "zod";
import { endpoint } from "./core.js";
import { CallSign, Id, Market, Timestamp } from "./common.js";

export const WaitlistRole = z.enum(["viewer", "station", "producer", "business"]);

export const waitlistApi = {
  join: endpoint({
    method: "POST",
    path: "/waitlist",
    auth: "public",
    summary: "Join the waitlist. A station can ask for a call sign; it's held until the market opens.",
    body: z
      .object({
        role: WaitlistRole,
        email: z.email(),
        zip: z.string().regex(/^\d{5}$/),
        callSign: CallSign.optional()
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
    auth: "public",
    summary: "Whether a call sign is free",
    params: z.object({ callSign: z.string() }),
    response: z.object({ callSign: z.string(), valid: z.boolean(), available: z.boolean() })
  }),
  listReservations: endpoint({
    method: "GET",
    path: "/admin/reservations",
    auth: "desk",
    summary: "Reserved call signs and the channels held for them",
    query: z.object({ marketId: Id.optional() }),
    response: z.array(
      z.object({
        id: Id,
        callSign: CallSign,
        email: z.string().nullable(),
        market: Market.nullable(),
        channel: z.string().nullable(),
        heldUntil: Timestamp.nullable(),
        createdAt: Timestamp
      })
    )
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
