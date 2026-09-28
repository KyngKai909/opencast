import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { ClearLink, Me, StationIdent } from "@opencast/contracts";
import type { Executor, ModuleContext } from "../../context.js";
import type { CurrentUser } from "../../http.js";
import { ClearLookupUnavailable } from "../../clearLink.js";
import { badRequest, conflict, forbidden, HttpError, notFound, refused } from "../../errors.js";

export type StationRole = "owner" | "operator" | "host";
export type BusinessRole = "owner" | "manager" | "viewer";

type PresetInput = { stationId: string; key: number | null };

const INVITE_DAYS = 7;
/** Station kinds Opencast runs itself: admins act as their owner. */
const OPENCAST_RUN_KINDS = new Set(["claimable", "catalog", "listed"]);

export interface AccountsService {
  userForToken(token: string): Promise<CurrentUser>;
  me(userId: string): Promise<Me>;
  updateMe(userId: string, input: { displayName?: string | null; marketId?: string | null; settings?: Record<string, unknown> }): Promise<Me>;
  displayNames(userIds: string[]): Promise<Map<string, string | null>>;
  /** Every email the user has, lower-cased (their account email and linked ones). */
  emailsOf(userId: string): Promise<string[]>;
  notificationPrefs(userId: string, scope: "viewer" | "station" | "business", scopeId: string | null): Promise<Record<string, unknown>>;
  saveNotificationPrefs(userId: string, scope: "viewer" | "station" | "business", scopeId: string | null, prefs: Record<string, unknown>): Promise<void>;

  presets(userId: string): Promise<Array<{ station: StationIdent; key: number | null; position: number }>>;
  savePreset(userId: string, input: PresetInput): Promise<void>;
  reorderPresets(userId: string, input: PresetInput[]): Promise<void>;
  removePreset(userId: string, stationId: string): Promise<void>;
  suggestPresetKey(userId: string): Promise<number | null>;
  usePresetKey(userId: string, key: number): Promise<void>;
  presetCounts(stationIds: string[]): Promise<Map<string, number>>;

  reminders(userId: string): Promise<ReminderRow[]>;
  addReminder(userId: string, input: { logEntryId?: string; listedAiringId?: string; switchMeOver: boolean }): Promise<ReminderRow>;
  updateReminder(userId: string, reminderId: string, switchMeOver: boolean): Promise<ReminderRow>;
  removeReminder(userId: string, reminderId: string): Promise<void>;
  dueReminders(withinMinutes: number): Promise<Array<ReminderRow & { userId: string }>>;
  markReminderNotified(reminderId: string): Promise<void>;

  /** Throws unless the user holds one of the roles (admins count as owner of stations Opencast runs). */
  requireStation(user: CurrentUser, stationId: string, roles: StationRole[]): Promise<StationRole>;
  stationRole(user: CurrentUser, stationId: string): Promise<StationRole | null>;
  requireBusiness(user: CurrentUser, businessId: string, roles: BusinessRole[]): Promise<BusinessRole>;
  addStationMember(db: Executor, stationId: string, userId: string, role: StationRole): Promise<void>;
  addBusinessMember(db: Executor, businessId: string, userId: string, role: BusinessRole): Promise<void>;
  stationMemberIds(stationId: string, roles?: StationRole[]): Promise<string[]>;
  /** Opencast admins (Network desk). */
  adminIds(): Promise<string[]>;
  /** The wallet a user signed in with or linked (Privy), if any: where the escrow can pay them. */
  walletOf(userId: string): Promise<string | null>;
  businessMemberIds(businessId: string, roles?: BusinessRole[]): Promise<string[]>;

  /** The person's linked Clear wallet, or null. `access` is full only while Clear still grants full access. */
  clearLink(userId: string): Promise<ClearLinkView | null>;
  /** A link by its ID, still linked or not (funding sources and payout destinations keep the ID). */
  clearLinkById(linkId: string): Promise<ClearLinkView | null>;
  /** Records the Clear wallet the person linked in Privy. 409 when Clear isn't linked there, or isn't set up here. */
  linkClear(user: CurrentUser): Promise<ClearLink>;
  /** Forgets it. Funding sources and payout destinations that used it stop working. */
  unlinkClear(userId: string): Promise<void>;

