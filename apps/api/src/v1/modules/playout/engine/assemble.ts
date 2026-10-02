// Assemble, continuously (platform prompt, Phase 5). One assembler per station on air turns the
// run sheet (plan.ts) into the channel's timeline (`channel_items`): which prepared segments air,
// in log order, with the program date-time each starts at. The playlists (playlist.ts) are rendered
// from those rows, so writing a channel takes almost no CPU and nothing is encoded.
//
//   - Each item becomes a row: a prepared item's segments (a program joined at the segment nearest
//     its offset; spots, credits, bumpers and station IDs always in full, from the top), with an
//     #EXT-X-DISCONTINUITY before it and its DATERANGE tags (item, break with SCTE-35, bug, code,
//     live, lower third, sign-off; A243: up next, the next program's title over an up-next bumper).
//   - Open time and holds air the station ID slate, prepared at the length needed (whole seconds,
//     at most a minute a row). Items not prepared air the same fill, and the station is told.
//   - A live block points at the live source's segments, always the worker's own copies in storage
//     (TV: Livepeer's, the same ladder, pulled once and stored as they appear, with the audio-only
//     rendition's sound taken from Livepeer's smallest; radio: packaged from the station's RTMP
//     push), appended as they appear; a source that isn't connected airs the prepared stand-by
//     slate. A source that reconnects starts a new row (a discontinuity), and so does a segment the
//     copy had to skip (a new `part`): the next row carries on from the segment after it.
//   - A planned sign-off: the closer and the off-air card (A242), then the playlist ends (an `end`
//     row: #EXT-X-ENDLIST). At the back time a new run starts (a new playlist), from the opener.
//     Openers and closers air whole, like station IDs; their item tags say `SID`, with `identCode`.
//   - When an item's last segment is published, its as-run entry is written with the program
//     date-times it aired at (a spot's proof frame first, from its published segment, with the bug).
//
// Rows are written a few seconds ahead; a cued break, an early end or a skip cuts the timeline at
// the next segment boundary and writes it again from there.

import { and, asc, desc, eq, gt, gte, isNull, lte, ne, notInArray, or, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import { dateRangeTag, HLS_CLASS, HlsLogCode } from "@opencast/contracts";
import type { ModuleContext } from "../../../context.js";
import { publicUrl } from "../../../lib/url.js";
import { BAND_RENDITIONS, REFERENCE, SEGMENT_MS, type Band } from "./ladder.js";
import type { LiveSource } from "./live.js";
import type { Segment } from "./plan.js";
import { refKey, type Preparer } from "./prepare.js";
import { proofFrame } from "./proof.js";
import { breakCue, encodeSpliceInsert, toHex } from "./scte35.js";
import type { Slates, StationLook } from "./slates.js";

const CI = schema.channelItems;
type Row = typeof CI.$inferSelect;

/** Rows are written this far ahead of the clock. */
const LEAD_MS = 20_000;
/** A program with less than this left isn't joined; the next thing starts instead. */
const MIN_JOIN_MS = 1_500;
/** A slate row holds at most this long (longer holds are several rows). */
const MAX_SLATE_S = 60;
/** Live sources are read this far ahead of their block, so they can connect early. */
const LIVE_PREROLL_MS = 60_000;
const PLAN_AHEAD_MS = 15 * 60_000;
/** A spot's code shows for its last 10 s. */
const CODE_MS = 10_000;
/** A243: up next says "Up next" when the program starts within this long of the clip's end, else "Next at 9:00 pm". */
const UP_NEXT_IMMEDIATE_MS = 2 * 60_000;

export interface ChannelLook extends StationLook {
  band: Band;
  bug: { mode: "off" | "call_sign_and_channel" | "logo"; opacity: number; position: string };
  logoUrl: string | null;
  /** A229: its call sign is shared with the rest of its family (its channel tells it apart). */
  sharesCallSign?: boolean;
}

export interface AssemblerOptions {
  look: ChannelLook;
  plan(from: Date, to: Date): Promise<Segment[]>;
  preparer: Preparer;
  slates: Slates;
  /** A live block's source (TV: Livepeer's playback; radio: the worker's ingest), or null when it has none. */
  liveSource(liveSourceId: string): Promise<LiveSource | null>;
  appOrigin: string;
  scratchDir: string;
  onMissing?(missing: { itemId: string; title: string; airsAt: Date }): void;
  onSignalLost?(liveSourceId: string): void;
  log?(line: string): void;
  leadMs?: number;
}

interface Cursor {
  run: number;
  /** The next row's first media sequence number. */
  seq: number;
  /** The discontinuity sequence at the last row. */
  disc: number;
  /** Where the next row starts (ms). */
  at: number;
  /** The playlist has ended (planned off air) until a new run starts. */
  ended: boolean;
  /** No row in this run yet. */
  fresh: boolean;
}

const isWhole = (s: Segment) => Boolean(s.airingId) || s.code === "UND" || s.code === "BMP" || s.code === "SID" || s.code === "OPN" || s.code === "CLS";
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

/** Shortens a row's tags to a new end (or drops those that start after it). */
function clipTags(tags: string[], end: number): string[] {
  return tags.flatMap((tag) => {
    const start = Date.parse(/START-DATE="([^"]+)"/.exec(tag)?.[1] ?? "");
    const duration = /DURATION=([\d.]+)/.exec(tag);
    if (Number.isNaN(start) || !duration || tag.includes("SCTE35")) return [tag];
    if (start >= end) return [];
    const ms = start + Number(duration[1]) * 1000;
    return ms > end ? [tag.replace(/DURATION=[\d.]+/, `DURATION=${Number(((end - start) / 1000).toFixed(3))}`)] : [tag];
  });
}

