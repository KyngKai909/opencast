// Email: every email the platform sends (invites, notices, the desk's letters, the data export)
// goes through `emailFromEnv`. With RESEND_API_KEY it sends through Resend's HTTP API; without one
// it writes a line to the log, as before, so development and tests need nothing.
//
// Each email is plain text plus a simple HTML version of the same words (renderEmail). A send is
// tried up to three times (network errors, 429 and 5xx), with one idempotency key for all three,
// so a retry never delivers twice. The key and full addresses are never logged.

import { randomUUID } from "node:crypto";

/** What a module asks to send. The notifier's `email(to, notice)` takes this. */
export interface EmailNotice {
  title: string;
  body: string;
  link: string | null;
  /** The button's words (default "Open Opencast"). */
  action?: string;
  /** Why this person is getting it: the line under the signature. */
  footer?: string;
  /** The same key never sends twice (Resend keeps keys for 24 hours). Default: one per call. */
  key?: string;
  /** What kind of email it is, for logs and the provider's tags: invite, notice, desk, data. */
  kind?: string;
}

export type SendEmail = (to: string, notice: EmailNotice) => Promise<void>;

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const DEFAULT_FOOTER = "You're getting this because of your Opencast account.";

/** An address as the logs may show it: the first letter, then the domain (`j…@example.com`). */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf("@");
  if (at <= 0) return "…";
  return `${address.slice(0, 1)}…${address.slice(at)}`;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/**
 * The email's words, as plain text and as simple HTML. The style guide's voice: calm, exact, a
 * little dry; plain words, no exclamation marks. The HTML is one column in the brand's colours
 * (ink on the raised ground, the signal colour for the button), with the link also written out.
 */
export function renderEmail(notice: EmailNotice): RenderedEmail {
  const action = notice.action ?? "Open Opencast";
  const footer = notice.footer ?? DEFAULT_FOOTER;
  const paragraphs = notice.body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const text = [
    notice.title,
    "",
    ...paragraphs.flatMap((p) => [p, ""]),
    ...(notice.link ? [`${action}: ${notice.link}`, ""] : []),
    "Opencast",
    footer
  ].join("\n");

  const p = (s: string) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#0F1830;">${escapeHtml(s).replace(/\n/g, "<br>")}</p>`;
  const button = notice.link
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 20px;"><tr><td style="border-radius:8px;background:#0A6883;">` +
      `<a href="${escapeHtml(notice.link)}" style="display:inline-block;padding:12px 20px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:8px;">${escapeHtml(action)}</a>` +
      `</td></tr></table>` +
      `<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#3F4960;">Or open this link: <a href="${escapeHtml(notice.link)}" style="color:#0A6883;word-break:break-all;">${escapeHtml(notice.link)}</a></p>`
    : "";
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(notice.title)}</title></head>` +
    `<body style="margin:0;padding:0;background:#E3E6EC;">` +
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#E3E6EC;"><tr><td align="center" style="padding:24px 16px;">` +
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#F3F5F8;border:1px solid #C6CCD7;border-radius:12px;">` +
    `<tr><td style="padding:24px 28px 8px;font-family:Archivo,'Helvetica Neue',Arial,sans-serif;font-size:20px;font-weight:800;letter-spacing:-0.02em;color:#0F1830;">` +
    `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#C42A1C;margin-right:8px;vertical-align:middle;"></span>opencast</td></tr>` +
    `<tr><td style="padding:8px 28px 8px;font-family:'Helvetica Neue',Arial,sans-serif;">` +
    `<h1 style="margin:0 0 16px;font-size:24px;line-height:1.2;font-weight:700;color:#0F1830;">${escapeHtml(notice.title)}</h1>` +
    paragraphs.map(p).join("") +
    button +
    `</td></tr>` +
    `<tr><td style="padding:16px 28px 24px;border-top:1px solid #C6CCD7;font-family:'Helvetica Neue',Arial,sans-serif;font-size:13px;line-height:1.5;color:#3F4960;">${escapeHtml(footer)}</td></tr>` +
    `</table></td></tr></table></body></html>`;
  return { subject: notice.title, text, html };
}

export interface ResendOptions {
  apiKey: string;
  /** "Opencast <hello@…>". */
  from: string;
  replyTo?: string | null;
  fetch?: typeof fetch;
  /** Tries in all (default 3). */
  attempts?: number;
  /** Waits between tries (tests pass one that doesn't). */
  sleep?: (ms: number) => Promise<void>;
  /** Per try (default 10 s). */
  timeoutMs?: number;
  log?: Pick<Console, "info" | "warn">;
}

