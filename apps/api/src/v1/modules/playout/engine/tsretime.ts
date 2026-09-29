// Joins MPEG-TS segments from different items into one continuous stream. Each prepared item's
// timestamps start again near zero, so a relay reading the channel's segments one after another
// would see time jump back at every item. This shifts every PTS, DTS and PCR in a segment by one
// offset per item, so each item carries on where the last one ended, and the relay can stream-copy.

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

export class TsRetimer {
  private offset = 0;
  /** The furthest timestamp written, plus a little: where the next item starts. */
  private end = START_TICKS;
  private item: string | null = null;

  /** Shifts a segment in place. `item` changes at each new item (a discontinuity). */
  retime(buf: Buffer, item: string, durationMs: number): Buffer {
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
