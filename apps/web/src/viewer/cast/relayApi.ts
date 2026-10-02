// The relay over the API: the phone's events stream (`phoneRemoteEvents`, Server-Sent Events) read
// with fetch and a stream reader, since EventSource can't send Authorization, and commands with
// `sendRemoteCommand`. The bearer is the account's sign-in token, or a guest's phone token.

import { API_PREFIX, buildPath, ErrorResponse, PhoneRemoteEvents, tvApi } from "@opencast/contracts";
import { ApiError, accessToken } from "../../api/client";
import { config } from "../../config";
import type { PhoneEvent, RelayAuth, RelayLink } from "./relay";

export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Reads a text/event-stream as it arrives, a chunk at a time: `event:` and `data:` lines up to a
 * blank line make a message (several data lines join with newlines); `: ping` comments are skipped;
 * `retry:` is reported. CRLF and CR line ends work, even split between chunks.
 */
export function createSseParser(onMessage: (m: SseMessage) => void, onRetry?: (ms: number) => void): (chunk: string) => void {
  let buf = "";
  let event = "";
  let data: string[] = [];
  const line = (l: string) => {
    if (l === "") {
      if (data.length) onMessage({ event: event || "message", data: data.join("\n") });
      event = "";
      data = [];
      return;
    }
    if (l.startsWith(":")) return;
    const c = l.indexOf(":");
    const field = c < 0 ? l : l.slice(0, c);
    let value = c < 0 ? "" : l.slice(c + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    else if (field === "retry" && /^\d+$/.test(value)) onRetry?.(Number(value));
  };
  /** The last chunk ended with a CR: an LF starting the next one is the rest of that CRLF. */
  let afterCr = false;
  return (chunk) => {
    if (!chunk) return;
    const text = afterCr && chunk.startsWith("\n") ? chunk.slice(1) : chunk;
    afterCr = chunk.endsWith("\r");
    const lines = (buf + text).split(/\r\n|\r|\n/);
    buf = lines.pop()!;
    lines.forEach(line);
  };
}

/** A stream message as a phone event, checked against the contract; anything else is null. */
export function phoneEvent(m: SseMessage): PhoneEvent | null {
  if (m.event !== "state" && m.event !== "ended") return null;
  let json: unknown;
  try {
    json = JSON.parse(m.data);
  } catch {
    return null;
  }
  const parsed = PhoneRemoteEvents[m.event].safeParse(json);
  if (!parsed.success) return null;
  return { event: m.event, data: parsed.data } as PhoneEvent;
}

async function refusal(res: Response): Promise<ApiError> {
  const json = await res.json().catch(() => null);
  const e = ErrorResponse.safeParse(json);
  return e.success ? new ApiError(res.status, e.data.error.code, e.data.error.message) : new ApiError(res.status, "error", "Something went wrong. Try again.");
}

export function apiRelayLink(deps: { fetch?: typeof fetch; token?: () => Promise<string | null>; base?: string } = {}): RelayLink {
  const doFetch = deps.fetch ?? ((input, init) => fetch(input, init));
  const token = deps.token ?? accessToken;
  const base = deps.base ?? config.apiBase;
  const url = (path: string, tvId: string) => `${base}${API_PREFIX}${buildPath(path, { tvId })}`;
  const headers = async (auth: RelayAuth): Promise<Record<string, string>> => {
    const t = auth.kind === "paired" ? auth.phoneToken : await token();
    return t ? { authorization: `Bearer ${t}` } : {};
  };

  return {
    async open(tvId, auth, on) {
      const abort = new AbortController();
      const res = await doFetch(url(tvApi.phoneRemoteEvents.path, tvId), { headers: { ...(await headers(auth)), accept: "text/event-stream" }, signal: abort.signal, cache: "no-store" });
      if (!res.ok) throw await refusal(res);
      if (!res.body) throw new ApiError(502, "no_stream", "Couldn't reach the TV. Check the connection and try again.");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let retryMs: number | undefined;
      const feed = createSseParser(
        (m) => {
          const e = phoneEvent(m);
          if (e) on.event(e);
        },
        (ms) => (retryMs = ms)
      );
      void (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            feed(decoder.decode(value, { stream: true }));
          }
        } catch {
          // Dropped: reported below, unless it was closed on purpose.
        }
        if (!abort.signal.aborted) on.drop(retryMs);
      })();
      return () => abort.abort();
    },
    async send(tvId, auth, command, name) {
      const res = await doFetch(url(tvApi.sendRemoteCommand.path, tvId), {
        method: "POST",
        headers: { ...(await headers(auth)), "content-type": "application/json" },
        body: JSON.stringify({ command, name })
      });
      if (!res.ok) throw await refusal(res);
    }
  };
}
