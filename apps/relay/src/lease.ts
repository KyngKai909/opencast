// One relay instance sends at a time: a lease in Redis, renewed every tick (a second instance, say
// during a redeploy or a move to another host, waits until the first lets go). Without REDIS_URL
// the instance is always the one sending: run one.

import { createClient } from "redis";

export interface LeaseStore {
  set(key: string, value: string, options: { NX?: true; XX?: true; EX: number }): Promise<string | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
}

export interface Lease {
  refresh(): Promise<boolean>;
  release(): Promise<void>;
  close(): Promise<void>;
}

/** A lease on `key` held by `instance`. No store: always held. A store that fails: held (a relay that can't reach Redis keeps relaying). */
export function createLease(store: LeaseStore | null, key: string, instance: string, ttlSec: number, log: (line: string) => void = console.warn): Lease {
  return {
    async refresh() {
      if (!store) return true;
      try {
        if ((await store.set(key, instance, { NX: true, EX: ttlSec })) === "OK") return true;
        if ((await store.get(key)) !== instance) return false;
        return (await store.set(key, instance, { XX: true, EX: ttlSec })) === "OK";
      } catch (error) {
        log(`[relay] the lease couldn't be renewed (${(error as Error).message}); carrying on`);
        return true;
      }
    },
    async release() {
      if (!store) return;
      try {
        if ((await store.get(key)) === instance) await store.del(key);
      } catch {
        // Expires on its own.
      }
    },
    async close() {
      // The store's connection is closed by whoever opened it.
    }
  };
}

/** Redis, when REDIS_URL is set. */
export async function redisStore(url: string | null, log: (line: string) => void = console.warn): Promise<{ store: LeaseStore | null; close(): Promise<void> }> {
  if (!url) return { store: null, close: async () => undefined };
  const client = createClient({ url, socket: { connectTimeout: 3_000 } });
  client.on("error", (error) => log(`[relay] Redis: ${error.message}`));
  try {
    await client.connect();
  } catch (error) {
    log(`[relay] Redis unavailable (${(error as Error).message}): relaying without a lease`);
    return { store: null, close: async () => undefined };
  }
  return {
    store: {
      set: (key, value, options) => (options.NX ? client.set(key, value, { NX: true, EX: options.EX }) : options.XX ? client.set(key, value, { XX: true, EX: options.EX }) : client.set(key, value, { EX: options.EX })) as Promise<string | null>,
      get: (key) => client.get(key),
      del: (key) => client.del(key)
    },
    close: async () => {
      await client.disconnect().catch(() => undefined);
    }
  };
}
