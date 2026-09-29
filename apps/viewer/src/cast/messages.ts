// The messages on Opencast's Cast namespace, as the receiver reads and writes them (apps/tv receiver.tsx and
// @opencast/player's parseCastCommand): the phone's "session" introduction first, then commands,
// each naming the phone; the receiver answers every phone with the state.

import { CAST_NAMESPACE } from "@opencast/player";
import type { ReceiverState, RemoteCommand, SessionIntro } from "./types";

export { CAST_NAMESPACE };

/** The dev:mock channel the receiver listens on (apps/tv/src/cast/context.ts MOCK_CAST_CHANNEL). */
export const MOCK_CAST_CHANNEL = "opencast-cast-mock";

/** A message on the mock channel (apps/tv/src/cast/context.ts MockCastMessage), carried by the bridge page. */
export type MockCastMessage =
  | { to: "receiver"; senderId: string; namespace: string; data: unknown }
  | { to: "sender"; senderId: string | null; namespace: string; data: unknown }
  | { to: "receiver"; senderId: string; kind: "connect" | "disconnect"; name?: string };

/** Signed out, the chip reads "Playing from a phone". */
export const SIGNED_OUT_NAME = "a phone";

/**
 * The phone's name for the TV's chip, from the account's first name: "Kai M." is "Kai's phone".
 * iOS no longer gives apps the device's own name, so it's built from the account (raise 9).
 */
export function phoneName(displayName: string | null | undefined): string {
  const first = (displayName ?? "").trim().split(/\s+/)[0]?.replace(/[.,]+$/, "") ?? "";
  if (!first) return SIGNED_OUT_NAME;
  return `${first.slice(0, 40)}'s phone`;
}

/**
 * The iPhone's name for the mirrored TV's chip ("Mirrored from Kai's iPhone"), from the account as
 * phoneName is; null signed out, and TV mode says "Mirrored from an iPhone".
 */
export function mirrorDeviceName(displayName: string | null | undefined): string | null {
  const name = phoneName(displayName);
  return name === SIGNED_OUT_NAME ? null : name.replace(/'s phone$/, "'s iPhone");
}

export function sessionMessage(intro: SessionIntro) {
  return { type: "session" as const, from: intro.from, marketSlug: intro.marketSlug, othersCanChange: intro.othersCanChange };
}

export function commandMessage(command: RemoteCommand, from: string) {
  return { ...command, from };
}

/** Reads a state message from the receiver (a string on a real Cast session, an object on the mock). Anything else is null. */
export function parseState(data: unknown): ReceiverState | null {
  let m = data;
  if (typeof m === "string") {
    try {
      m = JSON.parse(m);
    } catch {
      return null;
    }
  }
  if (!m || typeof m !== "object" || (m as { type?: unknown }).type !== "state") return null;
  const s = m as Record<string, unknown>;
  return {
    stationId: typeof s.stationId === "string" ? s.stationId : null,
    paused: s.paused === true,
    changedBy: typeof s.changedBy === "string" ? s.changedBy : null,
    sleepEndsAt: typeof s.sleepEndsAt === "number" ? s.sleepEndsAt : null
  };
}

/** Whether a message from the receiver is its "I'm here" (it started or restarted: introduce the phone again). */
export function isReceiverReady(data: unknown): boolean {
  return !!data && typeof data === "object" && (data as { type?: unknown }).type === "receiver-ready";
}

/** The receiver ended the session (the sleep timer ran out). On a real Cast session the SDK says so itself (SESSION_ENDED). */
export function isSessionEnded(data: unknown): boolean {
  return !!data && typeof data === "object" && (data as { type?: unknown }).type === "session-ended";
}

/** Another phone changed the channel: the state names someone other than this phone. */
export function changedByOther(state: ReceiverState | null, me: string): string | null {
  if (!state?.changedBy || state.changedBy === me) return null;
  return state.changedBy;
}
