// The remote relay's message bus: a TV's stream and its phones' streams may be open on different
// API instances, so messages go through a bus. In one process it's a map of listeners; with
// REDIS_URL it's Redis pub/sub (every instance subscribes to the channels its open streams need).
// Delivery is at most once: a message published while nobody listens is gone, as on Cast.

import { createClient } from "redis";

export interface RelayMessage {
  event: string;
  data: unknown;
  /** Only for these phones (a phone channel carries messages for every phone of a TV). */
  only?: { phoneId?: string; kind?: "account" | "guest" };
}

export interface RelayBus {
  readonly kind: "memory" | "redis";
  publish(channel: string, message: RelayMessage): Promise<void>;
  /** Resolves once the subscription is live; returns the unsubscribe. */
  subscribe(channel: string, listener: (message: RelayMessage) => void): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

export function memoryRelayBus(): RelayBus {
  const listeners = new Map<string, Set<(message: RelayMessage) => void>>();
  return {
    kind: "memory",
    async publish(channel, message) {
      // A copy each, as Redis would give: a listener can't change what another one sees.
      const text = JSON.stringify(message);
      for (const listener of [...(listeners.get(channel) ?? [])]) {
        queueMicrotask(() => listener(JSON.parse(text) as RelayMessage));
      }
    },
    async subscribe(channel, listener) {
      const set = listeners.get(channel) ?? new Set();
      set.add(listener);
      listeners.set(channel, set);
      return async () => {
        set.delete(listener);
        if (!set.size) listeners.delete(channel);
      };
    },
    async close() {
      listeners.clear();
    }
  };
}

type RedisClient = ReturnType<typeof createClient>;

/** Redis pub/sub. Connects on first use, so a process that never relays (the worker) never connects. */
export function redisRelayBus(url: string, prefix = "opencast:relay:"): RelayBus {
  let clients: Promise<{ pub: RedisClient; sub: RedisClient }> | undefined;
  const listeners = new Map<string, Set<(message: RelayMessage) => void>>();

  const connect = () => {
    clients ??= (async () => {
      const pub = createClient({ url });
      pub.on("error", (error) => console.warn(`[relay] Redis: ${(error as Error).message}`));
      const sub = pub.duplicate();
      sub.on("error", (error) => console.warn(`[relay] Redis: ${(error as Error).message}`));
      await Promise.all([pub.connect(), sub.connect()]);
      return { pub, sub };
    })().catch((error) => {
      clients = undefined;
      throw error;
    });
    return clients;
  };

  const deliver = (channel: string) => (raw: string) => {
    let message: RelayMessage;
    try {
      message = JSON.parse(raw) as RelayMessage;
    } catch {
      return;
    }
    for (const listener of [...(listeners.get(channel) ?? [])]) listener(message);
  };

  return {
    kind: "redis",
    async publish(channel, message) {
      const { pub } = await connect();
      await pub.publish(prefix + channel, JSON.stringify(message));
    },
    async subscribe(channel, listener) {
      const { sub } = await connect();
      let set = listeners.get(channel);
      if (!set) {
        set = new Set();
        listeners.set(channel, set);
        await sub.subscribe(prefix + channel, deliver(channel));
      }
      set.add(listener);
      return async () => {
        const current = listeners.get(channel);
        if (!current) return;
        current.delete(listener);
        if (!current.size) {
          listeners.delete(channel);
          await sub.unsubscribe(prefix + channel).catch(() => undefined);
        }
      };
    },
    async close() {
      listeners.clear();
      if (!clients) return;
      const { pub, sub } = await clients.catch(() => ({ pub: null, sub: null }));
      clients = undefined;
      await Promise.all([pub?.quit().catch(() => undefined), sub?.quit().catch(() => undefined)]);
    }
  };
}

export function relayFromEnv(env: NodeJS.ProcessEnv): RelayBus {
  const url = env.REDIS_URL?.trim();
  return url ? redisRelayBus(url) : memoryRelayBus();
}
