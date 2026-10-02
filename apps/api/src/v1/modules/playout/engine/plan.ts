// The run sheet: what airs, second by second, from the program log. Programs play
// at their times, split around the breaks inside them; each break airs a bumper into
// the break, its spots (already placed and paid for), the credit, a bumper out of the
// break and the station ID, which is always last when it airs (the bumpers at both
// ends since 2026-09-29; before, they filled the time after the credit). Time left
// over holds on the station ID slate before the station ID. How often each part airs
// in breaks, spots included, is the break rule's cadence (cadence.ts; every break by
// default), decided with the log's breaks (`BreakSlotView.parts`).
// Open time airs station ID and bumpers, never nothing.
//
// A station with no station ID of its own that can air airs its generated one (stationId.ts):
// wherever a station ID airs (breaks, open time, dead-air fill, back from off air) once it's
// prepared, the station ID slate before. An uploaded station ID always wins.
//
// Planned off air time (off air hours, a sign-off on the log), since A242 (2026-10-02): the
// station's closer, then its off-air card for a minute, then nothing: the channel's playlist ends
// and waits. The opener airs in the last seconds before the back time, where a new playlist starts,
// so the first program starts on time; the station ID after it only if the station says so (the
// opener replaces it by default). Without a closer or opener of its own, the automatic one in the
// station's look (stationId.ts); without an off-air card of its own, the generated one (slates.ts).
// An off air block too short for all of that keeps the channel going: closer, the card held for
// what's left, opener; shorter still, the card alone for the whole block (as before A242). Several
// openers, closers or cards take turns, a broadcast day each (in library order).
//
// A station that never goes off air can open each broadcast day with its opener (`dailyOpener`):
// at the first program boundary at or after 6:00 am (the market's time, the day templates' day),
// in the last seconds of the break or open time before it, where the station ID would air: it
// takes the place of that fill (the station ID, a bumper, the station ID slate), never of a program,
// a spot or a credit. A boundary without that much fill before it is passed over for the next, for
// three hours. A day that starts with a sign-on (off air time ending within three hours of 6:00 am)
// already opens with the opener.
//
// The assembler (assemble.ts) turns the run sheet into the channel's playlists from prepared
// segments. An item that isn't prepared yet doesn't air: the planner is told what's ready
// (`isReady`) and plans the log's usual fill in its place, marking it `missing`.

import { promises as fs } from "node:fs";
import path from "node:path";
import { asLogCode } from "@opencast/contracts";
import type { ModuleContext } from "../../../context.js";
import { objectKey, sha256FromCid } from "../../../storage.js";
import type { ItemRef } from "../../library/service.js";
import type { BreakSlotView } from "../../log/service.js";
import { clockTime } from "../../../lib/time.js";
import { broadcastDate, broadcastDay } from "../../log/templates.js";
import { CREDIT_MS, STATION_ID_MS } from "./fill.js";
import { identLine, Slates, type StationLook } from "./slates.js";
import { hourStartIn, partsOf } from "./cadence.js";
import { catalogCreditBreaks } from "./catalogCredit.js";
import type { Band } from "./ladder.js";
import { GENERATED_IDENT_MS, GENERATED_SID_MS, generatedIdentKey, generatedStationIdKey, type IdentKind } from "./stationId.js";
import { bumpersIn } from "./cadence.js";
import { defaultElements, eligible, fitElements, type AirWindowRef, type Announce, type Boundary, type BumperRole, type Element } from "./sequence.js";

/** A station ID or bumper to air: the library's, or the generated station ID. */
type FillerRef = Pick<ItemRef, "id" | "title" | "contentId" | "location" | "mediaKind" | "durationMs"> & { generated?: boolean; bumperRole?: BumperRole | null; airs?: AirWindowRef | null };

/** `OPN` an opener, `CLS` a closer (A242). */
type LogCode = "PGM" | "SPT" | "UND" | "BMP" | "SID" | "OPEN" | "OPN" | "CLS";
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
  /** A243: a bumper's role as it airs here (its sequence's), for the as-run log and the item tag. */
  bumperRole?: BumperRole;
  /** A243: where it airs: a break's opening or closing sequence, between programs, open time, or (A242) sign-on. */
  position?: "open" | "close" | "between" | "open_time" | "sign_on";
  /** A243: up next only, what it names (the player draws the title over it). */
  announces?: Announce;
}

