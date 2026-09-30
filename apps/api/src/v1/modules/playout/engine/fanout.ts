// Where a station's relay stream goes (follow-up Phase 3). The sender (sender.ts) makes one MPEG-TS
// stream per station, in real time; the fan-out pushes it over RTMP, one FFmpeg "pusher" per
// destination, stream-copied (TS in, FLV out, nothing re-encoded):
//
//   - `livepeer` (the default): one pusher, to the station's Livepeer relay stream, which Livepeer
//     sends on to every platform with its multistream targets;
//   - `direct` (the fallback, RELAY_FAN_OUT=direct): one pusher per platform.
//
// A pusher that drops is started again on its own (every few seconds), joining the stream where it
// is; the others, and the sender, carry on. `restart(id)` restarts one pusher on purpose (a
// platform's limit, in direct mode): only that platform reconnects.

import { spawn, type ChildProcess } from "node:child_process";

export interface FanoutDestination {
  /** A platform's ID (direct), or `livepeer`. */
  id: string;
  /** Full RTMP(S) address, with the key: never logged. */
  url: string;
}

interface Pusher {
  dest: FanoutDestination;
  child: ChildProcess | null;
  /** Bytes sent by earlier runs of this pusher. */
  before: number;
  /** The current run's bytes (FFmpeg's total_size), counted into `before` when it ends. */
  run: { bytes: number } | null;
  startedAt: number;
  lastStart: number;
  /** Held back until then (a restart's gap). */
  holdUntil: number;
  lastError: string | null;
  errors: number;
  /** Connections made (1 for a push that never dropped). */
  starts: number;
}

/** A sink for the sender's stream: the fan-out, or anything that takes bytes (tests). */
export interface RelayOutput {
  write(chunk: Buffer): void;
  /** Bytes sent to every destination (egress), since it was made. */
  bytes(): number;
  /** How many places it sends to. */
  readonly destinations: number;
}

const RESPAWN_MS = 3_000;
/** Pushers stopped on purpose (their exit isn't an error). */
const stopping = new WeakSet<ChildProcess>();
/** A pusher that can't keep up with this much waiting is started again (a stuck connection). */
const MAX_BUFFERED = 16 * 1024 * 1024;

/** Strips the key from an RTMP address for logs. */
export function redact(url: string): string {
  return url.replace(/^(rtmps?:\/\/[^/]+\/[^/]*)\/.*$/i, "$1/…");
}

export class Fanout implements RelayOutput {
  private pushers = new Map<string, Pusher>();
  private closed = false;

  constructor(
    destinations: FanoutDestination[],
    private options: { log?(line: string): void; respawnMs?: number } = {}
  ) {
    this.set(destinations);
  }

  get destinations() {
    return this.pushers.size;
  }

  ids() {
    return [...this.pushers.keys()];
  }

  /** Adds, removes or re-points pushers (a changed address restarts only that one). */
  set(destinations: FanoutDestination[]) {
    const wanted = new Map(destinations.map((d) => [d.id, d]));
    for (const [id, p] of this.pushers) {
      const next = wanted.get(id);
      if (!next) {
        this.stop(p);
        this.pushers.delete(id);
      } else if (next.url !== p.dest.url) {
        p.dest = next;
        this.stop(p);
      }
    }
    for (const d of destinations) {
      if (!this.pushers.has(d.id)) this.pushers.set(d.id, { dest: d, child: null, before: 0, run: null, startedAt: 0, lastStart: 0, holdUntil: 0, lastError: null, errors: 0, starts: 0 });
    }
  }

  write(chunk: Buffer) {
    if (this.closed) return;
    for (const p of this.pushers.values()) {
      if (!p.child && Date.now() >= p.holdUntil && Date.now() - p.lastStart >= (this.options.respawnMs ?? RESPAWN_MS)) this.start(p);
      const stdin = p.child?.stdin;
      if (!stdin || stdin.destroyed || !stdin.writable) continue;
      if (stdin.writableLength > MAX_BUFFERED) {
        p.lastError = "The destination stopped taking the stream";
        this.stop(p);
        continue;
      }
      stdin.write(chunk);
    }
  }

  /** Restarts one destination's push (a platform limit): it's held off for `gapMs`, the others carry on. */
  async restart(id: string, gapMs = 3_000) {
    const p = this.pushers.get(id);
    if (!p) return false;
    p.holdUntil = Date.now() + gapMs;
    this.stop(p);
    return true;
  }

  bytes() {
    let total = 0;
    for (const p of this.pushers.values()) total += p.before + (p.run?.bytes ?? 0);
    return total;
  }

  /** Per destination: running, bytes, errors. */
  status() {
    return [...this.pushers.values()].map((p) => ({ id: p.dest.id, running: Boolean(p.child), bytes: p.before + (p.run?.bytes ?? 0), errors: p.errors, starts: p.starts, lastError: p.lastError, since: p.startedAt || null }));
  }

  async close() {
    this.closed = true;
    await Promise.all([...this.pushers.values()].map((p) => this.stop(p, true)));
  }

  private start(p: Pusher) {
    p.lastStart = Date.now();
    p.starts++;
    const args = [
      "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1",
      "-f", "mpegts", "-i", "pipe:0",
      "-map", "0:v?", "-map", "0:a?", "-c", "copy", "-bsf:a", "aac_adtstoasc",
      "-f", "flv", "-flvflags", "no_duration_filesize", p.dest.url
    ];
    const child = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "pipe"] });
    const run = { bytes: 0 };
    p.child = child;
    p.run = run;
    p.startedAt = Date.now();
    child.stdin?.on("error", () => undefined);
    let progress = "";
    child.stdout?.on("data", (d) => {
      progress += String(d);
      const lines = progress.split("\n");
      progress = lines.pop() ?? "";
      for (const line of lines) {
        const m = /^total_size=(\d+)/.exec(line);
        if (m) run.bytes = Number(m[1]);
      }
    });
    let lastError = "";
    child.stderr?.on("data", (d) => (lastError = String(d).trim().slice(-300)));
    child.on("error", (error) => {
      p.lastError = error.message;
    });
    child.on("close", (code) => {
      p.before += run.bytes;
      if (p.run === run) p.run = null;
      if (p.child === child) p.child = null;
      if (code && !this.closed && !stopping.has(child)) {
        p.errors++;
        // FFmpeg's own words, without the address (it holds the key).
        p.lastError = lastError.split(p.dest.url).join(redact(p.dest.url)) || `ffmpeg exited ${code}`;
        this.options.log?.(`[fanout] ${p.dest.id} (${redact(p.dest.url)}) dropped: ${p.lastError}`);
      }
    });
  }

  private stop(p: Pusher, wait = false): Promise<void> {
    const child = p.child;
    if (!child) return Promise.resolve();
    p.child = null;
    stopping.add(child);
    return new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const kill = setTimeout(() => child.kill("SIGKILL"), wait ? 5_000 : 1_000);
      child.once("close", () => {
        clearTimeout(kill);
        resolve();
      });
      child.stdin?.end();
      if (!wait) child.kill("SIGTERM");
    });
  }
}
