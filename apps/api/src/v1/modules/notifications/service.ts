// Notices in the app, and pushes and emails, from events the other modules emit.
// Some can't be turned off: dead air coming, spots about to pause, rights claims.

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { ModuleContext } from "../../context.js";
import type { EmailNotice } from "../../email.js";
import type { Events } from "../../events.js";
import { clockTime, localDate } from "../../lib/time.js";
import { broadcastDate } from "../log/templates.js";

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
  | "code_used"
  | "preset_live"
  | "station_news"
  | "signed_on_off"
  | "spot_added"
  | "station_account"
  | "relay"
  | "external_station"
  | "call_sign_owners";

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

export const ALWAYS_ON: Kind[] = ["dead_air_warning", "low_balance", "rights_claim", "station_account"];

/** What's on unless someone turns it off. Business viewers start with only the weekly summary. */
const DEFAULTS: Record<Scope["kind"], Prefs> = {
  // Nothing about programs you didn't ask about: a preset going live and station news are off until turned on.
  viewer: {
    reminder: { push: true, email: true },
    switch_over: { push: true, email: false },
    preset_live: { push: false, email: false },
    station_news: { push: false, email: false }
  },
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
    weekly_summary: { push: false, email: true },
    signed_on_off: { push: true, email: false },
    // Pay-as-you-go (2026-09-29): always on, to the owners.
    station_account: { push: true, email: true },
    // Relays (2026-09-30): a relay stopped or came back, a restart the station has to do, paid promotion to mark.
    relay: { push: true, email: false },
    // External stations (2026-09-30): the Network desk, when one leaves the dial for a stream that's down and when it's back.
    external_station: { push: true, email: true },
    // A234 (2026-09-30): the Network desk, when a station sharing X.1's call sign no longer shares an owner with it.
    call_sign_owners: { push: true, email: true }
  },
  business: {
    low_balance: { push: true, email: true },
    spot_paused: { push: true, email: true },
    sponsorship_answered: { push: true, email: true },
    order_update: { push: true, email: true },
    weekly_summary: { push: false, email: true },
    code_used: { push: false, email: false },
    spot_added: { push: true, email: false }
  }
};

const DEFAULT_QUIET = { from: "22:00", to: "08:00" };
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * When an airing is, for a viewer's notice: "Friday 9:00 pm" within the week, "October 9, 9:00 pm"
 * further out (a weekday a week away would read as this week's).
 */
export function dayTime(at: Date, timezone: string, now: Date): string {
  const days = Math.round((Date.parse(localDate(at, timezone)) - Date.parse(localDate(now, timezone))) / 86_400_000);
  const day = new Intl.DateTimeFormat("en-US", days >= 0 && days < 7 ? { timeZone: timezone, weekday: "long" } : { timeZone: timezone, month: "long", day: "numeric" }).format(at);
  return days >= 0 && days < 7 ? `${day} ${clockTime(at, timezone)}` : `${day}, ${clockTime(at, timezone)}`;
}

/** Whether a time falls in a quiet-hours window (which may run past midnight), in the time zone. */
export function inQuietHours(at: Date, timezone: string, window: { from: string; to: string } = DEFAULT_QUIET): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const now = Number(parts.find((p) => p.type === "hour")?.value ?? 0) * 60 + Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const from = minutesOf(window.from);
  const to = minutesOf(window.to);
  return from <= to ? now >= from && now < to : now >= from || now < to;
}

export interface NotificationsService {
  notify(userIds: string[], notice: NoticeInput): Promise<void>;
  list(userId: string, filter: { unread?: boolean; limit: number }): Promise<NoticeView[]>;
  markRead(userId: string, input: { ids?: string[]; all?: boolean }): Promise<void>;
  prefs(userId: string, scope: Scope): Promise<{ prefs: Prefs; alwaysOn: Kind[] }>;
  setPrefs(userId: string, scope: Scope, prefs: Prefs): Promise<{ prefs: Prefs; alwaysOn: Kind[] }>;
  /** A3: the account's notices and their delivery records go. */
  forgetUser(userId: string): Promise<void>;
  /** Emails an invite (made, or sent again). Rejects when the email couldn't be sent. */
  sendInvite(invite: InviteEmail): Promise<void>;
}

