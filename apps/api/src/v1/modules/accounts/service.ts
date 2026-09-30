import { and, asc, desc, eq, gt, gte, inArray, isNull, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { AccountExport, ClearLink, InvitePreview, Me, NotificationTiming, OpencastTeamMember, StationIdent, WatchHistory } from "@opencast/contracts";
import type { Executor, ModuleContext } from "../../context.js";
import type { CurrentUser } from "../../http.js";
import { ClearLookupUnavailable } from "../../clearLink.js";
import { badRequest, conflict, forbidden, HttpError, notFound, refused } from "../../errors.js";
import { maskEmail } from "../../email.js";

export type StationRole = "owner" | "operator" | "host";
export type BusinessRole = "owner" | "manager" | "viewer";

type PresetInput = { stationId: string; key: number | null };

const INVITE_DAYS = 7;
const DAY_MS = 86_400_000;
/** An invite's email goes again at most this often (each send sets the expiry a week out, so the last send is known). */
const RESEND_GAP_MS = 10 * 60_000;
/** Watch history is kept this long (the settings say "Kept for 30 days"). */
const WATCH_HISTORY_DAYS = 30;
/** Heartbeats closer than this to the last one on the same station extend it, rather than start a new stretch. */
const WATCH_GAP_MS = 2 * 60_000;

/** Tokens issued before this second, or from a session ended by it, answer 401. */
const signedOut = () => new HttpError(401, "signed_out", "You were signed out. Sign in again.");
const accountDeleted = () => new HttpError(401, "account_deleted", "This account was deleted. Sign in again to start a new one.");
/**
 * "Sign out everywhere" and deleting an account are compared with the token's `iat`, which is
 * Privy's wall clock, so they're recorded by the wall clock too, not the business clock.
 */
const wallClock = () => new Date();
const second = (d: Date) => Math.floor(d.getTime() / 1000);

/** Unset counts as on, as the settings show it. */
export const keepsWatchHistory = (settings: unknown) => (settings as { privacy?: { keepWatchHistory?: boolean } } | null)?.privacy?.keepWatchHistory !== false;
/** Station kinds Opencast runs itself: admins act as their owner. */
const OPENCAST_RUN_KINDS = new Set(["claimable", "catalog", "listed"]);

export interface AccountsService {
  userForToken(token: string): Promise<CurrentUser>;
  /** A person by id, as a caller (a TV session acts as them). Null if there's no such person. */
  currentUser(userId: string): Promise<CurrentUser | null>;
  me(userId: string): Promise<Me>;
  updateMe(userId: string, input: { displayName?: string | null; marketId?: string | null; settings?: Record<string, unknown> }): Promise<Me>;
  displayNames(userIds: string[]): Promise<Map<string, string | null>>;
  /** Every email the user has, lower-cased (their account email and linked ones). */
  emailsOf(userId: string): Promise<string[]>;
  /**
   * Added 2026-09-29: the signed-in person's verified emails as accepting an invite checks them
   * (INVITE_EMAIL_MATCH): the ones recorded, and Privy's linked accounts read again.
   */
  verifiedEmails(user: CurrentUser): Promise<string[]>;
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
  /**
   * Added 2026-09-29 (log edits): the reminders on log entries, by entry (who set them). A log
   * edit that takes an entry off warns with the count, and tells each of them.
   */
  remindersOnEntries(entryIds: string[], ex?: Executor): Promise<Map<string, Array<{ id: string; userId: string }>>>;
  /**
   * An entry comes off the log and the program airs again later: its reminders move to that
   * airing, to be reminded again at its start. Someone who already has one there keeps that one
   * (the moved one goes). Answers everyone whose reminder moved.
   */
  moveReminders(ex: Executor, fromEntryId: string, toEntryId: string): Promise<Array<{ id: string; userId: string }>>;
  /** An entry comes off the log with nothing to move to: its reminders are cancelled. Answers them. */
  cancelReminders(ex: Executor, entryIds: string[]): Promise<Array<{ id: string; userId: string; logEntryId: string }>>;
  /** Entries moved (a new start): their reminders come again at the new start, even if one already went. */
  rearmReminders(ex: Executor, entryIds: string[]): Promise<void>;

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
  /**
   * Reads the person's wallets from Privy again and records any new one (the embedded wallet the
   * claim page makes, since Privy makes none at sign-in), then answers as `walletOf`. Needs
   * PRIVY_APP_SECRET; without it, what's recorded already.
   */
  recordWallets(userId: string): Promise<string | null>;
  businessMemberIds(businessId: string, roles?: BusinessRole[]): Promise<string[]>;
  /** P21: a closed business: everyone on its team loses access, and its open invites expire. */
  closeBusinessAccess(businessId: string): Promise<void>;

  /** The person's linked Clear wallet, or null. `access` is full only while Clear still grants full access. */
  clearLink(userId: string): Promise<ClearLinkView | null>;
  /** A link by its ID, still linked or not (funding sources and payout destinations keep the ID). */
  clearLinkById(linkId: string): Promise<ClearLinkView | null>;
  /** Records the Clear wallet the person linked in Privy. 409 when Clear isn't linked there, or isn't set up here. */
  linkClear(user: CurrentUser): Promise<ClearLink>;
  /** Forgets it. Funding sources and payout destinations that used it stop working. */
  unlinkClear(userId: string): Promise<void>;

  // ---- Added 2026-09-28: A1, A2, A3, A6, O2 ----
  /** A1: refuses every token issued before now, and every session seen before now; TVs signed out too. */
  signOutEverywhere(userId: string): Promise<void>;
  /** A2: from a signed-in heartbeat, while keepWatchHistory is on. */
  recordWatching(userId: string, stationId: string): Promise<void>;
  watchHistory(userId: string): Promise<WatchHistory>;
  clearWatchHistory(userId: string): Promise<void>;
  /** A3: emails a link to the download. */
  exportData(userId: string): Promise<{ email: string; readyBy: string }>;
  downloadData(userId: string): Promise<AccountExport>;
  deleteAccount(userId: string): Promise<void>;
  /** A6: the Opencast team (admins). */
  opencastTeam(): Promise<OpencastTeamMember[]>;
  /** Added 2026-09-29 (desk Settings): people by id, with the name to show and their account email. */
  peopleByIds(userIds: string[]): Promise<Map<string, { name: string; email: string | null; isAdmin: boolean; adminByEmail: boolean }>>;
  /** The account with this email (its own, or a verified linked email, Google or Apple address), if one exists. */
  userIdByEmail(email: string): Promise<string | null>;
  /** Makes someone an Opencast admin, or not (desk Settings, Team). OPENCAST_ADMIN_EMAILS still makes admins at sign-in. */
  setAdmin(userId: string, isAdmin: boolean): Promise<void>;
  /** O2: the person's notification timing, and the time zone it's read in (their market's). */
  notificationTiming(userId: string): Promise<{ timing: NotificationTiming; timezone: string }>;

  team(scope: TeamScope): Promise<TeamView>;
  invite(user: CurrentUser, scope: TeamScope, input: { email?: string; phone?: string; role: string; note?: string; programIds?: string[] }): Promise<InviteRow>;
  /** A5: each station the person is on, in membership order: on air, and the next dead air within six hours. */
  stationStatus(userId: string): Promise<Array<{ stationId: string; onAir: boolean; deadAirAt: string | null; deadAirEndsAt: string | null }>>;
  updateMember(scope: TeamScope, userId: string, input: { role?: string; note?: string | null }): Promise<void>;
  removeMember(scope: TeamScope, userId: string): Promise<void>;
  transferStationOwnership(stationId: string, fromUserId: string, toUserId: string): Promise<void>;
  /** Emails the invite again (10 minutes apart at least) and extends it a week. */
  resendInvite(user: CurrentUser, inviteId: string): Promise<InviteRow>;
  /** Joins the team. An invite to an email needs that email on the account, unless INVITE_EMAIL_MATCH=off. */
  acceptInvite(user: CurrentUser, inviteId: string): Promise<void>;
  /** An invite as its link's page shows it; signed in, whether the account's email matches. */
  invitePreview(inviteId: string, user: CurrentUser | null): Promise<InvitePreview>;
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
  programIds?: string[];
}

export interface TeamView {
  members: Array<{
    userId: string;
    displayName: string | null;
    email: string | null;
    role: string;
    note: string | null;
    lastInAt: string | null;
    programIds?: string[];
  }>;
  invites: InviteRow[];
}

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);

