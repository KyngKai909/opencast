// A radio relay's picture, without FFmpeg: the spot's code (its `code` DATERANGE) shows over the
// loop from the keyframe nearest its start to the keyframe nearest its end; loops switch only at
// keyframes; the picture's frames are laid under the joined sound as one TS stream (picture on
// 0x100, sound on 0x101, continuity counters running on). And where a TV relay draws the code
// into a segment, in the segment's own seconds.
import { describe, expect, it } from "vitest";
import { dateRangeTag, HLS_CLASS } from "@opencast/contracts";
import { accessUnits, PictureTrack, RelayMuxer, type AccessUnit, type VideoFrame } from "../src/v1/modules/playout/engine/background.js";
import { liveObjectPrefixes } from "../src/v1/modules/playout/engine/assemble.js";
import { codeInSegment, codeWindow } from "../src/v1/modules/playout/engine/sender.js";

const FRAME = 3_000; // 90 kHz ticks at 30 fps

/** A fake loop: `n` frames, a keyframe every 60, each frame's bytes naming its loop and index. */
function loop(name: string, n = 150): AccessUnit[] {
  return Array.from({ length: n }, (_, i) => ({ key: i % 60 === 0, data: Buffer.concat([Buffer.from([0, 0, 0, 1, 0x09, 0xf0]), Buffer.from(`${name}${i}`)]) }));
}

function pes(pid: number, pts: number, bytes: number): Buffer[] {
  // A PES with a PTS, over as many packets as it takes (no stuffing needed for a test).
  const head = Buffer.alloc(14);
  head.set([0, 0, 1, 0xc0, 0, 0, 0x80, 0x80, 5]);
  const v = pts;
  head[9] = 0x21 | ((Math.floor(v / 2 ** 30) & 0x7) << 1);
  head[10] = (Math.floor(v / 2 ** 22) & 0xff);
  head[11] = ((Math.floor(v / 2 ** 15) & 0x7f) << 1) | 1;
  head[12] = (Math.floor(v / 2 ** 7) & 0xff);
  head[13] = ((v & 0x7f) << 1) | 1;
  const payload = Buffer.concat([head, Buffer.alloc(bytes, 0x55)]);
  const out: Buffer[] = [];
  for (let at = 0, first = true; at < payload.length; at += 184, first = false) {
    const p = Buffer.alloc(188, 0xff);
    p[0] = 0x47;
    p[1] = (first ? 0x40 : 0) | (pid >> 8);
    p[2] = pid & 0xff;
    p[3] = 0x10;
    payload.copy(p, 4, at, Math.min(payload.length, at + 184));
    out.push(p);
  }
  return out;
}

describe("the code on a radio relay", () => {
  const start = Date.parse("2026-10-01T20:00:00.000Z");
  const tag = dateRangeTag({ id: "row-code", class: HLS_CLASS.code, start: start + 5_000, durationSeconds: 10, attributes: { spotId: "s", code: "WAVE10", offer: "10% off", qrUrl: "https://app.opencast.test/c/WAVE10?s=x" } });

  it("reads the spot's code and its times from the row's tags", () => {
    const code = codeWindow([tag])!;
    expect(code).toMatchObject({ code: "WAVE10", offer: "10% off", start: start + 5_000, end: start + 15_000 });
    expect(codeWindow(["#EXT-X-DATERANGE:ID=\"x\",CLASS=\"org.useopencast.bug\",START-DATE=\"2026-10-01T20:00:00.000Z\",DURATION=4"])).toBeNull();
  });

  it("switches to the code's loop at the keyframe nearest its start, and back at the one nearest its end", () => {
    const code = codeWindow([tag])!;
    const track = new PictureTrack(loop("b"));
    track.add(code.key, loop("c"));
    const first = 126_000;
    const frames: VideoFrame[] = [];
    // Four-second segments of sound, as the relay joins them, mapped to the channel's time.
    for (let s = 0; s < 5; s++) {
      const segFirst = first + s * 4_000 * 90;
      const segStart = start + s * 4_000;
      const wanted = (pts: number) => {
        const t = segStart + (pts - segFirst) / 90;
        return t >= code.start && t < code.end ? code.key : "base";
      };
      frames.push(...track.frames(segFirst, segFirst + 4_000 * 90, wanted));
    }
    expect(frames).toHaveLength(600);
    const onCode = frames.filter((f) => f.loop === code.key);
    // From 4 s (the keyframe nearest 5 s) to 14 s (nearest 15 s): ten seconds of it.
    expect(onCode).toHaveLength(300);
    expect((onCode[0].pts - first) / 90).toBe(4_000);
    expect((onCode[onCode.length - 1].pts + FRAME - first) / 90).toBe(14_000);
    // Only ever at keyframes, and the loop's frames run on across the switch.
    const switches = frames.filter((f, i) => i > 0 && f.loop !== frames[i - 1].loop);
    expect(switches.every((f) => f.au.key)).toBe(true);
    expect(onCode[0].au.data.toString().endsWith("c120")).toBe(true);
    expect(frames[0].au.data.toString().endsWith("b0")).toBe(true);
    expect(frames[150].au.data.toString().endsWith("c0")).toBe(true);
    expect(frames[450].au.data.toString().endsWith("b0")).toBe(true);
    expect(track.sent.get(code.key)).toBe(300);
  });

  it("stays on the loop showing while a code's isn't ready, and refuses one that doesn't line up", () => {
    const track = new PictureTrack(loop("b"));
    const frames = track.frames(0, 4_000 * 90, () => "code:not-ready");
    expect(frames.every((f) => f.loop === "base")).toBe(true);
    expect(() => track.add("code:x", loop("c", 149))).toThrow();
  });
});

