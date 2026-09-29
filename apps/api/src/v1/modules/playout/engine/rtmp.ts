// The worker's own RTMP ingest, for radio live blocks (the radio band never goes through Livepeer).
// Before prepare once, then assemble, the worker read a live source with an FFmpeg RTMP listener
// (`-listen 1` on LIVE_LISTEN_PORT): one port per source, and any stream key accepted. This is the
// same idea on one port for every source: a small RTMP server that takes publishers only (OBS,
// vMix, FFmpeg, hardware encoders), checks each stream key against the station's live sources,
// and hands the sound on as FLV to whoever packages it (radiolive.ts). Pictures are dropped: the
// radio band is sound only.
//
// What it speaks: the plain RTMP handshake (C0 C1 C2 / S0 S1 S2, which every publisher accepts),
// chunk streams in both directions, the protocol control messages, AMF0 commands (connect,
// releaseStream, FCPublish, createStream, publish, FCUnpublish, deleteStream) and AMF0 data. Not
// RTMPS, RTMPE or playback.

import { EventEmitter } from "node:events";
import net from "node:net";
import { randomBytes } from "node:crypto";

const HANDSHAKE = 1536;
/** What the server asks the publisher to acknowledge, and the chunk size it sends at. */
const WINDOW = 5_000_000;
const OUT_CHUNK = 4096;
/** A publisher that sends nothing this long is dropped. */
const IDLE_MS = 30_000;

// --- AMF0 ------------------------------------------------------------------------------

type Amf = number | boolean | string | null | undefined | Date | Amf[] | { [key: string]: Amf };

function amfRead(buf: Buffer, at: number): [Amf, number] {
  const type = buf[at++];
  switch (type) {
    case 0x00:
      return [buf.readDoubleBE(at), at + 8];
    case 0x01:
      return [buf[at] !== 0, at + 1];
    case 0x02: {
      const n = buf.readUInt16BE(at);
      return [buf.toString("utf8", at + 2, at + 2 + n), at + 2 + n];
    }
    case 0x0c: {
      const n = buf.readUInt32BE(at);
      return [buf.toString("utf8", at + 4, at + 4 + n), at + 4 + n];
    }
    case 0x03:
    case 0x08: {
      if (type === 0x08) at += 4; // the ECMA array's count
      const out: Record<string, Amf> = {};
      while (at + 3 <= buf.length) {
        const n = buf.readUInt16BE(at);
        at += 2;
        if (n === 0 && buf[at] === 0x09) return [out, at + 1];
        const key = buf.toString("utf8", at, at + n);
        at += n;
        const [value, next] = amfRead(buf, at);
        out[key] = value;
        at = next;
      }
      return [out, at];
    }
    case 0x0a: {
      const count = buf.readUInt32BE(at);
      at += 4;
      const out: Amf[] = [];
      for (let i = 0; i < count; i++) {
        const [value, next] = amfRead(buf, at);
        out.push(value);
        at = next;
      }
      return [out, at];
    }
    case 0x0b:
      return [new Date(buf.readDoubleBE(at)), at + 10];
    case 0x05:
      return [null, at];
    case 0x06:
      return [undefined, at];
    default:
      throw new Error(`AMF0 type ${type} isn't read`);
  }
}

function amfReadAll(buf: Buffer): Amf[] {
  const out: Amf[] = [];
  let at = 0;
  while (at < buf.length) {
    const [value, next] = amfRead(buf, at);
    out.push(value);
    at = next;
  }
  return out;
}

