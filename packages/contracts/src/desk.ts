// Network desk Settings (added 2026-09-29, follow-up Phase 0 item 11, desk-pages 04): the team and
// its desk roles, the rules registry every module reads, each market's numbering, escrow signer
// changes that need the other admins' approval, and the change log. Every endpoint is `desk`: anyone
// on the Opencast team reads; only admins change anything (403 `desk_role` otherwise).

import { z } from "zod";
import { endpoint } from "./core.js";
import { DateOnly, Id, Market, Timestamp } from "./common.js";
import { storageMaintenanceApi } from "./storageMaintenance.js";

/** A Network desk role. Admin is the account's admin flag (and OPENCAST_ADMIN_EMAILS), as before. */
export const DeskRole = z.enum(["admin", "rights_reviewer", "market_lead"]);
export type DeskRole = z.infer<typeof DeskRole>;
export const DESK_ROLE_LABELS = { admin: "Admin", rights_reviewer: "Rights reviewer", market_lead: "Market lead" } as const;

/** One role someone holds. A market lead's is for one market; the others are Opencast-wide (market null). */
export const DeskRoleGrant = z.object({ role: DeskRole, market: Market.nullable() });
export type DeskRoleGrant = z.infer<typeof DeskRoleGrant>;

/** Someone named on the desk: who set a rule, who checked an item. */
export const DeskPerson = z.object({ userId: Id, name: z.string() });
export type DeskPerson = z.infer<typeof DeskPerson>;

export const TeamPerson = z.object({
  userId: Id,
  name: z.string(),
  email: z.string().nullable(),
  roles: z.array(DeskRoleGrant),
  /** Made an admin by OPENCAST_ADMIN_EMAILS: taking admin away here doesn't stick while they're listed there. */
  adminByEmail: z.boolean(),
  you: z.boolean()
});
export type TeamPerson = z.infer<typeof TeamPerson>;

export const DeskTeam = z.object({
  people: z.array(TeamPerson),
  /** The caller is an admin, so can change roles. */
  canEdit: z.boolean()
});
export type DeskTeam = z.infer<typeof DeskTeam>;

/** A role to give: a market lead's needs its market. */
export const RoleInput = z
  .object({ role: DeskRole, marketId: Id.optional() })
  .refine((r) => (r.role === "market_lead") === !!r.marketId, { message: "A market lead needs a market, and only a market lead has one", path: ["marketId"] });

/**
 * Where a rule sits on the Rules page. `watch_data` and `features` added 2026-09-29 (follow-up
 * Phase 1: how long watch data is kept, the minimum audience, and the "Not for me" flag).
 */
export const RuleGroup = z.enum(["pay_as_you_go", "shares", "rights", "relays", "numbering", "escrow", "call_signs", "sponsors", "watch_data", "features", "external", "costs"]);
export type RuleGroup = z.infer<typeof RuleGroup>;

/** One version of a rule: its value from a date. */
export const RuleVersion = z.object({
  id: Id,
  /** Typed JSON, checked against the rule's definition (the API's rules registry). */
  value: z.unknown(),
  /** The value in words, as the Rules page shows it ("10 GB, 5 live hours", "Not set yet"). */
  display: z.string(),
  /** False while it's an Open rule nobody has decided ("Not set yet"). */
  set: z.boolean(),
  effectiveFrom: Timestamp,
  /** Null: set by the migration that started the registry (the value in effect before it). */
  setBy: DeskPerson.nullable(),
  note: z.string().nullable(),
  createdAt: Timestamp
});
export type RuleVersion = z.infer<typeof RuleVersion>;

export const RuleView = z.object({
  key: z.string(),
  /** '' for an Opencast-wide rule; a market's id for a per-market one (numbering). */
  scope: z.string(),
  group: RuleGroup,
  title: z.string(),
  detail: z.string(),
  /** The version in effect at `at` (now, unless asked). */
  current: RuleVersion,
  /** The next version already set to take effect, if any. */
  next: RuleVersion.nullable(),
  /** What a value looks like, for the edit form: the JSON Schema of the rule's value. */
  valueSchema: z.record(z.string(), z.unknown())
});
export type RuleView = z.infer<typeof RuleView>;