export class ChannelAssembler {
  private cursor: Cursor | null = null;
  private plan: Segment[] = [];
  private planFrom = 0;
  private planUntil = 0;
  /** Bumped by replan(): a plan read before it is stale when it lands. */
  private planVersion = 0;
  private skipped = new Set<string>();
  /** Whole items written (so a quick replan never airs them twice). */
  private written = new Set<string>();
  /** Plan segments with nothing left to air. */
  private passed = new Set<string>();
  private sources = new Map<string, LiveSource | null>();
  private liveRow: { row: Row; segKey: string; sourceId: string; lastSeq: number; session?: string; part?: number } | null = null;
  /** A live row closed at a skipped segment: the next row carries on after `lastSeq` (same session). */
  private resume: { segKey: string; sourceId: string; lastSeq: number; session?: string } | null = null;
  private standBy: { id: string; segKey: string; sourceId: string } | null = null;
  private signalLost = new Set<string>();
  private pending: "now" | "future" | null = null;
  private finishing = new Set<string>();
  /** Rows whose as-run couldn't be written, and when: tried again a minute later, never ahead of newer rows. */
  private failed = new Map<string, number>();
  private current: string | null | undefined = undefined;
  private reported = new Set<string>();
  /** Something that didn't air, told once the row airing in its place is published. */
  private nextMissing: { itemId: string; title: string; airsAt: Date } | null = null;
  private missingByRow = new Map<string, { itemId: string; title: string; airsAt: Date }>();
  private carried = new Map<string, string | null>();
  private stopped = false;

  constructor(
    private ctx: ModuleContext,
    readonly stationId: string,
    private options: AssemblerOptions
  ) {}

  private get db() {
    return this.ctx.deps.db;
  }

  private now() {
    return this.ctx.deps.clock.now().getTime();
  }

  private log(line: string) {
    this.options.log?.(`[assemble ${this.options.look.callSign ?? this.stationId.slice(0, 8)}] ${line}`);
  }

  /** Carries on from the station's last row (a restart, or another replica), or starts a run now. */
  async start() {
    const now = this.now();
    await this.db.update(CI).set({ open: false }).where(and(eq(CI.stationId, this.stationId), eq(CI.open, true)));
    const [last] = await this.db.select().from(CI).where(eq(CI.stationId, this.stationId)).orderBy(desc(CI.seq), desc(CI.startsAt)).limit(1);
    if (!last) this.cursor = { run: 1, seq: 0, disc: 0, at: now, ended: false, fresh: true };
    else if (last.kind === "end") this.cursor = { run: last.run, seq: last.seq, disc: last.disc, at: Math.max(now, last.startsAt.getTime()), ended: true, fresh: false };
    else if (last.endsAt.getTime() < now - 8_000) this.cursor = { run: last.run + 1, seq: last.seq + last.segments, disc: last.disc + 1, at: now, ended: false, fresh: true };
    else this.cursor = { run: last.run, seq: last.seq + last.segments, disc: last.disc, at: last.endsAt.getTime(), ended: false, fresh: false };
    this.log(`assembling from ${new Date(this.cursor.at).toISOString()} (run ${this.cursor.run})`);
  }

  /** The log changed (a spot placed, an entry edited): read it again. With `interrupt`, from now. */
  replan(interrupt = false) {
    this.planVersion++;
    this.planUntil = 0;
    this.pending = interrupt ? "now" : (this.pending ?? "future");
  }

  /** Stops what's airing; the rest of its time airs the station ID slate. */
  async skip() {
    const now = new Date(this.now());
    const [row] = await this.db
      .select({ planKey: CI.planKey })
      .from(CI)
      .where(and(eq(CI.stationId, this.stationId), lte(CI.startsAt, now), gt(CI.endsAt, now)))
      .limit(1);
    if (row?.planKey) this.skipped.add(row.planKey);
    this.replan(true);
  }

  /** Stops. Signing off ends the playlist; a worker shutting down leaves it for the next leader. */
  async stop(options: { signOff: boolean }) {
    this.stopped = true;
    if (this.liveRow) await this.closeLive();
    for (const source of this.sources.values()) await source?.close?.().catch(() => undefined);
    this.sources.clear();
    if (options.signOff && this.cursor && !this.cursor.ended) {
      await this.truncate(this.now());
      await this.insertEnd(Math.max(this.now(), this.cursor!.at));
      // What aired up to the end goes in the as-run log now; nothing will come back for it.
      await this.finish(this.cursor!.at);
    }
  }

  async tick() {
    if (this.stopped) return;
    if (!this.cursor) await this.start();
    const now = this.now();
    if (this.pending) {
      const pending = this.pending;
      this.pending = null;
      if (pending === "now" || this.cursor!.ended) await this.truncate(now);
      else {
        // Keep what's on now; everything after it is written again.
        const [row] = await this.db
          .select({ endsAt: CI.endsAt })
          .from(CI)
          .where(and(eq(CI.stationId, this.stationId), lte(CI.startsAt, new Date(now)), gt(CI.endsAt, new Date(now)), ne(CI.kind, "end")))
          .limit(1);
        await this.truncate(Math.max(now, row?.endsAt.getTime() ?? now));
      }
    }
    await this.extend(now);
    await this.finish(now);
    await this.markCurrent(now);
  }

