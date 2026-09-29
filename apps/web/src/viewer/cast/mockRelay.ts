// dev:mock's relay: there's no API stream, so the phone reaches TV mode (VITE_TV_URL) through the
// same hidden bridge page the mock Cast sender uses (/mock-cast-bridge.html, served by TV mode's dev
// server in mock mode only), with TV mode's messages (apps/tv/src/mocks/handlers/remote.ts):
//   to the TV    { to: "relay-tv", tvId, phoneId, name, command }
//                { to: "relay-tv", tvId, phoneId, name, connected, kind }   the remote opened (true) or closed
//                { to: "relay-tv", phoneId, name, pairCode }                pairing: the TV's mock knows its codes
//   to phones    { to: "relay-phone", tvId, state, phoneId? }
//                { to: "relay-phone", tvId, ended, phoneId?, kind? }        ended: a reason, or { reason }
//                { to: "relay-phone", tvId, phoneId, paired }               pairing's answer (PairedPhone)
//                { to: "relay-phone", tvId: null, phoneId, error }          pairing refused ({ code, message })
// A message naming another phone, or the other kind of phone, isn't this one's. The mock can't tell
// whether TV mode is listening, so it never answers `tv_not_connected`. Never in a production
// build: sender.ts imports this only when VITE_MOCK is "true".

import { PairedPhone, PhoneRemoteEvents, RemoteState } from "@opencast/contracts";
import { bridgeFrame } from "./mockSender";
import type { PhoneEvent, RelayAuth, RelayLink, RelayRefusal } from "./relay";

type Frame = ReturnType<typeof bridgeFrame>;

export interface MockRelayLink extends RelayLink {
  /** Pairs with the TV showing this code, through the TV's own mock. Null when the TV didn't answer (TV mode isn't running). */
  pair(code: string, name: string, timeoutMs?: number): Promise<PairedPhone | RelayRefusal | null>;
}

let shared: MockRelayLink | null = null;

/** The page's one mock relay, so pairing and the remote are the same phone (one phoneId) to the TV. */
export function sharedMockRelay(tvUrl: string): MockRelayLink {
  return (shared ??= mockRelayLink(tvUrl));
}

/** The relay's two kinds of phone: signed in to the TV's account, or a guest's paired by code. */
const kindOf = (auth: RelayAuth) => (auth.kind === "paired" ? "guest" : "account");

/** A message from the bridge as a phone event for this phone and TV, or null. */
export function relayPhoneEvent(m: unknown, me: { tvId: string; phoneId?: string; kind?: "account" | "guest" }): PhoneEvent | null {
  if (!m || typeof m !== "object") return null;
  const x = m as { to?: unknown; tvId?: unknown; phoneId?: unknown; kind?: unknown; state?: unknown; ended?: unknown };
  if (x.to !== "relay-phone" || x.tvId !== me.tvId) return null;
  if (x.phoneId !== undefined && me.phoneId !== undefined && x.phoneId !== me.phoneId) return null;
  if (x.kind !== undefined && me.kind !== undefined && x.kind !== me.kind) return null;
  if (x.state !== undefined) {
    const s = RemoteState.safeParse(x.state);
    return s.success ? { event: "state", data: s.data } : null;
  }
  const e = PhoneRemoteEvents.ended.safeParse(typeof x.ended === "string" ? { reason: x.ended } : x.ended);
  return e.success ? { event: "ended", data: e.data } : null;
}

export function mockRelayLink(tvUrl: string, makeFrame: (tvUrl: string) => Frame = bridgeFrame): MockRelayLink {
  /** This phone, as the relay would name it. */
  const phoneId = crypto.randomUUID();
  let frame: Frame | null = null;
  let streams = 0;
  const bridge = () => (frame ??= makeFrame(tvUrl));

  return {
    async open(tvId, auth, on, name) {
      const f = bridge();
      const kind = kindOf(auth);
      streams++;
      const stop = f.listen((m) => {
        const e = relayPhoneEvent(m, { tvId, phoneId, kind });
        if (e) on.event(e);
      });
      let opened = false;
      const close = () => {
        stop();
        if (opened) f.post({ to: "relay-tv", tvId, phoneId, name, connected: false, kind });
        if (--streams === 0 && frame === f) {
          frame = null;
          // A moment for the "closed" message to cross before the bridge goes.
          setTimeout(() => f.close(), 1000);
        }
      };
      try {
        await f.ready();
      } catch (e) {
        close();
        throw e;
      }
      // The remote opened: the TV lists this phone, and answers with what it shows.
      opened = true;
      f.post({ to: "relay-tv", tvId, phoneId, name, connected: true, kind });
      let closed = false;
      return () => {
        if (closed) return;
        closed = true;
        close();
      };
    },
    async send(tvId, _auth, command, name) {
      const f = bridge();
      await f.ready();
      f.post({ to: "relay-tv", tvId, phoneId, name, command });
    },
    async pair(code, name, timeoutMs = 2500) {
      const f = bridge();
      await f.ready();
      return new Promise((resolve) => {
        const done = (answer: PairedPhone | RelayRefusal | null) => {
          clearTimeout(timer);
          stop();
          resolve(answer);
        };
        const timer = setTimeout(() => done(null), timeoutMs);
        const stop = f.listen((m) => {
          const x = m as { to?: unknown; phoneId?: unknown; paired?: unknown; error?: { code?: unknown; message?: unknown } };
          if (x.to !== "relay-phone" || x.phoneId !== phoneId) return;
          const paired = PairedPhone.safeParse(x.paired);
          if (paired.success) return done(paired.data);
          if (x.error && typeof x.error.code === "string" && typeof x.error.message === "string") done({ status: x.error.code === "too_many_tries" ? 429 : 404, code: x.error.code, message: x.error.message });
        });
        f.post({ to: "relay-tv", phoneId, name, pairCode: code });
      });
    }
  };
}
