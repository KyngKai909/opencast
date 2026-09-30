// The run sheet: what airs, second by second, from the program log. Programs play
// at their times, split around the breaks inside them; each break airs its spots
// (already placed and paid for), then the credit, bumpers and the station ID,
// which is always last when it airs. How often the station ID, bumpers and credit
// air in breaks is the break rule's cadence (cadence.ts; every break by default).
// Open time airs station ID and bumpers, never nothing.
//
// A station with no station ID of its own that can air airs its generated one (stationId.ts):
// wherever a station ID airs (breaks, open time, dead-air fill, back from off air) once it's
// prepared, the station ID slate before. An uploaded station ID always wins.
//
// Planned off air time (off air hours, a sign-off on the log) airs the sign-off slate for a minute,
// then nothing: the channel's playlist ends and waits. The station ID airs in the last seconds
// before the back time, where a new playlist starts, so the first program starts on time.
//
// The assembler (assemble.ts) turns the run sheet into the channel's playlists from prepared
// segments. An item that isn't prepared yet doesn't air: the planner is told what's ready
// (`isReady`) and plans the log's usual fill in its place, marking it `missing`.

import path from "node:path";
import type { ModuleContext } from "../../../context.js";
import type { ItemRef } from "../../library/service.js";
import type { BreakSlotView } from "../../log/service.js";
import { clockTime } from "../../../lib/time.js";
import { CREDIT_MS, STATION_ID_MS } from "./fill.js";
import { Slates, type StationLook } from "./slates.js";
import { breakPartsFor } from "./cadence.js";
import type { Band } from "./ladder.js";
import { GENERATED_SID_MS, generatedStationIdKey } from "./stationId.js";

/** A station ID or bumper to air: the library's, or the generated station ID. */
type FillerRef = Pick<ItemRef, "id" | "title" | "contentId" | "location" | "mediaKind" | "durationMs"> & { generated?: boolean };

type LogCode = "PGM" | "SPT" | "UND" | "BMP" | "SID" | "OPEN";
export type AsRunReason = "planned" | "rotation" | "backup_rotation" | "station_id_fill" | "dead_air_fill" | "live" | "slate";

export type SegmentSource =
  /** A prepared item: by content ID, or (before content IDs) its old location. */
  | { kind: "file"; location: string; seekMs: number; mediaKind: "video" | "audio"; contentId?: string }
  | { kind: "image"; path: string }
  | { kind: "live"; liveSourceId: string }
  /** Planned off air: no output at all until `backAt` (the playlist has ended). */
  | { kind: "off"; backAt: Date };

export interface Segment {
  key: string;
  startsAt: Date;
  endsAt: Date;
  code: LogCode;
  label: string;
  source: SegmentSource;
  reason: AsRunReason;
  inBreak: boolean;
  breakId?: string;
  logEntryId?: string;
  itemId?: string;
  programId?: string;
  airingId?: string;
  agreementId?: string;
  liveSourceId?: string;
  /** A spot's code and QR, drawn for its last :10. */
  code10?: { code: string; offer: string };
  spotId?: string;
  /** The whole break this segment is part of (for its SCTE-35 cue). */
  breakSpan?: { startsAt: Date; lengthMs: number };
  /** The sign-off slate: when the station is back. */
  backAt?: Date;
  /** Which generated slate an image is (the assembler prepares it at the segment's length). */
  slate?: "station_id" | "credit" | "off_air" | "stand_by";
  /** Fill airing in place of something that isn't prepared yet. */
  missing?: { itemId: string; title: string; contentId: string; airsAt: Date };
}

import { DEAD_AIR_NOTE } from "../../log/service.js";
import { offAirStretches } from "../../log/offair.js";
const BUMPER_MIN_MS = 1_000;
/** How long the sign-off slate airs before the channel ends. */
export const SIGN_OFF_SLATE_MS = 60_000;
/** Shorter off air time than this just holds the slate. */
const MIN_DARK_MS = 60_000;

export interface PlannerOptions {
  /** Is the item prepared for this station's band? Without it, everything counts as ready. */
  isReady?: (ref: { contentId: string | null; location: string | null }, stationId: string) => boolean;
  slatesDir?: string;
  /**
   * Asks for a station's generated station ID to be prepared (it isn't yet). `png` is its picture
   * (TV), drawn here. Without it, nothing is asked.
   */
  wantGenerated?: (spec: { stationId: string; key: string; band: Band; png: string | null; seconds: number }) => Promise<void>;
}