  // --- The run sheet ---------------------------------------------------------------------

  private async planAround(t: number): Promise<Segment[]> {
    while (t >= this.planUntil - 60_000 || t < this.planFrom) {
      const version = this.planVersion;
      const from = t - 1_000;
      const to = t + PLAN_AHEAD_MS;
      const plan = await this.options.plan(new Date(from), new Date(to));
      // The log changed while this was being read (a break filled, a spot placed): read it again.
      if (version !== this.planVersion) continue;
      this.plan = plan;
      this.planFrom = from;
      this.planUntil = to;
      this.prewarm(plan);
    }
    return this.plan;
  }

  /** Slates coming up are prepared before they're needed. */
  private prewarm(plan: Segment[]) {
    const { preparer } = this.options;
    const band = this.options.look.band;
    for (const seg of plan) {
      if (seg.source.kind !== "image" || seg.slate === "stand_by") continue;
      const seconds = Math.min(MAX_SLATE_S, Math.max(1, Math.round((seg.endsAt.getTime() - seg.startsAt.getTime()) / 1000)));
      void preparer.slate(seg.source.path, seconds, band).catch(() => undefined);
    }
  }

  /** The segment to air at `t`: spots and fills in full, once; programs joined if there's enough left. */
  private async segmentAt(t: number): Promise<Segment | null> {
    const plan = await this.planAround(t);
    let i = plan.findIndex((s) => s.endsAt.getTime() > t);
    while (i >= 0 && i < plan.length) {
      const s = plan[i];
      const done = this.passed.has(`${s.key}@${s.startsAt.getTime()}`) || (isWhole(s) && this.written.has(s.key));
      const tooLate = !isWhole(s) && s.source.kind !== "off" && s.source.kind !== "live" && s.endsAt.getTime() - t < MIN_JOIN_MS;
      if (!done && !tooLate) return s;
      i++;
    }
    return null;
  }

  private async extend(now: number) {
    const lead = this.options.leadMs ?? LEAD_MS;
    await this.syncSources(now);
    // The stand-by slate is written ahead; a source that connects cuts it at the next segment
    // boundary, once it has a segment to air (a TV source's first copy: asking starts the copying).
    const standing = this.standBy ? this.sources.get(this.standBy.sourceId) : null;
    if (this.standBy && standing?.connected() && standing.after(null).length) {
      this.standBy = null;
      await this.truncate(now);
    }
    const c = this.cursor!;
    if (!c.ended && c.at < now - 10_000) {
      // Fell behind (the worker stalled): carry on from now; the next item's date-time says so.
      this.log(`behind by ${Math.round((now - c.at) / 1000)} s: carrying on from now`);
      if (this.liveRow) await this.closeLive();
      this.resume = null;
      c.at = now;
    }
    for (let guard = 0; guard < 200 && this.cursor!.at < now + lead && !this.stopped; guard++) {
      const seg = await this.segmentAt(this.cursor!.at);
      if (!seg) break;
      if (!(await this.write(seg, now))) break;
    }
  }

  // --- Writing rows -----------------------------------------------------------------------

  private async insertRow(values: Omit<typeof CI.$inferInsert, "stationId" | "run" | "seq" | "disc" | "discontinuity">): Promise<Row> {
    const c = this.cursor!;
    if (c.ended) {
      // Back on after a planned sign-off: a new playlist.
      c.run++;
      c.disc++;
      c.ended = false;
      c.fresh = true;
    }
    const disc = c.fresh ? c.disc : c.disc + 1;
    const [row] = await this.db
      .insert(CI)
      .values({ ...values, stationId: this.stationId, run: c.run, seq: c.seq, disc, discontinuity: true })
      .returning();
    c.seq += row.segments;
    c.disc = disc;
    c.fresh = false;
    c.at = row.endsAt.getTime();
    if (this.nextMissing) this.missingByRow.set(row.id, this.nextMissing);
    this.nextMissing = null;
    return row;
  }

  private async insertEnd(at: number) {
    const c = this.cursor!;
    await this.db.insert(CI).values({ stationId: this.stationId, run: c.run, seq: c.seq, disc: c.disc, discontinuity: false, startsAt: new Date(at), endsAt: new Date(at), kind: "end", code: "OPEN", label: "Off air", reason: "slate", segmentMs: [], tags: [] });
    c.ended = true;
    c.at = at;
  }

  private async carriedFrom(agreementId: string | undefined): Promise<string | null> {
    if (!agreementId) return null;
    if (!this.carried.has(agreementId)) {
      const agreement = (await this.ctx.services.catalog.agreementsByIds([agreementId])).get(agreementId);
      const maker = agreement ? (await this.ctx.services.stations.idents([agreement.makerStationId])).get(agreement.makerStationId) : undefined;
      this.carried.set(agreementId, maker?.callSign ?? maker?.name ?? null);
    }
    return this.carried.get(agreementId) ?? null;
  }