export const RuleList = z.object({ at: Timestamp, rules: z.array(RuleView), canEdit: z.boolean() });
export type RuleList = z.infer<typeof RuleList>;

/** The value of a rule at a moment ("the value at time T"). */
export const RuleValueAt = z.object({ key: z.string(), scope: z.string(), at: Timestamp, value: z.unknown(), effectiveFrom: Timestamp, versionId: Id });
export type RuleValueAt = z.infer<typeof RuleValueAt>;

/** `storage` added 2026-09-29: each apply of a storage job (Settings, Storage maintenance). */
export const ChangeKind = z.enum(["rule", "role", "signer", "storage"]);
export const ChangeLogEntry = z.object({
  id: Id,
  at: Timestamp,
  /** Null: a migration, or a write bridged from the old tables. */
  by: DeskPerson.nullable(),
  kind: ChangeKind,
  subject: z.string(),
  scope: z.string(),
  summary: z.string(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  effectiveFrom: Timestamp.nullable(),
  note: z.string().nullable()
});
export type ChangeLogEntry = z.infer<typeof ChangeLogEntry>;

/** A market's numbering ranges: TV majors (each with its subchannels), and the radio band in even tenths. */
export const Numbering = z.object({
  tv: z.object({ firstMajor: z.number().int().min(2).max(69), lastMajor: z.number().int().min(2).max(69) }),
  radio: z.object({ firstTenths: z.number().int().min(882).max(1078), lastTenths: z.number().int().min(882).max(1078) })
});
export type Numbering = z.infer<typeof Numbering>;

export const MarketNumbering = z.object({
  market: Market,
  numbering: Numbering,
  /** "TV 2 to 69, with subchannels"; "Radio 88.2 to 107.8, even tenths". */
  tvLine: z.string(),
  radioLine: z.string(),
  /** Set for this market; otherwise it follows the Opencast-wide numbering. */
  own: z.boolean(),
  effectiveFrom: Timestamp,
  next: z.object({ numbering: Numbering, effectiveFrom: Timestamp }).nullable()
});
export type MarketNumbering = z.infer<typeof MarketNumbering>;

export const SignerProposalKind = z.enum(["add", "remove", "replace", "threshold"]);
export const SignerProposal = z.object({
  id: Id,
  kind: SignerProposalKind,
  oldAddress: z.string().nullable(),
  newAddress: z.string().nullable(),
  signersAfter: z.array(z.string()),
  thresholdAfter: z.number().int(),
  note: z.string().nullable(),
  proposedBy: DeskPerson,
  proposedAt: Timestamp,
  status: z.enum(["open", "approved", "refused", "withdrawn"]),
  /** Every other admin when it was proposed, and what each said. */
  approvals: z.array(z.object({ admin: DeskPerson, decision: z.enum(["approve", "refuse"]).nullable(), at: Timestamp.nullable(), note: z.string().nullable() })),
  decidedAt: Timestamp.nullable(),
  /** The caller is one of the admins it waits on. */
  canDecide: z.boolean(),
  /** The caller proposed it and it's still open. */
  canWithdraw: z.boolean()
});
export type SignerProposal = z.infer<typeof SignerProposal>;

export const EscrowSigners = z.object({
  /** Where the list comes from: the contract (`keys()`, `threshold()`), configuration (ESCROW_VERIFIERS, ESCROW_THRESHOLD), or nothing yet. Read-only here. */
  source: z.enum(["contract", "config", "none"]),
  contract: z.string().nullable(),
  signers: z.array(z.string()),
  threshold: z.number().int().nullable(),
  /** The last change approved here, waiting for the timelock to make it on-chain (contracts/README.md). */
  approved: SignerProposal.nullable(),
  proposals: z.array(SignerProposal),
  canPropose: z.boolean()
});
export type EscrowSigners = z.infer<typeof EscrowSigners>;

const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "An address: 0x and 40 hex digits");

