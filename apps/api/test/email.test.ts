// The email transport (email.ts): Resend's HTTP API with a fake fetch, its retries and
// idempotency key, and the log without a key. Nothing here reaches the network.

import { describe, expect, it, vi } from "vitest";
import { EmailError, emailFromEnv, maskEmail, renderEmail, resendTransport, type EmailNotice } from "../src/v1/email.js";

const KEY = "re_test_not_a_real_key";
const TO = "dee.okafor@example.com";
const notice: EmailNotice = {
  title: "Join Inland Beat on Opencast",
  body: "Kai invited you to Inland Beat's team on Opencast, as an operator.\n\nSign in with this email address to join.",
  link: "https://app.opencast.test/control/invites/abc",
  action: "Join Inland Beat",
  footer: "Kai on Inland Beat typed this address.",
  key: "invite:abc:2026-10-01T19:00:00.000Z",
  kind: "invite"
};

function fakeFetch(answers: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = answers.shift();
    if (!next) throw new Error("no more answers");
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function quietLog() {
  const lines: string[] = [];
  const log = { info: (m: string) => void lines.push(m), warn: (m: string) => void lines.push(m), log: (m: string) => void lines.push(m) };
  return { log: log as unknown as Console, lines };
}

describe("sending through Resend", () => {
  it("posts the email once, with the key, the from and reply-to, text and HTML", async () => {
    const { fetch, calls } = fakeFetch([json(200, { id: "email_123" })]);
    const { log, lines } = quietLog();
    const send = resendTransport({ apiKey: KEY, from: "Opencast <hello@example.org>", replyTo: "team@example.org", fetch, log, sleep: async () => {} });
    await send(TO, notice);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    expect(headers["idempotency-key"]).toBe(notice.key);
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({ from: "Opencast <hello@example.org>", to: [TO], subject: "Join Inland Beat on Opencast", reply_to: "team@example.org", tags: [{ name: "kind", value: "invite" }] });
    expect(body.text).toContain("Join Inland Beat: https://app.opencast.test/control/invites/abc");
    expect(body.html).toContain('href="https://app.opencast.test/control/invites/abc"');
    // The log names the kind and a masked address: never the key or the whole address.
    expect(lines).toEqual(["[email] sent invite to d…@example.com (email_123)"]);
  });

  it("tries again after a 500 and a network error, with the same key, then succeeds", async () => {
    const { fetch, calls } = fakeFetch([json(500, { name: "internal_server_error" }), new TypeError("fetch failed"), json(200, { id: "email_9" })]);
    const sleeps: number[] = [];
    const { log } = quietLog();
    const send = resendTransport({ apiKey: KEY, from: "Opencast <hello@example.org>", fetch, log, sleep: async (ms) => void sleeps.push(ms) });
    await send(TO, notice);
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((c) => (c.init.headers as Record<string, string>)["idempotency-key"]))).toEqual(new Set([notice.key]));
    expect(sleeps).toEqual([1000, 4000]);
  });

  it("waits as long as a 429 asks, and makes one key per send when none is given", async () => {
    const { fetch, calls } = fakeFetch([json(429, { name: "rate_limit_exceeded" }, { "retry-after": "2" }), json(200, { id: "x" }), json(200, { id: "y" })]);
    const sleeps: number[] = [];
    const { log } = quietLog();
    const send = resendTransport({ apiKey: KEY, from: "a@example.org", fetch, log, sleep: async (ms) => void sleeps.push(ms) });
    const { key: _key, ...keyless } = notice;
    await send(TO, keyless);
    await send(TO, keyless);
    expect(sleeps).toEqual([2000]);
    const keys = calls.map((c) => (c.init.headers as Record<string, string>)["idempotency-key"]);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("doesn't try again when Resend refuses the email, and says so without the key or address", async () => {
    const { fetch, calls } = fakeFetch([json(422, { name: "validation_error", message: "Invalid `to` field." })]);
    const { log, lines } = quietLog();
    const send = resendTransport({ apiKey: KEY, from: "a@example.org", fetch, log, sleep: async () => {} });
    const error = await send(TO, notice).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmailError);
    expect((error as EmailError).status).toBe(422);
    expect(calls).toHaveLength(1);
    expect(lines.join("\n")).not.toContain(KEY);
    expect(lines.join("\n")).not.toContain(TO);
  });

  it("gives up after three tries", async () => {
    const { fetch, calls } = fakeFetch([json(503, {}), json(503, {}), json(503, {})]);
    const { log } = quietLog();
    const send = resendTransport({ apiKey: KEY, from: "a@example.org", fetch, log, sleep: async () => {} });
    await expect(send(TO, notice)).rejects.toThrow("Resend answered 503");
    expect(calls).toHaveLength(3);
  });
});

describe("the transport from the environment", () => {
  it("without a key, writes the email to the log (the link too, outside production)", async () => {
    const { fetch, calls } = fakeFetch([]);
    const { log, lines } = quietLog();
    await emailFromEnv({ NODE_ENV: "development" }, { fetch, log })(TO, notice);
    expect(calls).toHaveLength(0);
    expect(lines).toEqual(["[notify] email to d…@example.com: Join Inland Beat on Opencast https://app.opencast.test/control/invites/abc"]);
  });

  it("without a key in production, warns once and logs no links", async () => {
    const { log, lines } = quietLog();
    const send = emailFromEnv({ NODE_ENV: "production" }, { log });
    await send(TO, notice);
    expect(lines).toEqual(["[v1] RESEND_API_KEY isn't set: emails (invites, notices) only go to the log.", "[notify] email to d…@example.com: Join Inland Beat on Opencast"]);
  });

  it("with a key, sends from EMAIL_FROM, or Resend's test sender until one is set", async () => {
    const { fetch, calls } = fakeFetch([json(200, { id: "a" }), json(200, { id: "b" })]);
    const { log, lines } = quietLog();
    await emailFromEnv({ RESEND_API_KEY: KEY, EMAIL_FROM: "Opencast <hello@example.org>", EMAIL_REPLY_TO: "team@example.org" }, { fetch, log })(TO, notice);
    await emailFromEnv({ RESEND_API_KEY: KEY }, { fetch, log })(TO, notice);
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ from: "Opencast <hello@example.org>", reply_to: "team@example.org" });
    expect(JSON.parse(String(calls[1]!.init.body)).from).toBe("Opencast <onboarding@resend.dev>");
    expect(JSON.parse(String(calls[1]!.init.body)).reply_to).toBeUndefined();
    expect(lines.some((l) => l.includes("EMAIL_FROM isn't set"))).toBe(true);
    expect(lines.join("\n")).not.toContain(KEY);
  });
});

describe("the words", () => {
  it("renders plain text and HTML of the same words, escaped", () => {
    const r = renderEmail({ title: "A <b>test</b>", body: "One & two.\n\nThree.", link: "https://example.org/?a=1&b=2" });
    expect(r.subject).toBe("A <b>test</b>");
    expect(r.text).toBe("A <b>test</b>\n\nOne & two.\n\nThree.\n\nOpen Opencast: https://example.org/?a=1&b=2\n\nOpencast\nYou're getting this because of your Opencast account.");
    expect(r.html).toContain("A &lt;b&gt;test&lt;/b&gt;");
    expect(r.html).toContain("One &amp; two.");
    expect(r.html).toContain('href="https://example.org/?a=1&amp;b=2"');
  });

  it("masks addresses", () => {
    expect(maskEmail("jess@orangestreet.example")).toBe("j…@orangestreet.example");
    expect(maskEmail("nope")).toBe("…");
  });
});