  /** The DATERANGE tags for a row: what the player draws over it and knows about it. */
  private async tagsFor(rowId: string, seg: Segment, start: number, end: number, contentId: string | null, kind: "item" | "live" | "stand_by"): Promise<string[]> {
    const look = this.options.look;
    const seconds = (end - start) / 1000;
    const out: string[] = [];
    if (kind !== "item") {
      out.push(dateRangeTag({ id: `${rowId}-live`, class: HLS_CLASS.live, start, durationSeconds: seconds, attributes: { logEntryId: seg.logEntryId ?? "", sourceId: seg.liveSourceId ?? "" } }));
    } else if (contentId && (HlsLogCode.safeParse(seg.code).success || seg.code === "OPN" || seg.code === "CLS")) {
      const carriedFrom = seg.code === "PGM" && !seg.inBreak ? await this.carriedFrom(seg.agreementId) : null;
      // An opener or closer (A242) says SID, which players built before it know, and which it is.
      const ident = seg.code === "OPN" || seg.code === "CLS" ? seg.code : null;
      out.push(
        dateRangeTag({
          id: `${rowId}-item`,
          class: HLS_CLASS.item,
          start,
          durationSeconds: seconds,
          attributes: { logEntryId: seg.logEntryId ?? null, code: ident ? "SID" : seg.code, contentId, title: seg.label, carriedFrom, identCode: ident, bumperRole: seg.code === "BMP" ? (seg.bumperRole ?? null) : null }
        })
      );
    }
    if (seg.breakSpan) {
      // The break's own cue: the same ID and times on whichever row carries it.
      const cue = breakCue(this.stationId, { id: seg.breakId ?? null, startsAt: seg.breakSpan.startsAt.toISOString(), lengthMs: seg.breakSpan.lengthMs });
      out.push(
        dateRangeTag({
          id: cue.id,
          class: HLS_CLASS.break,
          start: cue.startsAt,
          durationSeconds: cue.durationMs / 1000,
          scte35Out: toHex(encodeSpliceInsert({ eventId: cue.eventId, outOfNetwork: true, durationMs: cue.durationMs, autoReturn: true })),
          scte35In: toHex(encodeSpliceInsert({ eventId: cue.eventId, outOfNetwork: false })),
          attributes: { breakId: cue.id }
        })
      );
    }
    if (seg.slate === "off_air") {
      out.push(dateRangeTag({ id: `${rowId}-sign-off`, class: HLS_CLASS.signOff, start, durationSeconds: seconds, attributes: { backAt: seg.backAt?.toISOString() ?? null } }));
    }
    const tv = look.band === "tv";
    if (tv && look.bug.mode !== "off" && kind !== "stand_by" && !["SID", "UND", "OPEN", "OPN", "CLS"].includes(seg.code)) {
      const logo = look.bug.mode === "logo" && look.logoUrl ? publicUrl(this.ctx.deps, look.logoUrl) : null;
      const mode = look.bug.mode === "logo" && logo ? "logo" : "call_sign_and_channel";
      const position = ["top_left", "top_right", "bottom_left", "bottom_right"].includes(look.bug.position) ? look.bug.position : "bottom_right";
      out.push(dateRangeTag({ id: `${rowId}-bug`, class: HLS_CLASS.bug, start, durationSeconds: seconds, attributes: { mode, callSign: look.callSign, channel: look.channel, logoUrl: logo, position, opacity: look.bug.opacity } }));
    }
    // A243: an up-next bumper's title, drawn by the player over the clip (TV), from the log as it is
    // now (written this close to air, when edits are locked). "Up next" when the program follows
    // within two minutes of the clip's end; otherwise "Next at 9:00 pm".
    if (tv && kind === "item" && seg.code === "BMP" && seg.bumperRole === "up_next" && seg.announces && seconds > 1) {
      const a = seg.announces;
      const immediate = Date.parse(a.startsAt) - end <= UP_NEXT_IMMEDIATE_MS ? 1 : 0;
      out.push(
        dateRangeTag({
          id: `${rowId}-up-next`,
          class: HLS_CLASS.upNext,
          start: start + 1000,
          durationSeconds: seconds - 1,
          attributes: { logEntryId: a.entryId, title: a.title, episodeTitle: a.episodeTitle, startsAt: a.startsAt, immediate, carriedFrom: a.carriedFrom }
        })
      );
    }
    // The code on both bands: the radio band's players draw no picture, but its translators do.
    if (seg.code10 && seg.spotId && end - start > 0) {
      const from = Math.max(start, end - CODE_MS);
      const qrUrl = `${this.options.appOrigin}/c/${encodeURIComponent(seg.code10.code)}?s=${this.stationId}`;
      out.push(dateRangeTag({ id: `${rowId}-code`, class: HLS_CLASS.code, start: from, durationSeconds: (end - from) / 1000, attributes: { spotId: seg.spotId, code: seg.code10.code, offer: seg.code10.offer, qrUrl } }));
    }
    if (tv && kind === "live" && seg.logEntryId) {
      const l3 = await this.ctx.services.stations.lowerThird(this.stationId, seg.logEntryId, seg.programId ?? null).catch(() => null);
      if (l3 && !l3.hidden && l3.name) {
        const version = l3.updatedAt ? Date.parse(l3.updatedAt) : 0;
        out.push(dateRangeTag({ id: `${rowId}-l3-${version}`, class: HLS_CLASS.lowerThird, start, durationSeconds: seconds, attributes: { name: l3.name, title: l3.title } }));
      }
    }
    return out;
  }

  private asRunFields(seg: Segment) {
    return {
      code: seg.code,
      label: seg.label,
      reason: seg.reason,
      planKey: seg.key,
      inBreak: seg.inBreak,
      logEntryId: seg.logEntryId ?? null,
      breakId: seg.breakId ?? null,
      assetId: seg.itemId ?? null,
      programId: seg.programId ?? null,
      airingId: seg.airingId ?? null,
      agreementId: seg.agreementId ?? null,
      liveSourceId: seg.liveSourceId ?? null,
      // A243: a bumper's role and where it aired; up next, what it announced.
      bumperRole: seg.code === "BMP" ? (seg.bumperRole ?? null) : null,
      position: seg.position ?? null,
      announcedEntryId: seg.announces?.entryId ?? null,
      announcedTitle: seg.announces?.title ?? null
    };
  }

