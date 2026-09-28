// Notices in the app, and pushes and emails, from events the other modules emit.
// Some can't be turned off: dead air coming, spots about to pause, rights claims.

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { ModuleContext } from "../../context.js";
import { clockTime } from "../../lib/time.js";

type Kind =
  | "reminder"
  | "switch_over"
  | "dead_air_warning"
  | "dead_air_filled"
  | "signal_lost"
  | "file_not_ready"
  | "spot_paused"
  | "spot_back"
  | "low_balance"
  | "sponsorship_request"
  | "sponsorship_answered"
  | "carriage_request"
  | "carriage_answered"
  | "carried_program_changed"
  | "order_update"
  | "rights_claim"
  | "invite"
  | "weekly_summary"
  | "code_used";

type Scope = { kind: "viewer" | "station" | "business"; id: string | null };

export interface NoticeInput {
  kind: Kind;
  title: string;
  body: string;
  link?: string | null;
  scope: Scope;
  /** The same key never makes a second notice (one warning per gap, one reminder per airing). */
  dedupeKey?: string;
}

export interface NoticeView {
  id: string;
  kind: Kind;
  title: string;
  body: string;
  link: string | null;
  scope: Scope;
  createdAt: string;
  readAt: string | null;
}

type Prefs = Record<string, { push: boolean; email: boolean }>;

export const ALWAYS_ON: Kind[] = ["dead_air_warning", "low_balance", "rights_claim"];

/** What's on unless someone turns it off. Business viewers start with only the weekly summary. */
const DEFAULTS: Record<Scope["kind"], Prefs> = {
  viewer: { reminder: { push: true, email: true }, switch_over: { push: true, email: false } },
  station: {
    dead_air_warning: { push: true, email: true },
    signal_lost: { push: true, email: false },
    file_not_ready: { push: true, email: false },
    spot_paused: { push: true, email: false },
    carriage_request: { push: true, email: true },
    carried_program_changed: { push: true, email: false },
    sponsorship_request: { push: true, email: true },
    order_update: { push: true, email: true },
    rights_claim: { push: true, email: true },
    weekly_summary: { push: false, email: true }
  },
  business: {
    low_balance: { push: true, email: true },
    spot_paused: { push: true, email: true },
    sponsorship_answered: { push: true, email: true },
    order_update: { push: true, email: true },
    weekly_summary: { push: false, email: true },
    code_used: { push: false, email: false }
  }
};

export interface NotificationsService {
  notify(userIds: string[], notice: NoticeInput): Promise<void>;
  list(userId: string, filter: { unread?: boolean; limit: number }): Promise<NoticeView[]>;
  markRead(userId: string, input: { ids?: string[]; all?: boolean }): Promise<void>;
  prefs(userId: string, scope: Scope): Promise<{ prefs: Prefs; alwaysOn: Kind[] }>;
  setPrefs(userId: string, scope: Scope, prefs: Prefs): Promise<{ prefs: Prefs; alwaysOn: Kind[] }>;
}