export function createAccountsService({ deps, services }: ModuleContext): AccountsService {
  const { db } = deps;
  const u = schema.users;

  // Opencast admins by email (OPENCAST_ADMIN_EMAILS, comma-separated): whoever signs in through Privy
  // with one of them (email, Google or Apple) is made an admin. It only ever adds admins; taking one
  // away is still `is_admin = false` by hand. Each user is looked at once per process.
  const lookedAtForAdmin = new Set<string>();
  const adminEmails = () => new Set((process.env.OPENCAST_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
  async function promoteByEmail<T extends { id: string; isAdmin: boolean }>(user: T): Promise<T> {
    const emails = adminEmails();
    if (user.isAdmin || !emails.size || lookedAtForAdmin.has(user.id)) return user;
    lookedAtForAdmin.add(user.id);
    const I = schema.identities;
    const rows = await db.select({ value: I.value }).from(I).where(and(eq(I.userId, user.id), inArray(I.kind, ["email", "google", "apple"])));
    if (!rows.some((r) => emails.has(r.value.toLowerCase()))) return user;
    await db.update(u).set({ isAdmin: true }).where(eq(u.id, user.id));
    return { ...user, isAdmin: true };
  }

  async function findOrCreateUser(privyDid: string, issuedAt: Date | null, sid: string | null) {
    const [existing] = await db.select().from(u).where(eq(u.privyDid, privyDid));
    if (existing?.deletedAt) {
      // A token from before the account was deleted is refused; a sign-in since starts a new account.
      const before = !issuedAt || second(issuedAt) < second(existing.deletedAt);
      const [ended] = sid ? await db.select().from(schema.signInSessions).where(and(eq(schema.signInSessions.userId, existing.id), eq(schema.signInSessions.sid, sid))) : [];
      if (before || ended) throw accountDeleted();
      await db.update(u).set({ privyDid: null }).where(eq(u.id, existing.id));
    } else if (existing) {
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
      createdAt: row.createdAt.toISOString(),
      ...(row.programIds ? { programIds: row.programIds } : {})
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
      const user = await promoteByEmail(await findOrCreateUser(verified.privyDid, verified.issuedAt, verified.sessionId));
      // A1: signed out everywhere. Tokens from before it are refused by their iat; a session seen
      // before it stays ended even after Privy refreshes its token.
      if (user.signedOutAt && (!verified.issuedAt || second(verified.issuedAt) < second(user.signedOutAt))) throw signedOut();
      if (verified.sessionId) {
        const S = schema.signInSessions;
        const [session] = await db
          .select({ endedAt: S.endedAt })
          .from(S)
          .where(and(eq(S.userId, user.id), eq(S.sid, verified.sessionId)));
        if (session?.endedAt) throw signedOut();
        if (!session) await db.insert(S).values({ userId: user.id, sid: verified.sessionId, firstSeenAt: wallClock() }).onConflictDoNothing();
      }
      return { id: user.id, privyDid: user.privyDid, isAdmin: user.isAdmin };
    },

    async currentUser(userId) {
      const [user] = await db
        .select({ id: u.id, privyDid: u.privyDid, isAdmin: u.isAdmin })
        .from(u)
        .where(and(eq(u.id, userId), isNull(u.deletedAt)));
      return user ?? null;
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
      // Opencast admins run every station Opencast runs (network, claimable, listed) as its owner
      // (stationRole), so master control lists those too, after their own.
      if (user.isAdmin) {
        const own = new Set(stationRows.map((r) => r.stationId));
        const run = await services.stations.idsOfKinds([...OPENCAST_RUN_KINDS] as Array<"claimable" | "catalog" | "listed">);
        for (const id of run) if (!own.has(id)) stationRows.push({ stationId: id, role: "owner" } as (typeof stationRows)[number]);
      }
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
        clear: clear ? { address: clear.address, access: clear.access, linkedAt: clear.linkedAt } : null,
        // Added 2026-09-29: Network desk roles (admin, rights reviewer, market lead).
        deskRoles: await services.settings.rolesOf({ id: user.id, isAdmin: user.isAdmin })
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
      // Turning watch history off stops keeping it, and forgets what was kept.
      if (input.settings && !keepsWatchHistory(input.settings) && (input.settings as { privacy?: object }).privacy) {
        await service.clearWatchHistory(userId);
      }
      return service.me(userId);
    },

    async peopleByIds(userIds) {
      const ids = [...new Set(userIds)];
      if (!ids.length) return new Map();
      const rows = await db.select({ id: u.id, displayName: u.displayName, email: u.email, isAdmin: u.isAdmin }).from(u).where(inArray(u.id, ids));
      const listed = adminEmails();
      const linked = listed.size
        ? await db
            .select({ userId: schema.identities.userId, value: schema.identities.value })
            .from(schema.identities)
            .where(and(inArray(schema.identities.userId, ids), inArray(schema.identities.kind, ["email", "google", "apple"])))
        : [];
      return new Map(
        rows.map((r) => [
          r.id,
          {
            name: r.displayName ?? r.email ?? "Someone on the team",
            email: r.email,
            isAdmin: r.isAdmin,
            adminByEmail: listed.size > 0 && [r.email, ...linked.filter((l) => l.userId === r.id).map((l) => l.value)].some((e) => !!e && listed.has(e.toLowerCase()))
          }
        ])
      );
    },

    async userIdByEmail(email) {
      const e = email.trim().toLowerCase();
      const [own] = await db
        .select({ id: u.id })
        .from(u)
        .where(and(sql`lower(${u.email}) = ${e}`, isNull(u.deletedAt)));
      if (own) return own.id;
      const [linked] = await db
        .select({ id: schema.identities.userId })
        .from(schema.identities)
        .innerJoin(u, eq(u.id, schema.identities.userId))
        .where(and(sql`lower(${schema.identities.value}) = ${e}`, inArray(schema.identities.kind, ["email", "google", "apple"]), isNull(u.deletedAt)));
      return linked?.id ?? null;
    },

    async setAdmin(userId, isAdmin) {
      await db.update(u).set({ isAdmin }).where(eq(u.id, userId));
    },

    async displayNames(userIds) {
      if (!userIds.length) return new Map();
      const rows = await db.select({ id: u.id, displayName: u.displayName }).from(u).where(inArray(u.id, userIds));
      return new Map(rows.map((r) => [r.id, r.displayName]));
    },

    verifiedEmails: (user) => verifiedEmails(user),

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
      // O2: "How early", per person (at the start unless they said otherwise).
      const userIds = [...new Set(rows.map((r) => r.userId))];
      const people = userIds.length ? await db.select({ id: u.id, settings: u.settings }).from(u).where(inArray(u.id, userIds)) : [];
      const lead = new Map(people.map((p) => [p.id, (p.settings as { notifications?: NotificationTiming } | null)?.notifications?.leadMinutes ?? 0]));
      return views
        .filter((v) => {
          const startsAt = Date.parse(v.airing.startsAt);
          const window = Math.max(withinMinutes, lead.get(byId.get(v.id)!) ?? 0);
          return startsAt >= now && startsAt - now <= window * 60_000;
        })
        .map((v) => ({ ...v, userId: byId.get(v.id)! }));
    },

    async markReminderNotified(reminderId) {
      await db.update(schema.reminders).set({ notifiedAt: deps.clock.now() }).where(eq(schema.reminders.id, reminderId));
    },

    async remindersOnEntries(entryIds, ex = db) {
      const R = schema.reminders;
      const out = new Map<string, Array<{ id: string; userId: string }>>();
      if (!entryIds.length) return out;
      const rows = await ex.select({ id: R.id, userId: R.userId, logEntryId: R.logEntryId }).from(R).where(inArray(R.logEntryId, [...new Set(entryIds)]));
      for (const r of rows) {
        const list = out.get(r.logEntryId!) ?? [];
        list.push({ id: r.id, userId: r.userId });
        out.set(r.logEntryId!, list);
      }
      return out;
    },

    async moveReminders(ex, fromEntryId, toEntryId) {
      const R = schema.reminders;
      const moving = await ex.select().from(R).where(eq(R.logEntryId, fromEntryId));
      if (!moving.length) return [];
      const there = await ex
        .select({ userId: R.userId })
        .from(R)
        .where(and(eq(R.logEntryId, toEntryId), inArray(R.userId, [...new Set(moving.map((r) => r.userId))])));
      const has = new Set(there.map((r) => r.userId));
      const dupes = moving.filter((r) => has.has(r.userId)).map((r) => r.id);
      if (dupes.length) await ex.delete(R).where(inArray(R.id, dupes));
      const kept = moving.filter((r) => !has.has(r.userId)).map((r) => r.id);
      // Reminded again at the new airing's start.
      if (kept.length) await ex.update(R).set({ logEntryId: toEntryId, notifiedAt: null }).where(inArray(R.id, kept));
      return moving.map((r) => ({ id: r.id, userId: r.userId }));
    },

    async cancelReminders(ex, entryIds) {
      const R = schema.reminders;
      if (!entryIds.length) return [];
      const rows = await ex.delete(R).where(inArray(R.logEntryId, [...new Set(entryIds)])).returning({ id: R.id, userId: R.userId, logEntryId: R.logEntryId });
      return rows.map((r) => ({ id: r.id, userId: r.userId, logEntryId: r.logEntryId! }));
    },

    async rearmReminders(ex, entryIds) {
      const R = schema.reminders;
      if (!entryIds.length) return;
      await ex.update(R).set({ notifiedAt: null }).where(and(inArray(R.logEntryId, [...new Set(entryIds)]), sql`${R.notifiedAt} is not null`));
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

    async recordWallets(userId) {
      const [user] = await db.select({ privyDid: u.privyDid }).from(u).where(eq(u.id, userId));
      if (user?.privyDid) {
        const linked = await deps.auth.linkedAccounts(user.privyDid).catch(() => []);
        for (const account of linked.filter((a) => a.kind === "wallet")) {
          await db
            .insert(schema.identities)
            .values({ userId, kind: "wallet", value: account.value, verifiedAt: deps.clock.now() })
            .onConflictDoNothing();
        }
      }
      return service.walletOf(userId);
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

    async closeBusinessAccess(businessId) {
      await db.transaction(async (tx) => {
        await tx.delete(schema.advertiserMemberships).where(eq(schema.advertiserMemberships.advertiserId, businessId));
        await tx
          .update(schema.invites)
          .set({ expiresAt: deps.clock.now() })
          .where(and(eq(schema.invites.advertiserId, businessId), isNull(schema.invites.acceptedAt), gt(schema.invites.expiresAt, deps.clock.now())));
      });
    },

    async signOutEverywhere(userId) {
      const at = wallClock();
      await db.update(u).set({ signedOutAt: at }).where(eq(u.id, userId));
      await db
        .update(schema.signInSessions)
        .set({ endedAt: at })
        .where(and(eq(schema.signInSessions.userId, userId), isNull(schema.signInSessions.endedAt)));
      // TVs (their own sessions) and the phones driving them.
      await services.tv.signOutEverywhere(userId);
    },

    async recordWatching(userId, stationId) {
      const W = schema.watchHistory;
      const [user] = await db.select({ settings: u.settings, deletedAt: u.deletedAt }).from(u).where(eq(u.id, userId));
      if (!user || user.deletedAt || !keepsWatchHistory(user.settings)) return;
      const at = deps.clock.now();
      const [last] = await db.select().from(W).where(eq(W.userId, userId)).orderBy(desc(W.lastAt)).limit(1);
      if (last && last.stationId === stationId && at >= last.lastAt && at.getTime() - last.lastAt.getTime() <= WATCH_GAP_MS) {
        await db.update(W).set({ lastAt: at }).where(eq(W.id, last.id));
        return;
      }
      await db.insert(W).values({ userId, stationId, startedAt: at, lastAt: at });
      await db.delete(W).where(and(eq(W.userId, userId), sql`${W.lastAt} < ${new Date(at.getTime() - WATCH_HISTORY_DAYS * 86_400_000)}`));
    },

    async watchHistory(userId) {
      const W = schema.watchHistory;
      const [user] = await db.select({ settings: u.settings }).from(u).where(eq(u.id, userId));
      const since = new Date(deps.clock.now().getTime() - WATCH_HISTORY_DAYS * 86_400_000);
      const rows = await db
        .select()
        .from(W)
        .where(and(eq(W.userId, userId), gte(W.lastAt, since)))
        .orderBy(desc(W.lastAt))
        .limit(200);
      const idents = await stationIdents(rows.map((r) => r.stationId));
      const items = rows.flatMap((r) => {
        const station = idents.get(r.stationId);
        return station ? [{ station, startedAt: r.startedAt.toISOString(), endedAt: r.lastAt.toISOString() }] : [];
      });
      return {
        keep: keepsWatchHistory(user?.settings),
        lastChannel: items[0] ? { station: items[0].station, at: items[0].endedAt } : null,
        items
      };
    },

    async clearWatchHistory(userId) {
      await db.delete(schema.watchHistory).where(eq(schema.watchHistory.userId, userId));
    },

    async exportData(userId) {
      const [email] = await service.emailsOf(userId);
      if (!email) throw conflict("no_email", "Add an email to your account first: the link goes there.");
      const now = deps.clock.now();
      // The file is made when it's downloaded (signed in), so the link carries nothing itself.
      await deps.notifier.email(email, {
        title: "Your Opencast data",
        body: "Everything your account holds, in one file: presets, reminders, watch history, pledges and receipts, notices, TVs and settings. Sign in to download it.",
        link: `${deps.config.appOrigin.replace(/\/+$/, "")}/settings/data?download=1`,
        action: "Download your data",
        footer: "You asked for this in Settings, Your data. The link needs you signed in.",
        kind: "data"
      });
      return { email, readyBy: now.toISOString() };
    },

    async downloadData(userId) {
      const [user] = await db.select().from(u).where(eq(u.id, userId));
      if (!user) throw notFound("Your account");
      const P = schema.notificationPrefs;
      const [me, presets, reminderRowsAll, history, pledges, prefs, notices, tvs] = await Promise.all([
        service.me(userId),
        service.presets(userId),
        db.select().from(schema.reminders).where(eq(schema.reminders.userId, userId)).then(reminderRows),
        service.watchHistory(userId),
        services.ledger.pledges(userId),
        db.select().from(P).where(eq(P.userId, userId)),
        services.notifications.list(userId, { limit: 1000 }),
        services.tv.listTvs(userId)
      ]);
      return {
        exportedAt: deps.clock.now().toISOString(),
        account: { id: me.id, displayName: me.displayName, email: me.email, market: me.market, createdAt: user.createdAt.toISOString(), settings: me.settings },
        identities: me.identities,
        memberships: me.memberships,
        presets,
        reminders: reminderRowsAll,
        watchHistory: history.items,
        pledges,
        notificationPrefs: prefs.map((p) => ({ scope: p.scope === "advertiser" ? ("business" as const) : p.scope, scopeId: p.scopeId, prefs: p.prefs as Record<string, { push: boolean; email: boolean }> })),
        notices,
        tvs,
        clear: me.clear ?? null
      };
    },

    async deleteAccount(userId) {
      const [owner] = await db
        .select({ stationId: schema.stationMemberships.stationId })
        .from(schema.stationMemberships)
        .where(and(eq(schema.stationMemberships.userId, userId), eq(schema.stationMemberships.role, "owner")))
        .limit(1);
      if (owner) throw conflict("owns_station", "You own a station. Make someone on its team the owner first, then delete your account.");
      const [business] = await db
        .select({ id: schema.advertiserMemberships.advertiserId })
        .from(schema.advertiserMemberships)
        .where(and(eq(schema.advertiserMemberships.userId, userId), eq(schema.advertiserMemberships.role, "owner")))
        .limit(1);
      if (business) throw conflict("owns_business", "You own a business on Opencast. Close it (or ask us to move it) first, then delete your account.");

      // Other modules first: pledges stop after this month, TVs sign out, notices go.
      await services.ledger.stopPledgesOf(userId);
      await services.tv.forgetUser(userId);
      await services.notifications.forgetUser(userId);

      const hostOf = await db
        .select({ stationId: schema.stationMemberships.stationId })
        .from(schema.stationMemberships)
        .where(eq(schema.stationMemberships.userId, userId));
      const at = wallClock();
      await db.transaction(async (tx) => {
        await tx.delete(schema.presets).where(eq(schema.presets.userId, userId));
        await tx.delete(schema.presetKeyUse).where(eq(schema.presetKeyUse.userId, userId));
        await tx.delete(schema.reminders).where(eq(schema.reminders.userId, userId));
        await tx.delete(schema.notificationPrefs).where(eq(schema.notificationPrefs.userId, userId));
        await tx.delete(schema.devices).where(eq(schema.devices.userId, userId));
        await tx.delete(schema.watchHistory).where(eq(schema.watchHistory.userId, userId));
        await tx.delete(schema.identities).where(eq(schema.identities.userId, userId));
        await tx.delete(schema.stationMemberships).where(eq(schema.stationMemberships.userId, userId));
        await tx.delete(schema.advertiserMemberships).where(eq(schema.advertiserMemberships.userId, userId));
        await tx.update(schema.clearLinks).set({ unlinkedAt: at }).where(and(eq(schema.clearLinks.userId, userId), isNull(schema.clearLinks.unlinkedAt)));
        await tx.update(schema.signInSessions).set({ endedAt: at }).where(and(eq(schema.signInSessions.userId, userId), isNull(schema.signInSessions.endedAt)));
        // The row stays, empty, because the ledger and others' records point at it.
        await tx
          .update(u)
          .set({ displayName: null, email: null, marketId: null, isAdmin: false, settings: {}, signedOutAt: at, deletedAt: at })
          .where(eq(u.id, userId));
      });
      for (const { stationId } of hostOf) await services.stations.removeHost(stationId, userId);
    },

    async stationStatus(userId) {
      const rows = await db.select({ stationId: schema.stationMemberships.stationId }).from(schema.stationMemberships).where(eq(schema.stationMemberships.userId, userId));
      const ids = rows.map((r) => r.stationId);
      const status = await services.playout.statusFor(ids);
      const now = deps.clock.now();
      return Promise.all(
        ids.map(async (stationId) => {
          const onAir = status.get(stationId)?.onAir ?? false;
          // Off air there's no dead air to warn about.
          const [gap] = onAir ? await services.log.gaps(stationId, now, new Date(now.getTime() + 6 * 3_600_000)) : [];
          return { stationId, onAir, deadAirAt: gap?.startsAt ?? null, deadAirEndsAt: gap?.endsAt ?? null };
        })
      );
    },

    async opencastTeam() {
      const rows = await db
        .select({ id: u.id, displayName: u.displayName, email: u.email })
        .from(u)
        .where(and(eq(u.isAdmin, true), isNull(u.deletedAt)))
        .orderBy(asc(u.displayName));
      return rows.map((r) => ({ id: r.id, name: r.displayName ?? r.email ?? "Opencast team", email: r.email ?? "" }));
    },

    async notificationTiming(userId) {
      const [user] = await db.select({ settings: u.settings, marketId: u.marketId }).from(u).where(eq(u.id, userId));
      const market = user?.marketId ? (await services.network.marketsByIds([user.marketId])).get(user.marketId) : undefined;
      return {
        timing: ((user?.settings as { notifications?: NotificationTiming } | null)?.notifications ?? {}) as NotificationTiming,
        timezone: market?.timezone ?? "America/Los_Angeles"
      };
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
      // A4: a host's live programs.
      const hosting = scope.kind === "station" ? await services.stations.hostPrograms(scope.id) : new Map<string, string[]>();
      return {
        members: members
          .map((m) => ({ ...m, lastInAt: iso(m.lastInAt), ...(scope.kind === "station" && m.role === "host" ? { programIds: hosting.get(m.userId) ?? [] } : {}) }))
          .sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9)),
        invites: invites.map(inviteRow)
      };
    },

    async invite(user, scope, input) {
      if (!input.email && !input.phone) {
        throw badRequest("Give an email or a phone number.", { email: "Email or phone" });
      }
      // A4: a host invite can name the live programs they'll host.
      const programIds = input.programIds?.length ? [...new Set(input.programIds)] : null;
      if (programIds) {
        if (scope.kind !== "station" || input.role !== "host") throw badRequest("Only a host invite names programs.", { programIds: "Hosts only" });
        const live = new Set((await services.library.programsForStation(scope.id)).filter((p) => p.live).map((p) => p.id));
        if (programIds.some((id) => !live.has(id))) throw badRequest("Hosts host this station's live programs.", { programIds: "Not a live program here" });
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
          expiresAt: new Date(deps.clock.now().getTime() + INVITE_DAYS * 86_400_000),
          programIds
        })
        .returning();
      deps.bus.emit("invite.created", await inviteSend(row));
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
      if (row.acceptedAt) throw conflict("invite_used", "They've already joined.");
      const now = deps.clock.now();
      // Every send sets the expiry a week out, so the last send was a week before it.
      const lastSent = row.expiresAt.getTime() - INVITE_DAYS * DAY_MS;
      const wait = lastSent + RESEND_GAP_MS - now.getTime();
      if (wait > 0) {
        const ago = Math.max(0, Math.floor((now.getTime() - lastSent) / 60_000));
        const left = Math.ceil(wait / 60_000);
        throw new HttpError(
          429,
          "resend_too_soon",
          `It went out ${ago === 0 ? "less than a minute" : `${ago} minute${ago === 1 ? "" : "s"}`} ago. You can send it again in ${left} minute${left === 1 ? "" : "s"}.`
        );
      }
      const [updated] = await db
        .update(schema.invites)
        .set({ expiresAt: new Date(now.getTime() + INVITE_DAYS * DAY_MS) })
        .where(eq(schema.invites.id, inviteId))
        .returning();
      if (updated.email) {
        const send = await inviteSend(updated);
        try {
          await services.notifications.sendInvite({ ...send, email: updated.email });
        } catch {
          // Nothing changes when the email didn't go, so trying again isn't held back.
          await db.update(schema.invites).set({ expiresAt: row.expiresAt }).where(eq(schema.invites.id, inviteId));
          throw new HttpError(502, "email_not_sent", "The email didn't go out. Try again in a few minutes.");
        }
      }
      return inviteRow(updated);
    },

    async acceptInvite(user, inviteId) {
      const [row] = await db.select().from(schema.invites).where(eq(schema.invites.id, inviteId));
      if (!row) throw notFound("That invite");
      if (row.acceptedAt) {
        // Accepting your own invite again (a second tap, a reload) changes nothing.
        if (row.acceptedBy === user.id) return;
        throw conflict("invite_used", "This invite was already used. Ask for a new one if you still need to join.");
      }
      if (row.expiresAt.getTime() < deps.clock.now().getTime()) throw refused("invite_expired", "This invite has expired. Ask for a new one.");
      if (row.email && deps.config.inviteEmailMatch !== false) {
        const emails = await verifiedEmails(user);
        if (!emails.includes(row.email.toLowerCase())) {
          throw new HttpError(
            403,
            "invite_email_mismatch",
            `This invite is for ${maskEmail(row.email)}; you're signed in as ${emails[0] ?? "an account with no email"}. Sign in with ${maskEmail(row.email)} to join.`
          );
        }
      }
      await db.transaction(async (tx) => {
        // Only one person can use an invite, even two at once.
        const [taken] = await tx
          .update(schema.invites)
          .set({ acceptedAt: deps.clock.now(), acceptedBy: user.id })
          .where(and(eq(schema.invites.id, inviteId), isNull(schema.invites.acceptedAt)))
          .returning({ id: schema.invites.id });
        if (!taken) throw conflict("invite_used", "This invite was already used. Ask for a new one if you still need to join.");
        if (row.stationId) await service.addStationMember(tx, row.stationId, user.id, row.role as StationRole);
        // A4: the programs the invite named, still live programs of the station.
        if (row.stationId && row.role === "host" && row.programIds?.length) await services.stations.addHost(tx, row.stationId, user.id, row.programIds);
        if (row.advertiserId) await service.addBusinessMember(tx, row.advertiserId, user.id, row.role as BusinessRole);
      });
    },

    async invitePreview(inviteId, user) {
      const [row] = await db.select().from(schema.invites).where(eq(schema.invites.id, inviteId));
      if (!row) throw notFound("That invite");
      const team = await inviteTeam(row);
      const [inviter] = await db.select({ displayName: u.displayName }).from(u).where(eq(u.id, row.invitedBy));
      const state = row.acceptedAt ? "accepted" : row.expiresAt.getTime() < deps.clock.now().getTime() ? "expired" : "open";
      const emails = user ? await verifiedEmails(user) : [];
      return {
        id: row.id,
        team,
        role: row.role,
        invitedBy: inviter?.displayName ?? null,
        emailHint: row.email ? maskEmail(row.email) : null,
        state,
        expiresAt: row.expiresAt.toISOString(),
        signedInAs: user ? (emails[0] ?? null) : null,
        emailMatches: user && row.email && deps.config.inviteEmailMatch !== false ? emails.includes(row.email.toLowerCase()) : null,
        acceptedByYou: Boolean(user && row.acceptedBy === user.id)
      };
    }
  };

  /** The team an invite is for, as its page names it. */
  async function inviteTeam(row: typeof schema.invites.$inferSelect): Promise<InvitePreview["team"]> {
    if (row.stationId) {
      const ident = (await stationIdents([row.stationId])).get(row.stationId);
      return { kind: "station", id: row.stationId, name: ident?.name ?? "A station", callSign: ident?.callSign ?? null };
    }
    const businessId = row.advertiserId!;
    return { kind: "business", id: businessId, name: (await services.spots.businessNames([businessId])).get(businessId) ?? "A business", callSign: null };
  }

  /** What an invite's email needs: the team, the role, who sent it, and this send's time. */
  async function inviteSend(row: typeof schema.invites.$inferSelect) {
    const team = await inviteTeam(row);
    const [inviter] = await db.select({ displayName: u.displayName }).from(u).where(eq(u.id, row.invitedBy));
    return {
      inviteId: row.id,
      email: row.email,
      phone: row.phone,
      teamName: team.name,
      scope: team.kind,
      role: row.role,
      invitedByName: inviter?.displayName ?? null,
      expiresAt: row.expiresAt.toISOString(),
      sentAt: deps.clock.now().toISOString()
    };
  }

  /**
   * The signed-in person's verified emails (email sign-in, Google, Apple), lower-cased: the ones
   * recorded, and Privy's linked accounts read again (recorded too), so an address linked since
   * the first sign-in counts.
   */
  async function verifiedEmails(user: CurrentUser): Promise<string[]> {
    const recorded = await service.emailsOf(user.id);
    if (!user.privyDid) return recorded;
    const linked = (await deps.auth.linkedAccounts(user.privyDid).catch(() => [])).filter((a) => a.kind !== "wallet" && a.value.includes("@"));
    for (const account of linked) {
      await db
        .insert(schema.identities)
        .values({ userId: user.id, kind: account.kind, value: account.value.toLowerCase(), verifiedAt: deps.clock.now() })
        .onConflictDoNothing();
    }
    return [...new Set([...recorded, ...linked.map((a) => a.value.toLowerCase())])];
  }

  return service;
}