  /** A prepared item's segments from `first`, as a row. */
  private async writePrepared(seg: Segment, key: string, first: number, lengths: number[], fields: Partial<ReturnType<ChannelAssembler["asRunFields"]>> = {}, kind: "item" | "stand_by" = "item") {
    const start = this.cursor!.at;
    const end = start + sum(lengths);
    const id = crypto.randomUUID();
    const tags = await this.tagsFor(id, { ...seg, ...(fields as object) } as Segment, start, end, key, kind);
    return this.insertRow({ id, ...this.asRunFields(seg), ...fields, kind: "prepared", preparedKey: key, firstSegment: first, segments: lengths.length, segmentMs: lengths, startsAt: new Date(start), endsAt: new Date(end), tags });
  }

  /** A generated slate, `ms` long (whole seconds, at most a minute). */
  private async writeSlate(seg: Segment, png: string, ms: number, fields: Partial<ReturnType<ChannelAssembler["asRunFields"]>> = {}, kind: "item" | "stand_by" = "item") {
    const seconds = Math.min(MAX_SLATE_S, Math.round(ms / 1000));
    if (seconds < 1) return null;
    const key = await this.options.preparer.slate(png, seconds, this.options.look.band);
    const lengths = await this.options.preparer.segmentMs(key, REFERENCE[this.options.look.band]);
    if (!lengths?.length) throw new Error("slate has no segments");
    return this.writePrepared(seg, key, 0, lengths, fields, kind);
  }

  /** The station ID slate from the cursor to `until` (or a minute of it). */
  private async hold(seg: Segment, until: number, reason: Segment["reason"] = "station_id_fill") {
    const png = await this.options.slates.stationId(this.options.look);
    const fill: Segment = { ...seg, code: "OPEN", label: "Station ID slate", airingId: undefined, code10: undefined, spotId: undefined, itemId: undefined, slate: "station_id", reason };
    return this.writeSlate(fill, png, until - this.cursor!.at, { code: "OPEN", label: "Station ID slate", reason, airingId: null, assetId: null, bumperRole: null, position: null, announcedEntryId: null, announcedTitle: null });
  }

  private reportMissing(missing: { itemId: string; title: string; airsAt: Date }) {
    const key = `${missing.itemId}:${missing.airsAt.getTime()}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.log(`${missing.title} isn't prepared; the usual fill airs instead`);
    this.options.onMissing?.(missing);
  }

  /** Writes the next row(s) for `seg`. False when nothing more can be written yet. */
  private async write(seg: Segment, now: number): Promise<boolean> {
    const c = this.cursor!;
    const t = c.at;
    const src = seg.source;
    if (src.kind !== "live" && this.liveRow) await this.closeLive();
    if (src.kind !== "live" && this.standBy) this.standBy = null;
    if (src.kind !== "live") this.resume = null;

    if (src.kind === "off") {
      // Planned off air: the playlist ends; the next run starts at the back time.
      if (!c.ended) await this.insertEnd(t);
      c.at = Math.max(t, seg.endsAt.getTime());
      return true;
    }
    // Open time before the next thing (the plan starts later, or it ran early).
    if (seg.startsAt.getTime() - t > 500 && src.kind !== "live") {
      await this.hold(seg, seg.startsAt.getTime());
      return true;
    }
    this.nextMissing = seg.missing ?? null;
    const whole = isWhole(seg);
    const done = () => (whole ? this.written.add(seg.key) : this.passed.add(`${seg.key}@${seg.startsAt.getTime()}`));

    if (this.skipped.has(seg.key)) {
      if (!(await this.hold(seg, seg.endsAt.getTime()))) done();
      else if (whole) done();
      return true;
    }

    if (src.kind === "live") return this.writeLive(seg, now);

    if (src.kind === "image") {
      const ms = whole ? seg.endsAt.getTime() - seg.startsAt.getTime() : seg.endsAt.getTime() - t;
      const row = await this.writeSlate(seg, src.path, ms);
      if (!row || whole) done();
      return true;
    }

    // A prepared item.
    const ref = { contentId: src.contentId ?? null, location: src.location.startsWith("cid:") ? null : src.location };
    const key = refKey(ref);
    const band = this.options.look.band;
    if (!key || !this.options.preparer.isReady(key, band)) {
      if (seg.itemId) this.nextMissing = { itemId: seg.itemId, title: seg.label, airsAt: seg.startsAt };
      const until = whole ? t + (seg.endsAt.getTime() - seg.startsAt.getTime()) : seg.endsAt.getTime();
      const row = await this.hold(seg, until);
      if (!row || whole) done();
      return true;
    }
    const lengths = (await this.options.preparer.segmentMs(key, REFERENCE[band])) ?? [];
    let first = 0;
    let take = lengths.length;
    if (!whole) {
      const offset = Math.max(0, t - seg.startsAt.getTime()) + src.seekMs;
      first = Math.min(lengths.length, Math.round(offset / SEGMENT_MS));
      const remaining = seg.endsAt.getTime() - t;
      let total = 0;
      take = 0;
      // To the segment boundary nearest the item's end on the log.
      while (first + take < lengths.length && (take === 0 || total + lengths[first + take] / 2 <= remaining)) {
        total += lengths[first + take];
        take++;
      }
    }
    if (take === 0) {
      done();
      return true;
    }
    await this.writePrepared(seg, key, first, lengths.slice(first, first + take));
    if (whole) done();
    else if (first + take >= lengths.length) done();
    return true;
  }