function amfWrite(value: Amf): Buffer {
  if (value === null || value === undefined) return Buffer.from([0x05]);
  if (typeof value === "number") {
    const b = Buffer.alloc(9);
    b[0] = 0x00;
    b.writeDoubleBE(value, 1);
    return b;
  }
  if (typeof value === "boolean") return Buffer.from([0x01, value ? 1 : 0]);
  if (typeof value === "string") {
    const s = Buffer.from(value, "utf8");
    const head = Buffer.alloc(3);
    head[0] = 0x02;
    head.writeUInt16BE(s.length, 1);
    return Buffer.concat([head, s]);
  }
  const parts: Buffer[] = [Buffer.from([0x03])];
  for (const [key, v] of Object.entries(value as Record<string, Amf>)) {
    const k = Buffer.from(key, "utf8");
    const n = Buffer.alloc(2);
    n.writeUInt16BE(k.length);
    parts.push(n, k, amfWrite(v));
  }
  parts.push(Buffer.from([0x00, 0x00, 0x09]));
  return Buffer.concat(parts);
}

// --- FLV ---------------------------------------------------------------------------------

/** An FLV file header, sound only, and the first "previous tag size". */
export const FLV_AUDIO_HEADER = Buffer.from([0x46, 0x4c, 0x56, 0x01, 0x04, 0x00, 0x00, 0x00, 0x09, 0x00, 0x00, 0x00, 0x00]);

/** One FLV tag (with its trailing size). */
export function flvTag(type: number, timestamp: number, data: Buffer): Buffer {
  const head = Buffer.alloc(11);
  head[0] = type;
  head.writeUIntBE(data.length, 1, 3);
  head.writeUIntBE(timestamp & 0xffffff, 4, 3);
  head[7] = (timestamp >>> 24) & 0xff;
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(11 + data.length);
  return Buffer.concat([head, data, tail]);
}

// --- Publishers ----------------------------------------------------------------------------

/** One encoder sending to one live source. Its sound goes out as FLV to whoever is attached. */
export class Publisher extends EventEmitter {
  readonly connectedAt = Date.now();
  lastDataAt = Date.now();
  /** Bytes of sound received. */
  bytes = 0;
  ended = false;
  /** An AAC stream's sequence header (its AudioSpecificConfig tag), sent first to a late sink. */
  private sequenceHeader: Buffer | null = null;
  private sinks = new Map<(chunk: Buffer) => void, { base: number | null }>();

  constructor(
    readonly sourceId: string,
    readonly key: string,
    /** Tells one connection from the next on the same source. */
    readonly session: string,
    private drop: () => void
  ) {
    super();
  }

  /** Sound as FLV from now on: the header (and AAC's sequence header) first, timestamps from 0. Returns a detach. */
  attach(sink: (chunk: Buffer) => void): () => void {
    this.sinks.set(sink, { base: null });
    sink(FLV_AUDIO_HEADER);
    if (this.sequenceHeader) sink(flvTag(8, 0, this.sequenceHeader));
    return () => void this.sinks.delete(sink);
  }

  /** @internal */
  audio(timestamp: number, data: Buffer) {
    if (!data.length) return;
    this.lastDataAt = Date.now();
    this.bytes += data.length;
    // AAC (sound format 10) with packet type 0 is its sequence header.
    if (data[0] >> 4 === 10 && data[1] === 0) {
      this.sequenceHeader = Buffer.from(data);
      for (const sink of this.sinks.keys()) sink(flvTag(8, 0, data));
      return;
    }
    for (const [sink, state] of this.sinks) {
      state.base ??= timestamp;
      sink(flvTag(8, Math.max(0, timestamp - state.base), data));
    }
  }

  /** @internal */
  touch() {
    this.lastDataAt = Date.now();
  }

  /** @internal The encoder went (or was replaced): sinks are told. */
  end() {
    if (this.ended) return;
    this.ended = true;
    this.sinks.clear();
    this.emit("end");
  }

  /** Drops the encoder's connection. */
  close() {
    this.drop();
  }
}

export interface RtmpIngestOptions {
  port: number;
  host?: string;
  /** The live source a stream key belongs to (a radio station's encoder), or null to refuse it. */
  authorize(key: string): Promise<string | null>;
  log?(line: string): void;
}

