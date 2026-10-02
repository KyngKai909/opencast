// The phone remote's relay, mocked (dev:mock only). The TV's stream (GET /tv/remote/events) is a
// streamed text/event-stream response fed from the BroadcastChannel the Cast mock uses, so a phone
// in another tab on this origin, or the viewer on its own origin through /mock-cast-bridge.html,
// drives this TV the way the API's relay would. What the TV posts goes back on the channel.
//
// On the channel "opencast-cast-mock" (phoneId: a UUID; name: "Kai's phone"):
//   to the TV   { to: "relay-tv", tvId, phoneId, name, command }            a command (tvApi's RemoteCommand)
//               { to: "relay-tv", tvId, phoneId, name, connected, kind? }   a phone's remote opened (true) or closed
//               { to: "relay-tv", phoneId, name, pairCode }                 pairPhone with the 4-digit code
//     (`kind` is "account" or "guest"; a phone that sends a command without pairing counts as the account's)
//   to phones   { to: "relay-phone", tvId, state }                          postRemoteState (RemoteState); also to a phone that connects
//               { to: "relay-phone", tvId, ended, phoneId?, kind? }         "tv_ended" (endRemote), "unpaired" (to phoneId), "signed_out" (to kind "account")
//               { to: "relay-phone", tvId, phoneId, paired }                pairPhone's answer (PairedPhone)
//               { to: "relay-phone", tvId: null, phoneId, error }           pairPhone refused ({ code: "code_not_found", message })
// In the console: __ocSignOutTvRemotely() signs this TV out as "Your TVs" would (a `signed_out` event).

import { http, HttpResponse, type HttpHandler } from "msw";
import { Id, Ok, RemoteCommand, RemotePairCode, RemotePhone, RemoteState, tvApi, type PairedPhone } from "@opencast/contracts";
import { z } from "zod";
import { MOCK_CAST_CHANNEL } from "../../cast/context";
import { now } from "../../lib/clock";
import { MOCK_TV_ID, MOCK_TV_NAME } from "../db";
import { fail, needsDevice, path, reply } from "../respond";
import { whenTvSignsOut } from "./signIn";

/** The bits of a BroadcastChannel the mock uses (tests pass their own). */
export interface MockChannel {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (e: MessageEvent) => void): void;
}

export const PAIR_MS = 5 * 60_000;
const PING_MS = 25_000;

const ToTv = z.union([
  z.object({ to: z.literal("relay-tv"), tvId: z.string(), phoneId: Id, name: z.string().min(1).max(60), command: RemoteCommand }),
  z.object({ to: z.literal("relay-tv"), tvId: z.string(), phoneId: Id, name: z.string().min(1).max(60), connected: z.boolean(), kind: z.enum(["account", "guest"]).optional() }),
  z.object({ to: z.literal("relay-tv"), phoneId: Id, name: z.string().min(1).max(60), pairCode: z.string() })
]);

export interface RemoteMock {
  handlers: HttpHandler[];
  /** The account signed this TV out ("Your TVs"). */
  signOutRemotely(): void;
  /** The TV signed itself out (signOutThisTv): its account phones' remotes end. */
  signedOutHere(): void;
  /** Streams open now (the TV is `online`). */
  streams(): number;
}

