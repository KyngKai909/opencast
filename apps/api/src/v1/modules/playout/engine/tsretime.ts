// Joins MPEG-TS segments from different items into one continuous stream. Each prepared item's
// timestamps start again near zero, so a relay reading the channel's segments one after another
// would see time jump back at every item. This shifts every PTS, DTS and PCR in a segment by one
// offset per item, so each item carries on where the last one ended, and the relay can stream-copy.
//
// It also gives every segment the same layout: sources lay their streams out differently (a live
// block's segments come from Livepeer, whose TS carries the sound on the PID our prepared segments
// use for the picture), and a relay reading one continuous stream would take one for the other and
// freeze at the switch. Each segment's program table is read, its picture moved to PID 0x100 and
// its sound to 0x101 under one program table (PMT on 0x1000), anything else dropped, and the
// continuity counters run on across segments.

const PACKET = 188;
const TS_CLOCK = 90; // ticks per millisecond
const WRAP = 2 ** 33;
/** Where the stream starts, as muxers usually do. */
const START_TICKS = 1_400 * TS_CLOCK;

function readTimestamp(b: Buffer, i: number): number {
  return (((b[i] >> 1) & 0x07) * 2 ** 30) + (((b[i + 1] << 7) | (b[i + 2] >> 1)) * 2 ** 15) + ((b[i + 3] << 7) | (b[i + 4] >> 1));
}

function writeTimestamp(b: Buffer, i: number, value: number) {
  const v = ((value % WRAP) + WRAP) % WRAP;
  const high = Math.floor(v / 2 ** 30);
  const mid = Math.floor(v / 2 ** 15) & 0x7fff;
  const low = v & 0x7fff;
  b[i] = (b[i] & 0xf1) | (high << 1) | 1;
  b[i + 1] = mid >> 7;
  b[i + 2] = ((mid & 0x7f) << 1) | 1;
  b[i + 3] = low >> 7;
  b[i + 4] = ((low & 0x7f) << 1) | 1;
}

/** Every PES timestamp and PCR in a TS buffer, visited in place. */
function visit(buf: Buffer, onPts: (at: number, value: number) => void, onPcr: (at: number, base: number) => void) {
  for (let p = 0; p + PACKET <= buf.length; p += PACKET) {
    if (buf[p] !== 0x47) continue;
    const start = (buf[p + 1] & 0x40) !== 0;
    const adaptation = (buf[p + 3] >> 4) & 0x3;
    let payload = p + 4;
    if (adaptation & 0x2) {
      const length = buf[p + 4];
      if (length > 0 && buf[p + 5] & 0x10) {
        const base = buf[p + 6] * 2 ** 25 + ((buf[p + 7] << 17) | (buf[p + 8] << 9) | (buf[p + 9] << 1) | (buf[p + 10] >> 7));
        onPcr(p + 6, base);
      }
      payload = p + 5 + length;
    }
    if (!start || !(adaptation & 0x1) || payload + 14 > p + PACKET) continue;
    if (buf[payload] !== 0 || buf[payload + 1] !== 0 || buf[payload + 2] !== 1) continue;
    const streamId = buf[payload + 3];
    // Streams with the optional PES header (audio, video, private).
    if (!(streamId >= 0xc0 && streamId <= 0xef) && streamId !== 0xbd) continue;
    const flags = buf[payload + 7] >> 6;
    if (flags & 0x2) onPts(payload + 9, readTimestamp(buf, payload + 9));
    if (flags === 0x3) onPts(payload + 14, readTimestamp(buf, payload + 14));
  }
}

/** Where the joined stream carries its program table, picture and sound. */
export const OUT_PID = { pmt: 0x1000, video: 0x100, audio: 0x101 } as const;
const VIDEO_TYPES = new Set([0x01, 0x02, 0x10, 0x1b, 0x24]);
const AUDIO_TYPES = new Set([0x03, 0x04, 0x0f, 0x11, 0x81, 0x87]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 24;
    for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
    t[i] = c >>> 0;
  }
  return t;
})();