export type InviteEmail = Omit<Events["invite.created"], "phone"> & { email: string };

const ROLE_WORDS: Record<InviteEmail["role"], { a: string; does: string }> = {
  operator: { a: "an operator", does: "Operators run the station day to day, but not money or the team." },
  host: { a: "a host", does: "Hosts go live on the blocks they're given." },
  manager: { a: "a manager", does: "Managers can run spots, add money and approve orders; only the owner takes money out." },
  viewer: { a: "a viewer", does: "Viewers see results and statements, but can't spend or change anything." }
};

/** An invite's email: where its link goes depends on the team (a station's joins in master control, a business's in the business app). */
export function inviteEmail(invite: InviteEmail, origins: { app: string; business: string }): { link: string; notice: EmailNotice } {
  const link = invite.scope === "business" ? `${origins.business}/invites/${invite.inviteId}` : `${origins.app}/control/invites/${invite.inviteId}`;
  const role = ROLE_WORDS[invite.role];
  const opening = invite.invitedByName
    ? `${invite.invitedByName} invited you to ${invite.teamName}'s team on Opencast, as ${role.a}.`
    : `You're invited to ${invite.teamName}'s team on Opencast, as ${role.a}.`;
  return {
    link,
    notice: {
      title: `Join ${invite.teamName} on Opencast`,
      body: [
        `${opening} ${role.does}`,
        `Sign in with this email address to join. The invite lasts a week.`
      ].join("\n\n"),
      link,
      action: `Join ${invite.teamName}`,
      footer: `${invite.invitedByName ?? "Someone"} on ${invite.teamName} typed this address. If you weren't expecting it, ignore this email: nothing happens unless you sign in and join.`,
      key: `invite:${invite.inviteId}:${invite.sentAt}`,
      kind: "invite"
    }
  };
}

