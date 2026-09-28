// SCTE-35 splice_insert cues for breaks, as HLS EXT-X-DATERANGE tags carry them:
// SCTE35-OUT when a break starts (out of network), SCTE35-IN when it ends.
// Encodes the binary splice_info_section (ANSI/SCTE 35) and its CRC-32/MPEG-2.

export interface SpliceInsert {
  eventId: number;
  /** true: leaving the program for the break. false: returning. */
  outOfNetwork: boolean;
  /** Break length, for the OUT cue. */
  durationMs?: number;
  /** Returning automatically when the duration ends. */
  autoReturn?: boolean;
}

const TICKS_PER_MS = 90; // 90 kHz clock

class BitWriter {
  private bytes: number[] = [];
  private current = 0;
  private filled = 0;

  write(value: number | bigint, bits: number) {
    const v = BigInt(value);
    for (let i = bits - 1; i >= 0; i--) {
      this.current = (this.current << 1) | Number((v >> BigInt(i)) & 1n);
      this.filled++;
      if (this.filled === 8) {
        this.bytes.push(this.current);
        this.current = 0;
        this.filled = 0;
      }
    }
  }

  toBytes(): number[] {
    if (this.filled) throw new Error("Not byte aligned");
    return this.bytes;
  }
}

/** CRC-32/MPEG-2: polynomial 0x04C11DB7, initial 0xFFFFFFFF, no reflection, no final XOR. */
export function crc32Mpeg2(bytes: number[] | Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte << 24;
    for (let i = 0; i < 8; i++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
    crc >>>= 0;
  }
  return crc >>> 0;
}

export function encodeSpliceInsert(cue: SpliceInsert): Uint8Array {
  // splice_insert() command
  const cmd = new BitWriter();
  cmd.write(cue.eventId >>> 0, 32); // splice_event_id
  cmd.write(0, 1); // splice_event_cancel_indicator
  cmd.write(0x7f, 7); // reserved
  cmd.write(cue.outOfNetwork ? 1 : 0, 1); // out_of_network_indicator
  cmd.write(1, 1); // program_splice_flag
  const hasDuration = cue.outOfNetwork && cue.durationMs !== undefined;
  cmd.write(hasDuration ? 1 : 0, 1); // duration_flag
  cmd.write(1, 1); // splice_immediate_flag (the tag's START-DATE says when)
  cmd.write(0xf, 4); // reserved
  if (hasDuration) {
    cmd.write(cue.autoReturn === false ? 0 : 1, 1); // auto_return
    cmd.write(0x3f, 6); // reserved
    cmd.write(BigInt(Math.round(cue.durationMs! * TICKS_PER_MS)), 33); // duration
  }
  cmd.write(0, 16); // unique_program_id
  cmd.write(0, 8); // avail_num
  cmd.write(0, 8); // avails_expected
  const command = cmd.toBytes();

  // splice_info_section() around it
  const body = new BitWriter();
  body.write(0, 8); // protocol_version
  body.write(0, 1); // encrypted_packet
  body.write(0, 6); // encryption_algorithm
  body.write(0, 33); // pts_adjustment
  body.write(0, 8); // cw_index
  body.write(0xfff, 12); // tier
  body.write(command.length, 12); // splice_command_length
  body.write(0x05, 8); // splice_command_type: splice_insert
  const afterCommandType = body.toBytes();
  const descriptorLoop = [0x00, 0x00]; // descriptor_loop_length = 0

  const payload = [...afterCommandType, ...command, ...descriptorLoop];
  const sectionLength = payload.length + 4; // + CRC
  const header = [0xfc, 0x30 | ((sectionLength >> 8) & 0x0f), sectionLength & 0xff]; // table_id, syntax=0, private=0, sap=11
  const withoutCrc = [...header, ...payload];
  const crc = crc32Mpeg2(withoutCrc);
  return Uint8Array.from([...withoutCrc, (crc >>> 24) & 0xff, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff]);
}

export const toHex = (bytes: Uint8Array) => `0x${Buffer.from(bytes).toString("hex").toUpperCase()}`;

/** Reads back what `encodeSpliceInsert` writes (for tests and the playlist checker). */
export function decodeSpliceInsert(bytes: Uint8Array): SpliceInsert & { crcOk: boolean } {
  if (bytes[0] !== 0xfc) throw new Error("Not a splice_info_section");
  const sectionLength = ((bytes[1] & 0x0f) << 8) | bytes[2];
  const end = 3 + sectionLength;
  const crcOk = crc32Mpeg2(bytes.subarray(0, end)) === 0;
  const commandType = bytes[13];
  if (commandType !== 0x05) throw new Error("Not a splice_insert");
  let i = 14;
  const eventId = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
  i += 5;
  const flags = bytes[i];
  const outOfNetwork = Boolean(flags & 0x80);
  const durationFlag = Boolean(flags & 0x20);
  i += 1;
  let durationMs: number | undefined;
  let autoReturn: boolean | undefined;
  if (durationFlag) {
    autoReturn = Boolean(bytes[i] & 0x80);
    const high = BigInt(bytes[i] & 0x01);
    const rest = BigInt((bytes[i + 1] << 24) | (bytes[i + 2] << 16) | (bytes[i + 3] << 8) | bytes[i + 4]) & 0xffffffffn;
    durationMs = Number(((high << 32n) | rest) / BigInt(TICKS_PER_MS));
  }
  return { eventId, outOfNetwork, durationMs, autoReturn, crcOk };
}

/** The EXT-X-DATERANGE tag pair for one break. */
export function breakDateRanges(input: { id: string; startsAt: Date; durationMs: number; eventId: number }): string[] {
  const out = toHex(encodeSpliceInsert({ eventId: input.eventId, outOfNetwork: true, durationMs: input.durationMs, autoReturn: true }));
  const back = toHex(encodeSpliceInsert({ eventId: input.eventId, outOfNetwork: false }));
  const seconds = (input.durationMs / 1000).toFixed(3);
  return [
    `#EXT-X-DATERANGE:ID="${input.id}",START-DATE="${input.startsAt.toISOString()}",PLANNED-DURATION=${seconds},SCTE35-OUT=${out}`,
    `#EXT-X-DATERANGE:ID="${input.id}",START-DATE="${input.startsAt.toISOString()}",DURATION=${seconds},SCTE35-IN=${back}`
  ];
}

/**
 * Adds the cues to a live HLS playlist. Tags go before the first segment,
 * as the spec allows DATERANGE anywhere in a media playlist; players match
 * them to segments by PROGRAM-DATE-TIME.
 */
export function decoratePlaylist(playlist: string, breaks: Array<{ id: string; startsAt: Date; durationMs: number; eventId: number }>): string {
  if (!breaks.length) return playlist;
  const lines = playlist.split("\n");
  const first = lines.findIndex((l) => l.startsWith("#EXTINF") || l.startsWith("#EXT-X-PROGRAM-DATE-TIME"));
  const at = first < 0 ? lines.length : first;
  const tags = breaks.flatMap((b) => breakDateRanges(b));
  return [...lines.slice(0, at), ...tags, ...lines.slice(at)].join("\n");
}
