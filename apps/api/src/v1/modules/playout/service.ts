import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import type { ModuleContext } from "../../context.js";
import type { CurrentUser } from "../../http.js";
import { forbidden, refused } from "../../errors.js";
import { publicUrl } from "../../lib/url.js";
import type { OffAirSpanView } from "../log/service.js";
import { clockTime } from "../../lib/time.js";
import { objectKey } from "../../storage.js";
import { BAND_RENDITIONS, LADDER, scaledLadder, type Band, type RenditionName } from "./engine/ladder.js";
import { renderMaster, renderMedia, renderSubtitles, SUBTITLES, WINDOW_MS, type ChannelRow } from "./engine/playlist.js";
import { captionSources } from "./engine/captions.js";
import { EMPTY_VTT, languageName } from "../../lib/captions.js";
import { logReadiness } from "./engine/readiness.js";
import { refKey } from "./engine/prepare.js";

type CheckKey = "log_covers_24h" | "station_id_hourly" | "rights_confirmed" | "listings_complete" | "live_sources_connected" | "channel_chosen" | "call_sign_chosen" | "output" | "off_air_hours" | "items_prepared";

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
  /** Added 2026-09-29: whether what's on the log in the next 48 hours is prepared for air. */
  readiness?: { items: number; ready: number; firstNotReady: { itemId: string; title: string; airsAt: string; status: "queued" | "preparing" | "failed" | "not_asked" } | null } | null;
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
  /**
   * The channel's playlists (prepare once, then assemble): `master.m3u8` (also `index.m3u8`) and
   * one media playlist per rendition (`v720.m3u8`…), rendered from its assembled timeline. Null
   * when there's no such playlist (or nothing published yet). `maxAge` is the cache time. On the
   * TV band, `subs.m3u8` is the subtitle rendition (X2), and `empty.vtt` its empty segment.
   */
  playlist(stationId: string, file: string): Promise<{ body: string; maxAge: number; contentType?: string } | null>;
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
  /** Where an item's preparation for air stands, for a band (the library's item history). */
  preparation(ref: { contentId: string | null; location: string | null }, band: "tv" | "radio"): Promise<{ status: "ready" | "queued" | "preparing" | "failed" | "not_asked"; renditions: string[]; preparedAt: string | null }>;
  /** How many times a carried program aired on a carrier in a window (carriage limits, statements). */
  carriedAirings(agreementIds: string[], from: Date, to: Date): Promise<Map<string, number>>;
}

const HOUR = 3_600_000;

