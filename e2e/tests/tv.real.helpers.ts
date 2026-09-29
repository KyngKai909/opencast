// TV mode's helpers for the real-API specs (tv.*.real.spec.ts): a TV signed in through the API
// the way the code sign-in does it, the device store put on the TV before the app starts, what
// every screen must not show, and a phone's side of the relay (its commands and its stream).

import { expect, type Page } from "@playwright/test";
import { api, approveTvCode, tokenFor } from "../lib/real";
import { API_BASE } from "../real/shared";

export interface TvSession {
  tvId: string;
  deviceToken: string;
  /** The TV session's token (tvSession endpoints). */
  token: string;
  signedInAs: string | null;
}

/** A TV registered and signed in to `person`'s account: registerTv, a code, approved on the phone, polled. */
export async function tvSession(person: string): Promise<TvSession> {
  const tv = await api<{ tvId: string; deviceToken: string }>("/tv/devices", { method: "POST", body: { platform: "web" } });
  const code = await api<{ code: string; pollToken: string }>("/tv/codes", { method: "POST", token: tv.deviceToken });
  await approveTvCode(code.code, person);
  const status = await api<{ status: string; token: string; signedInAs: string | null }>(`/tv/codes/${code.pollToken}`);
  expect(status.status).toBe("approved");
  return { tvId: tv.tvId, deviceToken: tv.deviceToken, token: status.token, signedInAs: status.signedInAs };
}

/**
 * Opens TV mode at `path` with this device store (localStorage "oc-tv-device"): past first launch
 * unless `firstLaunch`, signed in when given a session (otherwise it registers itself). The store
 * is put there once per tab, so a reload keeps what the app wrote since.
 */
export async function openTv(page: Page, path = "/", o: { session?: TvSession; firstLaunch?: boolean; device?: Record<string, unknown> } = {}) {
  const s = o.session;
  const device = {
    welcomed: !o.firstLaunch,
    ...(s ? { tvId: s.tvId, deviceToken: s.deviceToken, token: s.token, signedInAs: s.signedInAs } : {}),
    ...o.device
  };
  await page.addInitScript((d) => {
    if (sessionStorage.getItem("oc-e2e-seeded")) return;
    sessionStorage.setItem("oc-e2e-seeded", "1");
    localStorage.clear();
    localStorage.setItem("oc-tv-device", JSON.stringify(d));
  }, device);
  await page.goto(path);
}

/** What the TV keeps on the device. */
export function deviceStore(page: Page): Promise<Record<string, any>> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("oc-tv-device") ?? "{}"));
}

/**
 * Watches a page for what the real-API runs must not see: page errors, responses that don't match
 * their contracts, and calls the API refused (recorded, then checked by the spec).
 */
export function watch(page: Page) {
  const w = { errors: [] as string[], mismatched: [] as string[], refused: [] as string[], pending: new Set<object>() };
  // Calls to the API still waiting for an answer (not the event streams, which stay open).
  const api = (u: URL) => u.port === "8788" && !u.pathname.endsWith("/events");
  page.on("request", (r) => {
    if (api(new URL(r.url()))) w.pending.add(r);
  });
  page.on("requestfinished", (r) => w.pending.delete(r));
  page.on("requestfailed", (r) => w.pending.delete(r));
  page.on("pageerror", (e) => w.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && /doesn't match its contract/.test(m.text())) w.mismatched.push(m.text().slice(0, 300));
  });
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (u.port === "8788" && r.status() >= 400) w.refused.push(`${r.request().method()} ${u.pathname} ${r.status()}`);
  });
  return w;
}

/** Nothing asked of the API is still waiting (the event streams aside). */
export async function answered(w: ReturnType<typeof watch>) {
  await expect.poll(() => w.pending.size).toBe(0);
}

// ---------- The phone's side of the relay ----------

/** A phone signed in to `person`'s account sends the TV a command (sendRemoteCommand). */
export async function phoneSays(tvId: string, person: string, command: object, name = "Sam's phone") {
  return api(`/tv/remote/${tvId}/commands`, { as: person, method: "POST", body: { command, name } });
}

export interface PhoneStream {
  /** Every `state` the phone has heard, oldest first. */
  states: Array<{ stationId: string | null; paused: boolean; changedBy: string | null; sleepEndsAt: number | null }>;
  ended: string[];
  close(): void;
}

/** A phone's stream for one TV (phoneRemoteEvents, SSE), read with fetch and the phone's token. */
export async function phoneListens(tvId: string, person: string): Promise<PhoneStream> {
  const token = await tokenFor(person);
  const ctl = new AbortController();
  const out: PhoneStream = { states: [], ended: [], close: () => ctl.abort() };
  const res = await fetch(`${API_BASE}/v1/tv/remote/${tvId}/events`, { headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" }, signal: ctl.signal });
  expect(res.status, "the phone's stream opens").toBe(200);
  void (async () => {
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += value;
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const event = /^event: ?(.*)$/m.exec(block)?.[1];
          const data = block
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.replace(/^data: ?/, ""))
            .join("\n");
          if (!data) continue;
          const json = JSON.parse(data);
          if (event === "state") out.states.push(json);
          if (event === "ended") out.ended.push(json.reason);
        }
      }
    } catch {
      /* closed */
    }
  })();
  return out;
}