  team(scope: TeamScope): Promise<TeamView>;
  invite(user: CurrentUser, scope: TeamScope, input: { email?: string; phone?: string; role: string; note?: string }): Promise<InviteRow>;
  updateMember(scope: TeamScope, userId: string, input: { role?: string; note?: string | null }): Promise<void>;
  removeMember(scope: TeamScope, userId: string): Promise<void>;
  transferStationOwnership(stationId: string, fromUserId: string, toUserId: string): Promise<void>;
  resendInvite(user: CurrentUser, inviteId: string): Promise<InviteRow>;
  acceptInvite(user: CurrentUser, inviteId: string): Promise<void>;
}

export type TeamScope = { kind: "station"; id: string } | { kind: "business"; id: string };

export interface ClearLinkView {
  id: string;
  userId: string;
  address: string;
  access: "read_only" | "full";
  linkedAt: string;
  /** False once unlinked. */
  active: boolean;
}

export interface ReminderRow {
  id: string;
  switchMeOver: boolean;
  createdAt: string;
  airing: {
    title: string;
    startsAt: string;
    station: StationIdent;
    listed: boolean;
    logEntryId: string | null;
    listedAiringId: string | null;
  };
}

export interface InviteRow {
  id: string;
  email: string | null;
  phone: string | null;
  role: "operator" | "host" | "manager" | "viewer";
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

export interface TeamView {
  members: Array<{
    userId: string;
    displayName: string | null;
    email: string | null;
    role: string;
    note: string | null;
    lastInAt: string | null;
  }>;
  invites: InviteRow[];
}

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);