  // --- Live -------------------------------------------------------------------------------

  private async source(liveSourceId: string): Promise<LiveSource | null> {
    if (!this.sources.has(liveSourceId)) this.sources.set(liveSourceId, await this.options.liveSource(liveSourceId).catch(() => null));
    return this.sources.get(liveSourceId) ?? null;
  }

  /** Reads the live sources of blocks on now or starting soon; forgets the rest. */
  private async syncSources(now: number) {
    const wanted = new Set<string>();
    for (const seg of this.plan) {
      if (seg.source.kind === "live" && seg.startsAt.getTime() - LIVE_PREROLL_MS <= now && seg.endsAt.getTime() > now) wanted.add(seg.source.liveSourceId);
    }
    for (const [id, source] of this.sources) {
      if (wanted.has(id) || this.liveRow?.sourceId === id) continue;
      this.sources.delete(id);
      await source?.close?.().catch(() => undefined);
    }
    for (const id of wanted) await (await this.source(id))?.poll();
  }

  private async closeLive() {
    const live = this.liveRow;
    if (!live) return;
    this.liveRow = null;
    await this.db.update(CI).set({ open: false }).where(eq(CI.id, live.row.id));
  }

  private async writeLive(seg: Segment, now: number): Promise<boolean> {
    const c = this.cursor!;
    const liveSourceId = (seg.source as { liveSourceId: string }).liveSourceId;
    const source = await this.source(liveSourceId);
    await source?.poll();
    const band = this.options.look.band;
    const blockEnd = seg.endsAt.getTime();

    if (source?.connected()) {
      if (this.standBy?.segKey === seg.key) {
        // Back from stand-by at the next segment boundary, once there's a segment to air: a
        // source that copies its segments (TV) starts copying when asked, and the slate carries on
        // until the first copy lands.
        if (!source.after(null).length) return false;
        this.standBy = null;
        await this.truncate(now);
      }
      const live = this.liveRow;
      if (live && live.segKey === seg.key) {
        const fresh = source.after(live.lastSeq);
        if (!fresh.length) return false;
        let row = live.row;
        const uris = { ...(row.liveUris ?? {}) };
        const lengths = [...row.segmentMs];
        // The source reconnected (a new session, its timestamps from the start): a new row. A
        // segment skipped (its copy failed, or the copy caught up): a new row too, from the next.
        if (fresh[0].session !== live.session || (fresh[0].part ?? 0) !== (live.part ?? 0)) {
          if (fresh[0].session === live.session) this.resume = { segKey: seg.key, sourceId: liveSourceId, lastSeq: live.lastSeq, session: live.session };
          await this.closeLive();
          return true;
        }
        for (const s of fresh) {
          if (row.startsAt.getTime() + sum(lengths) >= blockEnd || s.session !== live.session || (s.part ?? 0) !== (live.part ?? 0)) break;
          lengths.push(s.durationMs);
          for (const r of BAND_RENDITIONS[band]) uris[r] = [...(uris[r] ?? []), s.uris[r]!];
          // The source's captions, when it has them ("" where a segment has none).
          if (s.uris.subs || uris.subs) uris.subs = [...(uris.subs ?? new Array<string>(lengths.length - 1).fill("")), s.uris.subs ?? ""];
          live.lastSeq = s.seq;
        }
        const end = row.startsAt.getTime() + sum(lengths);
        const tags = await this.tagsFor(row.id, seg, row.startsAt.getTime(), end, null, "live");
        [row] = await this.db
          .update(CI)
          .set({ segments: lengths.length, segmentMs: lengths, liveUris: uris, endsAt: new Date(end), tags })
          .where(eq(CI.id, row.id))
          .returning();
        c.seq = row.seq + row.segments;
        c.at = end;
        live.row = row;
        if (end >= blockEnd) await this.closeLive();
        return true;
      }
      // Into the live block, at the source's live edge (once the channel's timeline reaches now);
      // asking for it first, so a source that copies its segments starts copying now.
      let edge = source.after(null);
      const resume = this.resume?.segKey === seg.key && this.resume.sourceId === liveSourceId ? this.resume : null;
      const next = resume ? source.after(resume.lastSeq).filter((s) => s.session === resume.session) : [];
      if (next.length) {
        // On from the segment after the one skipped, in its part, to the block's end.
        const part = next[0].part ?? 0;
        edge = [];
        let t = c.at;
        for (const s of next) {
          if ((s.part ?? 0) !== part || t >= blockEnd) break;
          edge.push(s);
          t += s.durationMs;
        }
      } else if (resume && edge[0]?.session === resume.session) return false;
      else if (c.at > now + 2_000) return false;
      if (!edge.length) return false;
      this.resume = null;
      if (this.liveRow) await this.closeLive();
      const id = crypto.randomUUID();
      const lengths = edge.map((s) => s.durationMs);
      const uris: Record<string, string[]> = Object.fromEntries(BAND_RENDITIONS[band].map((r) => [r, edge.map((s) => s.uris[r]!)]));
      if (edge.some((s) => s.uris.subs)) uris.subs = edge.map((s) => s.uris.subs ?? "");
      const tags = await this.tagsFor(id, seg, c.at, c.at + sum(lengths), null, "live");
      const row = await this.insertRow({ id, ...this.asRunFields(seg), reason: "live", kind: "live", liveUris: uris, segments: lengths.length, segmentMs: lengths, startsAt: new Date(c.at), endsAt: new Date(c.at + sum(lengths)), tags, open: true });
      this.liveRow = { row, segKey: seg.key, sourceId: liveSourceId, lastSeq: edge[edge.length - 1].seq, session: edge[edge.length - 1].session, part: edge[edge.length - 1].part };
      this.signalLost.delete(seg.key);
      this.log("live source connected: on air from it");
      return true;
    }

    // No signal: the stand-by slate, until it's back.
    if (this.liveRow?.segKey === seg.key) {
      await this.closeLive();
      this.log("live signal lost: standing by");
    }
    this.resume = null;
    if (!this.signalLost.has(seg.key)) {
      this.signalLost.add(seg.key);
      if (seg.startsAt.getTime() <= now + 2_000) this.options.onSignalLost?.(liveSourceId);
      else this.signalLost.delete(seg.key);
    }
    // Written only as it's needed, so the live source takes over as soon as it connects.
    if (c.at > now + 2_000) return false;
    const png = await this.options.slates.standBy(this.options.look);
    const row = await this.writeSlate(seg, png, Math.min(blockEnd - c.at, MAX_SLATE_S * 1000), { label: "Stand by", reason: "slate" }, "stand_by");
    if (!row) {
      this.passed.add(`${seg.key}@${seg.startsAt.getTime()}`);
      return true;
    }
    this.standBy = { id: row.id, segKey: seg.key, sourceId: liveSourceId };
    return true;
  }

