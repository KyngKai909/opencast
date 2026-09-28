// The worker's cache of files, on its volume. Every hour it reads the next 48 hours of
// every station's log (and what each could air in a break) and copies in any content
// ID it doesn't have, earliest airtime first. When space runs short it evicts what
// airs furthest in the future, or never. Nothing at air time waits on a download:
// playout reads only what's here.

import { promises as fs } from "node:fs";
import path from "node:path";

export interface Need {
  cid: string;
  bytes: number;
  /** When it next airs. Station IDs, bumpers and spots in rotation can air any time: now. */
  airsAt: Date;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number | null;
  files: number;
  bytesCached: number;
  capacityBytes: number;
  lastSyncAt: string | null;
  /** Needed in the window but not here (didn't fit, or the copy failed). */
  pending: number;
  fetchFailures: number;
}

const CID = /^b[a-z2-7]{58}$/;

export class ContentCache {
  private files = new Map<string, { bytes: number }>();
  private hits = 0;
  private misses = 0;
  private fetchFailures = 0;
  private lastSyncAt: Date | null = null;
  private pending = 0;
  private syncing?: Promise<void>;

  constructor(
    readonly dir: string,
    readonly capacityBytes: number,
    private fetch: (cid: string, dest: string) => Promise<void>,
    private log: (line: string) => void = () => undefined
  ) {}

  /** Reads what's already on the volume (a restart keeps the cache). */
  async init() {
    await fs.mkdir(this.dir, { recursive: true });
    for (const name of await fs.readdir(this.dir)) {
      const file = path.join(this.dir, name);
      if (name.endsWith(".part")) {
        await fs.rm(file, { force: true });
        continue;
      }
      if (!CID.test(name)) continue;
      const { size } = await fs.stat(file);
      this.files.set(name, { bytes: size });
    }
  }

  ids() {
    return [...this.files.keys()];
  }

  has(cid: string) {
    return this.files.has(cid);
  }

  pathOf(cid: string) {
    return path.join(this.dir, cid);
  }

  /** At air: the file, or null (a miss; the log's usual fill airs instead). */
  take(cid: string): string | null {
    if (this.files.has(cid)) {
      this.hits++;
      return this.pathOf(cid);
    }
    this.misses++;
    return null;
  }

  get bytesCached() {
    let total = 0;
    for (const f of this.files.values()) total += f.bytes;
    return total;
  }

  stats(): CacheStats {
    const served = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: served ? this.hits / served : null,
      files: this.files.size,
      bytesCached: this.bytesCached,
      capacityBytes: this.capacityBytes,
      lastSyncAt: this.lastSyncAt?.toISOString() ?? null,
      pending: this.pending,
      fetchFailures: this.fetchFailures
    };
  }

  async evict(cid: string) {
    if (!this.files.delete(cid)) return;
    await fs.rm(this.pathOf(cid), { force: true });
  }

  /**
   * Copies in what's needed, earliest airtime first. `gone` are content IDs taken down
   * or deleted: they leave the cache whatever else is true.
   */
  sync(needs: Need[], gone: string[] = []): Promise<void> {
    if (this.syncing) return this.syncing;
    this.syncing = this.run(needs, gone).finally(() => (this.syncing = undefined));
    return this.syncing;
  }

  private async run(needs: Need[], gone: string[]) {
    for (const cid of gone) await this.evict(cid);
    // One entry per file, at its earliest airtime.
    const next = new Map<string, Need>();
    for (const need of needs) {
      const seen = next.get(need.cid);
      if (!seen || need.airsAt < seen.airsAt) next.set(need.cid, need);
    }
    const ordered = [...next.values()].sort((a, b) => a.airsAt.getTime() - b.airsAt.getTime());
    let pending = 0;
    for (const need of ordered) {
      if (this.files.has(need.cid)) continue;
      if (!(await this.makeRoom(need, next))) {
        pending++;
        continue;
      }
      try {
        await this.fetch(need.cid, this.pathOf(need.cid));
        const { size } = await fs.stat(this.pathOf(need.cid));
        this.files.set(need.cid, { bytes: size });
      } catch (error) {
        pending++;
        this.fetchFailures++;
        this.log(`[cache] couldn't copy ${need.cid}: ${(error as Error).message}`);
      }
    }
    this.pending = pending;
    this.lastSyncAt = new Date();
  }

  /** Evicts what airs furthest away (or never) until `need` fits; never anything needed sooner. */
  private async makeRoom(need: Need, next: Map<string, Need>) {
    if (need.bytes > this.capacityBytes) return false;
    while (this.bytesCached + need.bytes > this.capacityBytes) {
      let victim: { cid: string; at: number } | null = null;
      for (const cid of this.files.keys()) {
        const at = next.get(cid)?.airsAt.getTime() ?? Number.POSITIVE_INFINITY;
        if (at <= need.airsAt.getTime()) continue;
        if (!victim || at > victim.at) victim = { cid, at };
      }
      if (!victim) return false;
      await this.evict(victim.cid);
    }
    return true;
  }
}
