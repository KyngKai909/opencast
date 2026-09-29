import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { ModuleContext } from "../../context.js";
import type { CurrentUser } from "../../http.js";
import { forbidden, refused } from "../../errors.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { breakCue, decoratePlaylist } from "./engine/scte35.js";
import { publicUrl } from "../../lib/url.js";
import { createLivepeerStream, hasLivepeerApiKey } from "../../../livepeer.js";
import { dateRangeTag, HLS_CLASS } from "@opencast/contracts";
import type { OffAirSpanView } from "../log/service.js";
import { clockTime } from "../../lib/time.js";

type CheckKey = "log_covers_24h" | "station_id_hourly" | "rights_confirmed" | "listings_complete" | "live_sources_connected" | "channel_chosen" | "call_sign_chosen" | "output" | "off_air_hours";

export interface SignOnCheck {
  key: CheckKey;
  label: string;
  passed: boolean;
  blocking: boolean;
  detail: string | null;
  watchUrl?: string | null;
}

export interface PlayoutStatusView {
  onAir: boolean;
  now: { title: string; code: "PGM" | "SPT" | "UND" | "BMP" | "SID" | "OPEN"; startedAt: string; itemId: string | null } | null;
  lastError: string | null;
  output: { livepeerEnabled: boolean; playbackUrl: string | null; bitrateKbps?: number | null };
  nextBreakAt: string | null;
  onAirSince?: string | null;
  next?: { title: string; detail: string | null; code: "PGM" | "SPT" | "UND" | "BMP" | "SID" | "OPEN"; startsAt: string; producer: string | null; colour: string | null; pictureUrl: string | null } | null;
  /** Planned off air time on now, or the next within 24 hours. */
  offAir?: (OffAirSpanView & { now: boolean }) | null;
}

export interface AsRunView {
  id: string;
  code: "PGM" | "SPT" | "UND" | "BMP" | "SID" | "OPEN";
  title: string;
  startedAt: string;
  endedAt: string;
  reason: "planned" | "rotation" | "backup_rotation" | "station_id_fill" | "dead_air_fill" | "live" | "slate";
  itemId: string | null;
  airingId: string | null;
}

export interface PlayoutService {
  /** Whether each station is on air, and where to play it. */
  /** `standingBy`: a live block is on the stand-by slate, waiting for its signal (S13). */
  statusFor(stationIds: string[]): Promise<Map<string, { onAir: boolean; playbackUrl: string | null; standingBy: boolean }>>;
  checks(stationId: string): Promise<{ ready: boolean; checks: SignOnCheck[] }>;
  signOn(stationId: string): Promise<PlayoutStatusView>;
  signOff(stationId: string, permanently: boolean): Promise<PlayoutStatusView>;
  cueBreak(user: CurrentUser, stationId: string): Promise<void>;
  status(stationId: string): Promise<PlayoutStatusView>;
  asRun(stationId: string, from: Date, to: Date): Promise<AsRunView[]>;
  /** As-run rows for spot airings, for billing and results. */
  asRunForAirings(airingIds: string[]): Promise<Map<string, typeof schema.asRun.$inferSelect>>;
  /** A station's live HLS playlist with SCTE-35 cues for its breaks (EXT-X-DATERANGE). */
  playlistWithCues(stationId: string): Promise<string | null>;
  /** Every station on air now, for the dead-air check. */
  onAirStations(): Promise<string[]>;
  /** Stations that aired anything in a window (from the as-run log). */
  stationsThatAired(from: Date, to: Date): Promise<string[]>;
  /** A planned sign-on ("Signs on Monday, 6:00 am"). */
  scheduleSignOn(stationId: string, at: Date): Promise<void>;
  /**
   * A124: signs on stations whose scheduled sign-on is due (a claimable station set up with a
   * sign-on time), through the same checks as signing on by hand. One that isn't ready isn't
   * tried again; the desk sees it still setting up.
   */
  runDueSignOns(): Promise<{ signedOn: number; notReady: number }>;
  nextSignOn(stationIds: string[]): Promise<Map<string, Date>>;
  /** Cancels a station's scheduled sign-ons (a creator stopped it before it signed on). */
  cancelSignOns(stationId: string): Promise<void>;
  /** L5: where an item aired, newest first, from the as-run log (any station). */
  airedItem(itemId: string, limit: number): Promise<Array<{ stationId: string; startedAt: Date; reason: AsRunView["reason"]; carriageAgreementId: string | null }>>;
  /** C5: when each item first aired anywhere, and where. */
  firstAired(itemIds: string[]): Promise<Map<string, { stationId: string; startedAt: Date }>>;
  /** G3: a live block ended early: playout hands back to the log now. */
  endLive(stationId: string, userId: string): Promise<void>;
  /** G2: when each station last signed on (while on air). */
  onAirSince(stationIds: string[]): Promise<Map<string, Date>>;
  /** The log or off air hours changed: playout reads them again now. */
  replan(stationId: string): Promise<void>;
  /** How many times a carried program aired on a carrier in a window (carriage limits, statements). */
  carriedAirings(agreementIds: string[], from: Date, to: Date): Promise<Map<string, number>>;
}