export const deskApi = {
  getTeam: endpoint({ method: "GET", path: "/admin/desk/team", auth: "desk", summary: "The Opencast team and their desk roles", response: DeskTeam }),
  addTeamMember: endpoint({
    method: "POST",
    path: "/admin/desk/team",
    auth: "desk",
    summary: "Gives someone with an Opencast account desk roles, by their email (admins only)",
    body: z.object({ email: z.email(), roles: z.array(RoleInput).min(1) }),
    response: DeskTeam,
    status: 200
  }),
  setTeamRoles: endpoint({
    method: "PUT",
    path: "/admin/desk/team/:userId",
    auth: "desk",
    summary: "Sets someone's desk roles; none takes them off the team (admins only)",
    params: z.object({ userId: Id }),
    body: z.object({ roles: z.array(RoleInput), note: z.string().max(500).optional() }),
    response: DeskTeam
  }),

  listRules: endpoint({
    method: "GET",
    path: "/admin/rules",
    auth: "desk",
    summary: "Every rule with its value (now, or at `at`) and the next change set",
    query: z.object({ at: Timestamp.optional(), scope: z.string().optional() }),
    response: RuleList
  }),
  ruleValue: endpoint({
    method: "GET",
    path: "/admin/rules/:key/value",
    auth: "desk",
    summary: "A rule's value at a moment",
    params: z.object({ key: z.string() }),
    query: z.object({ at: Timestamp.optional(), scope: z.string().optional() }),
    response: RuleValueAt
  }),
  ruleVersions: endpoint({
    method: "GET",
    path: "/admin/rules/:key/versions",
    auth: "desk",
    summary: "Every version of a rule, past and future, newest first",
    params: z.object({ key: z.string() }),
    query: z.object({ scope: z.string().optional() }),
    response: z.array(RuleVersion)
  }),
  setRule: endpoint({
    method: "POST",
    path: "/admin/rules/:key/versions",
    auth: "desk",
    summary: "A new value from a date, never before today (admins only). The old value stays in the change log",
    params: z.object({ key: z.string() }),
    body: z.object({ value: z.unknown(), effectiveFrom: z.union([DateOnly, Timestamp]), scope: z.string().optional(), note: z.string().max(500).optional() }),
    response: RuleView
  }),
  changeLog: endpoint({
    method: "GET",
    path: "/admin/change-log",
    auth: "desk",
    summary: "Every change made in Settings, newest first",
    query: z.object({ kind: ChangeKind.optional(), limit: z.coerce.number().int().min(1).max(500).optional() }),
    response: z.array(ChangeLogEntry)
  }),

  listNumbering: endpoint({ method: "GET", path: "/admin/numbering", auth: "desk", summary: "Each market's numbering ranges", response: z.array(MarketNumbering) }),

  getSigners: endpoint({ method: "GET", path: "/admin/escrow/signers", auth: "desk", summary: "The escrow's verifier keys (read-only), and changes proposed here", response: EscrowSigners }),
  proposeSignerChange: endpoint({
    method: "POST",
    path: "/admin/escrow/signer-proposals",
    auth: "desk",
    summary: "Proposes a change to the verifier keys; every other admin has to approve it (admins only)",
    body: z.object({ kind: SignerProposalKind, oldAddress: Address.optional(), newAddress: Address.optional(), threshold: z.number().int().min(1).optional(), note: z.string().max(500).optional() }),
    response: SignerProposal
  }),
  decideSignerChange: endpoint({
    method: "POST",
    path: "/admin/escrow/signer-proposals/:proposalId/decision",
    auth: "desk",
    summary: "Approves or refuses a proposed signer change (the other admins only)",
    params: z.object({ proposalId: Id }),
    body: z.object({ decision: z.enum(["approve", "refuse"]), note: z.string().max(500).optional() }),
    response: SignerProposal,
    status: 200
  }),
  withdrawSignerChange: endpoint({
    method: "POST",
    path: "/admin/escrow/signer-proposals/:proposalId/withdraw",
    auth: "desk",
    summary: "Withdraws your own open proposal",
    params: z.object({ proposalId: Id }),
    response: SignerProposal,
    status: 200
  }),

  // Storage maintenance (added 2026-09-29), admins only: storageMaintenance.ts.
  ...storageMaintenanceApi
} as const;
