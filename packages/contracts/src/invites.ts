// Invite codes (added 2026-10-07, the user's request): sign-ups are invite-only while the desk keeps
// `signups.invite_only` on, like Clubhouse while it grew. Everyone who's in can make a few codes
// (`signups.codes_per_person`, 10 to start), each good for one person; the desk makes its own in
// batches for the first people, any number of uses each. Someone signed in who isn't in yet can
// only redeem a code, sign out or delete the account; a team invite or the desk lets them in too.
// A code is 8 letters and digits with no look-alikes (no 0, O, 1, I or L), shown as XXXX-XXXX; any
// case, spaces or dashes are read the same. On the web, opencast's /join/XXXX-XXXX.

import { z } from "zod";
import { endpoint } from "./core.js";
import { Id, Timestamp } from "./common.js";
import { Me } from "./accounts.js";

export const InviteCode = z.string().trim().min(8).max(20);

/** Someone who came in with a code. */
export const InviteJoiner = z.object({ name: z.string().nullable(), at: Timestamp });

export const InviteCodeView = z.object({
  code: z.string(),
  /** `personal`: one of a person's own, one use. `internal`: the desk's. */
  kind: z.enum(["personal", "internal"]),
  note: z.string().nullable(),
  /** Null: no limit (the desk's only). */
  maxUses: z.number().int().nullable(),
  uses: z.number().int(),
  expiresAt: Timestamp.nullable(),
  revokedAt: Timestamp.nullable(),
  createdAt: Timestamp,
  /** Who came in with it, newest first (up to 50). */
  joined: z.array(InviteJoiner)
});
export type InviteCodeView = z.infer<typeof InviteCodeView>;

export const MyInvites = z.object({
  /** Whether sign-ups need a code now. While they don't, codes still work and still count. */
  inviteOnly: z.boolean(),
  /** How many codes the person may make in all (`signups.codes_per_person`). */
  allowance: z.number().int(),
  /** How many more they can make: a code taken back before anyone used it doesn't count. */
  left: z.number().int(),
  codes: z.array(InviteCodeView)
});
export type MyInvites = z.infer<typeof MyInvites>;

/** What a /join link's page shows before signing in. */
export const InviteCheck = z.object({
  usable: z.boolean(),
  /** Why it can't be used. */
  reason: z.enum(["unknown", "used", "revoked", "expired"]).nullable(),
  /** Who it's from: the person's name, or "Opencast" for the desk's. */
  from: z.string().nullable()
});
export type InviteCheck = z.infer<typeof InviteCheck>;

/** Someone signed in and waiting to be let in. */
export const InviteWaiting = z.object({ userId: Id, name: z.string().nullable(), email: z.string().nullable(), signedUpAt: Timestamp });

export const DeskInvites = z.object({
  inviteOnly: z.boolean(),
  codesPerPerson: z.number().int(),
  /** The desk's codes, newest first. */
  internal: z.array(InviteCodeView),
  /** Signed in and not let in yet, newest first (up to 200). */
  waiting: z.array(InviteWaiting),
  counts: z.object({
    /** Everyone in, and how they came in. */
    admitted: z.number().int(),
    byPersonalCode: z.number().int(),
    byInternalCode: z.number().int(),
    byTeamInvite: z.number().int(),
    byDesk: z.number().int(),
    waiting: z.number().int(),
    personalCodesMade: z.number().int()
  }),
  /** Whose codes brought the most people in. */
  topInviters: z.array(z.object({ name: z.string().nullable(), email: z.string().nullable(), joined: z.number().int() }))
});
export type DeskInvites = z.infer<typeof DeskInvites>;

const CodeParams = z.object({ code: InviteCode });

export const invitesApi = {
  check: endpoint({
    method: "GET",
    path: "/invite-codes/:code",
    auth: "public",
    summary: "Whether an invite code can be used, and who it's from, for its /join page (added 2026-10-07)",
    params: CodeParams,
    response: InviteCheck
  }),
  redeem: endpoint({
    method: "POST",
    path: "/invite-codes/:code/redeem",
    auth: "user",
    beforeAdmitted: true,
    summary:
      "Come in with an invite code (added 2026-10-07). 404 `invite_unknown`; 409 `invite_used` (no uses left), `invite_revoked`; 422 `invite_expired`. Someone already in gets their account back unchanged and the code isn't used.",
    params: CodeParams,
    response: Me
  }),
  mine: endpoint({
    method: "GET",
    path: "/me/invite-codes",
    auth: "user",
    summary: "The person's own invite codes, how many they can still make, and who came in with each (added 2026-10-07)",
    response: MyInvites
  }),
  make: endpoint({
    method: "POST",
    path: "/me/invite-codes",
    auth: "user",
    summary: "Make one invite code, good for one person (added 2026-10-07). 409 `no_invites_left` once the allowance is used.",
    response: InviteCodeView,
    status: 201
  }),
  takeBack: endpoint({
    method: "DELETE",
    path: "/me/invite-codes/:code",
    auth: "user",
    summary: "Take back one of your codes before anyone uses it; it goes back to what you can make (added 2026-10-07). 409 `invite_used` once used.",
    params: CodeParams,
    response: MyInvites
  }),
  desk: endpoint({
    method: "GET",
    path: "/admin/invite-codes",
    auth: "desk",
    summary: "Admins: invite-only on or off, the desk's codes, who's waiting to be let in, and how everyone came in (added 2026-10-07)",
    response: DeskInvites
  }),
  deskMake: endpoint({
    method: "POST",
    path: "/admin/invite-codes",
    auth: "desk",
    summary: "Admins: make a batch of the desk's codes (added 2026-10-07)",
    body: z.object({
      count: z.number().int().min(1).max(100),
      /** Null: any number of people. */
      maxUses: z.number().int().min(1).max(10_000).nullable(),
      note: z.string().trim().max(200).nullable(),
      expiresAt: Timestamp.nullable()
    }),
    response: z.array(InviteCodeView),
    status: 201
  }),
  deskRevoke: endpoint({
    method: "DELETE",
    path: "/admin/invite-codes/:code",
    auth: "desk",
    summary: "Admins: stop any code working (the desk's or a person's); who came in with it stays in (added 2026-10-07)",
    params: CodeParams,
    response: DeskInvites
  }),
  letIn: endpoint({
    method: "POST",
    path: "/admin/invite-codes/let-in",
    auth: "desk",
    summary: "Admins: let someone waiting in without a code (added 2026-10-07)",
    body: z.object({ userId: Id }),
    response: DeskInvites
  })
};