describe("a TV relay's code", () => {
  it("is drawn into the segments it shows in, in each one's own seconds", () => {
    const code = { key: "k", start: 10_000, end: 20_000, code: "X", offer: "", qrUrl: "" };
    // A 15-second spot from 5 s, in 4-second segments: the code's last 10 s are in the last three.
    expect(codeInSegment(code, 5_000, 4_000, 1.4)).toBeNull();
    expect(codeInSegment(code, 9_000, 4_000, 1.4)).toEqual({ from: 2.4, to: 5.4 });
    expect(codeInSegment(code, 13_000, 4_000, 5.4)).toEqual({ from: 5.4, to: 9.4 });
    expect(codeInSegment(code, 17_000, 3_000, 9.4)).toEqual({ from: 9.4, to: 12.4 });
  });
});

describe("laying the picture under the sound", () => {
  it("interleaves the frames with the sound by time, in one program, the counters running on", () => {
    const track = new PictureTrack(loop("b", 60));
    const muxer = new RelayMuxer();
    const out: Buffer[] = [];
    for (let s = 0; s < 2; s++) {
      const base = 126_000 + s * 4_000 * 90;
      // Sound as tsretime leaves it: PES on 0x101, a frame of AAC every 21⅓ ms.
      const sound = Buffer.concat(Array.from({ length: 10 }, (_, i) => pes(0x101, base + i * 36_000, 300)).flat());
      out.push(muxer.mux(sound, track.frames(base, base + 4_000 * 90, () => "base")));
    }
    const ts = Buffer.concat(out);
    expect(ts.length % 188).toBe(0);
    const pids = new Map<number, number[]>();
    const starts: Array<{ pid: number; pts: number }> = [];
    for (let p = 0; p < ts.length; p += 188) {
      expect(ts[p]).toBe(0x47);
      const pid = ((ts[p + 1] & 0x1f) << 8) | ts[p + 2];
      const cc = ts[p + 3] & 0x0f;
      pids.set(pid, [...(pids.get(pid) ?? []), cc]);
      if (ts[p + 1] & 0x40 && (pid === 0x100 || pid === 0x101)) {
        const af = (ts[p + 3] >> 4) & 0x2 ? 1 + ts[p + 4] : 0;
        const at = p + 4 + af;
        expect(ts.subarray(at, at + 3)).toEqual(Buffer.from([0, 0, 1]));
        const b = ts.subarray(at + 9, at + 14);
        const pts = ((b[0] >> 1) & 0x07) * 2 ** 30 + ((b[1] << 7) | (b[2] >> 1)) * 2 ** 15 + ((b[3] << 7) | (b[4] >> 1));
        starts.push({ pid, pts });
      }
    }
    expect([...pids.keys()].sort()).toEqual([0, 0x100, 0x101, 0x1000]);
    // The picture's counters run on over both calls (no gaps).
    const video = pids.get(0x100)!;
    expect(video.every((cc, i) => i === 0 || cc === ((video[i - 1] + 1) & 0x0f))).toBe(true);
    // 8 s of 30 fps pictures and every sound PES, in time order.
    expect(starts.filter((s) => s.pid === 0x100)).toHaveLength(240);
    expect(starts.filter((s) => s.pid === 0x101)).toHaveLength(20);
    expect(starts.every((s, i) => i === 0 || s.pts >= starts[i - 1].pts || s.pid !== starts[i - 1].pid)).toBe(true);
    const order = starts.map((s) => s.pts);
    expect(order.every((v, i) => i === 0 || v >= order[i - 1] - FRAME)).toBe(true);
  });

  it("splits H.264 into access units at their delimiters", () => {
    const nal = (type: number, n = 4) => Buffer.concat([Buffer.from([0, 0, 0, 1, type]), Buffer.alloc(n, 0x11)]);
    const stream = Buffer.concat([nal(0x09), nal(0x67), nal(0x68), nal(0x65, 40), nal(0x09), nal(0x41, 20), nal(0x09), nal(0x41, 20)]);
    const units = accessUnits(stream);
    expect(units.map((u) => u.key)).toEqual([true, false, false]);
    expect(Buffer.concat(units.map((u) => u.data))).toEqual(stream);
  });
});

describe("live segments the worker stored", () => {
  it("are found by their session, to go when their rows do", () => {
    expect(
      liveObjectPrefixes([
        { a128: ["https://media.test/prepared/live-abc123def456-mun4o23y1/a128/seg_00000.ts", "https://media.test/prepared/live-abc123def456-mun4o23y1/a128/seg_00001.ts"], a64: ["/objects/prepared/live-abc123def456-mun4o23y1/a64/seg_00000.ts"] },
        { v720: ["https://livepeer.test/hls/x/720p0/1.ts"], a128: ["/hls/prepared/live-abc123def456-mv0000002/a128/seg_00007.ts"] },
        null
      ]).sort()
    ).toEqual(["prepared/live-abc123def456-mun4o23y1", "prepared/live-abc123def456-mv0000002"]);
  });
});