export function createNotificationsService(ctx: ModuleContext): NotificationsService {
  const { deps, services } = ctx;
  const { db } = deps;
  const N = schema.notices;

  async function prefsFor(userId: string, scope: Scope): Promise<Prefs> {
    const saved = await services.accounts.notificationPrefs(userId, scope.kind, scope.id);
    return { ...DEFAULTS[scope.kind], ...(saved as Prefs) };
  }

  const service: NotificationsService = {
    async notify(userIds, notice) {
      for (const userId of [...new Set(userIds)]) {
        const [row] = await db
          .insert(N)
          .values({
            userId,
            kind: notice.kind,
            title: notice.title,
            body: notice.body,
            link: notice.link ?? null,
            scopeKind: notice.scope.kind,
            scopeId: notice.scope.id,
            dedupeKey: notice.dedupeKey ? `${notice.dedupeKey}:${userId}` : null
          })
          .onConflictDoNothing()
          .returning();
        if (!row) continue;
        const prefs = await prefsFor(userId, notice.scope);
        const always = ALWAYS_ON.includes(notice.kind);
        const channel = prefs[notice.kind] ?? { push: false, email: false };
        const deliver = { title: notice.title, body: notice.body, link: notice.link ?? null };
        if (always || channel.push) {
          await deps.notifier.push(userId, deliver).then(
            () => db.insert(schema.deliveries).values({ noticeId: row.id, channel: "push", sentAt: deps.clock.now() }),
            (error) => db.insert(schema.deliveries).values({ noticeId: row.id, channel: "push", error: String(error) })
          );
        }
        if (always || channel.email) {
          const [email] = await services.accounts.emailsOf(userId);
          if (email) {
            await deps.notifier.email(email, deliver).then(
              () => db.insert(schema.deliveries).values({ noticeId: row.id, channel: "email", sentAt: deps.clock.now() }),
              (error) => db.insert(schema.deliveries).values({ noticeId: row.id, channel: "email", error: String(error) })
            );
          }
        }
      }
    },

    async list(userId, filter) {
      const rows = await db
        .select()
        .from(N)
        .where(and(eq(N.userId, userId), ...(filter.unread ? [isNull(N.readAt)] : [])))
        .orderBy(desc(N.createdAt))
        .limit(filter.limit);
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind as Kind,
        title: r.title,
        body: r.body,
        link: r.link,
        scope: { kind: r.scopeKind, id: r.scopeId },
        createdAt: r.createdAt.toISOString(),
        readAt: r.readAt?.toISOString() ?? null
      }));
    },

    async markRead(userId, input) {
      const now = deps.clock.now();
      if (input.all) {
        await db.update(N).set({ readAt: now }).where(and(eq(N.userId, userId), isNull(N.readAt)));
      } else if (input.ids?.length) {
        await db.update(N).set({ readAt: now }).where(and(eq(N.userId, userId), inArray(N.id, input.ids)));
      }
    },

    async prefs(userId, scope) {
      return { prefs: await prefsFor(userId, scope), alwaysOn: ALWAYS_ON };
    },

    async setPrefs(userId, scope, prefs) {
      // Always-on kinds stay on whatever is sent.
      const cleaned = Object.fromEntries(Object.entries(prefs).filter(([kind]) => !ALWAYS_ON.includes(kind as Kind)));
      await services.accounts.saveNotificationPrefs(userId, scope.kind, scope.id, cleaned);
      return service.prefs(userId, scope);
    }
  };

  // Subscriptions ---------------------------------------------------------------

  const stationTeam = (stationId: string) => services.accounts.stationMemberIds(stationId, ["owner", "operator"]);
  const businessTeam = (businessId: string) => services.accounts.businessMemberIds(businessId, ["owner", "manager"]);
  const name = async (stationId: string) => {
    const ident = (await services.stations.idents([stationId])).get(stationId);
    return ident ? `${ident.callSign ?? ident.name}${ident.channel ? ` ${ident.channel}` : ""}` : "A station";
  };
  const origin = deps.config.appOrigin;

  deps.bus.on("reminder.due", async (e) => {
    await service.notify([e.userId], {
      kind: e.switchMeOver ? "switch_over" : "reminder",
      title: `${e.title} starts soon`,
      body: e.switchMeOver ? "We'll switch you over when it starts." : "Tune in when it starts.",
      scope: { kind: "viewer", id: null },
      dedupeKey: `reminder:${e.reminderId}`
    });
  });

  deps.bus.on("station.dead_air_warning", async (e) => {
    await service.notify(await stationTeam(e.stationId), {
      kind: "dead_air_warning",
      title: `Dead air in ${e.minutesBefore} minutes`,
      body: `Nothing is on the log from ${clockTime(new Date(e.gapStartsAt), await services.stations.timezoneOf(e.stationId))}. If nobody fills it, master control repeats from the library.`,
      link: `/stations/${e.stationId}/log`,
      scope: { kind: "station", id: e.stationId },
      dedupeKey: `dead-air:${e.stationId}:${e.gapStartsAt}:${e.minutesBefore}`
    });
  });

  deps.bus.on("station.dead_air_filled", async (e) => {
    await service.notify(await stationTeam(e.stationId), {
      kind: "dead_air_filled",
      title: "Dead air was filled",
      body: "Nobody filled the gap, so master control repeated from the library.",
      link: `/stations/${e.stationId}/as-run`,
      scope: { kind: "station", id: e.stationId },
      dedupeKey: `dead-air-filled:${e.stationId}:${e.gapStartsAt}`
    });
  });

  deps.bus.on("station.signal_lost", async (e) => {
    await service.notify(await stationTeam(e.stationId), {
      kind: "signal_lost",
      title: "Signal lost",
      body: "The live source isn't sending. A slate is airing until it's back.",
      link: `/stations/${e.stationId}/live`,
      scope: { kind: "station", id: e.stationId },
      dedupeKey: `signal:${e.stationId}:${deps.clock.now().toISOString().slice(0, 16)}`
    });
  });

  // Files the playout server doesn't have: the station and Network desk both hear.
  deps.bus.on("station.file_not_ready", async (e) => {
    const tz = await services.stations.timezoneOf(e.stationId);
    const when = clockTime(new Date(e.airsAt), tz);
    const recipients = [...new Set([...(await stationTeam(e.stationId)), ...(await services.accounts.adminIds())])];
    await service.notify(recipients, {
      kind: "file_not_ready",
      title: e.missedAtAir ? `${e.title} didn't air` : `${e.title} isn't ready for ${when}`,
      body: e.missedAtAir
        ? `Its file wasn't on the playout server at ${when}, so station ID and bumpers aired in its place.`
        : `Its file isn't on the playout server yet. It's being copied; if it doesn't arrive, station ID and bumpers air in its place.`,
      link: `/stations/${e.stationId}/log`,
      scope: { kind: "station", id: e.stationId },
      dedupeKey: `file:${e.missedAtAir ? "missed" : "late"}:${e.stationId}:${e.itemId}:${e.airsAt}`
    });
  });

  deps.bus.on("spot.paused", async (e) => {
    // Daily-cap pauses tell no one; they resume by themselves at midnight.
    if (e.reason === "daily_cap") return;
    const spot = await services.spots.spotSummary(e.spotId);
    await service.notify(await businessTeam(e.businessId), {
      kind: "spot_paused",
      title: `${spot.title} is paused`,
      body: e.reason === "budget_spent" ? "Its budget is spent. Raise it to put it back in the market." : "Your balance ran low. Add money to put it back in the market.",
      link: `/spots/${e.spotId}`,
      scope: { kind: "business", id: e.businessId }
    });
    const why = e.reason === "budget_spent" ? "its budget is spent" : "the business's balance ran low";
    for (const stationId of e.stationIds) {
      const [perDayMs, backup] = await Promise.all([services.spots.recentAirTimePerDay(e.spotId, stationId), services.spots.rotationFor(stationId, "backup")]);
      const minutes = Math.round(perDayMs / 60_000);
      const open = perDayMs >= 60_000 ? `about ${minutes} minute${minutes === 1 ? "" : "s"} a day` : perDayMs > 0 ? `about ${Math.round(perDayMs / 1000)} seconds a day` : "a little time";
      await service.notify(await stationTeam(stationId), {
        kind: "spot_paused",
        title: `${spot.title} paused`,
        body: `${spot.business}'s spot paused because ${why}. That leaves ${open} open in your breaks; ${backup.length ? "your backup rotation fills it" : "station ID and bumpers air there until you add a spot"}. Airings already held still air.`,
        link: `/stations/${stationId}/spot-market?open=1`,
        scope: { kind: "station", id: stationId }
      });
    }
  });

  deps.bus.on("spot.resumed", async (e) => {
    const spot = await services.spots.spotSummary(e.spotId);
    for (const stationId of e.stationIds) {
      await service.notify(await stationTeam(stationId), {
        kind: "spot_back",
        title: `${spot.title} is back`,
        body: "It's back in the market. Add it back to your rotation if you want it.",
        link: `/stations/${stationId}/spot-market`,
        scope: { kind: "station", id: stationId }
      });
    }
  });

  deps.bus.on("business.low_balance", async (e) => {
    await service.notify(await businessTeam(e.businessId), {
      kind: "low_balance",
      title: e.daysLeft <= 1 ? "Your spots pause tomorrow" : `Your spots pause in about ${e.daysLeft} days`,
      body: "Add money to keep them in the market.",
      link: `/businesses/${e.businessId}/balance`,
      scope: { kind: "business", id: e.businessId },
      dedupeKey: `low-balance:${e.businessId}:${e.daysLeft}:${e.since}`
    });
  });

  deps.bus.on("sponsorship.requested", async (e) => {
    const business = (await services.spots.businessNames([e.businessId])).get(e.businessId) ?? "A business";
    await service.notify(await stationTeam(e.stationId), {
      kind: "sponsorship_request",
      title: "New sponsorship request",
      body: `${business} wants to sponsor ${await name(e.stationId)}.`,
      link: `/stations/${e.stationId}/sponsors`,
      scope: { kind: "station", id: e.stationId }
    });
  });

  deps.bus.on("sponsorship.decided", async (e) => {
    await service.notify(await businessTeam(e.businessId), {
      kind: "sponsorship_answered",
      title: e.approved ? `${await name(e.stationId)} approved your sponsorship` : `${await name(e.stationId)} declined your sponsorship`,
      body: e.approved ? "Your credit goes on air with its first airing." : "Nothing was charged.",
      link: `/businesses/${e.businessId}/sponsorships`,
      scope: { kind: "business", id: e.businessId }
    });
  });

  deps.bus.on("carriage.requested", async (e) => {
    await service.notify(await stationTeam(e.makerStationId), {
      kind: "carriage_request",
      title: `${await name(e.carrierStationId)} wants to carry you`,
      body: "Review the request.",
      link: `/stations/${e.makerStationId}/carriage`,
      scope: { kind: "station", id: e.makerStationId }
    });
  });

  deps.bus.on("carriage.decided", async (e) => {
    await service.notify(await stationTeam(e.carrierStationId), {
      kind: "carriage_answered",
      title: e.approved ? `${await name(e.makerStationId)} approved your request` : `${await name(e.makerStationId)} declined your request`,
      body: e.approved ? "Place it in your log." : "Look for another program in the market.",
      link: `/stations/${e.carrierStationId}/carriage`,
      scope: { kind: "station", id: e.carrierStationId }
    });
  });

  deps.bus.on("order.updated", async (e) => {
    const both = [...(await businessTeam(e.businessId)), ...(await stationTeam(e.makerStationId))];
    await service.notify(both, {
      kind: "order_update",
      title: "A production order changed",
      body: `It's now: ${e.state.replace(/_/g, " ")}.`,
      link: `/orders/${e.orderId}`,
      scope: { kind: "business", id: e.businessId }
    });
  });

  deps.bus.on("claim.filed", async (e) => {
    await service.notify(await stationTeam(e.stationId), {
      kind: "rights_claim",
      title: `A rights claim on ${e.itemTitle}`,
      body: "It's off air until you answer. You have days to answer; see the claim.",
      link: `/stations/${e.stationId}/rights`,
      scope: { kind: "station", id: e.stationId }
    });
    for (const carrier of e.carrierStationIds) {
      await service.notify(await stationTeam(carrier), {
        kind: "rights_claim",
        title: `${e.itemTitle} is off air for now`,
        body: "Its maker received a rights claim. It comes back if the claim is answered.",
        link: `/stations/${carrier}/log`,
        scope: { kind: "station", id: carrier }
      });
    }
  });

  deps.bus.on("invite.created", async (e) => {
    if (e.email) {
      await deps.notifier.email(e.email, {
        title: `You're invited to ${e.teamName} on Opencast`,
        body: "Sign in with this email to join.",
        link: `${origin}/invites/${e.inviteId}`
      });
    }
  });

  return service;
}