  // --- Cutting the timeline ----------------------------------------------------------------

  /** Cuts the timeline at the first segment boundary at or after `at`, and carries on from there. */
  private async truncate(at: number) {
    const rows = await this.db
      .select()
      .from(CI)
      .where(and(eq(CI.stationId, this.stationId), or(gt(CI.endsAt, new Date(at)), and(eq(CI.kind, "end"), gte(CI.startsAt, new Date(at))))))
      .orderBy(asc(CI.seq), asc(CI.startsAt));
    let standByGone = false;
    for (const row of rows) {
      if (row.startsAt.getTime() >= at) {
        await this.db.delete(CI).where(eq(CI.id, row.id));
        if (this.standBy?.id === row.id) standByGone = true;
        if (row.planKey) this.written.delete(row.planKey);
        if (this.liveRow?.row.id === row.id) this.liveRow = null;
        continue;
      }
      let n = 0;
      let t = row.startsAt.getTime();
      while (n < row.segmentMs.length && t < at) t += row.segmentMs[n++];
      const lengths = row.segmentMs.slice(0, n);
      const liveUris = row.liveUris ? Object.fromEntries(Object.entries(row.liveUris).map(([k, v]) => [k, v.slice(0, n)])) : null;
      await this.db
        .update(CI)
        .set({ segments: n, segmentMs: lengths, liveUris, endsAt: new Date(t), open: false, tags: clipTags(row.tags, t) })
        .where(eq(CI.id, row.id));
      if (this.liveRow?.row.id === row.id) this.liveRow = null;
    }
    const [last] = await this.db.select().from(CI).where(eq(CI.stationId, this.stationId)).orderBy(desc(CI.seq), desc(CI.startsAt)).limit(1);
    const c = this.cursor!;
    if (!last) this.cursor = { run: c.run, seq: c.seq, disc: c.disc, at: Math.max(at, this.now()), ended: false, fresh: true };
    else if (last.kind === "end") this.cursor = { run: last.run, seq: last.seq, disc: last.disc, at: Math.max(at, last.startsAt.getTime()), ended: true, fresh: false };
    else this.cursor = { run: last.run, seq: last.seq + last.segments, disc: last.disc, at: last.endsAt.getTime(), ended: false, fresh: false };
    // A stand-by slate that's still there (a replan cut after it, or through it) is still one: the
    // source connecting cuts it. Before, a replan while standing by (dead air filled after the
    // block, a log edit) left the slate to run out before the source could air.
    if (standByGone) this.standBy = null;
    this.resume = null;
  }

  // --- Published: the as-run log ------------------------------------------------------------

  /** Items whose last segment has been published: their as-run entries (a spot's proof frame first). */
  private async finish(now: number) {
    for (const [id, at] of this.failed) if (now - at > 60_000) this.failed.delete(id);
    const waiting = [...this.failed.keys()];
    const done = await this.db
      .select()
      .from(CI)
      .where(and(eq(CI.stationId, this.stationId), isNull(CI.asRunId), eq(CI.open, false), ne(CI.kind, "end"), lte(CI.endsAt, new Date(now)), gt(CI.segments, 0), waiting.length ? notInArray(CI.id, waiting) : undefined))
      .orderBy(asc(CI.seq))
      .limit(20);
    for (const row of done) {
      if (this.finishing.has(row.id)) continue;
      this.finishing.add(row.id);
      try {
        await this.record(row);
        this.failed.delete(row.id);
      } catch (error) {
        this.failed.set(row.id, now);
        const reason = (error as Error & { cause?: Error }).cause?.message ?? (error as Error).message;
        this.log(`as-run for ${row.label} failed: ${reason.split("\n")[0].slice(0, 200)}`);
      } finally {
        this.finishing.delete(row.id);
      }
    }
  }

