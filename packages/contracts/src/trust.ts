import { z } from "zod";
import { endpoint } from "./core.js";
import { Id, Millis, StationIdent, Timestamp } from "./common.js";
import { ClaimState } from "./states.js";

export const Claim = z.object({
  id: Id,
  item: z.object({ id: Id, title: z.string() }),
  station: StationIdent,
  claimantName: z.string(),
  claimantRole: z.string().nullable(),
  /** Stations don't see the claimant's contact; it goes through Opencast. */
  workKind: z.string().nullable(),
  claimText: z.string(),
  rangeStartMs: Millis.nullable(),
  rangeEndMs: Millis.nullable(),
  swornStatement: z.boolean(),
  state: ClaimState,
  receivedAt: Timestamp,
  answerDueAt: Timestamp,
  daysToAnswer: z.number().int().nullable(),
  answer: z
    .object({ basis: z.string(), note: z.string().nullable(), attachmentUrl: z.string().nullable(), answeredAt: Timestamp, claimantReplyDueAt: Timestamp })
    .nullable(),
  takedowns: z.array(
    z.object({
      station: StationIdent,
      pulledAt: Timestamp,
      airingsReplaced: z.number().int(),
      replacedWith: z.string().nullable(),
      restoredAt: Timestamp.nullable()
    })
  )
});

export const Standing = z.object({
  status: z.enum(["good", "offers_paused"]),
  openClaims: z.number().int(),
  upheldLast12Months: z.number().int(),
  /** Placeholder: 3 upheld in a year pauses carriage offers. */
  threshold: z.number().int()
});

export const trustApi = {
  fileClaim: endpoint({
    method: "POST",
    path: "/claims",
    auth: "public",
    summary: "A rights holder files a claim. The item goes off air at once, everywhere it's carried.",
    body: z.object({
      itemId: Id,
      claimantName: z.string().min(1).max(200),
      claimantRole: z.string().max(200).optional(),
      claimantContact: z.string().min(3).max(200),
      workKind: z.string().max(200).optional(),
      claimText: z.string().min(1).max(5000),
      rangeStartMs: Millis.optional(),
      rangeEndMs: Millis.optional(),
      swornStatement: z.literal(true)
    }),
    response: z.object({ claimId: Id, answerDueAt: Timestamp }),
    status: 201
  }),
  listClaims: endpoint({
    method: "GET",
    path: "/stations/:stationId/claims",
    auth: "user",
    summary: "Claims against this station's items, and its standing",
    params: z.object({ stationId: Id }),
    response: z.object({ claims: z.array(Claim), standing: Standing })
  }),
  answerClaim: endpoint({
    method: "POST",
    path: "/claims/:claimId/answer",
    auth: "user",
    summary: "Answer with a rights basis and an attestation. The item airs again; the claimant has 10 business days to respond.",
    params: z.object({ claimId: Id }),
    body: z.object({
      basis: z.enum(["made_it", "owner_permission", "public_domain"]),
      note: z.string().max(2000).optional(),
      attachmentUrl: z.string().optional(),
      attest: z.literal(true)
    }),
    response: Claim
  }),
  removeClaimedItem: endpoint({
    method: "POST",
    path: "/claims/:claimId/remove",
    auth: "user",
    summary: "Take the item down instead of answering",
    params: z.object({ claimId: Id }),
    response: Claim
  }),
  resolveClaim: endpoint({
    method: "POST",
    path: "/claims/:claimId/resolve",
    auth: "admin",
    summary: "Opencast records the outcome: upheld, withdrawn or restored",
    params: z.object({ claimId: Id }),
    body: z.object({ outcome: z.enum(["upheld", "withdrawn", "restored"]) }),
    response: Claim
  })
};

export type Claim = z.infer<typeof Claim>;
export type Standing = z.infer<typeof Standing>;