interface ChunkStream {
  timestamp: number;
  /** The last timestamp field read (absolute for type 0, a delta otherwise). */
  field: number;
  length: number;
  type: number;
  streamId: number;
  extended: boolean;
  parts: Buffer[];
  received: number;
}

/** One connection: handshake, chunks, commands. */
class Connection {
  private buf: Buffer = Buffer.alloc(0);
  private state: "c0c1" | "c2" | "chunks" = "c0c1";
  private inChunk = 128;
  private streams = new Map<number, ChunkStream>();
  private received = 0;
  private acked = 0;
  private peerWindow = 2_500_000;
  private publisher: Publisher | null = null;
  private busy: Promise<void> = Promise.resolve();
  private idle: NodeJS.Timeout;

  constructor(
    private socket: net.Socket,
    private ingest: RtmpIngest
  ) {
    socket.setNoDelay(true);
    socket.on("data", (d: Buffer) => this.data(d));
    socket.on("error", () => undefined);
    socket.on("close", () => this.closed());
    this.idle = setInterval(() => {
      const last = this.publisher?.lastDataAt ?? 0;
      if (this.publisher && Date.now() - last > IDLE_MS) socket.destroy();
    }, 5_000);
  }

  private data(chunk: Buffer) {
    this.received += chunk.length;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    try {
      this.drain();
    } catch (error) {
      this.ingest.logLine(`dropped a connection: ${(error as Error).message}`);
      this.socket.destroy();
      return;
    }
    if (this.received - this.acked >= this.peerWindow / 2) {
      this.acked = this.received;
      this.control(3, u32(this.received >>> 0));
    }
  }

  private drain() {
    for (;;) {
      if (this.state === "c0c1") {
        if (this.buf.length < 1 + HANDSHAKE) return;
        const c1 = this.buf.subarray(1, 1 + HANDSHAKE);
        const s1 = Buffer.concat([u32(Math.floor(Date.now() / 1000) >>> 0), Buffer.alloc(4), randomBytes(HANDSHAKE - 8)]);
        this.socket.write(Buffer.concat([Buffer.from([3]), s1, c1]));
        this.buf = this.buf.subarray(1 + HANDSHAKE);
        this.state = "c2";
        continue;
      }
      if (this.state === "c2") {
        if (this.buf.length < HANDSHAKE) return;
        this.buf = this.buf.subarray(HANDSHAKE);
        this.state = "chunks";
        continue;
      }
      if (!this.chunk()) return;
    }
  }

  /** Reads one chunk if it's all there. */
  private chunk(): boolean {
    const b = this.buf;
    if (b.length < 1) return false;
    const fmt = b[0] >> 6;
    let csid = b[0] & 0x3f;
    let at = 1;
    if (csid === 0) {
      if (b.length < 2) return false;
      csid = b[1] + 64;
      at = 2;
    } else if (csid === 1) {
      if (b.length < 3) return false;
      csid = b[2] * 256 + b[1] + 64;
      at = 3;
    }
    const size = [11, 7, 3, 0][fmt];
    if (b.length < at + size) return false;
    const prev = this.streams.get(csid);
    if (!prev && fmt !== 0) throw new Error(`chunk stream ${csid} starts without a full header`);
    const st: ChunkStream = prev ?? { timestamp: 0, field: 0, length: 0, type: 0, streamId: 0, extended: false, parts: [], received: 0 };
    let field = st.field;
    let length = st.length;
    let type = st.type;
    let streamId = st.streamId;
    if (fmt <= 2) field = b.readUIntBE(at, 3);
    if (fmt <= 1) {
      length = b.readUIntBE(at + 3, 3);
      type = b[at + 6];
    }
    if (fmt === 0) streamId = b.readUInt32LE(at + 7);
    at += size;
    const extended = fmt <= 2 ? field === 0xffffff : st.extended;
    if (extended) {
      if (b.length < at + 4) return false;
      field = b.readUInt32BE(at);
      at += 4;
    }
    const starting = st.received === 0;
    const take = Math.min(this.inChunk, length - (starting ? 0 : st.received));
    if (b.length < at + take) return false;
    // All there: commit.
    if (starting) {
      st.timestamp = fmt === 0 ? field : st.timestamp + field;
      st.field = field;
      st.length = length;
      st.type = type;
      st.streamId = streamId;
      st.extended = extended;
      st.parts = [];
    }
    st.parts.push(b.subarray(at, at + take));
    st.received += take;
    this.streams.set(csid, st);
    this.buf = b.subarray(at + take);
    if (st.received >= st.length) {
      const body = st.parts.length === 1 ? st.parts[0] : Buffer.concat(st.parts);
      st.parts = [];
      st.received = 0;
      this.message(st.type, st.streamId, st.timestamp, Buffer.from(body));
    }
    return true;
  }