export class EmailError extends Error {
  constructor(
    message: string,
    readonly status: number | null
  ) {
    super(message);
  }
}

const RESEND_URL = "https://api.resend.com/emails";
/** Resend's tag values: letters, numbers, underscores and dashes. */
const tag = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256);

/** Sends through Resend's HTTP API. Resolves once Resend has taken the email; throws after the last try. */
export function resendTransport(options: ResendOptions): SendEmail {
  const doFetch = options.fetch ?? fetch;
  const attempts = Math.max(1, options.attempts ?? 3);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = options.log ?? console;
  const timeoutMs = options.timeoutMs ?? 10_000;

  return async (to, notice) => {
    const { subject, text, html } = renderEmail(notice);
    // One key for every try of this send, so a retry after a lost answer doesn't send twice.
    const key = (notice.key ?? `email:${randomUUID()}`).slice(0, 256);
    const payload = JSON.stringify({
      from: options.from,
      to: [to],
      subject,
      text,
      html,
      ...(options.replyTo ? { reply_to: options.replyTo } : {}),
      tags: [{ name: "kind", value: tag(notice.kind ?? "notice") }]
    });
    const who = maskEmail(to);
    let last: EmailError | null = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      let retryAfterMs: number | null = null;
      try {
        const res = await doFetch(RESEND_URL, {
          method: "POST",
          headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json", "idempotency-key": key },
          body: payload,
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (res.ok) {
          const data = (await res.json().catch(() => null)) as { id?: string } | null;
          log.info(`[email] sent ${notice.kind ?? "notice"} to ${who}${data?.id ? ` (${data.id})` : ""}`);
          return;
        }
        const detail = (await res.json().catch(() => null)) as { name?: string; message?: string } | null;
        last = new EmailError(`Resend answered ${res.status}${detail?.name ? ` ${detail.name}` : ""}`, res.status);
        // Only a busy or failing Resend is worth trying again; a refused email stays refused.
        const retryable = res.status === 429 || res.status >= 500 || (res.status === 409 && detail?.name === "concurrent_idempotent_requests");
        if (!retryable) break;
        const after = Number(res.headers.get("retry-after"));
        if (Number.isFinite(after) && after > 0) retryAfterMs = Math.min(after * 1000, 30_000);
      } catch (error) {
        last = new EmailError(`Couldn't reach Resend (${(error as Error).name ?? "error"})`, null);
      }
      if (attempt < attempts) await sleep(retryAfterMs ?? 1000 * 4 ** (attempt - 1));
    }
    log.warn(`[email] ${notice.kind ?? "notice"} to ${who} failed: ${last?.message ?? "unknown"}`);
    throw last ?? new EmailError("The email wasn't sent.", null);
  };
}

/** Without a key: the log gets the email instead (the link too, outside production). */
export function logTransport(options: { production: boolean; log?: Pick<Console, "log"> }): SendEmail {
  const log = options.log ?? console;
  return async (to, notice) => {
    const link = !options.production && notice.link ? ` ${notice.link}` : "";
    log.log(`[notify] email to ${maskEmail(to)}: ${notice.title}${link}`);
  };
}

/**
 * The email transport from the environment: Resend with RESEND_API_KEY (from EMAIL_FROM, replies
 * to EMAIL_REPLY_TO), else the log. EMAIL_FROM falls back to Resend's test sender, which only
 * delivers to the Resend account's own address, until a domain is verified.
 */
export function emailFromEnv(env: NodeJS.ProcessEnv, options: { fetch?: typeof fetch; sleep?: ResendOptions["sleep"]; log?: Console } = {}): SendEmail {
  const apiKey = env.RESEND_API_KEY?.trim();
  const production = env.NODE_ENV === "production";
  const log = options.log ?? console;
  if (!apiKey) {
    if (production) log.warn("[v1] RESEND_API_KEY isn't set: emails (invites, notices) only go to the log.");
    return logTransport({ production, log });
  }
  let from = env.EMAIL_FROM?.trim();
  if (!from) {
    from = "Opencast <onboarding@resend.dev>";
    log.warn("[v1] EMAIL_FROM isn't set: sending from Resend's test address, which only reaches the Resend account's own email.");
  }
  return resendTransport({ apiKey, from, replyTo: env.EMAIL_REPLY_TO?.trim() || null, fetch: options.fetch, sleep: options.sleep, log });
}