import { DEAD_AIR_NOTE } from "../../log/service.js";
import { offAirStretches } from "../../log/offair.js";
const BUMPER_MIN_MS = 1_000;
/** How long the sign-off slate airs before the channel ends. */
export const SIGN_OFF_SLATE_MS = 60_000;
/** Shorter off air time than this just holds the slate. */
const MIN_DARK_MS = 60_000;
/**
 * A242: off air time with no room to go dark (closer, a minute of the card, a minute dark, opener)
 * keeps the channel on: closer, the card for what's left, opener, as long as the card holds this long.
 */
export const MIN_CARD_MS = 10_000;
/** A242: how long after 6:00 am the daily opener looks for a program boundary with room before it. */
export const DAILY_OPENER_WINDOW_MS = 3 * 3_600_000;
/** The run sheet is planned from this long before 6:00 am, for the fill the daily opener takes the end of. */
const DAILY_OPENER_LEAD_MS = 15 * 60_000;
const DAY_MS = 86_400_000;

/** An opener or closer to air (A242): the station's own, the automatic one, or (until that's prepared) its picture, silent. */
interface IdentPick {
  ms: number;
  label: string;
  source: SegmentSource;
  itemId?: string;
}

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
  const slatesDir = options.slatesDir ?? path.join(deps.config.storageRoot, "slates");
  const slates = new Slates(slatesDir);

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
   * An opener or closer (A242): the station's own (`own`, prepared; one a broadcast day, in turn),
   * else the automatic one in its look once it's prepared, else that one's picture held, silent
   * (it's asked for, if `ask`: the station has none of its own that could air).
   */
  async function identFor(
    stationId: string,
    station: StationLook & { band: Band },
    kind: IdentKind,
    own: FillerRef[],
    turn: number,
    back: string | null,
    ask: boolean
  ): Promise<IdentPick> {
    if (own.length) {
      const ref = own[turn % own.length];
      return { ms: ref.durationMs!, label: ref.title, source: { kind: "file", location: fileAt(stationId, ref)!, seekMs: 0, mediaKind: ref.mediaKind, contentId: ref.contentId ?? undefined }, itemId: ref.id };
    }
    const label = kind === "opener" ? `${identLine(station)} · Signing on` : `${identLine(station)} · Signing off${back ? ` · Back at ${back}` : ""}`;
    const key = generatedIdentKey(station, station.band, kind, back);
    const at = fileAt(stationId, { contentId: key, location: null });
    if (at) return { ms: GENERATED_IDENT_MS, label, source: { kind: "file", location: at, seekMs: 0, mediaKind: "video", contentId: key } };
    const png = await slates.identCard(station, kind, back);
    if (ask && options.wantGenerated) await options.wantGenerated({ stationId, key, band: station.band, png: station.band === "radio" ? null : png, seconds: GENERATED_IDENT_MS / 1000 }).catch(() => undefined);
    return { ms: GENERATED_IDENT_MS, label, source: { kind: "image", path: png } };
  }

  /** A still off-air card's picture (A242), fitted to the frame; null if it can't be read. */
  async function cardPicture(ref: Pick<ItemRef, "contentId" | "location">): Promise<string | null> {
    try {
      if (ref.contentId) {
        const source = path.join(slatesDir, `card-source-${ref.contentId}`);
        try {
          await fs.access(source);
        } catch {
          await fs.mkdir(slatesDir, { recursive: true });
          const partial = `${source}.${process.pid}.${Date.now()}.part`;
          await deps.storage.objects.download(objectKey.file(ref.contentId), partial, sha256FromCid(ref.contentId));
          await fs.rename(partial, source);
        }
        return await slates.ownCard(source, ref.contentId);
      }
      if (ref.location && !/^https?:\/\//.test(ref.location)) return await slates.ownCard(ref.location, ref.location);
    } catch {
      // Unreadable: the generated card airs instead.
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
    fillers: { stationIds: FillerRef[]; bumpers: FillerRef[]; tz?: string },
    station: StationLook,
    parts: { bumpers: boolean; stationId: boolean } = { bumpers: true, stationId: true }
  ): Promise<Segment[]> {
    const out: Segment[] = [];
    if (ms <= 0) return out;
    const withBumpers = parts.bumpers;
    // A243: only what's inside its window (dates, time of day) airs.
    const inWindow = (f: FillerRef, t: number) => !fillers.tz || eligible(f, t, fillers.tz);
    let sid: FillerRef | undefined = fillers.stationIds.find((f) => inWindow(f, startsAt.getTime()));
    // The generated station ID airs whole (ten seconds); with less room, the station ID slate.
    if (sid?.generated && ms < sid.durationMs!) sid = undefined;
    const sidMs = parts.stationId ? Math.min(ms, sid?.durationMs ?? STATION_ID_MS) : 0;
    let cursor = startsAt.getTime();
    let left = ms - sidMs;
    let n = 0;
    // A243: open time loops the Any bumpers (every bumper before roles); with none, every bumper but up next.
    const anyPool = fillers.bumpers.filter((b) => !b.bumperRole || b.bumperRole === "any");
    const loop = anyPool.length ? anyPool : fillers.bumpers.filter((b) => b.bumperRole !== "up_next");
    while (withBumpers && left >= BUMPER_MIN_MS && loop.length) {
      const pool = loop.filter((b) => inWindow(b, cursor));
      if (!pool.length) break;
      const bumper = pool[n % pool.length];
      // A bumper is never cut short; what's left holds on the station ID slate.
      if (bumper.durationMs! > left) break;
      const len = bumper.durationMs!;
      out.push({ key: `${context.key}:bmp:${n}`, startsAt: new Date(cursor), endsAt: new Date(cursor + len), code: "BMP", label: bumper.title, source: { kind: "file", location: fileAt(stationId, bumper)!, seekMs: 0, mediaKind: bumper.mediaKind, contentId: bumper.contentId ?? undefined }, reason: context.reason, inBreak: context.inBreak, breakId: context.breakId, itemId: bumper.id, ...(context.inBreak ? {} : { position: "open_time" as const }) });
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

  /**
   * The daily opener (A242): for each broadcast day starting in the run sheet (6:00 am in the
   * market's time zone), the opener at the first program boundary at or after it with enough fill
   * just before it (the station ID slate, the station ID, a bumper: never a program, a spot, a
   * credit, a live block or an off-air card), looking three hours on. It takes the last seconds of
   * that fill, the station ID after it if the station says so; a station ID or bumper it would cut
   * into gives way to the station ID slate. Not on a day that starts with a sign-on.
   */
  async function dailyOpeners(
    segments: Segment[],
    c: {
      start: number;
      to: number;
      tz: string;
      entries: Array<{ startsAt: Date; kind: string }>;
      offAirBlocks: Array<{ e: number }>;
      opener: (at: number) => Promise<IdentPick>;
      sidMs: number;
      station: StationLook;
      stationId: string;
      fillers: { stationIds: FillerRef[]; bumpers: FillerRef[]; tz?: string };
    }
  ) {
    const fill = (seg: Segment) => seg.source.kind !== "live" && seg.source.kind !== "off" && seg.slate !== "off_air" && !seg.airingId && (seg.code === "OPEN" || seg.code === "SID" || seg.code === "BMP");
    const days = new Set<number>();
    for (let t = c.start + DAILY_OPENER_LEAD_MS; t <= c.to; t += 3_600_000) days.add(broadcastDay(broadcastDate(new Date(t), c.tz), c.tz).from.getTime());
    days.add(broadcastDay(broadcastDate(new Date(c.to), c.tz), c.tz).from.getTime());
    for (const day of [...days].sort((a, b) => a - b)) {
      if (day < c.start || day > c.to) continue;
      // A day that starts with a sign-on opens with the opener already.
      if (c.offAirBlocks.some((o) => Math.abs(o.e - day) <= DAILY_OPENER_WINDOW_MS)) continue;
      const boundaries = [...new Set(c.entries.filter((e) => e.kind !== "off_air").map((e) => e.startsAt.getTime()))]
        .filter((t) => t >= day && t < day + DAILY_OPENER_WINDOW_MS && t <= c.to)
        .sort((a, b) => a - b);
      const pick = await c.opener(day);
      const need = pick.ms + c.sidMs;
      for (const at of boundaries) {
        const last = segments.findIndex((seg) => seg.endsAt.getTime() === at);
        if (last < 0) continue;
        // The fill just before the boundary, going back until there's room.
        let first = last;
        while (first >= 0 && fill(segments[first]) && at - segments[first].startsAt.getTime() < need) {
          if (first > 0 && segments[first - 1].endsAt.getTime() !== segments[first].startsAt.getTime()) break;
          first--;
        }
        if (first < 0 || !fill(segments[first]) || at - segments[first].startsAt.getTime() < need) continue;
        const cut = at - need;
        const where = segments[last];
        const context = { reason: "planned" as const, inBreak: where.inBreak, breakId: where.breakId, breakSpan: where.breakSpan };
        const kept: Segment[] = [];
        const straddling = segments[first];
        if (straddling.startsAt.getTime() < cut) {
          // A picture is shortened; a station ID or bumper doesn't air cut: the station ID slate holds instead.
          kept.push(
            straddling.source.kind === "image"
              ? { ...straddling, endsAt: new Date(cut) }
              : { ...straddling, key: `${straddling.key}:held`, code: "OPEN", label: "Station ID slate", source: { kind: "image", path: await slates.stationId(c.station) }, slate: "station_id", itemId: undefined, endsAt: new Date(cut) }
          );
        }
        const opener: Segment = { key: `day:${day}:opn`, startsAt: new Date(cut), endsAt: new Date(cut + pick.ms), code: "OPN", label: pick.label, source: pick.source, itemId: pick.itemId, ...context };
        const after = c.sidMs ? await filler(c.stationId, new Date(cut + pick.ms), c.sidMs, { key: `day:${day}`, reason: "planned", inBreak: where.inBreak, breakId: where.breakId }, c.fillers, c.station, { bumpers: false, stationId: true }) : [];
        segments.splice(first, last - first + 1, ...kept, opener, ...after.map((seg) => ({ ...seg, breakSpan: where.breakSpan })));
        break;
      }
    }
  }

  return {
    slates,

    /** Everything that airs on a station between `from` and `to`, in order, with no gaps. */
    async plan(stationId: string, from: Date, to: Date): Promise<Segment[]> {
      const [tz, rule] = await Promise.all([services.stations.timezoneOf(stationId), services.stations.breakRule(stationId)]);
      // The daily opener (A242) is placed from the broadcast day's 6:00 am on: a window that starts
      // within three hours after it (or just before it) is planned from a little before 6:00 am (and
      // cut to the window at the end), so where it goes never depends on where the window starts.
      let start = from.getTime();
      if (rule.dailyOpener) {
        const today = broadcastDay(broadcastDate(from, tz), tz).from.getTime();
        const next = broadcastDay(broadcastDate(new Date(start + DAILY_OPENER_LEAD_MS), tz), tz).from.getTime();
        if (start - today <= DAILY_OPENER_WINDOW_MS) start = Math.min(start, today - DAILY_OPENER_LEAD_MS);
        if (next > from.getTime()) start = Math.min(start, next - DAILY_OPENER_LEAD_MS);
      }
      const lookback = new Date(start - 6 * 3_600_000);
      const [allEntries, { breaks, boundaries }, allFillers, station, credits, members, offAirSpans, paused, allIdentity] = await Promise.all([
        services.log.entries(stationId, lookback, to),
        services.log.breakPlan(stationId, lookback, to),
        services.library.fillers(stationId),
        look(stationId),
        services.spots.creditsFor(stationId),
        services.ledger.memberCredits(stationId),
        services.log.offAirSpans(stationId, lookback, to),
        services.billing.paused(stationId),
        services.library.identity(stationId)
      ]);
      // Pay-as-you-go: live hours paused (their cap reached, or a bill unpaid past the grace
      // period) air the live block's time as open time, station ID and bumpers. Never dead air.
      const livePaused = station.band === "radio" ? paused.radioLive : paused.liveHours;
      // Planned off air time is its own block (sign-off entries included), from sign-off to back.
      const offAirBlocks = offAirStretches(offAirSpans).map((o) => ({ s: Date.parse(o.startsAt), e: Date.parse(o.backAt), logEntryId: o.logEntryId }));
      const entries = allEntries.filter((e) => e.kind !== "off_air");
      // Only station IDs and bumpers that are prepared (A243: each in its window when it airs).
      const fillers: { stationIds: FillerRef[]; bumpers: FillerRef[]; tz: string } = { stationIds: allFillers.stationIds.filter((f) => fileAt(stationId, f)), bumpers: allFillers.bumpers.filter((f) => fileAt(stationId, f)), tz };
      // No station ID of its own ready: the generated one (asked for when there's none that could be).
      // A243: its own all have windows: the generated one too, for the times none is in its window.
      if (!fillers.stationIds.length || fillers.stationIds.every((f) => f.airs)) {
        const generated = await generatedId(stationId, station, !allFillers.stationIds.length);
        if (generated) fillers.stationIds.push(generated);
      }
      // A243: the between-programs bumpers before each program (a closing break carves them from its end, open time from its own).
      const boundaryAt = new Map(boundaries.map((b) => [Date.parse(b.at), b]));
      const carved = new Set<number>();
      const preparedBumper = new Map(fillers.bumpers.map((b) => [b.id, b]));
      /** An element's bumper, prepared and in its window; else the next in its chain that is. */
      const resolve = (e: Element, t: number): FillerRef | null => {
        for (const id of [e.itemId, ...e.alternates]) {
          const ref = preparedBumper.get(id);
          if (ref && eligible(ref, t, tz)) return ref;
        }
        return null;
      };
      const elementSegment = (e: Element, ref: FillerRef, at: number, key: string, where: { inBreak: boolean; breakId?: string }): Segment => ({
        key,
        startsAt: new Date(at),
        endsAt: new Date(at + ref.durationMs!),
        code: "BMP",
        label: ref.title,
        source: { kind: "file", location: fileAt(stationId, ref)!, seekMs: 0, mediaKind: ref.mediaKind, contentId: ref.contentId ?? undefined },
        reason: "planned",
        inBreak: where.inBreak,
        breakId: where.breakId,
        itemId: ref.id,
        bumperRole: e.role,
        position: e.position,
        ...(e.announces ? { announces: e.announces } : {})
      });
      /** A boundary's bumpers that fit `room`, resolved, in order. */
      const boundaryFit = (b: Boundary, room: number) =>
        fitElements(
          b.elements.flatMap((e) => {
            const ref = resolve(e, Date.parse(b.at));
            return ref ? [{ ...e, ref, lengthMs: ref.durationMs! }] : [];
          }),
          room
        ).filter((e) => e.fits);
      // A242: openers and closers that are prepared; off-air cards that are pictures, or prepared clips.
      const identity = {
        openers: allIdentity.openers.filter((f) => fileAt(stationId, f)),
        closers: allIdentity.closers.filter((f) => fileAt(stationId, f)),
        cards: allIdentity.offAirCards.filter((f) => f.durationMs === null || fileAt(stationId, f))
      };
      // Turns, a broadcast day each: the nth day airs the (n mod count)th, in library order.
      const turn = (at: number) => Math.floor(Date.parse(`${broadcastDate(new Date(at), tz)}T00:00:00Z`) / DAY_MS);
      // A243: an opener or closer outside its window doesn't air (the automatic one does, if none is in its window).
      const openerAt = (at: number) => identFor(stationId, station, "opener", identity.openers.filter((f) => eligible(f, at, tz)), turn(at), null, !allIdentity.openers.length);
      const closerAt = (at: number, back: string) => identFor(stationId, station, "closer", identity.closers.filter((f) => eligible(f, at, tz)), turn(at), back, !allIdentity.closers.length);
      // The station ID after the opener, when the station says so (A242; the opener replaces it by default).
      const sidAfterOpenerMs = rule.stationIdAfterOpener ? Math.min(fillers.stationIds[0]?.durationMs ?? STATION_ID_MS, 60_000) : 0;
      const stored = breaks.filter((b): b is BreakSlotView & { id: string } => Boolean(b.id));
      const [items, airings, programs, offAir] = await Promise.all([
        services.library.itemsByIds(entries.map((e) => e.assetId).filter((v): v is string => Boolean(v))),
        services.spots.breakAirings(stored.map((b) => b.id)),
        services.library.programsByIds(entries.map((e) => e.programId).filter((v): v is string => Boolean(v))),
        services.trust.offAirItems(entries.map((e) => e.assetId).filter((v): v is string => Boolean(v)))
      ]);
      const segments: Segment[] = [];
      // Catalog programs keep one credit an hour, thanking their series' sponsor in this market (or Clear).
      const programOfEntry = (entryId: string | null) => {
        const entry = entryId ? entries.find((e) => e.id === entryId) : undefined;
        return entry?.programId ?? (entry?.assetId ? items.get(entry.assetId)?.programId : null) ?? null;
      };
      const catalog = await services.spots.catalogCredits(stationId, [...new Set(entries.map((e) => programOfEntry(e.id)).filter((v): v is string => Boolean(v)))], from);
      const catalogBreaks = catalogCreditBreaks(breaks, (entryId) => catalog.has(programOfEntry(entryId) ?? ""), hourStartIn(tz));

      const composeBreak = async (slot: BreakSlotView, entryId: string | null): Promise<Segment[]> => {
        const start = Date.parse(slot.startsAt);
        const end = start + slot.lengthMs;
        const key = `brk:${slot.id ?? slot.startsAt}`;
        const parts = partsOf(slot);
        let missing: Segment["missing"];
        // Spots, producer's share first; already held, so they air even if paused since.
        const spots: Array<{ airing: NonNullable<ReturnType<typeof airings.get>>[number]; at: string; len: number }> = [];
        let spotMs = 0;
        for (const airing of slot.id ? (airings.get(slot.id) ?? []) : []) {
          const len = airing.lengthSec * 1000;
          const at = fileAt(stationId, airing);
          // Not prepared: it doesn't air (its hold goes back), and the break fills as usual.
          if (!at && airing.contentId && !missing) missing = { itemId: airing.spotId, title: airing.title, contentId: airing.contentId, airsAt: new Date(start) };
          if (!at || start + spotMs + len > end) continue;
          spots.push({ airing, at, len });
          spotMs += len;
        }
        // The thank-you credit: sponsors of this program, of the station, and members who asked to be named.
        const entry = entries.find((e) => e.id === entryId);
        const programId = entry?.programId ?? (entry?.assetId ? items.get(entry.assetId)?.programId : null) ?? null;
        const catalogCredit = programId && catalogBreaks.has(slot.startsAt) ? catalog.get(programId) : undefined;
        const sponsors = catalogCredit ? [{ ...catalogCredit.sponsor, programId }] : credits.filter((c) => c.programId === null || c.programId === programId);
        const thanked = catalogCredit ? [] : members.named;
        // Room for the station ID after it (the generated one is ten seconds).
        const sidRoom = parts.stationId ? (fillers.stationIds[0]?.generated ? GENERATED_SID_MS : STATION_ID_MS) : 0;
        let left = slot.lengthMs - spotMs;
        const creditMs = parts.underwriting && (sponsors.length || thanked.length) && left >= sidRoom + 10_000 ? Math.min(CREDIT_MS, left - sidRoom) : 0;
        left -= creditMs;
        // A243: the bumpers, picked with the break: the opening sequence, the closing one and (when
        // it closes a program's slot just as the next starts) the between sequence after it. Each
        // airs whole or not at all, by priority (into the break, out of it, up next, Any); none
        // where the cadence leaves a sequence out. Defaults: one into the break and one out of it
        // (the same one twice when there's one), as before.
        const room = left - sidRoom;
        const chosen = slot.elements ?? defaultElements(fillers.bumpers, { open: bumpersIn(parts, "open"), close: bumpersIn(parts, "close") }, start, tz);
        const boundary = slot.boundary && Date.parse(slot.boundary.at) === end && !carved.has(end) ? slot.boundary : null;
        if (boundary) carved.add(end);
        const fitted = fitElements(
          [...chosen.open, ...chosen.close, ...(boundary?.elements ?? [])].flatMap((e) => {
            const ref = resolve(e, e.position === "between" ? end : start);
            return ref ? [{ ...e, ref, lengthMs: ref.durationMs! }] : [];
          }),
          room
        ).filter((e) => e.fits);
        // The between bumpers end the break's time, outside its SCTE-35 span (partners' ads never replace them).
        const between = fitted.filter((e) => e.position === "between");
        const spanEnd = end - between.reduce((sum, e) => sum + e.lengthMs, 0);

        const out: Segment[] = [];
        let cursor = start;
        const bumpers = (position: "open" | "close") =>
          fitted
            .filter((e) => e.position === position)
            .forEach((e, i) => {
              // The first two keep the keys they had before A243.
              const k = i === 0 ? `${key}:bmp:${position === "open" ? "in" : "out"}` : `${key}:bmp:${position}:${i}`;
              out.push(elementSegment(e, e.ref, cursor, k, { inBreak: true, breakId: slot.id ?? undefined }));
              cursor += e.lengthMs;
            });
        bumpers("open");
        for (const { airing, at, len } of spots) {
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
        const afterSpots = out.length;
        if (creditMs > 0) {
          const programSponsors = sponsors.some((c) => c.programId && c.programId === programId);
          const subject = catalogCredit ? catalogCredit.subject : programSponsors && programId ? (programs.get(programId)?.title ?? station.name) : station.name;
          // A catalog credit is drawn in its series' colour, and carries its program so it's counted.
          const look = catalogCredit ? { ...station, colour: catalogCredit.colour ?? station.colour } : station;
          out.push({
            key: `${key}:und`,
            startsAt: new Date(cursor),
            endsAt: new Date(cursor + creditMs),
            code: "UND",
            label: `${subject} is made possible by`,
            source: { kind: "image", path: await slates.credit(look, { subject, sponsors: sponsors.map((s) => ({ business: s.business, creditText: s.creditText })), members: thanked }) },
            slate: "credit",
            reason: "planned",
            inBreak: true,
            breakId: slot.id ?? undefined,
            ...(catalogCredit && programId ? { programId } : {})
          });
          cursor += creditMs;
        }
        bumpers("close");
        // What's left holds on the station ID slate, then the station ID (when it airs).
        out.push(...(await filler(stationId, new Date(cursor), spanEnd - cursor, { key, reason: "planned", inBreak: true, breakId: slot.id ?? undefined }, fillers, station, { bumpers: false, stationId: parts.stationId })));
        // Reported when the break airs; if the file arrives first, the break is planned again with it.
        if (missing && out[afterSpots]) out[afterSpots] = { ...out[afterSpots], missing };
        const breakSpan = { startsAt: new Date(start), lengthMs: spanEnd - start };
        const inSpan: Segment[] = out.map((seg) => ({ ...seg, breakSpan }));
        cursor = spanEnd;
        for (const [i, e] of between.entries()) {
          inSpan.push(elementSegment(e, e.ref, cursor, `${key}:bmp:between:${i}`, { inBreak: false }));
          cursor += e.lengthMs;
        }
        return inSpan;
      };

      const openTime = async (a: number, b: number) => {
        if (b <= a) return;
        // A243: open time just before a program ends with its between bumpers (whatever fits, the station ID kept).
        const boundary = boundaryAt.get(b);
        const fit = boundary && !carved.has(b) ? boundaryFit(boundary, b - a - (fillers.stationIds[0]?.durationMs ?? STATION_ID_MS)) : [];
        if (boundary && !carved.has(b)) carved.add(b);
        const cut = b - fit.reduce((sum, e) => sum + e.lengthMs, 0);
        segments.push(...(await filler(stationId, new Date(a), cut - a, { key: `open:${a}`, reason: "station_id_fill", inBreak: false }, fillers, station)));
        let at = cut;
        for (const [i, e] of fit.entries()) {
          segments.push(elementSegment(e, e.ref, at, `open:${a}:between:${i}`, { inBreak: false }));
          at += e.lengthMs;
        }
      };

      const signOff = async (block: { s: number; e: number; logEntryId: string | null }) => {
        const back = clockTime(new Date(block.e), tz);
        const generatedCard = { kind: "image" as const, path: await slates.offAir(station, back) };
        const base = { code: "OPEN" as const, label: "Off air", reason: "slate" as const, inBreak: false, logEntryId: block.logEntryId ?? undefined, slate: "off_air" as const, backAt: new Date(block.e) };
        // The off-air card from `a` to `b`: the station's own (a picture held; a clip whole, as many
        // times as it fits), else (and for what a clip leaves) the generated one.
        const card = async (a: number, b: number) => {
          const own = identity.cards.length ? identity.cards[turn(block.s) % identity.cards.length] : undefined;
          let at = a;
          if (own && own.durationMs === null) {
            const png = await cardPicture(own);
            if (png) {
              segments.push({ ...base, key: `off:${block.s}`, startsAt: new Date(a), endsAt: new Date(b), source: { kind: "image", path: png }, itemId: own.id });
              return;
            }
          } else if (own) {
            for (let n = 0; own.durationMs && at + own.durationMs <= b && n < 100; n++) {
              segments.push({ ...base, key: `off:${block.s}:card:${n}`, startsAt: new Date(at), endsAt: new Date(at + own.durationMs), source: { kind: "file", location: fileAt(stationId, own)!, seekMs: 0, mediaKind: own.mediaKind, contentId: own.contentId ?? undefined }, itemId: own.id });
              at += own.durationMs;
            }
          }
          if (at < b) segments.push({ ...base, key: `off:${block.s}`, startsAt: new Date(at), endsAt: new Date(b), source: generatedCard });
        };
        const ident = (code: "OPN" | "CLS", pick: IdentPick, at: number, key: string): Segment => ({
          key,
          startsAt: new Date(at),
          endsAt: new Date(at + pick.ms),
          code,
          label: pick.label,
          source: pick.source,
          reason: "planned",
          inBreak: false,
          logEntryId: code === "CLS" ? (block.logEntryId ?? undefined) : undefined,
          itemId: pick.itemId
        });
        const closer = await closerAt(block.s, back);
        const opener = await openerAt(block.e);
        const openMs = opener.ms + sidAfterOpenerMs;
        const length = block.e - block.s;
        // Too short to go dark, or even to sign off and on: see the top of this file.
        if (length < closer.ms + MIN_CARD_MS + openMs) {
          await card(block.s, block.e);
          return;
        }
        const dark = length >= closer.ms + SIGN_OFF_SLATE_MS + MIN_DARK_MS + openMs;
        segments.push(ident("CLS", closer, block.s, `off:${block.s}:cls`));
        const cardEnds = dark ? block.s + closer.ms + SIGN_OFF_SLATE_MS : block.e - openMs;
        await card(block.s + closer.ms, cardEnds);
        if (dark) segments.push({ ...base, key: `off:${block.s}:dark`, startsAt: new Date(cardEnds), endsAt: new Date(block.e - openMs), source: { kind: "off", backAt: new Date(block.e) } });
        // Back on: the opener, ending as the first program starts (the station ID after it, if the station says so).
        segments.push({ ...ident("OPN", opener, block.e - openMs, `on:${block.e}:opn`), position: "sign_on" });
        if (sidAfterOpenerMs) segments.push(...(await filler(stationId, new Date(block.e - sidAfterOpenerMs), sidAfterOpenerMs, { key: `on:${block.e}`, reason: "planned", inBreak: false }, fillers, station, { bumpers: false, stationId: true })));
      };

      const blocks = [
        ...entries.map((entry) => ({ s: entry.startsAt.getTime(), e: entry.endsAt.getTime(), entry, off: null })),
        ...offAirBlocks.map((off) => ({ s: off.s, e: off.e, entry: null, off }))
      ].sort((a, b) => a.s - b.s);

      let cursor = start;
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

        if (entry.kind === "live" && livePaused) {
          await openTime(s, e);
        } else if (entry.kind === "live") {
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
              code: asLogCode(entry.code),
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
      if (rule.dailyOpener) await dailyOpeners(segments, { start, to: to.getTime(), tz, entries, offAirBlocks, opener: openerAt, sidMs: sidAfterOpenerMs, station, stationId, fillers });
      return segments.filter((seg) => seg.endsAt.getTime() > from.getTime() && seg.startsAt.getTime() < to.getTime() && seg.endsAt > seg.startsAt);
    }
  };
}
