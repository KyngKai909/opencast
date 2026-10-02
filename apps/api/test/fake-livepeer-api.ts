// A local fake of Livepeer Studio's API, as the relay uses it (streams and multistream targets).
// Nothing real is created, and nothing is pushed anywhere: tests point the relay's Livepeer client
// here, and its "ingest" at a local RTMP sink when they push for real.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createLivepeerRelayApi, type LivepeerRelayApi } from "../src/v1/modules/relays/livepeer.js";

export interface FakeStream {
  id: string;
  name: string;
  streamKey: string;
  playbackId: string;
  profiles: unknown[];
  record: boolean;
  multistream: { targets: Array<{ id: string; profile: string; videoOnly?: boolean }> };
}

export interface FakeTarget {
  id: string;
  name: string;
  url: string;
  disabled: boolean;
}

export interface FakeLivepeer {
  api: LivepeerRelayApi;
  streams: Map<string, FakeStream>;
  targets: Map<string, FakeTarget>;
  calls: Array<{ method: string; path: string; body: unknown }>;
  /** Livepeer's existing streams (a live source's), made the way the stations module does. */
  addStream(id: string, name?: string): FakeStream;
  close(): Promise<void>;
}

export async function fakeLivepeerApi(ingestBase = "rtmp://127.0.0.1:1/live"): Promise<FakeLivepeer> {
  const streams = new Map<string, FakeStream>();
  const targets = new Map<string, FakeTarget>();
  const calls: FakeLivepeer["calls"] = [];
  let n = 0;
  const addStream = (id: string, name = id): FakeStream => {
    const s: FakeStream = { id, name, streamKey: `key-${id}`, playbackId: `pb-${id}`, profiles: [{ name: "720p" }], record: false, multistream: { targets: [] } };
    streams.set(id, s);
    return s;
  };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      const url = req.url ?? "";
      calls.push({ method: req.method ?? "", path: url, body });
      const send = (status: number, value?: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(value === undefined ? "" : JSON.stringify(value));
      };
      if (req.headers.authorization !== "Bearer test-livepeer-key") return send(401, { errors: ["Unauthorized"] });
      let m: RegExpExecArray | null;
      if (req.method === "POST" && url === "/stream") {
        const id = `stream-${++n}`;
        const s: FakeStream = { id, name: body.name, streamKey: `relay-key-${n}`, playbackId: `relay-pb-${n}`, profiles: body.profiles ?? [{ name: "default" }], record: Boolean(body.record), multistream: { targets: [] } };
        streams.set(id, s);
        return send(201, s);
      }
      if ((m = /^\/stream\/([^/]+)$/.exec(url))) {
        const s = streams.get(decodeURIComponent(m[1]));
        if (!s) return send(404, { errors: ["not found"] });
        if (req.method === "GET") return send(200, { ...s, isActive: true });
        if (req.method === "PATCH") {
          if (body.multistream) s.multistream = body.multistream;
          return send(204);
        }
      }
      if (req.method === "POST" && url === "/multistream/target") {
        const id = `target-${++n}`;
        targets.set(id, { id, name: body.name, url: body.url, disabled: Boolean(body.disabled) });
        return send(201, { id, name: body.name, disabled: Boolean(body.disabled) });
      }
      if ((m = /^\/multistream\/target\/([^/]+)$/.exec(url))) {
        const t = targets.get(decodeURIComponent(m[1]));
        if (!t) return send(404, { errors: ["not found"] });
        if (req.method === "PATCH") {
          if (body.url !== undefined) t.url = body.url;
          if (body.disabled !== undefined) t.disabled = body.disabled;
          return send(204);
        }
        if (req.method === "DELETE") {
          targets.delete(t.id);
          return send(204);
        }
      }
      send(404, { errors: ["not found"] });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    api: createLivepeerRelayApi({ apiBase: base, apiKey: "test-livepeer-key", ingestBase }),
    streams,
    targets,
    calls,
    addStream,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  };
}
