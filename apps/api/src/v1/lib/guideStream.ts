// A249 (2026-10-06, the user's choice: "large guide files"): XMLTV guides read as they download.
// Public guide data comes as one file for a whole platform's channels (Pluto TV's US guide, as
// i.mjh.nz republishes it: 965 KB gzipped, 7.4 MB of XML, 427 channels, 8,806 programmes), often
// gzipped. Such a file is never held whole: the answer is unzipped as it arrives (node:zlib, when
// its first bytes are gzip's, whatever its name or type says), its text scanned element by element,
// and only the programmes of the channels wanted are kept (each listing that reads the file, in one
// pass). Limits (GUIDE_LIMITS): its size as it comes, its size as read, airings kept for a channel,
// and time; past any, the read stops (`GuideTooBig`) and what was stored stays.
//
// The channel: the address's `#channel=` (a guide's id for it, else one ending "-<it>", as Plex's
// ids gained a prefix of their own in i.mjh.nz's files, else its name in the guide); without one,
// a guide of one channel is read whole, and one of several is read for the channel the listing's
// name (or its stream's folder) names exactly, else none: never several channels mixed.
// Titles are the guide's own; a programme without a title or a start is left out.

import { createGunzip } from "node:zlib";
import { Readable, pipeline } from "node:stream";
import { GUIDE_LIMITS } from "@opencast/contracts";
import type { CalendarEvent } from "./ics.js";
import { NAME_EXTRAS, plain, streamFolders, textOf, xmlAttr, xmltvProgramme, type ChannelHints } from "./schedules.js";

export type GuideLimit = "compressed" | "bytes" | "programmes" | "time";

/** A guide past one of its limits. */
export class GuideTooBig extends Error {
  constructor(readonly limit: GuideLimit) {
    super(`The guide is past its ${limit} limit.`);
    this.name = "GuideTooBig";
  }
}

export interface GuideCaps {
  compressedBytes: number;
  bytes: number;
  programmes: number;
  ms: number;
}

export const GUIDE_CAPS: GuideCaps = {
  compressedBytes: GUIDE_LIMITS.compressedBytes,
  bytes: GUIDE_LIMITS.bytes,
  programmes: GUIDE_LIMITS.programmes,
  ms: GUIDE_LIMITS.seconds * 1000
};

/** Over this as read (or gzipped at all), a guide is large: read at most every 30 minutes while running dry. */
export const LARGE_GUIDE_BYTES = 5_000_000;

/** One element can't be longer than this: a tag that never closes stops the read. */
const ELEMENT_MAX = 1_000_000;

/** Whether bytes start as gzip does (1f 8b). */
export const isGzip = (b: Uint8Array) => b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b;

/** An answer's body, unzipped when it's gzip (by its first bytes), counted against the limits. */
export interface GuideBody {
  gzip: boolean;
  /** Bytes as they came, and as read (unzipped), so far. */
  counts: { compressed: number; bytes: number };
  chunks: AsyncGenerator<Uint8Array>;
}

/**
 * The body as it downloads. The fetch has already undone a `Content-Encoding: gzip`; a file that is
 * itself gzip (`.xml.gz`, `application/gzip`, or labelled nothing useful at all) is unzipped here,
 * and one named `.gz` that isn't is read as it is. `deadline`: when the read must be done by.
 */