/** MPEG-2's CRC-32, over a PSI section. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ b) & 0xff]) >>> 0;
  return crc >>> 0;
}

const pidOf = (b: Buffer, p: number) => ((b[p + 1] & 0x1f) << 8) | b[p + 2];

/** A PSI section (after the pointer field) in a packet that starts one, or null. */
function section(b: Buffer, p: number): Buffer | null {
  if (!(b[p + 1] & 0x40)) return null;
  const adaptation = (b[p + 3] >> 4) & 0x3;
  let at = p + 4;
  if (adaptation & 0x2) at += 1 + b[p + 4];
  if (!(adaptation & 0x1) || at >= p + PACKET) return null;
  at += 1 + b[at];
  if (at + 3 > p + PACKET) return null;
  const length = ((b[at + 1] & 0x0f) << 8) | b[at + 2];
  return at + 3 + length <= p + PACKET ? b.subarray(at, at + 3 + length) : null;
}

/** One TS packet holding one PSI section (padded with 0xff). */
function psiPacket(pid: number, body: number[]): Buffer {
  const out = Buffer.alloc(PACKET, 0xff);
  out[0] = 0x47;
  out[1] = 0x40 | ((pid >> 8) & 0x1f);
  out[2] = pid & 0xff;
  out[3] = 0x10;
  out[4] = 0; // pointer field
  const length = body.length - 3 + 4; // after section_length, with the CRC
  body[1] = (body[1] & 0xf0) | 0x30 | ((length >> 8) & 0x0f);
  body[2] = length & 0xff;
  const crc = crc32(Uint8Array.from(body));
  Buffer.from([...body, (crc >>> 24) & 0xff, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff]).copy(out, 5);
  return out;
}

function patPacket(): Buffer {
  return psiPacket(0, [0x00, 0xb0, 0, 0x00, 0x01, 0xc1, 0x00, 0x00, 0x00, 0x01, 0xe0 | (OUT_PID.pmt >> 8), OUT_PID.pmt & 0xff]);
}

function pmtPacket(pcrPid: number, videoType: number | null, audioType: number | null): Buffer {
  const body = [0x02, 0xb0, 0, 0x00, 0x01, 0xc1, 0x00, 0x00, 0xe0 | (pcrPid >> 8), pcrPid & 0xff, 0xf0, 0x00];
  if (videoType !== null) body.push(videoType, 0xe0 | (OUT_PID.video >> 8), OUT_PID.video & 0xff, 0xf0, 0x00);
  if (audioType !== null) body.push(audioType, 0xe0 | (OUT_PID.audio >> 8), OUT_PID.audio & 0xff, 0xf0, 0x00);
  return psiPacket(OUT_PID.pmt, body);
}

interface Layout {
  pmtPid: number;
  map: Map<number, number>;
  pcrPid: number;
  videoType: number | null;
  audioType: number | null;
}

/** The segment's picture and sound PIDs, from its PAT and PMT (null when it carries neither). */
export function readLayout(buf: Buffer): Layout | null {
  let pmtPid: number | null = null;
  for (let p = 0; p + PACKET <= buf.length; p += PACKET) {
    if (buf[p] !== 0x47) continue;
    const pid = pidOf(buf, p);
    if (pid === 0 && pmtPid === null) {
      const s = section(buf, p);
      if (!s || s[0] !== 0x00) continue;
      for (let i = 8; i + 4 <= s.length - 4; i += 4) {
        const program = (s[i] << 8) | s[i + 1];
        if (program !== 0) {
          pmtPid = ((s[i + 2] & 0x1f) << 8) | s[i + 3];
          break;
        }
      }
    } else if (pmtPid !== null && pid === pmtPid) {
      const s = section(buf, p);
      if (!s || s[0] !== 0x02) continue;
      const pcr = ((s[8] & 0x1f) << 8) | s[9];
      const infoLength = ((s[10] & 0x0f) << 8) | s[11];
      const map = new Map<number, number>();
      let videoType: number | null = null;
      let audioType: number | null = null;
      for (let i = 12 + infoLength; i + 5 <= s.length - 4; ) {
        const type = s[i];
        const es = ((s[i + 1] & 0x1f) << 8) | s[i + 2];
        const esInfo = ((s[i + 3] & 0x0f) << 8) | s[i + 4];
        if (VIDEO_TYPES.has(type) && videoType === null) {
          videoType = type;
          map.set(es, OUT_PID.video);
        } else if (AUDIO_TYPES.has(type) && audioType === null) {
          audioType = type;
          map.set(es, OUT_PID.audio);
        }
        i += 5 + esInfo;
      }
      return { pmtPid, map, pcrPid: map.get(pcr) ?? OUT_PID.video, videoType, audioType };
    }
  }
  return null;
}