  private message(type: number, streamId: number, timestamp: number, body: Buffer) {
    switch (type) {
      case 1:
        this.inChunk = body.readUInt32BE(0) & 0x7fffffff;
        return;
      case 2: {
        const aborted = this.streams.get(body.readUInt32BE(0));
        if (aborted) {
          aborted.parts = [];
          aborted.received = 0;
        }
        return;
      }
      case 5:
        this.peerWindow = body.readUInt32BE(0) || this.peerWindow;
        return;
      case 8:
        if (this.publisher && !this.publisher.ended) this.publisher.audio(timestamp, body);
        return;
      case 9:
        // Pictures are dropped: the radio band is sound only.
        this.publisher?.touch();
        return;
      case 17:
        return this.command(body.subarray(1), streamId);
      case 20:
        return this.command(body, streamId);
      default:
        return;
    }
  }

  private command(body: Buffer, streamId: number) {
    const [name, txn, , ...args] = amfReadAll(body);
    const id = typeof txn === "number" ? txn : 0;
    // Commands are answered in order; `publish` waits on the database.
    this.busy = this.busy.then(async () => {
      switch (name) {
        case "connect":
          this.control(5, u32(WINDOW));
          this.control(6, Buffer.concat([u32(WINDOW), Buffer.from([2])]));
          this.control(1, u32(OUT_CHUNK));
          this.invoke(0, "_result", id, { fmsVer: "FMS/3,0,1,123", capabilities: 31 }, { level: "status", code: "NetConnection.Connect.Success", description: "Connection succeeded.", objectEncoding: 0 });
          return;
        case "createStream":
          this.invoke(0, "_result", id, null, 1);
          return;
        case "publish": {
          const raw = typeof args[0] === "string" ? args[0] : "";
          const key = raw.split("?")[0].trim();
          const sourceId = key ? await this.ingest.authorizeKey(key) : null;
          if (!sourceId || this.socket.destroyed) {
            this.invoke(streamId || 1, "onStatus", 0, null, { level: "error", code: "NetStream.Publish.BadName", description: "That stream key isn't a live source here." });
            this.ingest.logLine(`refused a publisher (${key ? `key ${key.slice(0, 6)}…` : "no key"})`);
            setTimeout(() => this.socket.destroy(), 200);
            return;
          }
          // Stream Begin, then Publish.Start.
          this.control(4, Buffer.concat([Buffer.from([0, 0]), u32(streamId || 1)]));
          this.invoke(streamId || 1, "onStatus", 0, null, { level: "status", code: "NetStream.Publish.Start", description: `${key.slice(0, 6)}… is now published.`, details: key });
          this.publisher = this.ingest.started(sourceId, key, () => this.socket.destroy());
          return;
        }
        case "FCUnpublish":
        case "deleteStream":
        case "closeStream":
          this.endPublishing();
          return;
        default:
          // releaseStream, FCPublish, getStreamLength and the like need no answer.
          return;
      }
    });
    this.busy.catch(() => undefined);
  }