export function createPlanner({ deps, services }: ModuleContext, options: PlannerOptions = {}) {
  const slates = new Slates(options.slatesDir ?? path.join(deps.config.storageRoot, "slates"));

  /** What the assembler airs: a prepared item (by content ID or old location), or null when it isn't ready. */
  function fileAt(stationId: string, ref: { contentId: string | null; location: string | null }): string | null {
    if (!ref.contentId && !ref.location) return null;
    if (options.isReady && !options.isReady(ref, stationId)) return null;
    return ref.contentId ? `cid:${ref.contentId}` : ref.location!;
  }

  async function look(stationId: string): Promise<StationLook & { bug: { mode: string; opacity: number }; band: Band }> {
    const l = await services.stations.look(stationId);
    return l ?? { callSign: null, channel: null, name: "Opencast", homeCity: null, colour: null, bug: { mode: "off", opacity: 78 }, band: "tv" };
  }

  /**
   * The station's generated station ID, when it's prepared (it's asked for when it isn't, if
   * `ask`: the station has no station ID of its own that can air).
   */
  async function generatedId(stationId: string, station: StationLook & { band: Band }, ask: boolean): Promise<FillerRef | null> {
    const key = generatedStationIdKey(station, station.band);
    if (fileAt(stationId, { contentId: key, location: null })) {
      return { id: "", title: `${station.callSign ?? station.name} ${station.channel ?? ""}`.trim(), contentId: key, location: null, mediaKind: "video", durationMs: GENERATED_SID_MS, generated: true };
    }
    if (ask && options.wantGenerated) {
      const png = station.band === "radio" ? null : await slates.stationIdCard(station);
      await options.wantGenerated({ stationId, key, band: station.band, png, seconds: GENERATED_SID_MS / 1000 }).catch(() => undefined);
    }
    return null;
  }

  /**
   * Station IDs and bumpers to fill `ms`, the station ID last. A break's cadence may leave out the
   * station ID or the bumpers (`parts`); what's left holds on the station ID slate.
   */
  async function filler(
    stationId: string,
    startsAt: Date,
    ms: number,
    context: { key: string; reason: AsRunReason; inBreak: boolean; breakId?: string },
    fillers: { stationIds: FillerRef[]; bumpers: FillerRef[] },
    station: StationLook,
    parts: { bumpers: boolean; stationId: boolean } = { bumpers: true, stationId: true }
  ): Promise<Segment[]> {
    const out: Segment[] = [];
    if (ms <= 0) return out;
    const withBumpers = parts.bumpers;
    let sid: FillerRef | undefined = fillers.stationIds[0];
    // The generated station ID airs whole (ten seconds); with less room, the station ID slate.
    if (sid?.generated && ms < sid.durationMs!) sid = undefined;
    const sidMs = parts.stationId ? Math.min(ms, sid?.durationMs ?? STATION_ID_MS) : 0;
    let cursor = startsAt.getTime();
    let left = ms - sidMs;
    let n = 0;
    while (withBumpers && left >= BUMPER_MIN_MS && fillers.bumpers.length) {
      const bumper = fillers.bumpers[n % fillers.bumpers.length];
      // A bumper is never cut short; what's left holds on the station ID slate.
      if (bumper.durationMs! > left) break;
      const len = bumper.durationMs!;
      out.push({ key: `${context.key}:bmp:${n}`, startsAt: new Date(cursor), endsAt: new Date(cursor + len), code: "BMP", label: bumper.title, source: { kind: "file", location: fileAt(stationId, bumper)!, seekMs: 0, mediaKind: bumper.mediaKind, contentId: bumper.contentId ?? undefined }, reason: context.reason, inBreak: context.inBreak, breakId: context.breakId, itemId: bumper.id });
      cursor += len;
      left -= len;
      n++;
      if (n > 500) break;
    }
    if (left > 0) {
      // Holds on the station ID slate.
      out.push({ key: `${context.key}:open`, startsAt: new Date(cursor), endsAt: new Date(cursor + left), code: "OPEN", label: "Station ID slate", source: { kind: "image", path: await slates.stationId(station) }, slate: "station_id", reason: context.reason, inBreak: context.inBreak, breakId: context.breakId });
      cursor += left;
    }
    if (!parts.stationId) return out;
    out.push({
      key: `${context.key}:sid`,
      startsAt: new Date(cursor),
      endsAt: new Date(cursor + sidMs),
      code: "SID",
      label: sid?.title ?? `${station.callSign ?? station.name} ${station.channel ?? ""}`.trim(),
      source: sid ? { kind: "file", location: fileAt(stationId, sid)!, seekMs: 0, mediaKind: sid.mediaKind, contentId: sid.contentId ?? undefined } : { kind: "image", path: await slates.stationId(station) },
      slate: sid ? undefined : "station_id",
      reason: context.reason,
      inBreak: context.inBreak,
      breakId: context.breakId,
      itemId: sid?.id || undefined
    });
    return out;
  }

  return {
    slates,

    /** Everything that airs on a station between `from` and `to`, in order, with no gaps. */
    async plan(stationId: string, from: Date, to: Date): Promise<Segment[]> {
      const lookback = new Date(from.getTime() - 6 * 3_600_000);
      const [allEntries, breaks, allFillers, station, credits, members, offAirSpans] = await Promise.all([
        services.log.entries(stationId, lookback, to),
        services.log.breaks(stationId, lookback, to),
        services.library.fillers(stationId),
        look(stationId),
        services.spots.creditsFor(stationId),
        services.ledger.memberCredits(stationId),
        services.log.offAirSpans(stationId, lookback, to)
      ]);
      // Planned off air time is its own block (sign-off entries included), from sign-off to back.
      const offAirBlocks = offAirStretches(offAirSpans).map((o) => ({ s: Date.parse(o.startsAt), e: Date.parse(o.backAt), logEntryId: o.logEntryId }));
      const entries = allEntries.filter((e) => e.kind !== "off_air");
      // Only station IDs and bumpers that are prepared.
      const fillers: { stationIds: FillerRef[]; bumpers: FillerRef[] } = { stationIds: allFillers.stationIds.filter((f) => fileAt(stationId, f)), bumpers: allFillers.bumpers.filter((f) => fileAt(stationId, f)) };
      // No station ID of its own ready: the generated one (asked for when there's none that could be).
      if (!fillers.stationIds.length) {
        const generated = await generatedId(stationId, station, !allFillers.stationIds.length);
        if (generated) fillers.stationIds.push(generated);
      }
      // How often the station ID, bumpers and credit air in each break (every break by default).
      const partsOf = await breakPartsFor({ deps, services }, stationId, { breaks, entries: { rows: allEntries, from: lookback, to } });
      const stored = breaks.filter((b): b is BreakSlotView & { id: string } => Boolean(b.id));
      const [items, airings, programs, offAir] = await Promise.all([
        services.library.itemsByIds(entries.map((e) => e.assetId).filter((v): v is string => Boolean(v))),
        services.spots.breakAirings(stored.map((b) => b.id)),
        services.library.programsByIds(entries.map((e) => e.programId).filter((v): v is string => Boolean(v))),
        services.trust.offAirItems(entries.map((e) => e.assetId).filter((v): v is string => Boolean(v)))
      ]);
      const tz = await services.stations.timezoneOf(stationId);
      const segments: Segment[] = [];

      const composeBreak = async (slot: BreakSlotView, entryId: string | null): Promise<Segment[]> => {
        const out: Segment[] = [];
        const start = Date.parse(slot.startsAt);
        const end = start + slot.lengthMs;
        let cursor = start;
        const key = `brk:${slot.id ?? slot.startsAt}`;
        let missing: Segment["missing"];
        // Spots, producer's share first; already held, so they air even if paused since.
        for (const airing of slot.id ? (airings.get(slot.id) ?? []) : []) {
          const len = airing.lengthSec * 1000;
          const at = fileAt(stationId, airing);
          // Not prepared: it doesn't air (its hold goes back), and the break fills as usual.
          if (!at && airing.contentId && !missing) missing = { itemId: airing.spotId, title: airing.title, contentId: airing.contentId, airsAt: new Date(start) };
          if (!at || cursor + len > end) continue;
          out.push({
            key: `${key}:spt:${airing.airingId}`,
            startsAt: new Date(cursor),
            endsAt: new Date(cursor + len),
            code: "SPT",
            label: "Spot",
            source: { kind: "file", location: at, seekMs: 0, mediaKind: "video", contentId: airing.contentId ?? undefined },
            reason: "rotation",
            inBreak: true,
            breakId: slot.id ?? undefined,
            airingId: airing.airingId,
            agreementId: airing.carriageAgreementId ?? undefined,
            code10: airing.code ?? undefined,
            spotId: airing.spotId
          });
          cursor += len;
        }
        // The thank-you credit: sponsors of this program, of the station, and members who asked to be named.
        const entry = entries.find((e) => e.id === entryId);
        const programId = entry?.programId ?? (entry?.assetId ? items.get(entry.assetId)?.programId : null) ?? null;
        const sponsors = credits.filter((c) => c.programId === null || c.programId === programId);
        const parts = partsOf(slot);
        // Room for the station ID after it (the generated one is ten seconds).
        const sidRoom = parts.stationId ? (fillers.stationIds[0]?.generated ? GENERATED_SID_MS : STATION_ID_MS) : 0;
        if (parts.underwriting && (sponsors.length || members.named.length) && end - cursor >= sidRoom + 10_000) {
          const len = Math.min(CREDIT_MS, end - cursor - sidRoom);
          const programSponsors = sponsors.some((c) => c.programId && c.programId === programId);
          const subject = programSponsors && programId ? (programs.get(programId)?.title ?? station.name) : station.name;
          out.push({
            key: `${key}:und`,
            startsAt: new Date(cursor),
            endsAt: new Date(cursor + len),
            code: "UND",
            label: `${subject} is made possible by`,
            source: { kind: "image", path: await slates.credit(station, { subject, sponsors: sponsors.map((s) => ({ business: s.business, creditText: s.creditText })), members: members.named }) },
            slate: "credit",
            reason: "planned",
            inBreak: true,
            breakId: slot.id ?? undefined
          });
          cursor += len;
        }
        out.push(...(await filler(stationId, new Date(cursor), end - cursor, { key, reason: "planned", inBreak: true, breakId: slot.id ?? undefined }, fillers, station, parts)));
        // Reported when the break airs; if the file arrives first, the break is planned again with it.
        const firstAfterSpots = out.findIndex((s) => s.code !== "SPT");
        if (missing && firstAfterSpots >= 0) out[firstAfterSpots] = { ...out[firstAfterSpots], missing };
        const breakSpan = { startsAt: new Date(start), lengthMs: slot.lengthMs };
        return out.map((seg) => ({ ...seg, breakSpan }));
      };

      const openTime = async (a: number, b: number) => {
        if (b <= a) return;
        segments.push(...(await filler(stationId, new Date(a), b - a, { key: `open:${a}`, reason: "station_id_fill", inBreak: false }, fillers, station)));
      };

      const signOff = async (block: { s: number; e: number; logEntryId: string | null }) => {
        const back = clockTime(new Date(block.e), tz);
        const slate = { kind: "image" as const, path: await slates.offAir(station, back) };
        const base = { code: "OPEN" as const, label: "Off air", reason: "slate" as const, inBreak: false, logEntryId: block.logEntryId ?? undefined, slate: "off_air" as const, backAt: new Date(block.e) };
        const sid = fillers.stationIds[0];
        const sidMs = Math.min(sid?.durationMs ?? STATION_ID_MS, 60_000);
        if (block.e - block.s < SIGN_OFF_SLATE_MS + MIN_DARK_MS + sidMs) {
          segments.push({ ...base, key: `off:${block.s}`, startsAt: new Date(block.s), endsAt: new Date(block.e), source: slate });
          return;
        }
        segments.push({ ...base, key: `off:${block.s}`, startsAt: new Date(block.s), endsAt: new Date(block.s + SIGN_OFF_SLATE_MS), source: slate });
        segments.push({ ...base, key: `off:${block.s}:dark`, startsAt: new Date(block.s + SIGN_OFF_SLATE_MS), endsAt: new Date(block.e - sidMs), source: { kind: "off", backAt: new Date(block.e) } });
        // Back on: the station ID first.
        segments.push(...(await filler(stationId, new Date(block.e - sidMs), sidMs, { key: `on:${block.e}`, reason: "planned", inBreak: false }, fillers, station, { bumpers: false, stationId: true })));
      };

      const blocks = [
        ...entries.map((entry) => ({ s: entry.startsAt.getTime(), e: entry.endsAt.getTime(), entry, off: null })),
        ...offAirBlocks.map((off) => ({ s: off.s, e: off.e, entry: null, off }))
      ].sort((a, b) => a.s - b.s);

      let cursor = from.getTime();
      for (const block of blocks) {
        const s = block.s;
        const e = block.e;
        if (e <= cursor) continue;
        await openTime(cursor, s);
        if (block.off) {
          await signOff(block.off);
          cursor = Math.max(cursor, e);
          continue;
        }
        const entry = block.entry!;
        const inside = breaks.filter((b) => b.logEntryId === entry.id).sort((x, y) => x.startsAt.localeCompare(y.startsAt));
        const reason: AsRunReason = entry.localNote === DEAD_AIR_NOTE ? "dead_air_fill" : "planned";

        if (entry.kind === "live") {
          let t = s;
          for (const b of inside) {
            const bs = Date.parse(b.startsAt);
            if (bs > t) segments.push({ key: `entry:${entry.id}:${t}`, startsAt: new Date(t), endsAt: new Date(bs), code: "PGM", label: "Live", source: { kind: "live", liveSourceId: entry.liveSourceId! }, reason: "live", inBreak: false, logEntryId: entry.id, programId: entry.programId ?? undefined, liveSourceId: entry.liveSourceId ?? undefined });
            segments.push(...(await composeBreak(b, entry.id)));
            t = bs + b.lengthMs;
          }
          if (t < e) segments.push({ key: `entry:${entry.id}:${t}`, startsAt: new Date(t), endsAt: new Date(e), code: "PGM", label: "Live", source: { kind: "live", liveSourceId: entry.liveSourceId! }, reason: "live", inBreak: false, logEntryId: entry.id, programId: entry.programId ?? undefined, liveSourceId: entry.liveSourceId ?? undefined });
        } else {
          const item = entry.assetId ? items.get(entry.assetId) : undefined;
          const at = item ? fileAt(stationId, item) : null;
          const playable = item && at && item.durationMs && !item.contentUnavailable && !offAir.has(item.id) && !item.archived;
          if (!playable) {
            // Pulled by a claim, not ready, or not prepared: station ID and bumpers, never nothing.
            const before = segments.length;
            await openTime(s, e);
            if (item?.contentId && !item.contentUnavailable && !at && segments[before]) {
              segments[before] = { ...segments[before], missing: { itemId: item.id, title: item.title, contentId: item.contentId, airsAt: entry.startsAt } };
            }
          } else {
            let t = s;
            let pos = 0;
            const title = entry.programId ? (programs.get(entry.programId)?.title ?? item.title) : item.title;
            const program = (from: number, to: number, seek: number): Segment => ({
              key: `entry:${entry.id}:${from}`,
              startsAt: new Date(from),
              endsAt: new Date(to),
              code: entry.code,
              label: title,
              source: { kind: "file", location: at!, seekMs: seek, mediaKind: item.mediaKind, contentId: item.contentId ?? undefined },
              reason,
              inBreak: false,
              logEntryId: entry.id,
              itemId: item.id,
              programId: entry.programId ?? item.programId ?? undefined,
              agreementId: entry.carriageAgreementId ?? undefined
            });
            for (const b of inside) {
              const bs = Date.parse(b.startsAt);
              if (bs > t && pos < item.durationMs!) {
                const len = Math.min(bs - t, item.durationMs! - pos);
                segments.push(program(t, t + len, pos));
                pos += len;
                t += len;
              }
              if (bs > t) await openTime(t, bs);
              segments.push(...(await composeBreak(b, entry.id)));
              t = Math.max(t, bs + b.lengthMs);
            }
            if (pos < item.durationMs! && t < e) {
              const len = Math.min(e - t, item.durationMs! - pos);
              segments.push(program(t, t + len, pos));
              t += len;
            }
            await openTime(t, e);
          }
        }
        cursor = Math.max(cursor, e);
      }
      await openTime(cursor, to.getTime());
      return segments.filter((seg) => seg.endsAt.getTime() > from.getTime() && seg.startsAt.getTime() < to.getTime() && seg.endsAt > seg.startsAt);
    }
  };
}
