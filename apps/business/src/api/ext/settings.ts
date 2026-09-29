// Fields and endpoints the Settings area (the profile, money and receipts, connections, closing
// the account) needs that the contracts don't have yet, as optional extensions (see ../ext.ts for
// the pattern). Each names its request in docs/contract-requests.md. Against the real API the
// fields are absent and the endpoints 404 until the request lands; the screens hide what depends
// on them.

import { Business, endpoint, FundingSource, Id, Micros, Timestamp } from "@opencast/contracts";
import { z } from "zod";

const BusinessParams = z.object({ businessId: Id });

/**
 * P20: what the business is connected to (biz-settings 04.1): Clear Pay and an online checkout,
 * which have no fields or endpoints yet. The Clear account itself is the person's (`Me.clear`,
 * linked with Connect Clear), and becomes a funding source through `ledger.addFundingSource`.
 */
export const ConnectionsX = z.object({
  clearPay: z.object({ connected: z.boolean() }),
  checkout: z.object({ connected: z.boolean(), provider: z.enum(["shopify", "stripe", "square"]).nullable() })
});
export type ConnectionsX = z.infer<typeof ConnectionsX>;

// ---- ledger ----

/**
 * E4: every receipt and statement (biz-settings 03.1): money added is a prepayment; airings,
 * sponsorships and orders are expenses; the statement is the document for the books.
 */
export const ReceiptX = z.object({
  id: Id,
  kind: z.enum(["prepayment", "expense", "statement"]),
  /** "September statement", "Production order", "Money added". */
  title: z.string(),
  /** "118 airings, 1 sponsorship", "Holiday gift cards, BEAT, held", "Bank transfer through Clear". */
  detail: z.string().nullable(),
  amountMicros: Micros,
  at: Timestamp,
  pdfUrl: z.string()
});
export type ReceiptX = z.infer<typeof ReceiptX>;

export const settingsExtApi = {
  /** P11: the logo (biz-settings 01.1 "Replace"). Square, at least 256 pixels. */
  uploadLogo: endpoint({
    method: "POST",
    path: "/businesses/:businessId/logo",
    auth: "user",
    summary: "P11: upload the business's logo (square, at least 256 pixels); returns the business with its logoUrl",
    params: BusinessParams,
    multipart: true,
    response: Business
  }),
  /**
   * P26 (new): change a location in place (the profile's address field; a location becoming a
   * service area). Only add and remove exist, and adding puts it last, so the business's first
   * place would move.
   */
  updateLocation: endpoint({
    method: "PATCH",
    path: "/businesses/:businessId/locations/:locationId",
    auth: "user",
    summary: "P26: change a location or service area in place",
    params: z.object({ businessId: Id, locationId: Id }),
    body: z
      .object({
        kind: z.enum(["location", "service_area"]),
        label: z.string().max(80).nullable(),
        streetAddress: z.string().max(200).nullable(),
        city: z.string().min(1).max(80),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        radiusMiles: z.number().positive().max(200).nullable()
      })
      .partial(),
    response: Business
  }),
  /** P21: close the account (owner only). */
  closeBusiness: endpoint({
    method: "POST",
    path: "/businesses/:businessId/close",
    auth: "user",
    summary: "P21: close a business account (owner only): spots come out of rotation, the available balance goes back to the default source",
    params: BusinessParams,
    body: z.object({ confirmName: z.string() }),
    response: z.object({ closedAt: Timestamp, returnedMicros: Micros, heldMicros: Micros })
  }),
  /** P20. */
  getConnections: endpoint({
    method: "GET",
    path: "/businesses/:businessId/connections",
    auth: "user",
    summary: "P20: Clear Pay and an online checkout",
    params: BusinessParams,
    response: ConnectionsX
  }),
  /** P20: Clear Pay and an online checkout (Clear itself is Connect Clear: accounts.linkClear). */
  connect: endpoint({
    method: "POST",
    path: "/businesses/:businessId/connections/:kind",
    auth: "user",
    summary: "P20: connect Clear Pay or an online checkout (owner only). The token comes from the provider's own flow.",
    params: z.object({ businessId: Id, kind: z.enum(["clear_pay", "checkout"]) }),
    body: z.object({ token: z.string().min(1), provider: z.enum(["shopify", "stripe", "square"]).optional() }),
    response: ConnectionsX
  }),
  /** E4. */
  listReceipts: endpoint({
    method: "GET",
    path: "/businesses/:businessId/receipts",
    auth: "user",
    summary: "E4: every receipt and statement, newest first, each with a PDF",
    params: BusinessParams,
    response: z.array(ReceiptX)
  }),
  /** E5. */
  removeFundingSource: endpoint({
    method: "DELETE",
    path: "/businesses/:businessId/funding-sources/:sourceId",
    auth: "user",
    summary: "E5: remove a funding source (owner only). The default can't be removed while it's the only one.",
    params: z.object({ businessId: Id, sourceId: Id }),
    response: z.array(FundingSource)
  }),
  /** E5. */
  makeDefaultFundingSource: endpoint({
    method: "POST",
    path: "/businesses/:businessId/funding-sources/:sourceId/default",
    auth: "user",
    summary: "E5: make a funding source the default (owner only)",
    params: z.object({ businessId: Id, sourceId: Id }),
    response: z.array(FundingSource)
  })
};