export class TsRetimer {
  private layout: Layout | null = null;
  private cc = new Map<number, number>();
  private offset = 0;
  /** The furthest timestamp written, plus a little: where the next item starts. */
  private end = START_TICKS;
  private item: string | null = null;

  /** The segment shifted, in the joined stream's layout. `item` changes at each new item (a discontinuity). */
  retime(buf: Buffer, item: string, durationMs: number): Buffer {
    return this.relayout(this.shift(buf, item, durationMs));
  }

  /** Picture on 0x100, sound on 0x101, one program table; continuity counters carried on. */
  private relayout(buf: Buffer): Buffer {
    this.layout = readLayout(buf) ?? this.layout;
    const layout = this.layout;
    if (!layout) return buf;
    const out: Buffer[] = [patPacket(), pmtPacket(layout.pcrPid, layout.videoType, layout.audioType)];
    for (let p = 0; p + PACKET <= buf.length; p += PACKET) {
      if (buf[p] !== 0x47) continue;
      const to = layout.map.get(pidOf(buf, p));
      if (to === undefined) continue; // the source's own tables, and anything else
      const packet = Buffer.from(buf.subarray(p, p + PACKET));
      packet[1] = (packet[1] & 0xe0) | (to >> 8);
      packet[2] = to & 0xff;
      out.push(packet);
    }
    // Continuity counters, per PID, over the whole joined stream (the tables' too).
    for (const packet of out) {
      const pid = pidOf(packet, 0);
      const hasPayload = (packet[3] >> 4) & 0x1;
      const last = this.cc.get(pid);
      const next = last === undefined ? 0 : hasPayload ? (last + 1) & 0x0f : last;
      packet[3] = (packet[3] & 0xf0) | next;
      this.cc.set(pid, next);
    }
    return Buffer.concat(out);
  }

  /** Shifts a segment's timestamps in place. */
  private shift(buf: Buffer, item: string, durationMs: number): Buffer {
    if (item !== this.item) {
      let first = Number.POSITIVE_INFINITY;
      visit(buf, (_, v) => (first = Math.min(first, v)), () => undefined);
      if (Number.isFinite(first)) this.offset = this.end - first;
      this.item = item;
    }
    let last = 0;
    visit(
      buf,
      (at, v) => {
        writeTimestamp(buf, at, v + this.offset);
        last = Math.max(last, v + this.offset);
      },
      (at, base) => {
        const v = (((base + this.offset) % WRAP) + WRAP) % WRAP;
        buf[at] = Math.floor(v / 2 ** 25) & 0xff;
        buf[at + 1] = Math.floor(v / 2 ** 17) & 0xff;
        buf[at + 2] = Math.floor(v / 2 ** 9) & 0xff;
        buf[at + 3] = Math.floor(v / 2) & 0xff;
        buf[at + 4] = (buf[at + 4] & 0x7f) | ((v & 1) << 7);
      }
    );
    // The next item starts just after this one's last timestamp (a segment with none: after its length).
    this.end = last ? Math.max(this.end, last + 40 * TS_CLOCK) : this.end + durationMs * TS_CLOCK;
    return buf;
  }
}
