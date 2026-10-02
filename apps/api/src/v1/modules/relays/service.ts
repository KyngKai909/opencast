// Relays (added 2026-09-30, follow-up Phase 3): one setting for all of a station's relays, and what
// the Translators page shows. The relays module owns broadcast.station_relays (the setting, and the
// station's Livepeer relay stream), broadcast.relay_targets (each platform's multistream target)
// and broadcast.relay_restarts (restarts for platform limits). The relay service (apps/relay)
// runs the relays themselves (runner.ts); the API only reads and changes the setting.
//
//   - "Live shows only" (the default, free) or "Everything I air" (pay as you go, per hour, per
//     station, whatever the number of platforms: billed from `translator_sessions` under Phase 2);
//   - "During breaks, relays show: Your spots / Station ID slate" (it replaces each translator's
//     `break_handling`, which is kept and no longer read);
//   - "Station bug on relays" (on by default; off, the relay stream-copies);
//   - "Save relays as YouTube videos" (off by default; on, YouTube rolls about every 11 hours).

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { schema } from "@opencast/db";
import { RULES, type RelayPlatformKind, type RelayRestart, type RelaySettings, type RelayView } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { CurrentUser } from "../../http.js";
import { notFound } from "../../errors.js";
import { limitsFrom, platformName, restartLabel, type Limits } from "./limits.js";
import { platformsSeam } from "./platforms.js";

const SR = schema.stationRelays;
const RT = schema.relayTargets;
const RR = schema.relayRestarts;

export const RELAY_DEFAULTS: RelaySettings = { mode: "live_only", breakHandling: "air_spots", bugOnRelays: true, saveYoutubeVideos: false };

export interface RelaysService {
  /** The station's relay setting (the defaults until it's changed). */
  settings(stationId: string): Promise<RelaySettings>;
  /** Each station's relay mode (billing reads sessions that don't say, through stations.relayModes). */
  modes(stationIds: string[]): Promise<Map<string, "everything" | "live_only">>;
  update(stationId: string, user: CurrentUser, patch: Partial<RelaySettings>, owner: boolean): Promise<RelayView>;
  view(stationId: string, user: CurrentUser, owner: boolean): Promise<RelayView>;
  restarts(stationId: string, limit: number): Promise<RelayRestart[]>;
  dismissPaidPromotionReminder(stationId: string, platformId: string): Promise<void>;
  /** The platform limits in effect (the rules registry's `relays.platform_limits`). */
  limits(at?: Date): Promise<Limits>;
  /** A station's relay setting from its old translators, when it has none yet (their keys moving to the platforms module). */
  adoptTranslatorSettings(stationId: string, settings: Pick<RelaySettings, "breakHandling" | "mode">): Promise<void>;
}