export function createNotificationsService(ctx: ModuleContext): NotificationsService {
  const { deps, services } = ctx;
  const { db } = deps;
  const N = schema.notices;

  const appOrigin = deps.config.appOrigin.replace(/\/+$/, "");
  const businessOrigin = (deps.config.businessOrigin ?? deps.config.appOrigin).replace(/\/+$/, "");
  /**
   * Master control's pages a station notice can open; anything else opens the monitor. A246: the
   * log, the as-run log and the breaks are the Schedule (the old pages still redirect there).
   */
  const CONTROL_PAGES: Record<string, string> = { schedule: "schedule", log: "schedule", "as-run": "schedule", live: "live", sponsors: "sponsors", rights: "rights", "spot-market": "spot-market", carriage: "market", breaks: "schedule", earnings: "earnings", library: "library", settings: "settings" };

  /**
   * A notice's link as a full address in the right app, for its email. Notices keep app-neutral
   * paths (`/stations/:id/log`, `/businesses/:id/balance`, `/spots/:id`); an email needs a page.
   */
  async function emailLink(scope: Scope, link: string | null): Promise<string | null> {
    if (!link || /^https?:\/\//.test(link)) return link;
    // A Network desk page (`/desk/…`): the desk is in the app, whatever the notice's scope.
    if (link === "/desk" || link.startsWith("/desk/")) return `${appOrigin}${link}`;
    if (scope.kind === "business" && scope.id) {
      const [path, query = ""] = link.split("?");
      const parts = path!.split("/").filter(Boolean);
      const q = query ? `?${query}` : "";
      if (parts[0] === "businesses" && parts[1]) return `${businessOrigin}/${[parts[1], ...parts.slice(2)].join("/")}${q}`;
      if (parts[0] === "spots" && parts[1]) return `${businessOrigin}/${scope.id}/spots/${parts[1]}`;
      if (parts[0] === "orders" && parts[1]) return `${businessOrigin}/${scope.id}/orders/${parts[1]}`;
      return `${businessOrigin}/${scope.id}`;
    }
    if (scope.kind === "station") {
      const [path, query = ""] = link.split("?");
      const parts = path!.split("/").filter(Boolean);
      const stationId = parts[0] === "stations" ? parts[1] : scope.id;
      const ident = stationId ? (await services.stations.idents([stationId])).get(stationId) : undefined;
      if (!ident?.callSign) return `${appOrigin}/control`;
      const page = parts[0] === "stations" ? CONTROL_PAGES[parts[2] ?? ""] : undefined;
      // A229: a station sharing its call sign has its channel in its address (`/control/beat-12-2`).
      return `${appOrigin}/control/${ident.slug ?? ident.callSign.toLowerCase()}/${page ?? "monitor"}${page && query ? `?${query}` : ""}`;
    }
    return `${appOrigin}${link.startsWith("/") ? "" : "/"}${link}`;
  }

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
        // O2: quiet hours (on unless turned off) hold back pushes about the person's own viewing; the notice still lands in the app.
        let quiet = false;
        if (notice.scope.kind === "viewer" && !always && channel.push) {
          const { timing, timezone } = await services.accounts.notificationTiming(userId);
          if (timing.quietHours !== false) quiet = inQuietHours(deps.clock.now(), timezone, { from: timing.quietFrom ?? DEFAULT_QUIET.from, to: timing.quietTo ?? DEFAULT_QUIET.to });
        }
        if (always || (channel.push && !quiet)) {
          await deps.notifier.push(userId, deliver).then(
            () => db.insert(schema.deliveries).values({ noticeId: row.id, channel: "push", sentAt: deps.clock.now() }),
            (error) => db.insert(schema.deliveries).values({ noticeId: row.id, channel: "push", error: String(error) })
          );
        }
        if (always || channel.email) {
          const [email] = await services.accounts.emailsOf(userId);
          if (email) {
            const letter: EmailNotice = {
              ...deliver,
              link: await emailLink(notice.scope, deliver.link),
              action: notice.scope.kind === "business" ? "Open Opencast for business" : notice.scope.kind === "station" ? "Open master control" : "Open Opencast",
              footer: always ? "Opencast always sends this one; it can't be turned off." : "You can turn these emails off in Settings, Notifications.",
              // One email per notice, however many times it's tried.
              key: `notice:${row.id}`,
              kind: notice.kind
            };
            await deps.notifier.email(email, letter).then(
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

    async forgetUser(userId) {
      const mine = db.select({ id: N.id }).from(N).where(eq(N.userId, userId));
      await db.delete(schema.deliveries).where(inArray(schema.deliveries.noticeId, mine));
      await db.delete(N).where(eq(N.userId, userId));
    },

    async sendInvite(invite) {
      const { notice } = inviteEmail(invite, { app: appOrigin, business: businessOrigin });
      await deps.notifier.email(invite.email, notice);
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

  deps.bus.on("reminder.due", async (e) => {
    await service.notify([e.userId], {
      kind: e.switchMeOver ? "switch_over" : "reminder",
      title: `${e.title} starts soon`,
      body: e.switchMeOver ? "We'll switch you over when it starts." : "Tune in when it starts.",
      scope: { kind: "viewer", id: null },
      // Per start: a reminder whose airing moved (or that moved to another airing) comes again.
      dedupeKey: `reminder:${e.reminderId}:${e.startsAt}`
    });
  });

  // Added 2026-09-29: an airing someone set a reminder for came off the log.
  const stationPage = async (stationId: string) => {
    const handle = (await services.stations.idents([stationId])).get(stationId)?.handle;
    return handle ? `/${handle}` : null;
  };
  deps.bus.on("reminder.moved", async (e) => {
    const tz = await services.stations.timezoneOf(e.stationId);
    await service.notify([e.userId], {
      kind: "reminder",
      title: `${e.title} moved to ${dayTime(new Date(e.startsAt), tz, deps.clock.now())} on ${await name(e.stationId)}`,
      body: "Your reminder moved with it.",
      link: await stationPage(e.stationId),
      scope: { kind: "viewer", id: null },
      dedupeKey: `reminder-moved:${e.reminderId}:${e.startsAt}`
    });
  });
  deps.bus.on("reminder.cancelled", async (e) => {
    const tz = await services.stations.timezoneOf(e.stationId);
    const station = await name(e.stationId);
    await service.notify([e.userId], {
      kind: "reminder",
      title: `${e.title} was taken off ${station}'s schedule`,
      body: `It was on for ${dayTime(new Date(e.startsAt), tz, deps.clock.now())}. Your reminder is cancelled.`,
      link: await stationPage(e.stationId),
      scope: { kind: "viewer", id: null },
      dedupeKey: `reminder-cancelled:${e.reminderId}`
    });
  });

  deps.bus.on("station.dead_air_warning", async (e) => {
    const tz = await services.stations.timezoneOf(e.stationId);
    await service.notify(await stationTeam(e.stationId), {
      kind: "dead_air_warning",
      title: `Dead air in ${e.minutesBefore} minutes`,
      body: `Nothing is on the log from ${clockTime(new Date(e.gapStartsAt), tz)}. If nobody fills it, master control repeats from the library.`,
      // A246 (decision 9): straight to the gap on the Schedule, with Fill ready: its broadcast day
      // and its start (the Log tab's `day` and `fill`).
      link: `/stations/${e.stationId}/schedule?day=${broadcastDate(new Date(e.gapStartsAt), tz)}&fill=${e.gapStartsAt}`,
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

  // O1: the station team hears when it signs on or off.
  deps.bus.on("station.signed_on", async (e) => {
    await service.notify(await stationTeam(e.stationId), {
      kind: "signed_on_off",
      title: `${await name(e.stationId)} signed on`,
      body: e.first ? "It's on the air for the first time." : "It's back on the air.",
      link: `/stations/${e.stationId}`,
      scope: { kind: "station", id: e.stationId },
      dedupeKey: `signed-on:${e.stationId}:${deps.clock.now().toISOString().slice(0, 16)}`
    });
  });

  deps.bus.on("station.signed_off", async (e) => {
    await service.notify(await stationTeam(e.stationId), {
      kind: "signed_on_off",
      title: `${await name(e.stationId)} signed off`,
      body: e.permanently ? "It's off the air for good." : "It's off the air until it signs on again.",
      link: `/stations/${e.stationId}`,
      scope: { kind: "station", id: e.stationId },
      dedupeKey: `signed-off:${e.stationId}:${deps.clock.now().toISOString().slice(0, 16)}`
    });
  });

  // O1: a business hears when a station adds its spot.
  deps.bus.on("spot.added_to_rotation", async (e) => {
    const spot = await services.spots.spotSummary(e.spotId);
    await service.notify(await businessTeam(e.businessId), {
      kind: "spot_added",
      title: `${await name(e.stationId)} added ${spot.title}`,
      body: e.backup ? "It's in their backup rotation: it airs when their main spots can't." : "It's in their rotation: it airs in their breaks from now.",
      link: `/spots/${e.spotId}`,
      scope: { kind: "business", id: e.businessId },
      dedupeKey: `spot-added:${e.spotId}:${e.stationId}:${e.backup ? "backup" : "main"}`
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

  // Items not prepared for air (prepare once, then assemble): the station and Network desk both hear.
  deps.bus.on("station.file_not_ready", async (e) => {
    const tz = await services.stations.timezoneOf(e.stationId);
    const when = clockTime(new Date(e.airsAt), tz);
    const recipients = [...new Set([...(await stationTeam(e.stationId)), ...(await services.accounts.adminIds())])];
    await service.notify(recipients, {
      kind: "file_not_ready",
      title: e.missedAtAir ? `${e.title} didn't air` : `${e.title} isn't ready for ${when}`,
      body: e.missedAtAir
        ? `It wasn't prepared for air by ${when}, so station ID and bumpers aired in its place.`
        : `It isn't prepared for air yet. It's in the queue; if it isn't ready in time, station ID and bumpers air in its place.`,
      link: `/stations/${e.stationId}/log`,
      scope: { kind: "station", id: e.stationId },
      dedupeKey: `file:${e.missedAtAir ? "missed" : "late"}:${e.stationId}:${e.itemId}:${e.airsAt}`
    });
  });

  deps.bus.on("spot.paused", async (e) => {
    // Daily-cap pauses tell no one; they resume by themselves at midnight.
    if (e.reason === "daily_cap") return;
    const spot = await services.spots.spotSummary(e.spotId);
    // A spot the business paused itself (A115): it knows; the stations are told.
    if (e.reason !== "by_hand") {
      await service.notify(await businessTeam(e.businessId), {
        kind: "spot_paused",
        title: `${spot.title} is paused`,
        body: e.reason === "budget_spent" ? "Its budget is spent. Raise it to put it back in the market." : "Your balance ran low. Add money to put it back in the market.",
        link: `/spots/${e.spotId}`,
        scope: { kind: "business", id: e.businessId }
      });
    }
    const why = e.reason === "budget_spent" ? "its budget is spent" : e.reason === "by_hand" ? "the business paused it" : "the business's balance ran low";
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

  // Pay-as-you-go (added 2026-09-29): the station's owners hear each step of its account.
  deps.bus.on("station.account", async (e) => {
    await service.notify(await services.accounts.stationMemberIds(e.stationId, ["owner"]), {
      kind: "station_account",
      title: e.title,
      body: e.body,
      link: `/stations/${e.stationId}/settings?section=account`,
      scope: { kind: "station", id: e.stationId },
      dedupeKey: e.dedupeKey
    });
  });

  // Relays (added 2026-09-30, follow-up Phase 3): the station team; the Network desk too when a relay stops.
  deps.bus.on("station.relay", async (e) => {
    const team = await stationTeam(e.stationId);
    const recipients = e.desk ? [...new Set([...team, ...(await services.accounts.adminIds())])] : team;
    await service.notify(recipients, {
      kind: "relay",
      title: e.title,
      body: e.body,
      link: `/stations/${e.stationId}/settings?section=translators`,
      scope: { kind: "station", id: e.stationId },
      dedupeKey: e.dedupeKey
    });
  });

  // External stations (added 2026-09-30, follow-up Phase 6): the Network desk, when one leaves the
  // dial for a stream that's down and when it's back. The link opens External sources.
  deps.bus.on("external.station", async (e) => {
    const ident = (await services.stations.idents([e.stationId])).get(e.stationId);
    await service.notify(await services.accounts.adminIds(), {
      kind: "external_station",
      title: e.title,
      body: e.body,
      link: `/desk/markets/${ident?.marketSlug ?? ""}/listed`,
      scope: { kind: "station", id: e.stationId },
      dedupeKey: e.dedupeKey
    });
  });

  // A234 (added 2026-09-30): the Network desk, when a full station sharing X.1's call sign no longer
  // shares an owner with it. The link opens the market board on that channel.
  deps.bus.on("station.call_sign_owners", async (e) => {
    const ident = (await services.stations.idents([e.stationId])).get(e.stationId);
    const major = ident?.channel?.split(".")[0];
    await service.notify(await services.accounts.adminIds(), {
      kind: "call_sign_owners",
      title: e.title,
      body: e.body,
      link: ident?.marketSlug ? `/desk/markets/${ident.marketSlug}/board${major ? `?ch=${major}` : ""}` : "/desk",
      scope: { kind: "station", id: e.stationId },
      dedupeKey: e.dedupeKey
    });
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

  // A new invite by email: its email (resending sends through sendInvite itself). A phone invite sends nothing yet.
  deps.bus.on("invite.created", async (e) => {
    if (e.email) await service.sendInvite({ ...e, email: e.email });
  });

  return service;
}
