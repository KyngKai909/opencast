// Network desk Settings (added 2026-09-29): the team's desk roles, the rules registry ("the value
// at time T", read by the ledger, trust and stations), each market's numbering, escrow signer
// changes that need every other admin's approval, and the change log. Owns network.desk_roles,
// network.rules, network.change_log, network.signer_proposals and network.signer_approvals.

import { and, asc, desc, eq, inArray, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@opencast/db";
import type { ChangeLogEntry, DeskPerson, DeskRoleGrant, DeskTeam, EscrowSigners, Market, MarketNumbering, Numbering, RuleList, RuleValueAt, RuleVersion, RuleView, SignerProposal } from "@opencast/contracts";
import type { Executor, ModuleContext } from "../../context.js";
import type { CurrentUser } from "../../http.js";
import { badRequest, conflict, forbidden, HttpError, notFound, refused } from "../../errors.js";
import { isRuleKey, RULE_KEYS, ruleDef, RULES, type RuleKey, type RuleValue } from "./rules.js";

/** What an action needs: an admin, a rights reviewer (or admin), or a market's lead (or admin). */
export type DeskNeed = "admin" | "rights" | { market: string };

export interface SettingsService {
  /** Holds any desk role besides admin (admins are on the team by their flag). */
  onTeam(userId: string): Promise<boolean>;
  rolesOf(user: { id: string; isAdmin: boolean }): Promise<DeskRoleGrant[]>;
  /** Throws 403 `desk_role` unless the user may do what `need` says. */
  requireDesk(user: CurrentUser, need: DeskNeed): Promise<void>;
  /** Whether the user may (no throw). */
  mayDesk(user: CurrentUser, need: DeskNeed): Promise<boolean>;
  team(user: CurrentUser): Promise<DeskTeam>;
  addTeamMember(user: CurrentUser, input: { email: string; roles: Array<{ role: DeskRoleGrant["role"]; marketId?: string }> }): Promise<DeskTeam>;
  setTeamRoles(user: CurrentUser, userId: string, input: { roles: Array<{ role: DeskRoleGrant["role"]; marketId?: string }>; note?: string }): Promise<DeskTeam>;

  /** The rule's value at a moment (now by default). Per-market rules: the market's own versions, else Opencast-wide. */
  valueAt<K extends RuleKey>(key: K, at?: Date, scope?: string): Promise<RuleValue<K>>;
  listRules(user: CurrentUser, at?: Date, scope?: string): Promise<RuleList>;
  ruleValue(key: string, at?: Date, scope?: string): Promise<RuleValueAt>;
  ruleVersions(key: string, scope?: string): Promise<RuleVersion[]>;
  setRule(user: CurrentUser, key: string, input: { value: unknown; effectiveFrom: string; scope?: string; note?: string }): Promise<RuleView>;
  changeLog(filter: { kind?: "rule" | "role" | "signer"; limit?: number }): Promise<ChangeLogEntry[]>;
  /** Records a change made elsewhere (the catalog's rebuilds are not; they have their own record). */
  logChange(db: Executor, entry: { by: string | null; kind: "rule" | "role" | "signer"; subject: string; scope?: string; summary: string; before?: unknown; after?: unknown; effectiveFrom?: Date | null; note?: string | null }): Promise<void>;

  numbering(): Promise<MarketNumbering[]>;
  numberingFor(marketId: string, at?: Date): Promise<Numbering>;

  signers(user: CurrentUser): Promise<EscrowSigners>;
  proposeSigner(user: CurrentUser, input: { kind: SignerProposal["kind"]; oldAddress?: string; newAddress?: string; threshold?: number; note?: string }): Promise<SignerProposal>;
  decideSigner(user: CurrentUser, proposalId: string, input: { decision: "approve" | "refuse"; note?: string }): Promise<SignerProposal>;
  withdrawSigner(user: CurrentUser, proposalId: string): Promise<SignerProposal>;
}

/** A rule with no version at all reads its fallback, under this id. */
const FALLBACK_ID = "00000000-0000-4000-8000-000000000000";

const ROLE_WORDS = { admin: "an admin", rights_reviewer: "a rights reviewer", market_lead: "market lead" } as const;

const deskRole = (message: string) => new HttpError(403, "desk_role", message);

export function createSettingsService({ deps, services }: ModuleContext): SettingsService {
  const { db } = deps;
  const R = schema.rules;
  const DR = schema.deskRoles;
  const CL = schema.changeLog;
  const SP = schema.signerProposals;
  const SA = schema.signerApprovals;

  async function people(ids: Array<string | null | undefined>): Promise<Map<string, DeskPerson>> {
    const found = await services.accounts.peopleByIds(ids.filter((i): i is string => !!i));
    return new Map([...found].map(([id, p]) => [id, { userId: id, name: p.name }]));
  }

  async function activeRoles(userIds?: string[]) {
    const rows = await db
      .select()
      .from(DR)
      .where(and(isNull(DR.removedAt), userIds ? inArray(DR.userId, userIds) : undefined));
    return rows;
  }

  async function grantsFor(userIds: string[], admins: Set<string>): Promise<Map<string, DeskRoleGrant[]>> {
    const rows = await activeRoles(userIds);
    const markets = await services.network.marketsByIds(rows.map((r) => r.marketId).filter((m): m is string => !!m));
    const out = new Map<string, DeskRoleGrant[]>();
    for (const id of userIds) out.set(id, admins.has(id) ? [{ role: "admin", market: null }] : []);
    const order = { rights_reviewer: 1, market_lead: 2 } as const;
    for (const r of [...rows].sort((a, b) => order[a.role] - order[b.role])) {
      const market = r.marketId ? (markets.get(r.marketId) ?? null) : null;
      if (r.role === "market_lead" && !market) continue;
      out.get(r.userId)?.push({ role: r.role, market });
    }
    return out;
  }

  // ---------- rules ----------

  function parseValue(key: RuleKey, value: unknown) {
    const result = ruleDef(key).schema.safeParse(value);
    if (!result.success) throw badRequest(`That value doesn't fit this rule: ${result.error.issues[0]?.message ?? "invalid"}.`, { value: result.error.issues[0]?.message ?? "Invalid" });
    return result.data;
  }

  async function versionRows(key: RuleKey, scope: string) {
    return db
      .select()
      .from(R)
      .where(and(eq(R.key, key), eq(R.scope, scope)))
      .orderBy(desc(R.effectiveFrom), desc(R.createdAt));
  }

  /** The version in effect at `at`: the market's own first (per-market rules), else Opencast-wide. */
  async function versionAt(key: RuleKey, at: Date, scope = "") {
    const scopes = ruleDef(key).scoped && scope ? [scope, ""] : [""];
    for (const s of scopes) {
      const [row] = await db
        .select()
        .from(R)
        .where(and(eq(R.key, key), eq(R.scope, s), lte(R.effectiveFrom, at)))
        .orderBy(desc(R.effectiveFrom), desc(R.createdAt))
        .limit(1);
      if (row) return row;
    }
    return null;
  }

  async function nextAfter(key: RuleKey, at: Date, scope = "") {
    const rows = await db
      .select()
      .from(R)
      .where(and(eq(R.key, key), eq(R.scope, scope)))
      .orderBy(asc(R.effectiveFrom), desc(R.createdAt));
    return rows.find((r) => r.effectiveFrom.getTime() > at.getTime()) ?? null;
  }

  function versionView(key: RuleKey, row: typeof R.$inferSelect | null, at: Date, who: Map<string, DeskPerson>): RuleVersion {
    const d = ruleDef(key);
    const value = row ? row.value : d.fallback;
    const shownAt = row && row.effectiveFrom.getTime() > at.getTime() ? row.effectiveFrom : at;
    return {
      id: row?.id ?? FALLBACK_ID,
      value,
      display: d.display(value, shownAt),
      set: d.isSet ? d.isSet(value) : true,
      effectiveFrom: (row?.effectiveFrom ?? new Date(0)).toISOString(),
      setBy: row?.setBy ? (who.get(row.setBy) ?? null) : null,
      note: row?.note ?? null,
      createdAt: (row?.createdAt ?? new Date(0)).toISOString()
    };
  }

  async function ruleView(key: RuleKey, at: Date, scope = ""): Promise<RuleView> {
    const d = ruleDef(key);
    const [current, next] = await Promise.all([versionAt(key, at, scope), nextAfter(key, at, d.scoped ? scope : "")]);
    const who = await people([current?.setBy, next?.setBy]);
    const value = current ? current.value : d.fallback;
    return {
      key,
      scope: d.scoped ? scope : "",
      group: d.group,
      title: d.title,
      detail: typeof d.detail === "function" ? d.detail(value) : d.detail,
      current: versionView(key, current, at, who),
      next: next ? versionView(key, next, at, who) : null,
      valueSchema: z.toJSONSchema(d.schema, { unrepresentable: "any" }) as Record<string, unknown>
    };
  }

  /** "2026-10-01" is midnight UTC that day; a timestamp is itself. Never before today. */
  function effectiveDate(input: string): Date {
    const at = /^\d{4}-\d{2}-\d{2}$/.test(input) ? new Date(`${input}T00:00:00.000Z`) : new Date(input);
    if (Number.isNaN(at.getTime())) throw badRequest("Choose the date it takes effect.", { effectiveFrom: "Invalid" });
    const now = deps.clock.now();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    if (at.getTime() < today) throw refused("retroactive", "A change takes effect from today or later, never before: statements say which value applied.");
    return at;
  }

  async function checkScope(key: RuleKey, scope: string | undefined) {
    const d = ruleDef(key);
    if (!scope) return "";
    if (!d.scoped) throw badRequest("This rule is the same everywhere: it has no market.", { scope: "Not per market" });
    if (!(await services.network.marketsByIds([scope])).size) throw badRequest("That market doesn't exist.", { scope: "Unknown market" });
    return scope;
  }

  const numberingLine = (n: Numbering) => ({
    tvLine: `TV ${n.tv.firstMajor} to ${n.tv.lastMajor}, with subchannels`,
    radioLine: `Radio ${(n.radio.firstTenths / 10).toFixed(1)} to ${(n.radio.lastTenths / 10).toFixed(1)}, even tenths`
  });

  // ---------- escrow signers ----------

  /** The keys as deployed: the contract's own list, else configuration, else nothing yet. */
  async function deployedSigners(): Promise<{ source: EscrowSigners["source"]; signers: string[]; threshold: number | null }> {
    const chain = deps.chain;
    if (chain?.signers) {
      try {
        const read = await chain.signers();
        return { source: "contract", signers: read.signers, threshold: read.threshold };
      } catch (error) {
        console.error("[settings] reading the escrow's keys failed", error);
      }
    }
    const configured = (process.env.ESCROW_VERIFIERS ?? "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    if (configured.length) {
      const t = Number(process.env.ESCROW_THRESHOLD);
      return { source: "config", signers: configured, threshold: Number.isFinite(t) && t > 0 ? t : null };
    }
    return { source: "none", signers: [], threshold: null };
  }

  /** The set a proposal changes: the last one approved here (waiting on the timelock), else as deployed. */
  async function currentSigners() {
    const approved = await service.valueAt("escrow.signers");
    if (approved.signers) return { signers: approved.signers, threshold: approved.threshold ?? 1 };
    const deployed = await deployedSigners();
    return { signers: deployed.signers, threshold: deployed.threshold ?? Math.max(1, Math.min(2, deployed.signers.length)) };
  }

  async function proposalViews(rows: Array<typeof SP.$inferSelect>, user: CurrentUser | null): Promise<SignerProposal[]> {
    if (!rows.length) return [];
    const decisions = await db
      .select()
      .from(SA)
      .where(
        inArray(
          SA.proposalId,
          rows.map((r) => r.id)
        )
      );
    const who = await people([...rows.flatMap((r) => [r.proposedBy, ...(r.approvers ?? [])])]);
    return rows.map((r) => {
      const mine = decisions.filter((d) => d.proposalId === r.id);
      const approvals = (r.approvers ?? []).map((adminId) => {
        const d = mine.find((x) => x.adminId === adminId);
        return { admin: who.get(adminId) ?? { userId: adminId, name: "An admin" }, decision: d?.decision ?? null, at: d?.at.toISOString() ?? null, note: d?.note ?? null };
      });
      return {
        id: r.id,
        kind: r.kind,
        oldAddress: r.oldAddress,
        newAddress: r.newAddress,
        signersAfter: r.signersAfter,
        thresholdAfter: r.thresholdAfter,
        note: r.note,
        proposedBy: who.get(r.proposedBy) ?? { userId: r.proposedBy, name: "An admin" },
        proposedAt: r.proposedAt.toISOString(),
        status: r.status,
        approvals,
        decidedAt: r.decidedAt?.toISOString() ?? null,
        canDecide: !!user && r.status === "open" && (r.approvers ?? []).includes(user.id) && !mine.some((d) => d.adminId === user.id),
        canWithdraw: !!user && r.status === "open" && r.proposedBy === user.id
      };
    });
  }

  async function proposal(user: CurrentUser, proposalId: string) {
    const [row] = await db.select().from(SP).where(eq(SP.id, proposalId));
    if (!row) throw notFound("That proposal");
    const [view] = await proposalViews([row], user);
    return view!;
  }

  const short = (a: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

  const service: SettingsService = {
    async onTeam(userId) {
      const [row] = await db
        .select({ id: DR.id })
        .from(DR)
        .where(and(eq(DR.userId, userId), isNull(DR.removedAt)))
        .limit(1);
      return !!row;
    },

    async rolesOf(user) {
      return (await grantsFor([user.id], new Set(user.isAdmin ? [user.id] : []))).get(user.id) ?? [];
    },

    async mayDesk(user, need) {
      if (user.isAdmin) return true;
      if (need === "admin") return false;
      const rows = await activeRoles([user.id]);
      if (need === "rights") return rows.some((r) => r.role === "rights_reviewer");
      return rows.some((r) => r.role === "market_lead" && r.marketId === need.market);
    },

    async requireDesk(user, need) {
      if (await service.mayDesk(user, need)) return;
      throw deskRole(need === "admin" ? "Only an admin can change that." : need === "rights" ? "Only a rights reviewer or an admin can do that." : "Only this market's lead or an admin can do that.");
    },

    async team(user) {
      const [adminIds, roleRows] = await Promise.all([services.accounts.adminIds(), activeRoles()]);
      const ids = [...new Set([...adminIds, ...roleRows.map((r) => r.userId)])];
      const [found, grants] = await Promise.all([services.accounts.peopleByIds(ids), grantsFor(ids, new Set(adminIds))]);
      const peopleList = ids
        .filter((id) => found.has(id))
        .map((id) => {
          const p = found.get(id)!;
          return { userId: id, name: p.name, email: p.email, roles: grants.get(id) ?? [], adminByEmail: p.adminByEmail, you: id === user.id };
        })
        .filter((p) => p.roles.length)
        .sort((a, b) => Number(b.roles.some((r) => r.role === "admin")) - Number(a.roles.some((r) => r.role === "admin")) || a.name.localeCompare(b.name));
      return { people: peopleList, canEdit: user.isAdmin };
    },

    async addTeamMember(user, input) {
      await service.requireDesk(user, "admin");
      const userId = await services.accounts.userIdByEmail(input.email);
      if (!userId) throw refused("no_account", `No one has signed in to Opencast as ${input.email.trim()} yet. Ask them to sign in once, then add them.`);
      const current = await service.rolesOf({ id: userId, isAdmin: (await services.accounts.peopleByIds([userId])).get(userId)?.isAdmin ?? false });
      const wanted = [...current.map((g) => ({ role: g.role, marketId: g.market?.id })), ...input.roles];
      return service.setTeamRoles(user, userId, { roles: wanted });
    },

    async setTeamRoles(user, userId, input) {
      await service.requireDesk(user, "admin");
      const person = (await services.accounts.peopleByIds([userId])).get(userId);
      if (!person) throw notFound("That person");
      const key = (r: { role: string; marketId?: string | null }) => `${r.role}:${r.marketId ?? ""}`;
      const wanted = new Map(input.roles.map((r) => [key(r), r]));
      for (const r of wanted.values()) {
        if ((r.role === "market_lead") !== !!r.marketId) throw badRequest("A market lead needs a market, and only a market lead has one.", { marketId: "Required for a market lead" });
      }
      const marketIds = [...wanted.values()].map((r) => r.marketId).filter((m): m is string => !!m);
      const markets = await services.network.marketsByIds(marketIds);
      if (markets.size !== new Set(marketIds).size) throw badRequest("That market doesn't exist.", { marketId: "Unknown market" });
      const wantsAdmin = wanted.has("admin:");
      if (person.isAdmin && !wantsAdmin && (await services.accounts.adminIds()).length <= 1) {
        throw refused("last_admin", "Opencast needs at least one admin. Make someone else an admin first.");
      }
      const now = deps.clock.now();
      const existing = await activeRoles([userId]);
      const words: string[] = [];
      // Market names for the roles given and the ones taken away.
      const named = new Map([...(await services.network.marketsByIds(existing.map((r) => r.marketId).filter((m): m is string => !!m))), ...markets]);
      const describe = (role: keyof typeof ROLE_WORDS, marketId?: string | null) => (role === "market_lead" ? `market lead for the ${named.get(marketId ?? "")?.name ?? "market"}` : ROLE_WORDS[role]);
      await db.transaction(async (tx) => {
        if (person.isAdmin !== wantsAdmin) {
          await services.accounts.setAdmin(userId, wantsAdmin);
          words.push(wantsAdmin ? `Made ${person.name} an admin` : `Took admin away from ${person.name}${person.adminByEmail ? " (OPENCAST_ADMIN_EMAILS makes them one again at sign-in)" : ""}`);
        }
        for (const row of existing) {
          if (wanted.has(key(row))) continue;
          await tx.update(DR).set({ removedAt: now, removedBy: user.id }).where(eq(DR.id, row.id));
          words.push(`Took ${person.name} off as ${describe(row.role, row.marketId)}`);
        }
        const have = new Set(existing.map(key));
        for (const r of wanted.values()) {
          if (r.role === "admin" || have.has(key(r))) continue;
          await tx.insert(DR).values({ userId, role: r.role, marketId: r.marketId ?? null, grantedBy: user.id, grantedAt: now });
          words.push(`Made ${person.name} ${describe(r.role, r.marketId)}`);
        }
        for (const summary of words) {
          await service.logChange(tx, {
            by: user.id,
            kind: "role",
            subject: userId,
            summary,
            before: [...(person.isAdmin ? [{ role: "admin", marketId: null }] : []), ...existing.map((r) => ({ role: r.role, marketId: r.marketId }))],
            after: [...wanted.values()].map((r) => ({ role: r.role, marketId: r.marketId ?? null })),
            note: input.note ?? null
          });
        }
      });
      return service.team(user);
    },

    async valueAt(key, at = deps.clock.now(), scope = "") {
      const row = await versionAt(key, at, scope);
      if (!row) return RULES[key].fallback as RuleValue<typeof key>;
      // A stored value that no longer fits its definition reads as the fallback, loudly.
      const parsed = RULES[key].schema.safeParse(row.value);
      if (!parsed.success) {
        console.error(`[settings] rule ${key} version ${row.id} doesn't fit its definition`, parsed.error.issues);
        return RULES[key].fallback as RuleValue<typeof key>;
      }
      return parsed.data as RuleValue<typeof key>;
    },

    async listRules(user, at = deps.clock.now(), scope = "") {
      const rules = await Promise.all(RULE_KEYS.map((key) => ruleView(key, at, ruleDef(key).scoped ? scope : "")));
      return { at: at.toISOString(), rules, canEdit: user.isAdmin };
    },

    async ruleValue(key, at = deps.clock.now(), scope = "") {
      if (!isRuleKey(key)) throw notFound("That rule");
      const row = await versionAt(key, at, scope);
      return {
        key,
        scope: row?.scope ?? "",
        at: at.toISOString(),
        value: row ? row.value : ruleDef(key).fallback,
        effectiveFrom: (row?.effectiveFrom ?? new Date(0)).toISOString(),
        versionId: row?.id ?? FALLBACK_ID
      };
    },

    async ruleVersions(key, scope = "") {
      if (!isRuleKey(key)) throw notFound("That rule");
      const rows = await versionRows(key, ruleDef(key).scoped ? scope : "");
      const who = await people(rows.map((r) => r.setBy));
      const now = deps.clock.now();
      return rows.map((r) => versionView(key, r, now, who));
    },

    async setRule(user, key, input) {
      await service.requireDesk(user, "admin");
      if (!isRuleKey(key)) throw notFound("That rule");
      const d = ruleDef(key);
      if (d.readOnly) throw conflict("use_proposal", "Escrow signers change through a proposal the other admins approve (Settings, Escrow signers).");
      const value = parseValue(key, input.value);
      const scope = await checkScope(key, input.scope);
      const effectiveFrom = effectiveDate(input.effectiveFrom);
      const before = await versionAt(key, effectiveFrom, scope);
      await db.transaction(async (tx) => {
        await tx.insert(R).values({ key, scope, value, effectiveFrom, setBy: user.id, note: input.note?.trim() || null, createdAt: deps.clock.now() });
        const market = scope ? (await services.network.marketsByIds([scope])).get(scope) : undefined;
        const beforeValue = before ? before.value : d.fallback;
        await service.logChange(tx, {
          by: user.id,
          kind: "rule",
          subject: key,
          scope,
          summary: `${d.title}${market ? ` (${market.name})` : ""}: ${d.display(beforeValue, effectiveFrom)} to ${d.display(value, effectiveFrom)}`,
          before: beforeValue,
          after: value,
          effectiveFrom,
          note: input.note?.trim() || null
        });
      });
      return ruleView(key, deps.clock.now(), scope);
    },

    async changeLog(filter) {
      const rows = await db
        .select()
        .from(CL)
        .where(filter.kind ? eq(CL.kind, filter.kind) : undefined)
        .orderBy(desc(CL.at), desc(CL.seq))
        .limit(filter.limit ?? 200);
      const who = await people(rows.map((r) => r.by));
      return rows.map((r) => ({
        id: r.id,
        at: r.at.toISOString(),
        by: r.by ? (who.get(r.by) ?? null) : null,
        kind: r.kind,
        subject: r.subject,
        scope: r.scope,
        summary: r.summary,
        before: r.before ?? null,
        after: r.after ?? null,
        effectiveFrom: r.effectiveFrom?.toISOString() ?? null,
        note: r.note
      }));
    },

    async logChange(tx, entry) {
      await tx.insert(CL).values({
        at: deps.clock.now(),
        by: entry.by,
        kind: entry.kind,
        subject: entry.subject,
        scope: entry.scope ?? "",
        summary: entry.summary,
        before: entry.before === undefined ? null : (entry.before as object),
        after: entry.after === undefined ? null : (entry.after as object),
        effectiveFrom: entry.effectiveFrom ?? null,
        note: entry.note ?? null
      });
    },

    async numbering() {
      const now = deps.clock.now();
      const markets = await services.network.allMarkets();
      return Promise.all(
        markets.map(async (market: Market) => {
          const row = await versionAt("numbering.channels", now, market.id);
          const numbering = (row?.value as Numbering | undefined) ?? RULES["numbering.channels"].fallback;
          const next = (await nextAfter("numbering.channels", now, market.id)) ?? (row?.scope === market.id ? null : await nextAfter("numbering.channels", now, ""));
          return {
            market,
            numbering,
            ...numberingLine(numbering),
            own: row?.scope === market.id,
            effectiveFrom: (row?.effectiveFrom ?? new Date(0)).toISOString(),
            next: next ? { numbering: next.value as Numbering, effectiveFrom: next.effectiveFrom.toISOString() } : null
          };
        })
      );
    },

    async numberingFor(marketId, at) {
      return service.valueAt("numbering.channels", at, marketId);
    },

    async signers(user) {
      const [deployed, approvedRows, recent] = await Promise.all([
        deployedSigners(),
        db.select().from(SP).where(eq(SP.status, "approved")).orderBy(desc(SP.decidedAt)).limit(1),
        db.select().from(SP).orderBy(desc(SP.proposedAt)).limit(20)
      ]);
      const [approved] = await proposalViews(approvedRows, user);
      return {
        source: deployed.source,
        contract: deps.chain?.escrow ?? deps.config.escrowContractAddress ?? null,
        signers: deployed.signers,
        threshold: deployed.threshold,
        approved: approved ?? null,
        proposals: await proposalViews(recent, user),
        canPropose: user.isAdmin
      };
    },

    async proposeSigner(user, input) {
      await service.requireDesk(user, "admin");
      const approvers = (await services.accounts.adminIds()).filter((id) => id !== user.id);
      if (!approvers.length) throw refused("needs_another_admin", "A signer change needs another admin to approve it. Add a second admin first.");
      const [openOne] = await db.select({ id: SP.id }).from(SP).where(eq(SP.status, "open")).limit(1);
      if (openOne) throw conflict("proposal_open", "Another signer change is waiting for approval. Decide or withdraw it first.");
      const { signers, threshold } = await currentSigners();
      const lower = (a?: string) => a?.toLowerCase();
      const has = (a?: string) => signers.some((s) => s.toLowerCase() === lower(a));
      let after = [...signers];
      switch (input.kind) {
        case "add":
          if (!input.newAddress) throw badRequest("Say which key to add.", { newAddress: "Required" });
          if (has(input.newAddress)) throw refused("already_a_signer", "That key is already a signer.");
          after.push(input.newAddress);
          break;
        case "remove":
          if (!input.oldAddress) throw badRequest("Say which key goes.", { oldAddress: "Required" });
          if (!has(input.oldAddress)) throw refused("not_a_signer", "That key isn't a signer.");
          after = after.filter((s) => s.toLowerCase() !== lower(input.oldAddress));
          break;
        case "replace":
          if (!input.oldAddress || !input.newAddress) throw badRequest("Say which key goes and which comes.", { oldAddress: input.oldAddress ? "" : "Required", newAddress: input.newAddress ? "" : "Required" });
          if (!has(input.oldAddress)) throw refused("not_a_signer", "That key isn't a signer.");
          if (has(input.newAddress)) throw refused("already_a_signer", "The new key is already a signer.");
          after = after.map((s) => (s.toLowerCase() === lower(input.oldAddress) ? input.newAddress! : s));
          break;
        case "threshold":
          if (!input.threshold) throw badRequest("Say how many approvals a claim needs.", { threshold: "Required" });
          break;
      }
      const thresholdAfter = input.threshold ?? Math.min(threshold, after.length);
      if (!after.length || thresholdAfter < 1 || thresholdAfter > after.length) throw refused("bad_threshold", `A claim needs between 1 and ${Math.max(1, after.length)} approvals with ${after.length} ${after.length === 1 ? "key" : "keys"}.`);
      const id = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(SP)
          .values({
            kind: input.kind,
            oldAddress: input.kind === "remove" || input.kind === "replace" ? input.oldAddress! : null,
            newAddress: input.kind === "add" || input.kind === "replace" ? input.newAddress! : null,
            threshold: input.threshold ?? null,
            signersAfter: after,
            thresholdAfter,
            note: input.note?.trim() || null,
            proposedBy: user.id,
            proposedAt: deps.clock.now(),
            approvers
          })
          .returning({ id: SP.id });
        const words = { add: `Proposed adding ${short(input.newAddress ?? null)}`, remove: `Proposed removing ${short(input.oldAddress ?? null)}`, replace: `Proposed replacing ${short(input.oldAddress ?? null)} with ${short(input.newAddress ?? null)}`, threshold: `Proposed ${thresholdAfter} approvals a claim` };
        await service.logChange(tx, { by: user.id, kind: "signer", subject: row.id, summary: `${words[input.kind]}: ${thresholdAfter} of ${after.length}`, before: { signers, threshold }, after: { signers: after, threshold: thresholdAfter }, note: input.note?.trim() || null });
        return row.id;
      });
      return proposal(user, id);
    },

    async decideSigner(user, proposalId, input) {
      await service.requireDesk(user, "admin");
      const [row] = await db.select().from(SP).where(eq(SP.id, proposalId));
      if (!row) throw notFound("That proposal");
      if (row.status !== "open") throw conflict("not_open", "That proposal has been decided.");
      if (row.proposedBy === user.id) throw forbidden("You proposed it: the other admins decide it.");
      if (!row.approvers.includes(user.id)) throw forbidden("Only the admins it names decide it.");
      const [already] = await db.select().from(SA).where(and(eq(SA.proposalId, proposalId), eq(SA.adminId, user.id)));
      if (already) throw conflict("already_decided", "You've already said.");
      const now = deps.clock.now();
      await db.transaction(async (tx) => {
        await tx.insert(SA).values({ proposalId, adminId: user.id, decision: input.decision, note: input.note?.trim() || null, at: now });
        const decided = await tx.select().from(SA).where(eq(SA.proposalId, proposalId));
        const who = (await people([user.id])).get(user.id)?.name ?? "An admin";
        if (input.decision === "refuse") {
          await tx.update(SP).set({ status: "refused", decidedAt: now }).where(eq(SP.id, proposalId));
          await service.logChange(tx, { by: user.id, kind: "signer", subject: proposalId, summary: `${who} refused the signer change`, note: input.note?.trim() || null });
          return;
        }
        await service.logChange(tx, { by: user.id, kind: "signer", subject: proposalId, summary: `${who} approved the signer change`, note: input.note?.trim() || null });
        const approvedBy = new Set(decided.filter((d) => d.decision === "approve").map((d) => d.adminId));
        if (!row.approvers.every((a) => approvedBy.has(a))) return;
        // Every other admin said yes: the change is approved, and handed to the timelock (contracts/README.md).
        await tx.update(SP).set({ status: "approved", decidedAt: now }).where(eq(SP.id, proposalId));
        const value = { signers: row.signersAfter, threshold: row.thresholdAfter };
        await tx.insert(R).values({ key: "escrow.signers", scope: "", value, effectiveFrom: now, setBy: user.id, note: "Approved in Settings. On-chain only through the timelock", createdAt: now });
        await service.logChange(tx, {
          by: user.id,
          kind: "signer",
          subject: proposalId,
          summary: `Signer change approved: ${row.thresholdAfter} of ${row.signersAfter.length}. Next, the timelock`,
          after: value,
          effectiveFrom: now
        });
      });
      return proposal(user, proposalId);
    },

    async withdrawSigner(user, proposalId) {
      const [row] = await db.select().from(SP).where(eq(SP.id, proposalId));
      if (!row) throw notFound("That proposal");
      if (row.proposedBy !== user.id) throw forbidden("Only whoever proposed it can withdraw it.");
      if (row.status !== "open") throw conflict("not_open", "That proposal has been decided.");
      const now = deps.clock.now();
      await db.transaction(async (tx) => {
        await tx.update(SP).set({ status: "withdrawn", decidedAt: now }).where(eq(SP.id, proposalId));
        await service.logChange(tx, { by: user.id, kind: "signer", subject: proposalId, summary: "Withdrew the signer change" });
      });
      return proposal(user, proposalId);
    }
  };
  return service;
}