export function guideBody(body: ReadableStream<Uint8Array> | null, caps: GuideCaps = GUIDE_CAPS, deadline = Date.now() + caps.ms, signal?: AbortSignal): Promise<GuideBody> {
  const counts = { compressed: 0, bytes: 0 };
  const late = () => Date.now() > deadline || signal?.aborted === true;
  return (async () => {
    if (!body) return { gzip: false, counts, chunks: (async function* () {})() };
    const reader = body.getReader();
    const read = async () => {
      try {
        return await reader.read();
      } catch (e) {
        if (late()) throw new GuideTooBig("time");
        throw e;
      }
    };
    // Enough of the start to know gzip.
    const head: Uint8Array[] = [];
    let headSize = 0;
    let ended = false;
    while (headSize < 2) {
      const { done, value } = await read();
      if (done || !value) {
        ended = true;
        break;
      }
      head.push(value);
      headSize += value.byteLength;
    }
    const first = head.length === 1 ? head[0]! : concat(head, headSize);
    const gzip = isGzip(first);
    async function* raw(): AsyncGenerator<Uint8Array> {
      try {
        if (first.byteLength) {
          counts.compressed += first.byteLength;
          if (counts.compressed > caps.compressedBytes) throw new GuideTooBig("compressed");
          yield first;
        }
        while (!ended) {
          if (late()) throw new GuideTooBig("time");
          const { done, value } = await read();
          if (done || !value) return;
          counts.compressed += value.byteLength;
          if (counts.compressed > caps.compressedBytes) throw new GuideTooBig("compressed");
          yield value;
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    }
    async function* unzipped(): AsyncGenerator<Uint8Array> {
      const source = Readable.from(raw(), { objectMode: false });
      const gunzip = createGunzip();
      pipeline(source, gunzip, () => undefined);
      try {
        for await (const chunk of gunzip as AsyncIterable<Buffer>) yield new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      } finally {
        source.destroy();
        gunzip.destroy();
      }
    }
    async function* counted(): AsyncGenerator<Uint8Array> {
      for await (const chunk of gzip ? unzipped() : raw()) {
        counts.bytes += chunk.byteLength;
        if (counts.bytes > caps.bytes) throw new GuideTooBig("bytes");
        if (late()) throw new GuideTooBig("time");
        yield chunk;
      }
    }
    return { gzip, counts, chunks: counted() };
  })();
}

function concat(parts: Uint8Array[], size: number): Uint8Array {
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.byteLength;
  }
  return all;
}

/** What a listing wants from a guide: the channel its address names, else the one its name or stream names. */
export interface GuideWant {
  fragment: string | null;
  hints: ChannelHints;
}

export interface GuideChannel {
  id: string;
  names: string[];
}

/** What one want got: its channel's airings, or why none. */
export interface GuideWantResult {
  channel: string | null;
  channelName: string | null;
  events: CalendarEvent[];
  /** `pick_channel`: several channels, none named or matched (or several matched); `not_in_guide`: the channel named isn't in it. */
  problem: "pick_channel" | "not_in_guide" | null;
}

export interface GuideScan {
  channels: GuideChannel[];
  wants: GuideWantResult[];
}

/** A guide's channel for a `#channel=`: its id, else an id ending "-<it>" (Plex's), else its id or name made plain. */
export function channelForFragment(channels: GuideChannel[], fragment: string): GuideChannel | null {
  return (
    channels.find((c) => c.id === fragment) ??
    channels.find((c) => c.id.endsWith(`-${fragment}`)) ??
    channels.find((c) => plain(c.id) === plain(fragment)) ??
    channels.find((c) => c.names.some((n) => plain(n) === plain(fragment))) ??
    null
  );
}

/**
 * A guide's channel for a listing with no `#channel=`: one whose id or name is the listing's name
 * (as given, then without a trailing "Channel", "TV" and the like) or one of its stream's folders,
 * made plain. Exactly only (a guide has hundreds of channels): none, or several different ones, is null.
 */
export function channelForHints(channels: GuideChannel[], hints: ChannelHints): GuideChannel | null {
  const name = hints.name ?? "";
  const wanted = [name, name.replace(NAME_EXTRAS, ""), ...streamFolders(hints.streamUrl)].map(plain).filter((n) => n.length >= 3);
  for (const n of new Set(wanted)) {
    const found = channels.filter((c) => plain(c.id) === n || c.names.some((x) => plain(x) === n));
    const ids = new Set(found.map((c) => c.id));
    if (ids.size === 1) return found[0]!;
    if (ids.size > 1) return null;
  }
  return null;
}

/**
 * An XMLTV guide's text, scanned as it comes (`push`, then `end`), keeping the programmes of the
 * channels wanted. `since`: programmes over by then are left out (they'd never be stored), so the
 * limit on a channel's airings counts what's to come. `channelsOnly`: stop at the first programme
 * (a guide's channels come before its programmes), to see which channels it has.
 */
export class XmltvScanner {
  private buf = "";
  private readonly channels: GuideChannel[] = [];
  private readonly ids = new Set<string>();
  /**
   * `listed`: the guide lists its channels (before its programmes, as XMLTV has them), so each
   * want's channel is known at the first programme and only theirs are kept. `loose`: it doesn't,
   * so programmes are kept by the channel they name (50 channels at most) and the wants are matched
   * at the end. Undefined until the first programme.
   */
  private mode: "listed" | "loose" | undefined;
  private targets: Array<string | null> = [];
  private problems: Array<GuideWantResult["problem"]> = [];
  private readonly kept = new Map<string, CalendarEvent[]>();
  private result: GuideScan | null = null;
  done = false;

  constructor(
    private readonly wants: GuideWant[],
    private readonly options: { since?: Date | null; maxProgrammes?: number; channelsOnly?: boolean } = {}
  ) {}

  push(text: string): void {
    if (this.done) return;
    this.buf += text;
    this.scan(false);
  }

  end(): GuideScan {
    if (this.result) return this.result;
    if (!this.done) this.scan(true);
    this.done = true;
    if (this.mode === "loose" || (this.mode === undefined && !this.channels.length)) {
      // The channels its programmes name.
      for (const id of this.kept.keys()) if (!this.ids.has(id)) this.channels.push({ id, names: [] });
      this.resolve();
    } else if (this.mode === undefined) this.resolve();
    this.result = {
      channels: this.channels,
      wants: this.wants.map((_, i) => {
        const id = this.targets[i] ?? null;
        return { channel: id, channelName: this.channels.find((c) => c.id === id)?.names[0] ?? null, events: id ? (this.kept.get(id) ?? []) : [], problem: this.problems[i] ?? null };
      })
    };
    return this.result;
  }

  /** Whole elements out of the buffer: channels and programmes; anything else is passed over. */
  private scan(final: boolean) {
    const buf = this.buf;
    let at = 0;
    while (!this.done) {
      const lt = buf.indexOf("<", at);
      if (lt < 0) {
        at = buf.length;
        break;
      }
      if (!final && buf.length - lt < 16) {
        at = lt;
        break;
      }
      if (buf.startsWith("<!--", lt)) {
        const close = buf.indexOf("-->", lt + 4);
        if (close < 0) {
          at = lt;
          break;
        }
        at = close + 3;
        continue;
      }
      const gt = buf.indexOf(">", lt);
      if (gt < 0) {
        at = lt;
        break;
      }
      const name = /^<(programme|channel)[\s/>]/.exec(buf.slice(lt, lt + 12))?.[1];
      if (!name) {
        at = gt + 1;
        continue;
      }
      const empty = buf[gt - 1] === "/";
      const attrs = buf.slice(lt + 1 + name.length, empty ? gt - 1 : gt);
      if (empty) {
        this.element(name, attrs, "");
        at = gt + 1;
        continue;
      }
      const close = buf.indexOf(`</${name}>`, gt);
      if (close < 0) {
        at = lt;
        break;
      }
      this.element(name, attrs, buf.slice(gt + 1, close));
      at = close + name.length + 3;
    }
    this.buf = this.done ? "" : buf.slice(at);
    if (this.buf.length > ELEMENT_MAX) throw new Error("A guide element never closes.");
  }

  private element(name: string, attrs: string, inner: string) {
    if (name === "channel") {
      const id = attribute(attrs, "id");
      if (!id || this.ids.has(id)) return;
      const names = [...inner.matchAll(/<display-name(?:\s[^>]*)?>([\s\S]*?)<\/display-name>/gi)].map((m) => textOf(m[1]!)).filter(Boolean);
      this.channels.push({ id, names });
      this.ids.add(id);
      return;
    }
    if (this.options.channelsOnly) {
      this.done = true;
      return;
    }
    if (this.mode === undefined) {
      this.mode = this.channels.length ? "listed" : "loose";
      if (this.mode === "listed") this.resolve();
    }
    const id = attribute(attrs, "channel");
    if (id === null) return;
    if (this.mode === "listed" && !this.targets.includes(id)) return;
    const e = xmltvProgramme(attrs, inner);
    if (!e) return;
    const since = this.options.since;
    if (since && (e.end ? e.end <= since : e.start < since)) return;
    let list = this.kept.get(id);
    if (!list) {
      if (this.kept.size >= 50) return;
      list = [];
      this.kept.set(id, list);
    }
    if (list.length >= (this.options.maxProgrammes ?? GUIDE_CAPS.programmes)) throw new GuideTooBig("programmes");
    list.push(e);
  }

  /** Each want's channel among the guide's: the fragment's, else the only one, else the one its name names. */
  private resolve() {
    const channels = this.channels;
    this.targets = [];
    this.problems = [];
    for (const w of this.wants) {
      const found = w.fragment !== null ? channelForFragment(channels, w.fragment) : channels.length === 1 ? channels[0]! : channelForHints(channels, w.hints);
      this.targets.push(found?.id ?? null);
      this.problems.push(found || !channels.length ? null : w.fragment !== null ? "not_in_guide" : "pick_channel");
    }
  }
}

/** An attribute's value, its entities decoded. */
function attribute(attrs: string, name: string): string | null {
  const raw = xmlAttr(attrs, name);
  if (raw === null) return null;
  return raw.includes("&") ? textOf(raw) : raw;
}

/** A guide already in hand (a small file, or a test's), read as one would be downloaded. */
export function readXmltvText(text: string, fragment: string | null, hints: ChannelHints = {}): CalendarEvent[] {
  const scanner = new XmltvScanner([{ fragment, hints }]);
  scanner.push(text);
  return scanner.end().wants[0]!.events;
}

/** A guide's text as it downloads, scanned: decoded as UTF-8 a chunk at a time. */
export async function scanGuide(body: GuideBody, scanner: XmltvScanner, head?: Uint8Array): Promise<GuideScan> {
  const decoder = new TextDecoder("utf-8");
  try {
    if (head?.byteLength) scanner.push(decoder.decode(head, { stream: true }));
    if (!scanner.done) {
      for await (const chunk of body.chunks) {
        scanner.push(decoder.decode(chunk, { stream: true }));
        if (scanner.done) break;
      }
    }
  } finally {
    await body.chunks.return(undefined).catch(() => undefined);
  }
  if (!scanner.done) scanner.push(decoder.decode());
  return scanner.end();
}
