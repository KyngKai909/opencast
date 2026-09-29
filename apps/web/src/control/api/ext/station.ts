// Fields and endpoints the Station area (settings, translators, rights, the switcher, claiming a
// station) needs that the contracts don't have yet, as optional extensions (see ../ext.ts for the
// pattern). Each names its request in docs/contract-requests.md. Against the real API the fields
// are absent until the request lands, and the screens hide what depends on them.

import { accountsApi, endpoint, Id, Micros, StationIdent, Timestamp, trustApi } from "@opencast/contracts";
import { Claim } from "@opencast/contracts";
import { z } from "zod";

// ---- accounts ----

/**
 * A5: on air and needs attention per station you're on, for the switcher ("Operator. On air",
 * "Dead air in 40 min"). Proposed as its own read, so the switcher needn't fan out a playout
 * status and a dead-air check per station; it could as well ride on `Me.memberships[]`.
 */
export const StationStatusX = z.object({
  stationId: Id,
  onAir: z.boolean(),
  /** When the next dead air starts, if it's within the next few hours. */
  deadAirAt: Timestamp.nullable()
});
export type StationStatusX = z.infer<typeof StationStatusX>;

/** A4: which live blocks (program ids) an invited host will host. */
export const InviteBodyX = accountsApi.inviteToStation.body.extend({ programIds: z.array(Id).optional() });
export type InviteBodyX = z.infer<typeof InviteBodyX>;

// ---- trust ----

const Takedown = Claim.shape.takedowns.element;

/** T1: each pulled airing's time and what replaced it; the carrier's deal ("Carries on barter"). */
export const TakedownX = Takedown.extend({
  airings: z.array(z.object({ startsAt: Timestamp, replacedWith: z.string().nullable() })).optional(),
  term: z.enum(["cash", "barter"]).nullable().optional()
});
export type TakedownX = z.infer<typeof TakedownX>;

/**
 * T1: what carriers were told. T4 (new): the claimed thing as a noun ("recording"), for the
 * claim's heading and the list ("says they own this recording", "Claim: the recording is theirs").
 */
export const ClaimX = Claim.extend({
  takedowns: z.array(TakedownX),
  carrierNotice: z.string().nullable().optional(),
  workNoun: z.string().nullable().optional()
});
export type ClaimX = z.infer<typeof ClaimX>;

export const ClaimsX = trustApi.listClaims.response.extend({ claims: z.array(ClaimX) });
export type ClaimsX = z.infer<typeof ClaimsX>;

// ---- network ----

/** N10: the creator's claim page (rights 05.1), public by its link, and the handover's status after starting. */
export const ClaimPageX = z.object({
  station: StationIdent,
  /** Who it's for: "Marcus Reyes". */
  personName: z.string(),
  /** "You said yes on August 12." */
  saidYesAt: Timestamp,
  /** "a radio station of your mixes and producer interviews". */
  works: z.string(),
  /** "your mixes": what the source account holds, in the creator's words. */
  worksShort: z.string(),
  sourcePlatform: z.enum(["youtube", "vimeo", "internet_archive", "instagram", "facebook", "soundcloud", "bandcamp", "other"]),
  onAirSince: Timestamp.nullable(),
  /** Listeners with the station as a preset: the creator counts as the station's own (inventory, raise list). */
  presetCount: z.number().int(),
  heldMicros: Micros,
  escrowContract: z.string().nullable(),
  escrowStationId: z.number().int(),
  handover: z
    .object({
      handoverId: Id,
      kind: z.enum(["claim", "stop"]),
      status: z.enum(["verifying", "approved", "waiting_period", "completed", "cancelled"]),
      payableAfter: Timestamp.nullable()
    })
    .nullable()
});
export type ClaimPageX = z.infer<typeof ClaimPageX>;

export const stationExtApi = {
  myStationStatus: endpoint({
    method: "GET",
    path: "/me/stations/status",
    auth: "user",
    summary: "A5: on air and the next dead air, for each station you're on",
    response: z.array(StationStatusX)
  }),
  attachToClaim: endpoint({
    method: "POST",
    path: "/claims/:claimId/attachments",
    auth: "user",
    summary: "B6: upload the permission or licence that backs an answer; returns the attachmentUrl answerClaim takes",
    params: z.object({ claimId: Id }),
    multipart: true,
    response: z.object({ attachmentUrl: z.string(), fileName: z.string() }),
    status: 201
  }),
  getClaimPage: endpoint({
    method: "GET",
    path: "/claim/:token",
    auth: "public",
    summary: "N10: the creator's claim page, and the handover's status once started",
    params: z.object({ token: z.string().min(8) }),
    response: ClaimPageX
  })
};

// ---- stations ----

/**
 * S17 (interim): the spot categories a station can block, until the API lists them. The same words
 * the spot market filters by.
 */
export const SPOT_CATEGORIES = ["Alcohol", "Gambling", "Cannabis", "Political", "Payday loans", "Vaping"] as const;

// ---- notifications ----

/** O1: "Signed on, signed off" has no NoticeKind yet; its preference is kept under this key. */
export const SIGNED_ON_OFF = "signed_on_off";
