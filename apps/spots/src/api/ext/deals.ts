// The Sponsorships and orders area's proposed fields (docs/contract-requests.md), as optional
// extensions of the spots contract. The mocks fill them in; against the real API they're absent
// until each request lands, and the screens hide what depends on them.
//
//   L1  Program format on a sponsorship ("Weekly, live"), for "One program, weekly, live".
//   P16 What a business can sponsor: stations and programs with the minimum, room and schedule line
//       (a new endpoint; listStationSponsorships is the station's own). Blocks sponsorships 02.1.
//   P17 The credit check's passing part ("Who you are and where") and the words each flag names;
//       the members' credit and co-sponsors for the preview.
//   P18 Makers: history with this business ("Made your Fall menu spot") and a specialty line.
//   P19 Delivery length and checks; when an order was quoted and approved.

import { z } from "zod";
import { CreditCheck, endpoint, Id, Micros, Millis, ProductionOrder, Sponsorship, StationIdent, Timestamp, spotsApi } from "@opencast/contracts";

// ---- Sponsorships (L1, P16, P17) ----

export const SponsorshipX = Sponsorship.extend({
  /** L1: the program's format ("Weekly", "Weekly, live"); null for a whole station. */
  programFormat: z.string().nullable().optional()
});
export type SponsorshipX = z.infer<typeof SponsorshipX>;
export const SponsorshipsX = z.array(SponsorshipX);

/** P16: one thing a business can sponsor near it. */
export const SponsorTarget = z.object({
  station: StationIdent,
  /** null: the whole station. */
  program: z.object({ id: Id, title: z.string() }).nullable(),
  /** "Saturdays at 9:00 pm, live", "Credited in every break, 24 hours", "Weekly". */
  schedule: z.string(),
  /** L1, for the sponsorship once it exists ("Weekly, live"). */
  programFormat: z.string().nullable(),
  minMonthlyMicros: Micros,
  /** null: the station set no limit. */
  maxSponsors: z.number().int().min(0).nullable(),
  sponsors: z.number().int().min(0),
  /** P17: the members' credit read after the sponsors ("members of Inland Beat"), or null. */
  membersCredit: z.string().nullable(),
  /** "In BEAT's breaks during the program". */
  where: z.string()
});
export type SponsorTarget = z.infer<typeof SponsorTarget>;

export const listSponsorTargets = endpoint({
  method: "GET",
  path: "/businesses/:businessId/sponsor-targets",
  auth: "user",
  summary: "P16 (proposed): stations and programs near the business that take sponsors, with the minimum and room",
  params: z.object({ businessId: Id }),
  response: z.object({ near: z.string().nullable(), targets: z.array(SponsorTarget) })
});

const Flag = CreditCheck.shape.flags.element;
export const CreditCheckX = CreditCheck.extend({
  /** P17: the part that passes, "who you are and where" ("A family coffee house on Orange Street in downtown Redlands"). */
  who: z.string().nullable().optional(),
  flags: z.array(Flag.extend({ /** P17: the words the flag names in its title ("the best"). */ quote: z.string().optional() }))
});
export type CreditCheckX = z.infer<typeof CreditCheckX>;
export type CreditFlag = CreditCheckX["flags"][number];

// ---- Production orders (P18, P19) ----

export const MakerX = spotsApi.listMakers.response.element.extend({
  /** P18: what this maker has made for this business ("Made your Fall menu spot"). */
  history: z.string().nullable().optional(),
  /** P18: what it's good at ("Food and kitchens", "Any category"). */
  specialty: z.string().nullable().optional()
});
export type MakerX = z.infer<typeof MakerX>;
export const MakersX = z.array(MakerX);

const Delivery = ProductionOrder.shape.deliveries.element;
export const OrderX = ProductionOrder.extend({
  deliveries: z.array(
    Delivery.extend({
      /** P19: the delivered file's length (the scrub bar's end). */
      durationMs: Millis.optional(),
      /** P19: the spot checks it passed ("length", "safe areas", "loudness", "captions"). */
      checksPassed: z.array(z.string()).optional()
    })
  ),
  /** P19 */
  quotedAt: Timestamp.nullable().optional(),
  /** P19: "approved September 22". */
  approvedAt: Timestamp.nullable().optional(),
  /** P19: what came back to the balance (cancelled after the delivery date, or refunded after review). */
  refundedMicros: Micros.optional()
});
export type OrderX = z.infer<typeof OrderX>;
export const OrdersX = z.array(OrderX);
