// A live source, read ahead of its block: from Livepeer's playback, or from a local
// RTMP listener an encoder pushes to. The feed is remuxed to MPEG-TS and kept open
// (restarted when the source drops), so an encoder can connect early or reconnect,
// and the runner can tell at any moment whether there's a signal to air.

import { spawn, type ChildProcess } from "node:child_process";
import type { Writable } from "node:stream";

/** No bytes for this long and the source counts as lost. */
const SIGNAL_GAP_MS = 2_000;

export interface LiveInput {
  url: string;
  listen: boolean;
}

export class LiveFeed {
  private child?: ChildProcess;
  private lastData = 0;
  private sink?: Writable;
  private stopped = false;
  private retry?: NodeJS.Timeout;

  constructor(
    readonly input: LiveInput,
    private log: (line: string) => void
  ) {}

  start() {
    if (this.stopped || this.child) return;
    const read = this.input.listen ? ["-listen", "1", "-i", this.input.url] : ["-rw_timeout", "5000000", "-i", this.input.url];
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", ...read, "-map", "0", "-c", "copy", "-f", "mpegts", "pipe:1"], { stdio: ["ignore", "pipe", "pipe"] });
    this.child = child;
    child.stdout?.on("data", (chunk: Buffer) => {
      this.lastData = Date.now();
      // Nobody on air from it (a break, or before the block): the feed is dropped, not queued.
      if (this.sink && !this.sink.writableEnded) this.sink.write(chunk);
    });
    child.stderr?.on("data", (d) => {
      const text = String(d).trim();
      if (text && !this.stopped) this.log(`live: ${text.slice(0, 200)}`);
    });
    child.on("close", () => {
      this.child = undefined;
      this.lastData = 0;
      // Listen again at once (the encoder may reconnect); pull again after a pause.
      if (!this.stopped) this.retry = setTimeout(() => this.start(), this.input.listen ? 200 : 2_000);
    });
    child.on("error", () => undefined);
  }

  get connected() {
    return Date.now() - this.lastData < SIGNAL_GAP_MS;
  }

  attach(sink: Writable) {
    sink.on("error", () => undefined);
    this.sink = sink;
  }

  detach(sink: Writable) {
    if (this.sink === sink) this.sink = undefined;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
    this.child?.kill("SIGTERM");
  }
}