const HOUR = 3_600_000;

export function createPlayoutService({ deps, services }: ModuleContext): PlayoutService {
  const { db } = deps;
  const P = schema.playoutState;
  const L = schema.livepeerConfig;

  async function livepeer(stationIds: string[]) {
    if (!stationIds.length) return new Map<string, typeof L.$inferSelect>();
    const rows = await db.select().from(L).where(inArray(L.stationId, stationIds));
    return new Map(rows.map((r) => [r.stationId, r]));
  }

  async function ensureOutput(stationId: string) {
    const [current] = await db.select().from(L).where(eq(L.stationId, stationId));
    if (current?.streamId || !hasLivepeerApiKey()) return;
    const [ident] = [...(await services.stations.idents([stationId])).values()];
    try {
      const stream = await createLivepeerStream(`${ident?.callSign ?? ident?.name ?? stationId} (Opencast)`);
      await db
        .insert(L)
        .values({ stationId, enabled: true, ...stream, updatedAt: deps.clock.now() })
        .onConflictDoUpdate({ target: L.stationId, set: { ...stream, lastError: null, updatedAt: deps.clock.now() } });
    } catch (error) {
      await db
        .insert(L)
        .values({ stationId, enabled: true, lastError: String((error as Error).message), updatedAt: deps.clock.now() })
        .onConflictDoUpdate({ target: L.stationId, set: { lastError: String((error as Error).message), updatedAt: deps.clock.now() } });
    }
  }

  const service: PlayoutService = {
    async statusFor(stationIds) {
      if (!stationIds.length) return new Map();
      const [states, outputs] = await Promise.all([db.select().from(P).where(inArray(P.stationId, stationIds)), livepeer(stationIds)]);
      const byId = new Map(states.map((s) => [s.stationId, s]));
      return new Map(
        stationIds.map((id) => {
          const out = outputs.get(id);
          const onAir = byId.get(id)?.onAir ?? false;
          const standingBy = onAir && (byId.get(id)?.standingBy ?? false);
          return [id, { onAir, playbackUrl: onAir ? (out?.enabled && out.playbackUrl ? out.playbackUrl : publicUrl(deps, `/hls/${id}/index.m3u8`)) : null, standingBy }];
        })
      );
    },

    async checks(stationId) {
      const now = deps.clock.now();
      const day = new Date(now.getTime() + 24 * HOUR);
      const [identity, gaps, breaks, readiness, entries, output, offAir, tz] = await Promise.all([
        services.stations.identityReady(stationId),
        services.log.gaps(stationId, now, day),
        services.log.breaks(stationId, now, day),
        services.library.readiness(stationId),
        services.log.entries(stationId, now, day),
        livepeer([stationId]),
        services.log.offAirSpans(stationId, now, day),
        services.stations.timezoneOf(stationId)
      ]);
      const rule = await services.stations.breakRule(stationId);

      // A station ID at least once an hour: every break ends with one, so breaks must come hourly.
      // Planned off air time doesn't count against it: the station signs off and back on with its ID.
      const breakTimes = breaks.map((b) => Date.parse(b.startsAt)).sort((a, b) => a - b);
      const sidEntries = entries.filter((e) => e.code === "SID").map((e) => e.startsAt.getTime());
      const offAirMarks = offAir.flatMap((o) => [Math.max(now.getTime(), Date.parse(o.startsAt)), Math.min(day.getTime(), Date.parse(o.endsAt))]);
      const marks = [...breakTimes, ...sidEntries, ...offAirMarks].sort((a, b) => a - b);
      let longest = 0;
      let cursor = now.getTime();
      const inOffAir = (a: number, b: number) => offAir.some((o) => Date.parse(o.startsAt) <= a && Date.parse(o.endsAt) >= b);
      for (const mark of marks) {
        if (!inOffAir(cursor, mark)) longest = Math.max(longest, mark - cursor);
        cursor = mark;
      }
      if (!inOffAir(cursor, day.getTime())) longest = Math.max(longest, day.getTime() - cursor);
      const idsPerDay = marks.length;
      const hourly = rule.mode !== "none" || sidEntries.length > 0 ? longest <= HOUR : false;

      const liveEntries = entries.filter((e) => e.kind === "live");
      const out = output.get(stationId);
      const checks: SignOnCheck[] = [
        { key: "call_sign_chosen", label: "Call sign chosen", passed: identity.callSign, blocking: true, detail: null },
        { key: "channel_chosen", label: "Channel chosen", passed: identity.channel, blocking: true, detail: null },
        {
          key: "log_covers_24h",
          label: "The log covers the next 24 hours",
          passed: gaps.length === 0,
          blocking: true,
          detail: gaps.length ? `${gaps.length} ${gaps.length === 1 ? "gap" : "gaps"}, the first at ${gaps[0].startsAt}` : null
        },
        {
          key: "station_id_hourly",
          label: "A station ID at least once an hour",
          passed: hourly,
          blocking: true,
          detail: `${idsPerDay} times a day`
        },
        {
          key: "rights_confirmed",
          label: "Rights confirmed",
          passed: readiness.rightsConfirmed === readiness.items,
          blocking: false,
          detail: `${readiness.rightsConfirmed} of ${readiness.items} items`
        },
        {
          key: "listings_complete",
          label: "Listings complete",
          passed: readiness.programsNeedingDescription === 0,
          blocking: false,
          detail: readiness.programsNeedingDescription ? `${readiness.programsNeedingDescription} need a description` : null
        },
        {
          key: "live_sources_connected",
          label: "Live sources connected",
          passed: liveEntries.length === 0,
          blocking: false,
          detail: liveEntries.length ? "A live block with no signal airs a slate" : null
        },
        {
          key: "output",
          label: "Output ready",
          passed: Boolean(out?.ingestUrl) || !hasLivepeerApiKey(),
          blocking: false,
          detail: out?.lastError ?? (hasLivepeerApiKey() ? "Set up on sign-on" : "Local output only"),
          // G6: the output's playback, once there is one (Livepeer's is made at the first sign-on).
          watchUrl: out?.playbackUrl ?? null
        }
      ];
      // Planned off air time isn't a gap; say so, so nobody wonders.
      const stretches = [...new Map(offAir.map((o) => [o.backAt, o])).values()];
      if (stretches.length) {
        const first = offAir.find((o) => o.backAt === stretches[0].backAt)!;
        checks.push({
          key: "off_air_hours",
          label: "Off air hours planned",
          passed: true,
          blocking: false,
          detail: `Off air from ${clockTime(new Date(first.startsAt), tz)}, back at ${clockTime(new Date(first.backAt), tz)}. Not dead air: no warnings, nothing fills it`
        });
      }
      return { ready: checks.every((c) => c.passed || !c.blocking), checks };
    },

    async signOn(stationId) {
      const { ready, checks } = await service.checks(stationId);
      if (!ready) {
        const failing = checks.filter((c) => c.blocking && !c.passed).map((c) => c.label.toLowerCase());
        throw refused("not_ready", `Not ready to sign on: ${failing.join(", ")}.`);
      }
      await ensureOutput(stationId);
      const { first } = await db.transaction(async (tx) => {
        const result = await services.stations.markSignedOn(tx, stationId);
        await tx
          .insert(P)
          .values({ stationId, onAir: true, updatedAt: deps.clock.now() })
          .onConflictDoUpdate({ target: P.stationId, set: { onAir: true, lastError: null, updatedAt: deps.clock.now() } });
        await tx.insert(schema.commands).values({ stationId, action: "sign_on", createdAt: deps.clock.now() });
        return result;
      });
      deps.bus.emit("station.signed_on", { stationId, first });
      return service.status(stationId);
    },

    async signOff(stationId, permanently) {
      await db.transaction(async (tx) => {
        await services.stations.markSignedOff(tx, stationId, permanently);
        await tx
          .insert(P)
          .values({ stationId, onAir: false, updatedAt: deps.clock.now() })
          .onConflictDoUpdate({ target: P.stationId, set: { onAir: false, updatedAt: deps.clock.now() } });
        await tx.insert(schema.commands).values({ stationId, action: "sign_off" });
      });
      if (permanently) {
        // The call sign stays reserved a year so a returning station can reclaim it; the channel frees after 90 days.
        await services.waitlist.holdAfterSignOff(stationId);
      }
      deps.bus.emit("station.signed_off", { stationId, permanently });
      return service.status(stationId);
    },

    async cueBreak(user, stationId) {
      const role = await services.accounts.requireStation(user, stationId, ["owner", "operator", "host"]);
      const now = deps.clock.now();
      const current = (await services.log.entries(stationId, now, new Date(now.getTime() + 1000))).find((e) => e.startsAt <= now && e.endsAt > now);
      if (!current || current.kind !== "live") throw refused("not_live", "Breaks are cued during live blocks.");
      if (role === "host" && !(await services.stations.isHost(user.id, stationId, current.programId))) {
        throw forbidden("Hosts can cue breaks on their own blocks only.");
      }
      await db.insert(schema.commands).values({ stationId, action: "cue_break", issuedBy: user.id });
    },

    async status(stationId) {
      const [[state], out] = await Promise.all([db.select().from(P).where(eq(P.stationId, stationId)), livepeer([stationId])]);
      const now = deps.clock.now();
      const [current] = (await services.log.entries(stationId, now, new Date(now.getTime() + 1000))).filter((e) => e.startsAt <= now && e.endsAt > now);
      const titles = current ? (await services.log.airingsByIds([current.id])).get(current.id) : undefined;
      const [nextBreak] = (await services.log.breaks(stationId, now, new Date(now.getTime() + 6 * HOUR))).filter((b) => Date.parse(b.startsAt) > now.getTime());
      const output = out.get(stationId);
      const onAir = state?.onAir ?? false;
      // G2: since when, and what's next for the preview monitor.
      const [since, next, offAir] = await Promise.all([
        onAir ? service.onAirSince([stationId]) : Promise.resolve(new Map<string, Date>()),
        services.log.nextEntry(stationId, now),
        services.log.offAirSpans(stationId, now, new Date(now.getTime() + 24 * HOUR))
      ]);
      const plannedOff = offAir[0] ? { ...offAir[0], now: Date.parse(offAir[0].startsAt) <= now.getTime() } : null;
      return {
        offAir: plannedOff,
        onAirSince: since.get(stationId)?.toISOString() ?? null,
        next: next
          ? {
              title: next.entry.title,
              detail: next.description,
              code: next.entry.code,
              startsAt: next.entry.startsAt,
              producer: next.producer,
              colour: next.colour,
              pictureUrl: null
            }
          : null,
        onAir,
        now:
          state?.onAir && current
            ? { title: titles?.title ?? "On air", code: current.code, startedAt: current.startsAt.toISOString(), itemId: current.assetId }
            : null,
        lastError: state?.lastError ?? output?.lastError ?? null,
        output: { livepeerEnabled: output?.enabled ?? false, playbackUrl: output?.playbackUrl ?? null, bitrateKbps: null },
        nextBreakAt: nextBreak?.startsAt ?? null
      };
    },

    async asRun(stationId, from, to) {
      const rows = await db
        .select()
        .from(schema.asRun)
        .where(and(eq(schema.asRun.stationId, stationId), gte(schema.asRun.startedAt, from), lt(schema.asRun.startedAt, to)))
        .orderBy(asc(schema.asRun.startedAt));
      const titles = await services.library.titles({
        itemIds: rows.map((r) => r.assetId).filter((v): v is string => Boolean(v)),
        programIds: rows.map((r) => r.programId).filter((v): v is string => Boolean(v))
      });
      return rows.map((r) => ({
        id: r.id,
        code: r.code,
        title: (r.assetId && titles.items.get(r.assetId)) || (r.programId && titles.programs.get(r.programId)) || (r.code === "SID" ? "Station ID" : r.reason === "live" ? "Live" : "Slate"),
        startedAt: r.startedAt.toISOString(),
        endedAt: r.endedAt.toISOString(),
        reason: r.reason,
        itemId: r.assetId,
        airingId: r.airingId
      }));
    },

    async asRunForAirings(airingIds) {
      if (!airingIds.length) return new Map();
      const rows = await db.select().from(schema.asRun).where(inArray(schema.asRun.airingId, airingIds));
      return new Map(rows.map((r) => [r.airingId!, r]));
    },

    async playlistWithCues(stationId) {
      const file = path.join(deps.config.storageRoot, "hls", stationId, "index.m3u8");
      const playlist = await fs.readFile(file, "utf8").catch(() => null);
      if (playlist === null) return null;
      const now = deps.clock.now();
      // Every break in the window, stored or only generated from the rule, carries its cue.
      const breaks = await services.log.breaks(stationId, new Date(now.getTime() - 5 * 60_000), new Date(now.getTime() + 2 * 60_000));
      const decorated = decoratePlaylist(
        playlist,
        breaks.map((b) => breakCue(stationId, b))
      );
      // Planned off air: the sign-off slate carries when the station is back (the worker ends the
      // playlist with #EXT-X-ENDLIST after it).
      const off = await services.log.offAirAt(stationId, now);
      if (!off) return decorated;
      const tag = dateRangeTag({ id: `sign-off-${stationId}-${Date.parse(off.startsAt)}`, class: HLS_CLASS.signOff, start: Date.parse(off.startsAt), attributes: { backAt: off.backAt } });
      const lines = decorated.split("\n");
      const first = lines.findIndex((l) => l.startsWith("#EXTINF") || l.startsWith("#EXT-X-PROGRAM-DATE-TIME"));
      lines.splice(first < 0 ? lines.length : first, 0, tag);
      return lines.join("\n");
    },

    async stationsThatAired(from, to) {
      const rows = await db
        .selectDistinct({ stationId: schema.asRun.stationId })
        .from(schema.asRun)
        .where(and(gte(schema.asRun.startedAt, from), lt(schema.asRun.startedAt, to)));
      return rows.map((r) => r.stationId);
    },

    async onAirStations() {
      const rows = await db.select({ stationId: P.stationId }).from(P).where(eq(P.onAir, true));
      return rows.map((r) => r.stationId);
    },

    async scheduleSignOn(stationId, at) {
      await db.insert(schema.schedules).values({ stationId, startAt: at, enabled: true });
    },

    async runDueSignOns() {
      const now = deps.clock.now();
      const due = await db
        .select()
        .from(schema.schedules)
        .where(and(eq(schema.schedules.enabled, true), isNull(schema.schedules.startedAt), lte(schema.schedules.startAt, now), gte(schema.schedules.startAt, new Date(now.getTime() - 7 * 86_400_000))))
        .orderBy(asc(schema.schedules.startAt));
      let signedOn = 0;
      let notReady = 0;
      for (const schedule of due) {
        // Taken first, so two workers never sign the same station on twice.
        const [mine] = await db
          .update(schema.schedules)
          .set({ startedAt: now })
          .where(and(eq(schema.schedules.id, schedule.id), isNull(schema.schedules.startedAt)))
          .returning();
        if (!mine) continue;
        const [state] = await db.select().from(P).where(eq(P.stationId, schedule.stationId));
        if (state?.onAir) continue;
        try {
          await service.signOn(schedule.stationId);
          signedOn++;
        } catch (error) {
          notReady++;
          await db.update(schema.schedules).set({ enabled: false, endedAt: now }).where(eq(schema.schedules.id, schedule.id));
          console.warn(`[playout] scheduled sign-on for ${schedule.stationId} didn't happen: ${(error as Error).message}`);
        }
      }
      return { signedOn, notReady };
    },

    async nextSignOn(stationIds) {
      if (!stationIds.length) return new Map();
      const rows = await db
        .select()
        .from(schema.schedules)
        .where(and(inArray(schema.schedules.stationId, stationIds), eq(schema.schedules.enabled, true), gte(schema.schedules.startAt, deps.clock.now())))
        .orderBy(asc(schema.schedules.startAt));
      const result = new Map<string, Date>();
      for (const r of rows) if (!result.has(r.stationId)) result.set(r.stationId, r.startAt);
      return result;
    },

    async cancelSignOns(stationId) {
      await db
        .update(schema.schedules)
        .set({ enabled: false })
        .where(and(eq(schema.schedules.stationId, stationId), eq(schema.schedules.enabled, true), gte(schema.schedules.startAt, deps.clock.now())));
    },

    async airedItem(itemId, limit) {
      const rows = await db
        .select({ stationId: schema.asRun.stationId, startedAt: schema.asRun.startedAt, reason: schema.asRun.reason, carriageAgreementId: schema.asRun.carriageAgreementId })
        .from(schema.asRun)
        .where(and(eq(schema.asRun.assetId, itemId), eq(schema.asRun.code, "PGM")))
        .orderBy(desc(schema.asRun.startedAt))
        .limit(limit);
      return rows;
    },

    async firstAired(itemIds) {
      if (!itemIds.length) return new Map();
      const rows = await db
        .selectDistinctOn([schema.asRun.assetId], { itemId: schema.asRun.assetId, stationId: schema.asRun.stationId, startedAt: schema.asRun.startedAt })
        .from(schema.asRun)
        .where(inArray(schema.asRun.assetId, itemIds))
        .orderBy(schema.asRun.assetId, asc(schema.asRun.startedAt));
      return new Map(rows.map((r) => [r.itemId!, { stationId: r.stationId, startedAt: r.startedAt }]));
    },

    async endLive(stationId, userId) {
      await db.insert(schema.commands).values({ stationId, action: "end_live", issuedBy: userId });
    },

    async replan(stationId) {
      const [state] = await db.select({ onAir: P.onAir }).from(P).where(eq(P.stationId, stationId));
      if (state?.onAir) await db.insert(schema.commands).values({ stationId, action: "replan" });
    },

    async onAirSince(stationIds) {
      if (!stationIds.length) return new Map();
      const rows = await db
        .select({ stationId: schema.commands.stationId, at: sql<Date>`max(${schema.commands.createdAt})` })
        .from(schema.commands)
        .where(and(inArray(schema.commands.stationId, stationIds), eq(schema.commands.action, "sign_on")))
        .groupBy(schema.commands.stationId);
      return new Map(rows.map((r) => [r.stationId, new Date(r.at)]));
    },

    async carriedAirings(agreementIds, from, to) {
      if (!agreementIds.length) return new Map();
      const rows = await db
        .select({ agreementId: schema.asRun.carriageAgreementId })
        .from(schema.asRun)
        .where(and(inArray(schema.asRun.carriageAgreementId, agreementIds), gte(schema.asRun.startedAt, from), lt(schema.asRun.startedAt, to), eq(schema.asRun.code, "PGM")));
      const counts = new Map<string, number>();
      for (const r of rows) counts.set(r.agreementId!, (counts.get(r.agreementId!) ?? 0) + 1);
      return counts;
    }
  };
  return service;
}