  private endPublishing() {
    if (!this.publisher) return;
    this.ingest.ended(this.publisher);
    this.publisher = null;
  }

  private closed() {
    clearInterval(this.idle);
    this.endPublishing();
    this.ingest.forget(this);
  }

  // --- Sending ---

  private send(csid: number, type: number, streamId: number, body: Buffer) {
    if (this.socket.destroyed) return;
    const head = Buffer.alloc(12);
    head[0] = csid & 0x3f;
    head.writeUIntBE(0, 1, 3);
    head.writeUIntBE(body.length, 4, 3);
    head[7] = type;
    head.writeUInt32LE(streamId, 8);
    const parts: Buffer[] = [head];
    for (let at = 0; at < body.length; at += OUT_CHUNK) {
      if (at) parts.push(Buffer.from([0xc0 | (csid & 0x3f)]));
      parts.push(body.subarray(at, at + OUT_CHUNK));
    }
    this.socket.write(Buffer.concat(parts));
  }

  private control(type: number, body: Buffer) {
    this.send(2, type, 0, body);
  }

  private invoke(streamId: number, name: string, txn: number, ...args: Amf[]) {
    this.send(3, 20, streamId, Buffer.concat([amfWrite(name), amfWrite(txn), ...args.map(amfWrite)]));
  }

  destroy() {
    this.socket.destroy();
  }
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
}

/**
 * The ingest server. `publisher(sourceId)` is who's sending to a source now; "publish" and
 * "unpublish" are emitted as encoders come and go. One publisher per source: a new one replaces
 * the last (an encoder reconnecting before its old connection timed out).
 */
export class RtmpIngest extends EventEmitter {
  private server: net.Server | null = null;
  private connections = new Set<Connection>();
  private publishers = new Map<string, Publisher>();
  private sessions = 0;

  constructor(private options: RtmpIngestOptions) {
    super();
  }

  get port(): number {
    const address = this.server?.address();
    return address && typeof address === "object" ? address.port : this.options.port;
  }

  async listen(): Promise<number> {
    if (this.server) return this.port;
    const server = net.createServer((socket) => this.connections.add(new Connection(socket, this)));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.options.port, this.options.host ?? "0.0.0.0", () => {
        server.off("error", reject);
        resolve();
      });
    });
    server.on("error", (error) => this.logLine(`ingest: ${error.message}`));
    this.logLine(`listening for encoders on :${this.port}`);
    return this.port;
  }

  async close() {
    const server = this.server;
    this.server = null;
    for (const c of this.connections) c.destroy();
    this.connections.clear();
    for (const p of this.publishers.values()) p.end();
    this.publishers.clear();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  publisher(sourceId: string): Publisher | null {
    const p = this.publishers.get(sourceId);
    return p && !p.ended ? p : null;
  }

  /** @internal */
  logLine(line: string) {
    this.options.log?.(`[ingest] ${line}`);
  }

  /** @internal */
  authorizeKey(key: string) {
    return this.options.authorize(key).catch(() => null);
  }

  /** @internal */
  started(sourceId: string, key: string, drop: () => void): Publisher {
    const old = this.publishers.get(sourceId);
    if (old) {
      old.end();
      old.close();
    }
    const p = new Publisher(sourceId, key, `${Date.now().toString(36)}${(++this.sessions).toString(36)}`, drop);
    this.publishers.set(sourceId, p);
    this.logLine(`encoder connected to ${sourceId.slice(0, 8)}`);
    this.emit("publish", p);
    return p;
  }

  /** @internal */
  ended(p: Publisher) {
    if (this.publishers.get(p.sourceId) === p) this.publishers.delete(p.sourceId);
    if (!p.ended) this.logLine(`encoder left ${p.sourceId.slice(0, 8)}`);
    p.end();
    this.emit("unpublish", p);
  }

  /** @internal */
  forget(c: Connection) {
    this.connections.delete(c);
  }
}
