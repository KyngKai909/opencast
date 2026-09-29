// The phone's casting or mirroring session, for the whole app: "Watch on" starts it, the remote
// reads it and sends through it, the cast button shows it, and it outlives page changes (the phone's
// guide, the tuned-in page). One session at a time.

import { useSyncExternalStore } from "react";
import { getMirroring, type MirrorStatus } from "./mirroring";
import { senderFor } from "./sender";
import type { CastSender, CastTarget, ReceiverState, RemoteCommand, SessionIntro } from "./types";

export type CastSession =
  | { status: "idle"; error: string | null }
  | { status: "connecting"; target: CastTarget }
  | { status: "casting"; target: CastTarget; me: string; receiver: ReceiverState | null }
  | { status: "mirroring"; target: CastTarget; receiver: ReceiverState | null }
  | { status: "mirror_stopped"; target: CastTarget; lockedAt: number };

const IDLE: CastSession = { status: "idle", error: null };
let session: CastSession = IDLE;
const listeners = new Set<() => void>();
let unsubs: Array<() => void> = [];
let activeSender: CastSender | null = null;
/** Until this phone sends its own command, a first state showing another station is the receiver not being ready yet. */
let settled = false;

function set(next: CastSession) {
  session = next;
  listeners.forEach((l) => l());
}

export function getCastSession(): CastSession {
  return session;
}

export function useCastSession(): CastSession {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => session,
    () => session
  );
}

/** The TV's state the remote draws, casting or mirroring. */
export function receiverOf(s: CastSession): ReceiverState | null {
  return s.status === "casting" || s.status === "mirroring" ? s.receiver : null;
}

/** Whether a TV is being driven from this phone. */
export function isRemoteActive(s: CastSession): boolean {
  return s.status === "casting" || s.status === "mirroring" || s.status === "connecting";
}

/** How long the phone waits for the receiver's first state before assuming the TV took the station it asked for. */
export const ASSUME_AFTER_MS = 1500;
/** A first state within this long that shows another station means the receiver wasn't ready for the phone's tune: ask again, once. */
export const RETUNE_WITHIN_MS = 8000;

/**
 * The receiver's first state after connecting. It only speaks when something changes, and it may
 * still be loading its dial when the phone's tune arrives: this decides whether to tune again. Not
 * when another phone changed the channel: that's theirs to change.
 */
export function shouldRetune(first: ReceiverState, asked: string | null, me: string, connectedAt: number, at: number): boolean {
  if (first.changedBy !== null && first.changedBy !== me) return false;
  return !!asked && first.stationId !== asked && at - connectedAt <= RETUNE_WITHIN_MS;
}

/** Starts casting to a TV, playing the station the phone has on. */
export async function startCast(target: CastTarget, intro: SessionIntro, start: { stationId: string; channel: string } | null): Promise<boolean> {
  const sender = await senderFor(target);
  if (!sender) {
    set({ status: "idle", error: "Casting isn't available here." });
    return false;
  }
  stopCasting();
  set({ status: "connecting", target });
  settled = false;
  const connectedAt = Date.now();
  // The receiver answers the introduction with what it has on. The phone tunes it only if that's
  // another station; if the receiver wasn't ready for the tune, the next state says so, and it asks
  // once more. A receiver that doesn't answer is assumed to have taken the tune.
  let phase: "first" | "tuned" | "done" = "first";
  let early: ReceiverState | null = null;
  const tune = () => start && sender.send({ type: "tune", channel: start.channel });
  const onState = (state: ReceiverState) => {
    if (phase === "first") {
      phase = "tuned";
      if (start && state.stationId !== start.stationId) tune();
    } else if (phase === "tuned") {
      phase = "done";
      if (!settled && start && shouldRetune(state, start.stationId, intro.from, connectedAt, Date.now())) tune();
    }
    const s = session;
    if (s.status === "casting") set({ ...s, receiver: state });
    else early = state;
  };
  // Listening before connecting, so the answer to the introduction isn't missed.
  unsubs.push(
    sender.onState(onState),
    sender.onEnded((message) => {
      cleanup();
      set(message ? { status: "idle", error: message } : IDLE);
    })
  );
  try {
    const connected = await sender.connect(target, intro);
    activeSender = sender;
    set({ status: "casting", target: connected, me: intro.from, receiver: early });
    if (start) {
      const timer = setTimeout(() => {
        if (phase !== "first") return;
        phase = "tuned";
        tune();
        const s = session;
        if (s.status === "casting" && !s.receiver) set({ ...s, receiver: { stationId: start.stationId, paused: false, changedBy: intro.from, sleepEndsAt: null } });
      }, ASSUME_AFTER_MS);
      unsubs.push(() => clearTimeout(timer));
    }
    return true;
  } catch (e) {
    cleanup();
    set({ status: "idle", error: (e as Error).message || "Casting didn't start." });
    return false;
  }
}

function cleanup() {
  unsubs.forEach((u) => u());
  unsubs = [];
  activeSender = null;
}

/** Sends a command to the TV. */
export function sendToTv(command: RemoteCommand) {
  const s = session;
  settled = true;
  if (s.status === "casting") activeSender?.send(command);
  else if (s.status === "mirroring") void getMirroring().then((m) => m?.send(command));
}

/** Stop: casting ends on the TV; mirroring stops drawing TV mode there. */
export function stopCasting() {
  const s = session;
  if (s.status === "casting" || s.status === "connecting") activeSender?.disconnect();
  if (s.status === "mirroring" || s.status === "mirror_stopped") void getMirroring().then((m) => m?.stop());
  cleanup();
  if (s.status !== "idle") set(IDLE);
}

/** The mirroring seam's status, reflected in the session (CastSync calls this on every change). */
export function applyMirrorStatus(m: MirrorStatus) {
  const s = session;
  if (s.status === "casting" || s.status === "connecting") return;
  const target: CastTarget = { id: `airplay:${m.tvName ?? ""}`, name: m.tvName ?? "the TV", kind: "airplay" };
  if (m.connected) {
    set({ status: "mirroring", target, receiver: m.receiver ?? (s.status === "mirroring" ? s.receiver : null) });
  } else if (m.lockedAt !== null && (s.status === "mirroring" || s.status === "mirror_stopped")) {
    set({ status: "mirror_stopped", target, lockedAt: m.lockedAt });
  } else if (s.status === "mirroring") {
    set(IDLE);
  }
}

/** While mirroring, the TV's state (in dev:mock, the phone's own player standing in for it). */
export function setMirrorReceiver(state: ReceiverState) {
  const s = session;
  if (s.status === "mirroring") set({ ...s, receiver: state });
}

/** Clears a "didn't start" message once it's been shown. */
export function clearCastError() {
  if (session.status === "idle" && session.error) set(IDLE);
}

/** Tests only. */
export function resetCastSessionForTests() {
  cleanup();
  set(IDLE);
}