  private async record(row: Row) {
    const { services } = this.ctx;
    const look = this.options.look;
    let proof: string | null = null;
    if (row.airingId && row.preparedKey && look.band === "tv") {
      const bug = look.bug.mode !== "off" ? await this.options.slates.bug(look, look.bug.opacity) : null;
      const r = this.options.preparer.ladder.v720;
      proof = await proofFrame(this.ctx, { stationId: this.stationId, airingId: row.airingId, preparedKey: row.preparedKey, rendition: r.name, width: r.width, height: r.height, segment: row.firstSegment + Math.floor(row.segments / 2), bug, scratchDir: this.options.scratchDir });
    }
    // What aired is recorded even if its log entry or break was taken off the log since it was
    // written (it aired all the same); the references that are gone are left empty.
    const logEntryId = row.logEntryId && (await services.log.entrySpan(row.logEntryId)) ? row.logEntryId : null;
    const breakId = row.breakId && (await services.log.breakContexts([row.breakId])).has(row.breakId) ? row.breakId : null;
    const asRun = await this.db.transaction(async (tx) => {
      const [claimed] = await tx.select({ asRunId: CI.asRunId }).from(CI).where(eq(CI.id, row.id)).for("update");
      if (!claimed || claimed.asRunId) return null;
      const [inserted] = await tx
        .insert(schema.asRun)
        .values({
          stationId: this.stationId,
          code: row.code as "PGM",
          startedAt: row.startsAt,
          endedAt: row.endsAt,
          logEntryId,
          breakId,
          assetId: row.assetId,
          programId: row.programId,
          airingId: row.airingId,
          carriageAgreementId: row.agreementId,
          liveSourceId: row.liveSourceId,
          reason: row.reason as "planned",
          bumperRole: row.bumperRole,
          position: row.position as "open" | null,
          announcedEntryId: row.announcedEntryId,
          announcedTitle: row.announcedTitle,
          proofFrameUrl: proof,
          proofFrameAt: proof ? new Date((row.startsAt.getTime() + row.endsAt.getTime()) / 2) : null
        })
        .returning();
      await tx.update(CI).set({ asRunId: inserted.id }).where(eq(CI.id, row.id));
      return inserted;
    });
    if (!asRun) return;
    const missing = this.missingByRow.get(row.id);
    if (missing) {
      this.missingByRow.delete(row.id);
      this.reportMissing(missing);
    }
    if (row.airingId) {
      await services.spots.settleAiring({ airingId: row.airingId, asRunId: asRun.id, startedAt: asRun.startedAt, endedAt: asRun.endedAt }).catch((error) => this.log(`settling ${row.airingId} failed: ${(error as Error).message}`));
    }
    // A carried episode under a cash deal: the carrier pays the maker (once per slot, however it's split).
    if (row.agreementId && row.logEntryId && row.code === "PGM" && !row.inBreak) {
      await services.catalog
        .chargeCarriedAiring({ agreementId: row.agreementId, carrierStationId: this.stationId, logEntryId: row.logEntryId })
        .catch((error) => this.log(`carriage fee for ${row.logEntryId} failed: ${(error as Error).message}`));
    }
  }

  /** What's on now, for master control's Monitor (and the dial's stand-by). */
  private async markCurrent(now: number) {
    const at = new Date(now);
    const [row] = await this.db
      .select()
      .from(CI)
      .where(and(eq(CI.stationId, this.stationId), lte(CI.startsAt, at), gt(CI.endsAt, at), ne(CI.kind, "end")))
      .orderBy(desc(CI.seq))
      .limit(1);
    const id = row?.id ?? null;
    if (id === this.current) return;
    this.current = id;
    const set = {
      currentAssetId: row?.assetId ?? null,
      currentLogEntryId: row?.logEntryId ?? null,
      currentStartedAt: row?.startsAt ?? null,
      standingBy: row?.label === "Stand by",
      lastError: null,
      updatedAt: this.ctx.deps.clock.now()
    };
    await this.db
      .insert(schema.playoutState)
      .values({ stationId: this.stationId, onAir: true, ...set })
      .onConflictDoUpdate({ target: schema.playoutState.stationId, set });
  }
}

/**
 * Channel rows older than two days go (the as-run log is the record), and with them the live
 * segments the worker stored for their live blocks (`prepared/live-…`).
 */
export async function pruneChannelItems({ deps }: ModuleContext) {
  const old = and(lte(CI.endsAt, new Date(deps.clock.now().getTime() - 2 * 86_400_000)), sql`${CI.asRunId} is not null or ${CI.kind} = 'end'`);
  const live = await deps.db.select({ liveUris: CI.liveUris }).from(CI).where(and(old, eq(CI.kind, "live")));
  for (const prefix of liveObjectPrefixes(live.map((r) => r.liveUris))) await deps.storage.objects.deletePrefix(prefix).catch(() => undefined);
  await deps.db.delete(CI).where(old);
}

/** The stored live sessions (`prepared/live-…`) a live row's segments are in. */
export function liveObjectPrefixes(uris: Array<Record<string, string[]> | null>): string[] {
  const out = new Set<string>();
  for (const byRendition of uris) {
    for (const list of Object.values(byRendition ?? {})) {
      for (const uri of list) {
        const m = /(prepared\/live-[\w-]+)\//.exec(uri);
        if (m) out.add(m[1]);
      }
    }
  }
  return [...out];
}