export function createRemoteMock(channel: MockChannel | null, o: { now?: () => number; pingMs?: number } = {}): RemoteMock {
  const clock = o.now ?? (() => now().getTime());
  const iso = () => new Date(clock()).toISOString();
  const phones = new Map<string, RemotePhone>();
  let pairCode: { code: string; expiresAt: number } | null = null;
  let lastState: RemoteState | null = null;
  const streams = new Set<(event: string, data: unknown) => void>();
  const encoder = new TextEncoder();

  const list = () => [...phones.values()].sort((a, b) => a.pairedAt.localeCompare(b.pairedAt));
  const toTv = (event: string, data: unknown) => streams.forEach((s) => s(event, data));
  const phonesChanged = () => toTv("phones", { phones: list() });
  const toPhones = (m: Record<string, unknown>) => channel?.postMessage({ to: "relay-phone", ...m });

  const phone = (phoneId: string, name: string, kind: "account" | "guest"): RemotePhone => {
    const p = phones.get(phoneId) ?? { id: phoneId, name, kind, connected: false, pairedAt: iso(), lastCommandAt: null };
    phones.set(phoneId, p);
    return p;
  };

  const endAccountPhones = () => {
    for (const p of [...phones.values()]) if (p.kind === "account") phones.delete(p.id);
    toPhones({ tvId: MOCK_TV_ID, ended: "signed_out", kind: "account" });
    phonesChanged();
  };

  channel?.addEventListener("message", (e: MessageEvent) => {
    const m = ToTv.safeParse(e.data);
    if (!m.success) return;
    const msg = m.data;
    if ("pairCode" in msg) {
      if (!pairCode || pairCode.code !== msg.pairCode || clock() >= pairCode.expiresAt) {
        toPhones({ tvId: null, phoneId: msg.phoneId, error: { code: "code_not_found", message: "That code isn't right, or it's run out. Check the code on the TV." } });
        return;
      }
      phones.set(msg.phoneId, { id: msg.phoneId, name: msg.name, kind: "guest", connected: false, pairedAt: iso(), lastCommandAt: null });
      const paired: PairedPhone = { tvId: MOCK_TV_ID, tvName: MOCK_TV_NAME, phoneToken: `mock-phone-token-${msg.phoneId}` };
      toPhones({ tvId: MOCK_TV_ID, phoneId: msg.phoneId, paired });
      phonesChanged();
      return;
    }
    if (msg.tvId !== MOCK_TV_ID) return;
    if ("connected" in msg) {
      const p = phone(msg.phoneId, msg.name, msg.kind ?? "account");
      phones.set(p.id, { ...p, name: msg.name, connected: msg.connected });
      if (msg.connected && lastState) toPhones({ tvId: MOCK_TV_ID, phoneId: msg.phoneId, state: lastState });
      phonesChanged();
      return;
    }
    // The API refuses a command while the TV's stream is closed (409 tv_not_connected); nothing hears it here either.
    if (!streams.size) return;
    const p = phone(msg.phoneId, msg.name, "account");
    const renamed = p.name !== msg.name;
    phones.set(p.id, { ...p, name: msg.name, lastCommandAt: iso() });
    toTv("command", { command: msg.command, from: { phoneId: msg.phoneId, name: msg.name }, at: iso() });
    if (renamed || !p.lastCommandAt) phonesChanged();
  });

  const handlers: HttpHandler[] = [
    http.get(path(tvApi.tvRemoteEvents), ({ request }) => {
      const denied = needsDevice(request);
      if (denied) return denied;
      let send: ((event: string, data: unknown) => void) | null = null;
      let ping: ReturnType<typeof setInterval> | undefined;
      const close = () => {
        if (send) streams.delete(send);
        send = null;
        if (ping) clearInterval(ping);
      };
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const write = (text: string) => {
            try {
              controller.enqueue(encoder.encode(text));
            } catch {
              close();
            }
          };
          send = (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          streams.add(send);
          write("retry: 3000\n\n");
          send("phones", { phones: list() });
          ping = setInterval(() => write(": ping\n\n"), o.pingMs ?? PING_MS);
          request.signal?.addEventListener("abort", () => {
            close();
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          });
        },
        cancel: close
      });
      return new HttpResponse(body, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" } });
    }),

    http.post(path(tvApi.postRemoteState), async ({ request }) => {
      const denied = needsDevice(request);
      if (denied) return denied;
      const state = RemoteState.safeParse(await request.json().catch(() => null));
      if (!state.success) return fail(400, "invalid", "That state isn't right.");
      lastState = state.data;
      toPhones({ tvId: MOCK_TV_ID, state: state.data });
      return reply(Ok, { ok: true });
    }),

    http.post(path(tvApi.endRemote), ({ request }) => {
      const denied = needsDevice(request);
      if (denied) return denied;
      lastState = null;
      toPhones({ tvId: MOCK_TV_ID, ended: "tv_ended" });
      return reply(Ok, { ok: true });
    }),

    http.post(path(tvApi.createPairCode), ({ request }) => {
      const denied = needsDevice(request);
      if (denied) return denied;
      // The frame's-style code first ("4821"), then made up: a new one replaces the last.
      const code = !pairCode ? "4821" : String(Math.floor(Math.random() * 10_000)).padStart(4, "0");
      pairCode = { code, expiresAt: clock() + PAIR_MS };
      return reply(RemotePairCode, { code, expiresAt: new Date(pairCode.expiresAt).toISOString() }, 201);
    }),

    http.get(path(tvApi.listRemotePhones), ({ request }) => needsDevice(request) ?? reply(z.array(RemotePhone), list())),

    http.delete(path(tvApi.removeRemotePhone), ({ request, params }) => {
      const denied = needsDevice(request);
      if (denied) return denied;
      const id = String(params.phoneId);
      if (!phones.delete(id)) return fail(404, "not_found", "That phone wasn't found.");
      toPhones({ tvId: MOCK_TV_ID, phoneId: id, ended: "unpaired" });
      phonesChanged();
      return reply(z.array(RemotePhone), list());
    })
  ];

  return {
    handlers,
    signOutRemotely() {
      toTv("signed_out", {});
      endAccountPhones();
    },
    signedOutHere: endAccountPhones,
    streams: () => streams.size
  };
}

// The app's mock: the real BroadcastChannel, in the browser only.
const MOCK = import.meta.env.VITE_MOCK === "true";
const browserChannel = MOCK && typeof window !== "undefined" && typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(MOCK_CAST_CHANNEL) : null;
const remote = createRemoteMock(browserChannel);
// The TV signing itself out ends its account phones' remotes, as the API does.
whenTvSignsOut(() => remote.signedOutHere());
if (MOCK && typeof window !== "undefined") (window as unknown as { __ocSignOutTvRemotely?: () => void }).__ocSignOutTvRemotely = () => remote.signOutRemotely();

export const remoteHandlers = remote.handlers;