export function createPlayoutService({ deps, services }: ModuleContext): PlayoutService {
  const { db } = deps;
  const P = schema.playoutState;

  const ladder = Number(process.env.PREPARE_LADDER_SCALE) > 0 ? scaledLadder(Number(process.env.PREPARE_LADDER_SCALE)) : LADDER;
  const channelUrl = (stationId: string) => publicUrl(deps, `/hls/${stationId}/master.m3u8`);
  /** Segment lengths per prepared key and rendition (they never change once prepared). */
  const lengths = new Map<string, number[]>();
  /** Rendered playlists, for a second (a burst of viewers costs one render). */
  const rendered = new Map<string, { at: number; value: { body: string; maxAge: number } | null }>();
  const bandOf = async (stationId: string): Promise<Band> => (await services.stations.idents([stationId])).get(stationId)?.band ?? "tv";

  function segmentUrl(key: string, rendition: string, index: number) {
    const path = `${objectKey.prepared(key, rendition)}/seg_${String(index).padStart(5, "0")}.ts`;
    // The bucket's public domain (R2's custom domain); without one, the API passes them through.
    return deps.storage.objects.publicUrl?.(path) ?? publicUrl(deps, `/hls/${path}`);
  }

  function captionUrl(key: string, rendition: string, index: number) {
    const path = `${objectKey.prepared(key, rendition)}/seg_${String(index).padStart(5, "0")}.vtt`;
    return deps.storage.objects.publicUrl?.(path) ?? publicUrl(deps, `/hls/${path}`);
  }

  /** The subtitle rendition's language: the one most of the station's programs are captioned in, else English. */
  async function captionLanguage(stationId: string): Promise<string> {
    return (await services.library.stationCaptionLanguage(stationId)) ?? "en";
  }

  async function renderPlaylist(stationId: string, file: string): Promise<{ body: string; maxAge: number; contentType?: string } | null> {
    const band = await bandOf(stationId);
    // The empty caption segment: the same bytes for every station, kept a long time.
    if (file === SUBTITLES.empty) return band === "tv" ? { body: EMPTY_VTT, maxAge: 86_400, contentType: "text/vtt" } : null;
    const now = deps.clock.now();
    const C = schema.channelItems;
    const [latest] = await db
      .select({ run: C.run, kind: C.kind, startsAt: C.startsAt })
      .from(C)
      .where(and(eq(C.stationId, stationId), lte(C.startsAt, now)))
      .orderBy(desc(C.seq), desc(C.startsAt))
      .limit(1);
    if (!latest) return null;
    if (file === "master.m3u8" || file === "index.m3u8") {
      const language = band === "tv" ? await captionLanguage(stationId) : null;
      return { body: renderMaster(band, ladder, language ? { language, name: languageName(language) } : null), maxAge: 30 };
    }
    const rendition = file.replace(/\.m3u8$/, "") as RenditionName;
    const subtitles = file === SUBTITLES.file && band === "tv";
    if (!subtitles && !BAND_RENDITIONS[band].includes(rendition)) return null;
    // After a planned sign-off the ended playlist stays as it was until the next run starts.
    const edge = latest.kind === "end" ? latest.startsAt : now;
    const rows = (await db
      .select()
      .from(C)
      .where(and(eq(C.stationId, stationId), eq(C.run, latest.run), lte(C.startsAt, now), gt(C.endsAt, new Date(edge.getTime() - WINDOW_MS - 60_000))))
      .orderBy(asc(C.seq), asc(C.startsAt))) as ChannelRow[];
    const [end] = latest.kind === "end" ? [] : await db.select().from(C).where(and(eq(C.stationId, stationId), eq(C.run, latest.run), eq(C.kind, "end"), lte(C.startsAt, now))).limit(1);
    if (end) rows.push(end as ChannelRow);
    if (subtitles) {
      const sources = await captionSources(db, (ids) => services.library.captionTrackIds(ids), rows as Array<ChannelRow & { assetId: string | null }>);
      const body = renderSubtitles({
        rows,
        now: now.getTime(),
        empty: SUBTITLES.empty,
        uri: (row, index) => {
          const source = sources.get(row.id);
          return source && index < source.segments ? captionUrl(source.key, source.rendition, index) : null;
        }
      });
      return body ? { body, maxAge: 1 } : null;
    }
    const keys = [...new Set(rows.map((r) => r.preparedKey).filter((k): k is string => Boolean(k) && !lengths.has(`${k}/${rendition}`)))];
    if (keys.length) {
      const found = await db
        .select({ key: schema.preparedRenditions.key, segmentMs: schema.preparedRenditions.segmentMs })
        .from(schema.preparedRenditions)
        .where(and(eq(schema.preparedRenditions.rendition, rendition), inArray(schema.preparedRenditions.key, keys)));
      for (const f of found) lengths.set(`${f.key}/${rendition}`, f.segmentMs);
    }
    const body = renderMedia({ rows, rendition, now: now.getTime(), lengths: (key) => lengths.get(`${key}/${rendition}`) ?? null, uri: (key, index) => segmentUrl(key, rendition, index) });
    return body ? { body, maxAge: 1 } : null;
  }

  const service: PlayoutService = {
    async statusFor(stationIds) {
      if (!stationIds.length) return new Map();
      const states = await db.select().from(P).where(inArray(P.stationId, stationIds));
      const byId = new Map(states.map((s) => [s.stationId, s]));
      return new Map(
        stationIds.map((id) => {
          const onAir = byId.get(id)?.onAir ?? false;
          const standingBy = onAir && (byId.get(id)?.standingBy ?? false);
          // The channel's own playlists, assembled from prepared segments (and Livepeer's during live blocks).
          return [id, { onAir, playbackUrl: onAir ? channelUrl(id) : null, standingBy }];
        })
      );
    },

    async checks(stationId) {
      const now = deps.clock.now();
      const day = new Date(now.getTime() + 24 * HOUR);
      const [identity, gaps, breaks, readiness, entries, prepared, offAir, tz, [aired]] = await Promise.all([
        services.stations.identityReady(stationId),
        services.log.gaps(stationId, now, day),
        services.log.breaks(stationId, now, day),
        services.library.readiness(stationId),
        services.log.entries(stationId, now, day),
        bandOf(stationId).then((band) => logReadiness({ deps, services }, stationId, band, now, day)),
        services.log.offAirSpans(stationId, now, day),
        services.stations.timezoneOf(stationId),
        db.select({ id: schema.channelItems.id }).from(schema.channelItems).where(eq(schema.channelItems.stationId, stationId)).limit(1)
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
      const preparedCount = prepared.filter((p) => p.ready).length;
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
          // Prepare once, then assemble: the channel is its own playlists; nothing to set up.
          passed: true,
          blocking: false,
          detail: "Assembled from prepared items",
          // G6: where the channel plays, once it has aired (null before).
          watchUrl: aired ? channelUrl(stationId) : null
        },
        {
          key: "items_prepared",
          label: "Items prepared for air",
          passed: preparedCount === prepared.length,
          blocking: false,
          detail: prepared.length ? `${preparedCount} of ${prepared.length} in the next 24 hours${preparedCount < prepared.length ? ". The rest are being prepared; anything not ready at air time airs station ID and bumpers" : ""}` : null
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
      const [state] = await db.select().from(P).where(eq(P.stationId, stationId));
      const now = deps.clock.now();
      const [current] = (await services.log.entries(stationId, now, new Date(now.getTime() + 1000))).filter((e) => e.startsAt <= now && e.endsAt > now);
      const titles = current ? (await services.log.airingsByIds([current.id])).get(current.id) : undefined;
      const [nextBreak] = (await services.log.breaks(stationId, now, new Date(now.getTime() + 6 * HOUR))).filter((b) => Date.parse(b.startsAt) > now.getTime());
      const onAir = state?.onAir ?? false;
      // G2: since when, and what's next for the preview monitor.
      const [since, next, offAir, prepared] = await Promise.all([
        onAir ? service.onAirSince([stationId]) : Promise.resolve(new Map<string, Date>()),
        services.log.nextEntry(stationId, now),
        services.log.offAirSpans(stationId, now, new Date(now.getTime() + 24 * HOUR)),
        bandOf(stationId).then((band) => logReadiness({ deps, services }, stationId, band, now, new Date(now.getTime() + 48 * HOUR)))
      ]);
      const notReady = prepared.filter((p) => !p.ready).sort((a, b) => a.airsAt.getTime() - b.airsAt.getTime())[0];
      const plannedOff = offAir[0] ? { ...offAir[0], now: Date.parse(offAir[0].startsAt) <= now.getTime() } : null;
      return {
        readiness: {
          items: prepared.length,
          ready: prepared.filter((p) => p.ready).length,
          firstNotReady: notReady ? { itemId: notReady.itemId, title: notReady.title, airsAt: notReady.airsAt.toISOString(), status: (notReady.status as "queued" | "preparing" | "failed" | null) ?? "not_asked" } : null
        },
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
        lastError: state?.lastError ?? null,
        // The channel's playlists are assembled; Livepeer only transcodes live blocks' sources.
        output: { livepeerEnabled: false, playbackUrl: onAir ? channelUrl(stationId) : null, bitrateKbps: null },
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

    async playlist(stationId, file) {
      const id = `${stationId}/${file}`;
      const hit = rendered.get(id);
      const at = deps.clock.now().getTime();
      if (hit && Math.abs(at - hit.at) < 1_000) return hit.value;
      const value = await renderPlaylist(stationId, file);
      rendered.set(id, { at, value });
      if (rendered.size > 5_000) rendered.clear();
      return value;
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

    async preparation(ref, band) {
      const key = refKey(ref);
      if (!key) return { status: "not_asked", renditions: [], preparedAt: null };
      const [[item], renditions] = await Promise.all([
        db.select().from(schema.preparedItems).where(eq(schema.preparedItems.key, key)),
        db.select({ rendition: schema.preparedRenditions.rendition }).from(schema.preparedRenditions).where(eq(schema.preparedRenditions.key, key))
      ]);
      const done = renditions.map((r) => r.rendition).sort();
      const ready = BAND_RENDITIONS[band].every((r) => done.includes(r));
      return {
        status: ready ? "ready" : ((item?.status === "ready" ? "queued" : item?.status) ?? "not_asked"),
        renditions: done,
        preparedAt: item?.preparedAt?.toISOString() ?? null
      };
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
