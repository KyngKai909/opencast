// The permission page's proposed fields and endpoints (docs/contract-requests.md), as optional
// extensions of network's PermissionPage. The viewer's mock fills them in; against the real API
// they're absent until the requests land, and the page falls back to what the contract has.
//
//   N4  The source platform ("from your Vimeo"), each work's group and noun, the page's grouped
//       summary ("6 skate films and 7 park session edits"), and the wording version recorded with
//       the answer.
//   B8  Stop from the link, and Claim now before there's a station. Blocking: the API has neither.

import { z } from "zod";
import { endpoint, Id, networkApi, PermissionPage, Timestamp } from "@opencast/contracts";

const Work = PermissionPage.shape.works.element.extend({
  groupLabel: z.string().nullable().optional(),
  noun: z.string().nullable().optional()
});

export const PermissionPageX = PermissionPage.extend({
  creator: PermissionPage.shape.creator.extend({
    sourcePlatform: z.enum(["youtube", "vimeo", "internet_archive", "instagram", "facebook", "soundcloud", "bandcamp", "other"]).optional()
  }),
  works: z.array(Work),
  /** N4: "6 skate films and 7 park session edits", and what's left out ("the shoe sponsor edit"). */
  summary: z.object({ included: z.string(), leftOut: z.string().nullable() }).nullable().optional(),
  /** The market's name, for "on the Inland Empire dial". */
  marketName: z.string().optional(),
  /** B8: stopped from the link. */
  stoppedAt: Timestamp.nullable().optional(),
  /** B8: a claim started from the link. */
  claim: z.object({ handoverId: Id, status: z.enum(["verifying", "approved", "waiting_period", "completed", "cancelled"]), startedAt: Timestamp }).nullable().optional()
});
export type PermissionPageX = z.infer<typeof PermissionPageX>;

const TokenParams = networkApi.getPermissionPage.params;

/** B8 (proposed): stop from the link. No account, like the yes. */
export const stopFromLink = endpoint({
  method: "POST",
  path: "/permission/:token/stop",
  auth: "public",
  summary: "B8 (proposed): stop the station from the permission link",
  params: TokenParams,
  response: PermissionPageX
});

/** B8 (proposed): claim from the link, before there's a station (then it's set up for them to run). */
export const claimFromLink = endpoint({
  method: "POST",
  path: "/permission/:token/claim",
  auth: "user",
  summary: "B8 (proposed): claim from the permission link, signed in, before or after the station exists",
  params: TokenParams,
  response: PermissionPageX
});
