// Server-Sent Events read with fetch and a stream reader: the API's streams need
// `Authorization`, which EventSource can't send. The parser follows the HTML spec's rules for
// the text/event-stream format: `event:` names the event, `data:` lines join with newlines, a
// blank line dispatches, a line starting with ":" is a comment (the API's `: ping`), and `retry:`
// is the reconnect delay the server asks for.

export interface SseEvent {
  event: string;
  data: string;
  id?: string;
}

export interface SseParser {
  /** Feed text as it arrives (any split, CRLF or LF). */
  push(chunk: string): void;
  /** The server's last `retry:` in ms, if it sent one. */
  retryMs(): number | null;
}

export function sseParser(onEvent: (e: SseEvent) => void, onComment?: (text: string) => void): SseParser {
  let buffer = "";
  let event = "";
  let data: string[] = [];
  let id: string | undefined;
  let retry: number | null = null;
  let sawCr = false;

  const line = (l: string) => {
    if (l === "") {
      if (data.length) onEvent({ event: event || "message", data: data.join("\n"), ...(id !== undefined ? { id } : {}) });
      event = "";
      data = [];
      return;
    }
    if (l.startsWith(":")) return onComment?.(l.slice(1).trimStart());
    const colon = l.indexOf(":");
    const field = colon < 0 ? l : l.slice(0, colon);
    let value = colon < 0 ? "" : l.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    else if (field === "id" && !value.includes("\0")) id = value;
    else if (field === "retry" && /^\d+$/.test(value)) retry = Number(value);
  };

  return {
    push(chunk) {
      // A CR at the end of the last chunk may be half of a CRLF.
      if (sawCr && chunk.startsWith("\n")) chunk = chunk.slice(1);
      sawCr = false;
      buffer += chunk;
      let start = 0;
      for (let i = 0; i < buffer.length; i++) {
        const c = buffer[i];
        if (c !== "\n" && c !== "\r") continue;
        line(buffer.slice(start, i));
        if (c === "\r") {
          if (i + 1 === buffer.length) sawCr = true;
          else if (buffer[i + 1] === "\n") i++;
        }
        start = i + 1;
      }
      buffer = buffer.slice(start);
    },
    retryMs: () => retry
  };
}

/** Reads a streamed response to its end (or until aborted), handing each event over. */
export async function readSse(res: Response, onEvent: (e: SseEvent) => void, o: { onComment?: (text: string) => void; parser?: (p: SseParser) => void } = {}): Promise<void> {
  if (!res.body) return;
  const parser = sseParser(onEvent, o.onComment);
  o.parser?.(parser);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

/**
 * The wait before reconnecting: doubling from `baseMs` with each failure in a row, up to `maxMs`,
 * with up to a fifth added at random so a room of TVs doesn't come back at once.
 */
export function backoffMs(failures: number, o: { baseMs?: number; maxMs?: number; random?: () => number } = {}): number {
  const base = o.baseMs ?? 1_000;
  const max = o.maxMs ?? 30_000;
  const ms = Math.min(max, base * 2 ** Math.max(0, failures - 1));
  return Math.round(ms * (1 + 0.2 * (o.random ?? Math.random)()));
}