export function createAccountsService({ deps, services }: ModuleContext): AccountsService {
  const { db } = deps;
  const u = schema.users;

  async function findOrCreateUser(privyDid: string) {
    const [existing] = await db.select().from(u).where(eq(u.privyDid, privyDid));
    if (existing) {
      return existing;
    }
    const linked = await deps.auth.linkedAccounts(privyDid).catch(() => []);
    return db.transaction(async (tx) => {
      // A station owner from before Privy is matched by the wallet they link.
      const wallets = linked.filter((a) => a.kind === "wallet").map((a) => a.value);
      let user: typeof u.$inferSelect | undefined;
      if (wallets.length) {
        const [legacy] = await tx
          .select({ user: u })
          .from(schema.identities)
          .innerJoin(u, eq(u.id, schema.identities.userId))
          .where(and(eq(schema.identities.kind, "wallet"), inArray(schema.identities.value, wallets), isNull(u.privyDid)));
        if (legacy) {
          [user] = await tx.update(u).set({ privyDid }).where(eq(u.id, legacy.user.id)).returning();
        }
      }
      if (!user) {
        const email = linked.find((a) => a.kind === "email")?.value ?? null;
        [user] = await tx.insert(u).values({ privyDid, email }).returning();
      }
      for (const account of linked) {
        await tx
          .insert(schema.identities)
          .values({ userId: user!.id, kind: account.kind, value: account.value, verifiedAt: deps.clock.now() })
          .onConflictDoNothing();
      }
      return user!;
    });
  }

  async function stationIdents(ids: string[]) {
    return services.stations.idents(ids);
  }

  async function reminderRows(rows: Array<typeof schema.reminders.$inferSelect>): Promise<ReminderRow[]> {
    const logIds = rows.map((r) => r.logEntryId).filter((v): v is string => Boolean(v));
    const listedIds = rows.map((r) => r.listedAiringId).filter((v): v is string => Boolean(v));
    const [airings, listed] = await Promise.all([
      services.log.airingsByIds(logIds),
      services.network.listedAiringsByIds(listedIds)
    ]);
    const stationIds = [...airings.values(), ...listed.values()].map((a) => a.stationId);
    const idents = await stationIdents(stationIds);
    return rows.flatMap((row) => {
      const target = row.logEntryId ? airings.get(row.logEntryId) : row.listedAiringId ? listed.get(row.listedAiringId) : undefined;
      const station = target && idents.get(target.stationId);
      if (!target || !station) {
        return [];
      }
      return [
        {
          id: row.id,
          switchMeOver: row.switchMeOver,
          createdAt: row.createdAt.toISOString(),
          airing: {
            title: target.title,
            startsAt: target.startsAt,
            station,
            listed: Boolean(row.listedAiringId),
            logEntryId: row.logEntryId,
            listedAiringId: row.listedAiringId
          }
        }
      ];
    });
  }

  async function reminderRow(userId: string, reminderId: string) {
    const [row] = await db
      .select()
      .from(schema.reminders)
      .where(and(eq(schema.reminders.id, reminderId), eq(schema.reminders.userId, userId)));
    if (!row) {
      throw notFound("That reminder");
    }
    const [view] = await reminderRows([row]);
    if (!view) {
      throw notFound("That airing");
    }
    return view;
  }

  function inviteRow(row: typeof schema.invites.$inferSelect): InviteRow {
    return {
      id: row.id,
      email: row.email,
      phone: row.phone,
      role: row.role,
      expiresAt: row.expiresAt.toISOString(),
      acceptedAt: iso(row.acceptedAt),
      createdAt: row.createdAt.toISOString()
    };
  }

  async function writePresets(userId: string, ordered: PresetInput[]) {
    const seen = new Set<string>();
    const keys = new Set<number>();
    for (const preset of ordered) {
      if (seen.has(preset.stationId)) {
        throw badRequest("A station can only be a preset once.");
      }
      seen.add(preset.stationId);
      if (preset.key !== null) {
        if (keys.has(preset.key)) {
          throw badRequest(`Key ${preset.key} is used twice.`);
        }
        keys.add(preset.key);
      }
    }
    await db.transaction(async (tx) => {
      await tx.delete(schema.presets).where(eq(schema.presets.userId, userId));
      if (ordered.length) {
        await tx.insert(schema.presets).values(ordered.map((p, position) => ({ userId, stationId: p.stationId, key: p.key, position })));
      }
    });
  }

  async function currentPresets(userId: string): Promise<PresetInput[]> {
    const rows = await db.select().from(schema.presets).where(eq(schema.presets.userId, userId)).orderBy(asc(schema.presets.position));
    return rows.map((r) => ({ stationId: r.stationId, key: r.key }));
  }

  function clearLinkView(row: typeof schema.clearLinks.$inferSelect): ClearLinkView {
    // Full access only while Clear still grants it: if Clear moves Opencast to read-only, every link follows.
    const access = row.access === "full" && deps.clear.access === "full" ? "full" : "read_only";
    return { id: row.id, userId: row.userId, address: row.address, access, linkedAt: row.linkedAt.toISOString(), active: row.unlinkedAt === null };
  }

  async function activeClearLink(userId: string) {
    const [row] = await db
      .select()
      .from(schema.clearLinks)
      .where(and(eq(schema.clearLinks.userId, userId), isNull(schema.clearLinks.unlinkedAt)));
    return row ?? null;
  }

  const service: AccountsService = {
    async userForToken(token) {
      const verified = await deps.auth.verify(token);
      const user = await findOrCreateUser(verified.privyDid);
      return { id: user.id, privyDid: user.privyDid, isAdmin: user.isAdmin };
    },

    async me(userId) {
      const [user] = await db.select().from(u).where(eq(u.id, userId));
      if (!user) {
        throw notFound("Your account");
      }
      const [identities, stationRows, businessRows, clear] = await Promise.all([
        db.select().from(schema.identities).where(eq(schema.identities.userId, userId)),
        db.select().from(schema.stationMemberships).where(eq(schema.stationMemberships.userId, userId)),
        db.select().from(schema.advertiserMemberships).where(eq(schema.advertiserMemberships.userId, userId)),
        service.clearLink(userId)
      ]);
      const [idents, businesses, markets] = await Promise.all([
        stationIdents(stationRows.map((r) => r.stationId)),
        services.spots.businessNames(businessRows.map((r) => r.advertiserId)),
        user.marketId ? services.network.marketsByIds([user.marketId]) : Promise.resolve(new Map())
      ]);
      return {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        market: user.marketId ? (markets.get(user.marketId) ?? null) : null,
        isAdmin: user.isAdmin,
        identities: identities.map((i) => ({ kind: i.kind, value: i.value, verifiedAt: iso(i.verifiedAt) })),
        memberships: [
          ...stationRows.flatMap((r) => {
            const station = idents.get(r.stationId);
            return station ? [{ kind: "station" as const, station, role: r.role }] : [];
          }),
          ...businessRows.flatMap((r) => {
            const name = businesses.get(r.advertiserId);
            return name ? [{ kind: "business" as const, business: { id: r.advertiserId, name }, role: r.role }] : [];
          })
        ],
        settings: (user.settings ?? {}) as Me["settings"],
        clear: clear ? { address: clear.address, access: clear.access, linkedAt: clear.linkedAt } : null
      };
    },

    async clearLink(userId) {
      const row = await activeClearLink(userId);
      return row ? clearLinkView(row) : null;
    },

    async clearLinkById(linkId) {
      const [row] = await db.select().from(schema.clearLinks).where(eq(schema.clearLinks.id, linkId));
      return row ? clearLinkView(row) : null;
    },

    async linkClear(user) {
      const providerAppId = deps.clear.providerAppId;
      if (!providerAppId) throw conflict("clear_not_configured", "Connecting Clear isn't set up on this server.");
      let found;
      try {
        found = user.privyDid ? await deps.clear.find(user.privyDid) : null;
      } catch (error) {
        if (error instanceof ClearLookupUnavailable) throw conflict("clear_not_configured", error.message);
        console.error("[accounts] reading the Clear link from Privy failed", error);
        throw new HttpError(502, "privy_unavailable", "Couldn't check your Clear link with Privy. Try again in a moment.");
      }
      if (!found) throw conflict("clear_not_linked", "Clear isn't linked yet.");
      const now = deps.clock.now();
      const row = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(schema.clearLinks)
          .where(and(eq(schema.clearLinks.userId, user.id), isNull(schema.clearLinks.unlinkedAt)))
          .for("update");
        if (current && current.address === found.address && current.subject === found.subject) {
          // The same wallet again: keep when it was linked, take the access Clear grants now.
          const [updated] = await tx.update(schema.clearLinks).set({ access: deps.clear.access, providerAppId }).where(eq(schema.clearLinks.id, current.id)).returning();
          return updated;
        }
        if (current) await tx.update(schema.clearLinks).set({ unlinkedAt: now }).where(eq(schema.clearLinks.id, current.id));
        const [created] = await tx
          .insert(schema.clearLinks)
          .values({ userId: user.id, address: found.address, subject: found.subject, providerAppId, access: deps.clear.access, linkedAt: now })
          .returning();
        return created;
      });
      const view = clearLinkView(row);
      return { address: view.address, access: view.access, linkedAt: view.linkedAt };
    },

    async unlinkClear(userId) {
      await db
        .update(schema.clearLinks)
        .set({ unlinkedAt: deps.clock.now() })
        .where(and(eq(schema.clearLinks.userId, userId), isNull(schema.clearLinks.unlinkedAt)));
    },

    async updateMe(userId, input) {
      const patch: Partial<typeof u.$inferInsert> = {};
      if (input.displayName !== undefined) patch.displayName = input.displayName;
      if (input.marketId !== undefined) {
        if (input.marketId && !(await services.network.marketsByIds([input.marketId])).size) {
          throw badRequest("That market doesn't exist.");
        }
        patch.marketId = input.marketId;
      }
      if (input.settings !== undefined) {
        // Merge section by section, so one app changing a section keeps the others.
        patch.settings = sql`${u.settings} || ${JSON.stringify(input.settings)}::jsonb`;
      }
      if (Object.keys(patch).length) {
        await db.update(u).set(patch).where(eq(u.id, userId));
      }
      return service.me(userId);
    },

    async displayNames(userIds) {
      if (!userIds.length) return new Map();
      const rows = await db.select({ id: u.id, displayName: u.displayName }).from(u).where(inArray(u.id, userIds));
      return new Map(rows.map((r) => [r.id, r.displayName]));
    },

    async emailsOf(userId) {
      const [user] = await db.select({ email: u.email }).from(u).where(eq(u.id, userId));
      const linked = await db
        .select({ value: schema.identities.value })
        .from(schema.identities)
        .where(and(eq(schema.identities.userId, userId), inArray(schema.identities.kind, ["email", "google", "apple"])));
      return [...new Set([user?.email, ...linked.map((l) => l.value)].filter((v): v is string => Boolean(v)).map((v) => v.toLowerCase()))];
    },

    async notificationPrefs(userId, scope, scopeId) {
      const P = schema.notificationPrefs;
      const [row] = await db
        .select()
        .from(P)
        .where(and(eq(P.userId, userId), eq(P.scope, scope === "business" ? "advertiser" : scope), scopeId ? eq(P.scopeId, scopeId) : isNull(P.scopeId)));
      return (row?.prefs as Record<string, unknown>) ?? {};
    },

    async saveNotificationPrefs(userId, scope, scopeId, prefs) {
      const P = schema.notificationPrefs;
      const dbScope = scope === "business" ? "advertiser" : scope;
      await db.delete(P).where(and(eq(P.userId, userId), eq(P.scope, dbScope), scopeId ? eq(P.scopeId, scopeId) : isNull(P.scopeId)));
      await db.insert(P).values({ userId, scope: dbScope, scopeId, prefs });
    },

    async presets(userId) {
      const rows = await db.select().from(schema.presets).where(eq(schema.presets.userId, userId)).orderBy(asc(schema.presets.position));
      const idents = await stationIdents(rows.map((r) => r.stationId));
      return rows.flatMap((r) => {
        const station = idents.get(r.stationId);
        return station ? [{ station, key: r.key, position: r.position }] : [];
      });
    },

    async savePreset(userId, { stationId, key }) {
      if (!(await stationIdents([stationId])).size) {
        throw notFound("That station");
      }
      const current = (await currentPresets(userId)).filter((p) => p.stationId !== stationId);
      // Replacing a key moves the old station to More presets; it's never deleted.
      const next = current.map((p) => (key !== null && p.key === key ? { ...p, key: null } : p));
      const keyed = next.filter((p) => p.key !== null);
      const more = next.filter((p) => p.key === null);
      const added = { stationId, key };
      const ordered = key === null ? [...keyed, ...more, added] : [...keyed, added, ...more];
      ordered.sort((a, b) => (a.key ?? 99) - (b.key ?? 99));
      await writePresets(userId, ordered);
    },

    async reorderPresets(userId, input) {
      const known = await stationIdents(input.map((p) => p.stationId));
      if (known.size !== new Set(input.map((p) => p.stationId)).size) {
        throw badRequest("One of those stations doesn't exist.");
      }
      await writePresets(userId, input);
    },

    async removePreset(userId, stationId) {
      await writePresets(
        userId,
        (await currentPresets(userId)).filter((p) => p.stationId !== stationId)
      );
    },

    async suggestPresetKey(userId) {
      const current = await currentPresets(userId);
      const used = new Set(current.map((p) => p.key).filter((k): k is number => k !== null));
      for (let key = 1; key <= 6; key++) {
        if (!used.has(key)) return key;
      }
      const since = new Date(deps.clock.now().getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
      const uses = await db
        .select({ key: schema.presetKeyUse.key, uses: sql<number>`sum(${schema.presetKeyUse.uses})::int` })
        .from(schema.presetKeyUse)
        .where(and(eq(schema.presetKeyUse.userId, userId), gte(schema.presetKeyUse.day, since)))
        .groupBy(schema.presetKeyUse.key);
      const byKey = new Map(uses.map((r) => [r.key, r.uses]));
      let best = 1;
      for (let key = 1; key <= 6; key++) {
        if ((byKey.get(key) ?? 0) < (byKey.get(best) ?? 0)) best = key;
      }
      return best;
    },

    async usePresetKey(userId, key) {
      const day = deps.clock.now().toISOString().slice(0, 10);
      await db
        .insert(schema.presetKeyUse)
        .values({ userId, key, day, uses: 1 })
        .onConflictDoUpdate({
          target: [schema.presetKeyUse.userId, schema.presetKeyUse.key, schema.presetKeyUse.day],
          set: { uses: sql`${schema.presetKeyUse.uses} + 1` }
        });
    },

    async presetCounts(stationIds) {
      if (!stationIds.length) return new Map();
      const rows = await db
        .select({ stationId: schema.presets.stationId, n: sql<number>`count(*)::int` })
        .from(schema.presets)
        .where(inArray(schema.presets.stationId, stationIds))
        .groupBy(schema.presets.stationId);
      return new Map(rows.map((r) => [r.stationId, r.n]));
    },

    async reminders(userId) {
      const rows = await db.select().from(schema.reminders).where(eq(schema.reminders.userId, userId));
      const views = await reminderRows(rows);
      const now = deps.clock.now().toISOString();
      return views.filter((v) => v.airing.startsAt >= now).sort((a, b) => a.airing.startsAt.localeCompare(b.airing.startsAt));
    },

    async addReminder(userId, input) {
      const [row] = await db
        .insert(schema.reminders)
        .values({ userId, logEntryId: input.logEntryId ?? null, listedAiringId: input.listedAiringId ?? null, switchMeOver: input.switchMeOver })
        .returning();
      const [view] = await reminderRows([row]);
      if (!view) {
        await db.delete(schema.reminders).where(eq(schema.reminders.id, row.id));
        throw notFound("That airing");
      }
      return view;
    },

    async updateReminder(userId, reminderId, switchMeOver) {
      await db
        .update(schema.reminders)
        .set({ switchMeOver })
        .where(and(eq(schema.reminders.id, reminderId), eq(schema.reminders.userId, userId)));
      return reminderRow(userId, reminderId);
    },

    async removeReminder(userId, reminderId) {
      await db.delete(schema.reminders).where(and(eq(schema.reminders.id, reminderId), eq(schema.reminders.userId, userId)));
    },

    async dueReminders(withinMinutes) {
      const rows = await db.select().from(schema.reminders).where(isNull(schema.reminders.notifiedAt));
      const views = await reminderRows(rows);
      const now = deps.clock.now().getTime();
      const byId = new Map(rows.map((r) => [r.id, r.userId]));
      return views
        .filter((v) => {
          const startsAt = Date.parse(v.airing.startsAt);
          return startsAt >= now && startsAt - now <= withinMinutes * 60_000;
        })
        .map((v) => ({ ...v, userId: byId.get(v.id)! }));
    },

    async markReminderNotified(reminderId) {
      await db.update(schema.reminders).set({ notifiedAt: deps.clock.now() }).where(eq(schema.reminders.id, reminderId));
    },

    async stationRole(user, stationId) {
      const [row] = await db
        .select({ role: schema.stationMemberships.role })
        .from(schema.stationMemberships)
        .where(and(eq(schema.stationMemberships.stationId, stationId), eq(schema.stationMemberships.userId, user.id)));
      if (row) {
        return row.role;
      }
      if (user.isAdmin) {
        const kind = await services.stations.kindOf(stationId);
        if (kind && OPENCAST_RUN_KINDS.has(kind)) return "owner";
      }
      return null;
    },

    async requireStation(user, stationId, roles) {
      const role = await service.stationRole(user, stationId);
      if (!role) {
        // Don't say whether a station you're not on exists.
        throw notFound("That station");
      }
      if (!roles.includes(role)) {
        throw forbidden(role === "host" ? "Hosts can go live on their own blocks only." : "Only the station's owner can do that.");
      }
      await db
        .update(schema.stationMemberships)
        .set({ lastInAt: deps.clock.now() })
        .where(and(eq(schema.stationMemberships.stationId, stationId), eq(schema.stationMemberships.userId, user.id)));
      return role;
    },

    async requireBusiness(user, businessId, roles) {
      const [row] = await db
        .select({ role: schema.advertiserMemberships.role })
        .from(schema.advertiserMemberships)
        .where(and(eq(schema.advertiserMemberships.advertiserId, businessId), eq(schema.advertiserMemberships.userId, user.id)));
      if (!row) {
        throw notFound("That business");
      }
      if (!roles.includes(row.role)) {
        throw forbidden(row.role === "viewer" ? "Viewers can see results, airings and statements only." : "Only the owner can do that.");
      }
      await db
        .update(schema.advertiserMemberships)
        .set({ lastInAt: deps.clock.now() })
        .where(and(eq(schema.advertiserMemberships.advertiserId, businessId), eq(schema.advertiserMemberships.userId, user.id)));
      return row.role;
    },

    async addStationMember(tx, stationId, userId, role) {
      await tx.insert(schema.stationMemberships).values({ stationId, userId, role }).onConflictDoUpdate({
        target: [schema.stationMemberships.stationId, schema.stationMemberships.userId],
        set: { role }
      });
    },

    async addBusinessMember(tx, businessId, userId, role) {
      await tx.insert(schema.advertiserMemberships).values({ advertiserId: businessId, userId, role }).onConflictDoUpdate({
        target: [schema.advertiserMemberships.advertiserId, schema.advertiserMemberships.userId],
        set: { role }
      });
    },

    async walletOf(userId) {
      const [row] = await db
        .select({ value: schema.identities.value })
        .from(schema.identities)
        .where(and(eq(schema.identities.userId, userId), eq(schema.identities.kind, "wallet")))
        .orderBy(desc(schema.identities.createdAt))
        .limit(1);
      return row?.value ?? null;
    },

    async adminIds() {
      const rows = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.isAdmin, true));
      return rows.map((r) => r.id);
    },

    async stationMemberIds(stationId, roles) {
      const rows = await db
        .select({ userId: schema.stationMemberships.userId, role: schema.stationMemberships.role })
        .from(schema.stationMemberships)
        .where(eq(schema.stationMemberships.stationId, stationId));
      return rows.filter((r) => !roles || roles.includes(r.role)).map((r) => r.userId);
    },

    async businessMemberIds(businessId, roles) {
      const rows = await db
        .select({ userId: schema.advertiserMemberships.userId, role: schema.advertiserMemberships.role })
        .from(schema.advertiserMemberships)
        .where(eq(schema.advertiserMemberships.advertiserId, businessId));
      return rows.filter((r) => !roles || roles.includes(r.role)).map((r) => r.userId);
    },

    async team(scope) {
      const members =
        scope.kind === "station"
          ? await db
              .select({ userId: u.id, displayName: u.displayName, email: u.email, role: schema.stationMemberships.role, note: schema.stationMemberships.note, lastInAt: schema.stationMemberships.lastInAt })
              .from(schema.stationMemberships)
              .innerJoin(u, eq(u.id, schema.stationMemberships.userId))
              .where(eq(schema.stationMemberships.stationId, scope.id))
          : await db
              .select({ userId: u.id, displayName: u.displayName, email: u.email, role: schema.advertiserMemberships.role, note: schema.advertiserMemberships.note, lastInAt: schema.advertiserMemberships.lastInAt })
              .from(schema.advertiserMemberships)
              .innerJoin(u, eq(u.id, schema.advertiserMemberships.userId))
              .where(eq(schema.advertiserMemberships.advertiserId, scope.id));
      const invites = await db
        .select()
        .from(schema.invites)
        .where(
          and(
            scope.kind === "station" ? eq(schema.invites.stationId, scope.id) : eq(schema.invites.advertiserId, scope.id),
            isNull(schema.invites.acceptedAt)
          )
        );
      const order = { owner: 0, operator: 1, manager: 1, host: 2, viewer: 2 } as Record<string, number>;
      return {
        members: members
          .map((m) => ({ ...m, lastInAt: iso(m.lastInAt) }))
          .sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9)),
        invites: invites.map(inviteRow)
      };
    },

    async invite(user, scope, input) {
      if (!input.email && !input.phone) {
        throw badRequest("Give an email or a phone number.", { email: "Email or phone" });
      }
      const [row] = await db
        .insert(schema.invites)
        .values({
          stationId: scope.kind === "station" ? scope.id : null,
          advertiserId: scope.kind === "business" ? scope.id : null,
          email: input.email?.toLowerCase() ?? null,
          phone: input.phone ?? null,
          role: input.role as InviteRow["role"],
          invitedBy: user.id,
          expiresAt: new Date(deps.clock.now().getTime() + INVITE_DAYS * 86_400_000)
        })
        .returning();
      const teamName =
        scope.kind === "station"
          ? ((await stationIdents([scope.id])).get(scope.id)?.name ?? "a station")
          : ((await services.spots.businessNames([scope.id])).get(scope.id) ?? "a business");
      deps.bus.emit("invite.created", { inviteId: row.id, email: row.email, phone: row.phone, teamName });
      return inviteRow(row);
    },

    async updateMember(scope, userId, input) {
      if (scope.kind === "station") {
        const m = schema.stationMemberships;
        const [current] = await db.select().from(m).where(and(eq(m.stationId, scope.id), eq(m.userId, userId)));
        if (!current) throw notFound("That member");
        if (current.role === "owner" && input.role) throw refused("owner_role", "Move ownership to change the owner's role.");
        await db
          .update(m)
          .set({ ...(input.role ? { role: input.role as StationRole } : {}), ...(input.note !== undefined ? { note: input.note } : {}) })
          .where(and(eq(m.stationId, scope.id), eq(m.userId, userId)));
      } else {
        const m = schema.advertiserMemberships;
        const [current] = await db.select().from(m).where(and(eq(m.advertiserId, scope.id), eq(m.userId, userId)));
        if (!current) throw notFound("That member");
        if (current.role === "owner" && input.role) throw refused("owner_role", "The owner's role can't change.");
        await db
          .update(m)
          .set({ ...(input.role ? { role: input.role as BusinessRole } : {}), ...(input.note !== undefined ? { note: input.note } : {}) })
          .where(and(eq(m.advertiserId, scope.id), eq(m.userId, userId)));
      }
    },

    async removeMember(scope, userId) {
      if (scope.kind === "station") {
        const m = schema.stationMemberships;
        const [current] = await db.select().from(m).where(and(eq(m.stationId, scope.id), eq(m.userId, userId)));
        if (current?.role === "owner") throw refused("owner_role", "The owner can't be removed. Move ownership first.");
        await db.delete(m).where(and(eq(m.stationId, scope.id), eq(m.userId, userId)));
        await services.stations.removeHost(scope.id, userId);
      } else {
        const m = schema.advertiserMemberships;
        const [current] = await db.select().from(m).where(and(eq(m.advertiserId, scope.id), eq(m.userId, userId)));
        if (current?.role === "owner") throw refused("owner_role", "The owner can't be removed.");
        await db.delete(m).where(and(eq(m.advertiserId, scope.id), eq(m.userId, userId)));
      }
    },

    async transferStationOwnership(stationId, fromUserId, toUserId) {
      const m = schema.stationMemberships;
      await db.transaction(async (tx) => {
        const [target] = await tx.select().from(m).where(and(eq(m.stationId, stationId), eq(m.userId, toUserId)));
        if (!target) throw refused("not_a_member", "Ownership can only go to someone already on the team.");
        await tx.update(m).set({ role: "operator" }).where(and(eq(m.stationId, stationId), eq(m.userId, fromUserId)));
        await tx.update(m).set({ role: "owner" }).where(and(eq(m.stationId, stationId), eq(m.userId, toUserId)));
      });
    },

    async resendInvite(user, inviteId) {
      const [row] = await db.select().from(schema.invites).where(eq(schema.invites.id, inviteId));
      if (!row) throw notFound("That invite");
      if (row.stationId) await service.requireStation(user, row.stationId, ["owner"]);
      if (row.advertiserId) await service.requireBusiness(user, row.advertiserId, ["owner"]);
      const [updated] = await db
        .update(schema.invites)
        .set({ expiresAt: new Date(deps.clock.now().getTime() + INVITE_DAYS * 86_400_000) })
        .where(eq(schema.invites.id, inviteId))
        .returning();
      return inviteRow(updated);
    },

    async acceptInvite(user, inviteId) {
      const [row] = await db.select().from(schema.invites).where(eq(schema.invites.id, inviteId));
      if (!row || row.acceptedAt) throw notFound("That invite");
      if (row.expiresAt.getTime() < deps.clock.now().getTime()) throw refused("invite_expired", "This invite has expired. Ask for a new one.");
      await db.transaction(async (tx) => {
        if (row.stationId) await service.addStationMember(tx, row.stationId, user.id, row.role as StationRole);
        if (row.advertiserId) await service.addBusinessMember(tx, row.advertiserId, user.id, row.role as BusinessRole);
        await tx.update(schema.invites).set({ acceptedAt: deps.clock.now(), acceptedBy: user.id }).where(eq(schema.invites.id, inviteId));
      });
    }
  };
  return service;
}
