// Livepeer Studio, as the relay uses it (follow-up Phase 3; its API as published in
// livepeer/studio's api-schema.yaml):
//
//   POST   /stream                      { name, profiles: [], record: false }  the per-station relay stream,
//                                        with no transcoding: it carries the relay's one push as it is
//   GET    /stream/:id                  its multistream targets and whether it's receiving
//   PATCH  /stream/:id                  { multistream: { targets: [{ id, profile: "source", videoOnly: false }] } }
//   POST   /multistream/target          { name, url, disabled }  one per platform per stream
//   PATCH  /multistream/target/:id      { url?, disabled? }  a platform's address, or off and on (a restart)
//   DELETE /multistream/target/:id
//
// Every target is sent `source`: Livepeer sends the same stream to every platform. Toggling one
// target restarts only that platform's push; the stream and the other targets are untouched.
// Nothing here is called in tests against the real service: they point LIVEPEER_API_BASE at a fake.

export interface LivepeerStreamInfo {
  id: string;
  isActive: boolean;
  profiles: unknown[];
  targets: Array<{ id: string; profile: string; videoOnly?: boolean }>;
}

export interface LivepeerRelayApi {
  /** A stream with `profiles: []` (no transcoding) for a station's relay. */
  createRelayStream(name: string): Promise<{ id: string; streamKey: string; playbackId: string | null }>;
  getStream(id: string): Promise<LivepeerStreamInfo>;
  /** Sets the stream's multistream targets, each `source`. */
  setStreamTargets(streamId: string, targetIds: string[]): Promise<void>;
  createTarget(input: { name: string; url: string; disabled: boolean }): Promise<{ id: string }>;
  updateTarget(id: string, patch: { url?: string; disabled?: boolean }): Promise<void>;
  deleteTarget(id: string): Promise<void>;
  /** Where the relay pushes a stream (its RTMP ingest with the key). */
  ingestUrl(streamKey: string): string;
}

export interface LivepeerRelayConfig {
  apiBase: string;
  apiKey: string;
  ingestBase: string;
  fetch?: typeof fetch;
}

export class LivepeerError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export function createLivepeerRelayApi(config: LivepeerRelayConfig): LivepeerRelayApi {
  const base = config.apiBase.replace(/\/+$/, "");
  const doFetch = config.fetch ?? fetch;
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await doFetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${config.apiKey}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000)
    });
    const text = await response.text();
    if (!response.ok) throw new LivepeerError(`Livepeer ${method} ${path.replace(/\/[0-9a-f-]{8,}/gi, "/…")} failed (${response.status}): ${text.slice(0, 200)}`, response.status);
    return (text ? JSON.parse(text) : {}) as T;
  }
  return {
    async createRelayStream(name) {
      const s = await call<{ id?: string; streamKey?: string; playbackId?: string }>("POST", "/stream", { name, profiles: [], record: false });
      if (!s.id || !s.streamKey) throw new LivepeerError("Livepeer's stream came back without an id or key", 502);
      return { id: s.id, streamKey: s.streamKey, playbackId: s.playbackId ?? null };
    },
    async getStream(id) {
      const s = await call<{ id: string; isActive?: boolean; profiles?: unknown[]; multistream?: { targets?: Array<{ id: string; profile: string; videoOnly?: boolean }> } }>("GET", `/stream/${encodeURIComponent(id)}`);
      return { id: s.id, isActive: Boolean(s.isActive), profiles: s.profiles ?? [], targets: s.multistream?.targets ?? [] };
    },
    async setStreamTargets(streamId, targetIds) {
      await call("PATCH", `/stream/${encodeURIComponent(streamId)}`, { multistream: { targets: targetIds.map((id) => ({ id, profile: "source", videoOnly: false })) } });
    },
    async createTarget(input) {
      const t = await call<{ id?: string }>("POST", "/multistream/target", input);
      if (!t.id) throw new LivepeerError("Livepeer's multistream target came back without an id", 502);
      return { id: t.id };
    },
    async updateTarget(id, patch) {
      await call("PATCH", `/multistream/target/${encodeURIComponent(id)}`, patch);
    },
    async deleteTarget(id) {
      await call("DELETE", `/multistream/target/${encodeURIComponent(id)}`).catch((error: LivepeerError) => {
        if (error.status !== 404) throw error;
      });
    },
    ingestUrl(streamKey) {
      return `${config.ingestBase.replace(/\/+$/, "")}/${streamKey}`;
    }
  };
}

/** A destination's full push address (its RTMP(S) address and key). */
export function pushUrl(rtmpUrl: string, streamKey: string): string {
  return `${rtmpUrl.replace(/\/+$/, "")}/${streamKey}`;
}
