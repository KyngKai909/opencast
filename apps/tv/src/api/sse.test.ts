import { describe, expect, it } from "vitest";
import { backoffMs, readSse, sseParser, type SseEvent } from "./sse";

function parse(chunks: string[]) {
  const events: SseEvent[] = [];
  const comments: string[] = [];
  const p = sseParser((e) => events.push(e), (c) => comments.push(c));
  chunks.forEach((c) => p.push(c));
  return { events, comments, retry: p.retryMs() };
}

describe("the event-stream parser", () => {
  it("reads the API's events, its ping and its retry", () => {
    const r = parse(['retry: 3000\n\nevent: phones\ndata: {"phones":[]}\n\n: ping\n\nevent: command\ndata: {"command":{"type":"info"}}\n\n']);
    expect(r.events).toEqual([
      { event: "phones", data: '{"phones":[]}' },
      { event: "command", data: '{"command":{"type":"info"}}' }
    ]);
    expect(r.comments).toEqual(["ping"]);
    expect(r.retry).toBe(3000);
  });

  it("puts events split anywhere back together, CRLF or LF", () => {
    const text = 'event: signed_out\r\ndata: {}\r\n\r\nevent: phones\ndata: {"phones":\ndata: []}\n\n';
    for (let cut = 1; cut < text.length; cut++) {
      const r = parse([text.slice(0, cut), text.slice(cut)]);
      expect(r.events).toEqual([
        { event: "signed_out", data: "{}" },
        { event: "phones", data: '{"phones":\n[]}' }
      ]);
    }
  });

  it("calls an unnamed event a message, and dispatches nothing without data", () => {
    expect(parse(["data: hi\n\nevent: nothing\n\n"]).events).toEqual([{ event: "message", data: "hi" }]);
  });

  it("waits for the blank line before an event counts", () => {
    expect(parse(["event: command\ndata: {}\n"]).events).toEqual([]);
  });
});

describe("reading a streamed response", () => {
  it("hands over each event as its bytes arrive", async () => {
    const enc = new TextEncoder();
    const parts = ["event: phones\nda", 'ta: {"phones":[]}\n', "\n"];
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        parts.forEach((p) => c.enqueue(enc.encode(p)));
        c.close();
      }
    });
    const got: SseEvent[] = [];
    await readSse(new Response(body), (e) => got.push(e));
    expect(got).toEqual([{ event: "phones", data: '{"phones":[]}' }]);
  });
});

describe("the wait before reconnecting", () => {
  it("doubles from a second with each failure, up to 30 seconds, plus up to a fifth at random", () => {
    const none = { random: () => 0 };
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => backoffMs(n, none))).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(backoffMs(1, { random: () => 1 })).toBe(1200);
  });
});