export function createRelaysService(ctx: ModuleContext): RelaysService {
  const { deps, services } = ctx;
  const { db } = deps;

  async function row(stationId: string) {
    const [r] = await db.select().from(SR).where(eq(SR.stationId, stationId));
    return r ?? null;
  }

  function restartView(r: typeof RR.$inferSelect, names: Map<string, string>, tz: string, now: Date): RelayRestart {
    const kind = r.kind as RelayPlatformKind;
    return {
      id: r.id,
      platformId: r.platformId,
      kind,
      reason: r.reason,
      status: r.status,
      at: r.at.toISOString(),
      deadline: r.deadline.toISOString(),
      duringBreak: r.duringBreak,
      automatic: r.automatic,
      label: restartLabel({ kind, name: names.get(r.platformId), at: r.at, deadline: r.deadline, duringBreak: r.duringBreak, automatic: r.automatic, status: r.status }, tz, now),
      doneAt: r.doneAt?.toISOString() ?? null
    };
  }

  const service: RelaysService = {
    async settings(stationId) {
      const r = await row(stationId);
      return r ? { mode: r.mode, breakHandling: r.breakHandling, bugOnRelays: r.bugOnRelays, saveYoutubeVideos: r.saveYoutubeVideos } : { ...RELAY_DEFAULTS };
    },

    async modes(stationIds) {
      const out = new Map<string, "everything" | "live_only">();
      if (!stationIds.length) return out;
      const rows = await db.select({ stationId: SR.stationId, mode: SR.mode }).from(SR).where(inArray(SR.stationId, stationIds));
      for (const id of stationIds) out.set(id, rows.find((r) => r.stationId === id)?.mode ?? RELAY_DEFAULTS.mode);
      return out;
    },

    async update(stationId, user, patch, owner) {
      const current = await service.settings(stationId);
      const next = { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as RelaySettings;
      await db
        .insert(SR)
        .values({ stationId, ...next, updatedBy: user.id, updatedAt: deps.clock.now() })
        .onConflictDoUpdate({ target: SR.stationId, set: { ...next, updatedBy: user.id, updatedAt: deps.clock.now() } });
      return service.view(stationId, user, owner);
    },

    async view(stationId, user, owner) {
      const now = deps.clock.now();
      const [r, settings, account, tz, targets, planned, recent, destinations] = await Promise.all([
        row(stationId),
        service.settings(stationId),
        services.billing.account(stationId, user, owner),
        services.stations.timezoneOf(stationId),
        db.select().from(RT).where(eq(RT.stationId, stationId)),
        db
          .select()
          .from(RR)
          .where(and(eq(RR.stationId, stationId), inArray(RR.status, ["scheduled", "due"])))
          .orderBy(asc(RR.at)),
        db
          .select()
          .from(RR)
          .where(and(eq(RR.stationId, stationId), inArray(RR.status, ["done", "failed"])))
          .orderBy(desc(RR.at))
          .limit(10),
        platformsSeam(ctx)
          .destinationsFor(stationId)
          .catch(() => [])
      ]);
      const names = new Map(destinations.map((d) => [d.platformId, platformName(d.kind, d.name)]));
      const everything = account.usage.find((u) => u.type === "relay_everything");
      const liveOnly = account.usage.find((u) => u.type === "relay_live_only");
      const pausedBecause = settings.mode === "everything" ? (everything?.paused ?? null) : null;
      const nextByPlatform = new Map<string, RelayRestart>();
      for (const p of planned) if (!nextByPlatform.has(p.platformId)) nextByPlatform.set(p.platformId, restartView(p, names, tz, now));
      const status: RelayView["status"] = pausedBecause ? "paused" : (r?.status ?? "off");
      // Every platform connected now, and any the relay still has a target for.
      const known = [
        ...destinations.map((d) => ({ platformId: d.platformId, kind: d.kind, name: d.name, connected: d.connected })),
        ...[...new Map(targets.map((t) => [t.platformId, t])).values()]
          .filter((t) => !destinations.some((d) => d.platformId === t.platformId))
          .map((t) => ({ platformId: t.platformId, kind: t.kind, name: undefined, connected: false }))
      ];
      const platforms = known.map((d) => {
        const mine = targets.filter((t) => t.platformId === d.platformId);
        const live = mine.find((t) => !t.disabled);
        const marked = mine.some((t) => t.paidPromotionMarkedAt);
        const remind = mine.some((t) => t.paidPromotionReminderAt && (!t.paidPromotionDismissedAt || t.paidPromotionDismissedAt < t.paidPromotionReminderAt));
        return {
          platformId: d.platformId,
          kind: d.kind,
          name: names.get(d.platformId) ?? platformName(d.kind, d.name),
          connected: d.connected,
          status: (live && status === "relaying" ? "relaying" : "idle") as "relaying" | "idle",
          broadcastStartedAt: live?.broadcastStartedAt?.toISOString() ?? null,
          nextRestart: nextByPlatform.get(d.platformId) ?? null,
          paidPromotion: marked ? ("marked" as const) : remind ? ("remind" as const) : null
        };
      });
      return {
        stationId,
        ...settings,
        status,
        pausedBecause,
        month: {
          month: account.month,
          hours: everything?.quantity ?? 0,
          soFarMicros: everything?.soFarMicros ?? 0,
          estimateMicros: everything?.estimate.micros ?? 0,
          priceMicros: everything?.priceMicros ?? null,
          capMicros: everything?.cap.micros ?? null,
          liveOnlyHours: liveOnly?.quantity ?? 0
        },
        platforms,
        nextRestarts: [...nextByPlatform.values()].sort((a, b) => a.at.localeCompare(b.at)),
        recentRestarts: recent.map((x) => restartView(x, names, tz, now)),
        canManage: owner
      };
    },

    async restarts(stationId, limit) {
      const [rows, tz, destinations] = await Promise.all([
        // Plans dropped before they were due (the broadcast ended, or a better break came) aren't restarts.
        db
          .select()
          .from(RR)
          .where(and(eq(RR.stationId, stationId), inArray(RR.status, ["scheduled", "done", "failed", "due"])))
          .orderBy(desc(RR.at))
          .limit(limit),
        services.stations.timezoneOf(stationId),
        platformsSeam(ctx)
          .destinationsFor(stationId)
          .catch(() => [])
      ]);
      const names = new Map(destinations.map((d) => [d.platformId, platformName(d.kind, d.name)]));
      return rows.map((r) => restartView(r, names, tz, deps.clock.now()));
    },

    async dismissPaidPromotionReminder(stationId, platformId) {
      const rows = await db
        .update(RT)
        .set({ paidPromotionDismissedAt: deps.clock.now(), updatedAt: deps.clock.now() })
        .where(and(eq(RT.stationId, stationId), eq(RT.platformId, platformId)))
        .returning({ id: RT.id });
      if (!rows.length) throw notFound("That platform");
    },

    async adoptTranslatorSettings(stationId, settings) {
      await db
        .insert(SR)
        .values({ stationId, ...RELAY_DEFAULTS, ...settings, updatedAt: deps.clock.now() })
        .onConflictDoNothing();
    },

    async limits(at = deps.clock.now()) {
      const value = await services.settings.valueAt("relays.platform_limits", at);
      return limitsFrom(value, RULES["relays.platform_limits"].fallback);
    }
  };
  return service;
}
