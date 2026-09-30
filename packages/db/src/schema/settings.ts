import { sql } from "drizzle-orm";
import { bigint, check, index, integer, jsonb, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { at, createdAt, id } from "./columns.js";
import { network } from "./namespaces.js";
import { markets } from "./network.js";
import { users } from "./accounts.js";

// Network desk's Settings (added 2026-09-29, follow-up Phase 0 item 11): the team's desk roles, the
// rules registry every module reads ("the value at time T"), escrow signer changes that need the
// other admins' approval, and one change log for all of them.

/**
 * A desk role besides admin. Admin is `accounts.users.is_admin` (and OPENCAST_ADMIN_EMAILS), as it
 * always was; these add rights reviewers (the catalog's second check, claims) and market leads (the
 * pipeline and reservations in one market). Removing one keeps the row, with who and when.
 */
export const deskRoles = network.table(
  "desk_roles",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", { enum: ["rights_reviewer", "market_lead"] }).notNull(),
    /** A market lead's market; null for a rights reviewer. */
    marketId: uuid("market_id").references(() => markets.id),
    grantedBy: uuid("granted_by").references(() => users.id),
    grantedAt: at("granted_at").notNull().defaultNow(),
    removedBy: uuid("removed_by").references(() => users.id),
    removedAt: at("removed_at")
  },
  (t) => [
    check("desk_role_kind", sql`${t.role} in ('rights_reviewer', 'market_lead')`),
    check("market_lead_has_market", sql`(${t.role} = 'market_lead') = (${t.marketId} is not null)`),
    uniqueIndex("desk_roles_one_active").on(t.userId, t.role, sql`coalesce(${t.marketId}, '00000000-0000-0000-0000-000000000000'::uuid)`).where(sql`${t.removedAt} is null`)
  ]
);

/**
 * The rules registry: every Open rule, each version with the date it takes effect. The value at a
 * moment is the latest version whose `effective_from` is at or before it (the latest set, on a
 * tie). Past and future versions stay. `scope` is '' for Opencast-wide rules, a market's id for
 * per-market ones (numbering). `value` is JSON checked against the rule's definition in the API.
 */
export const rules = network.table(
  "rules",
  {
    id: id(),
    key: text("key").notNull(),
    scope: text("scope").notNull().default(""),
    value: jsonb("value").notNull(),
    effectiveFrom: at("effective_from").notNull(),
    /** Null: set by a migration (the values in effect before the registry). */
    setBy: uuid("set_by").references(() => users.id),
    note: text("note"),
    createdAt: createdAt()
  },
  (t) => [index("rules_key_scope_from").on(t.key, t.scope, t.effectiveFrom), check("rule_key_format", sql`${t.key} ~ '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$'`)]
);

/** Every change made in Settings: rules, team roles, escrow signer proposals and approvals. */
export const changeLog = network.table(
  "change_log",
  {
    id: id(),
    /** Order among changes made at the same moment (one approval can make two). */
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    at: at("at").notNull().defaultNow(),
    /** Null: a migration. */
    by: uuid("by").references(() => users.id),
    kind: text("kind", { enum: ["rule", "role", "signer"] }).notNull(),
    /** The rule's key, the person's id, or the signer proposal's id. */
    subject: text("subject").notNull(),
    scope: text("scope").notNull().default(""),
    /** One line, as the change log shows it. */
    summary: text("summary").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    effectiveFrom: at("effective_from"),
    note: text("note")
  },
  (t) => [check("change_kind", sql`${t.kind} in ('rule', 'role', 'signer')`), index("change_log_at").on(t.at)]
);

/**
 * A change to the escrow's verifier keys, proposed in Settings. It takes effect here only when every
 * other admin (as of the proposal) has approved it; any one of them can refuse it. Keys change
 * on-chain only through the timelock (contracts/README.md); the approved change is what's handed to it.
 */
export const signerProposals = network.table(
  "signer_proposals",
  {
    id: id(),
    kind: text("kind", { enum: ["add", "remove", "replace", "threshold"] }).notNull(),
    /** The key going (remove, replace). */
    oldAddress: text("old_address"),
    /** The key coming (add, replace). */
    newAddress: text("new_address"),
    /** Approvals needed on-chain after the change (threshold; optional otherwise). */
    threshold: integer("threshold"),
    /** The whole set after the change, as proposed. */
    signersAfter: jsonb("signers_after").$type<string[]>().notNull(),
    thresholdAfter: integer("threshold_after").notNull(),
    note: text("note"),
    proposedBy: uuid("proposed_by")
      .notNull()
      .references(() => users.id),
    proposedAt: at("proposed_at").notNull().defaultNow(),
    /** The other admins when it was proposed: every one of them has to approve. */
    approvers: jsonb("approvers").$type<string[]>().notNull(),
    status: text("status", { enum: ["open", "approved", "refused", "withdrawn"] }).notNull().default("open"),
    decidedAt: at("decided_at")
  },
  (t) => [
    check("signer_kind", sql`${t.kind} in ('add', 'remove', 'replace', 'threshold')`),
    check("signer_status", sql`${t.status} in ('open', 'approved', 'refused', 'withdrawn')`),
    check("signer_addresses", sql`(${t.kind} in ('remove', 'replace')) = (${t.oldAddress} is not null) and (${t.kind} in ('add', 'replace')) = (${t.newAddress} is not null)`),
    check("signer_threshold_after", sql`${t.thresholdAfter} >= 1 and ${t.thresholdAfter} <= jsonb_array_length(${t.signersAfter})`)
  ]
);

export const signerApprovals = network.table(
  "signer_approvals",
  {
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => signerProposals.id),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => users.id),
    decision: text("decision", { enum: ["approve", "refuse"] }).notNull(),
    note: text("note"),
    at: at("at").notNull().defaultNow()
  },
  (t) => [primaryKey({ columns: [t.proposalId, t.adminId] }), check("signer_decision", sql`${t.decision} in ('approve', 'refuse')`)]
);
