// What the TV app tells phones driving it through the relay, as the Cast receiver does over Cast:
// what's on, paused, who changed it and when the sleep timer ends, posted whenever one of them
// changes (POST /tv/remote/state). When the sleep timer stops Opencast the remote session ends
// (POST /tv/remote/end): phones are told, and the next phone to send a command starts a new one.

import { useEffect, useRef } from "react";
import { tvApi, type RemoteState } from "@opencast/contracts";
import { usePlayer, type CommandSource, type PlayerState } from "@opencast/player";
import { call } from "../api/client";
import { getDevice } from "./device";
import type { RelayInput } from "./relay";

let lastSource: CommandSource | undefined;

/** Every command's source, as it's dispatched: the state says who changed it last. */
export function noteSource(s: CommandSource | undefined) {
  lastSource = s;
}

/** A phone's name when the last command came through the relay; the TV's own remote is nobody's phone. */
export function changedByOf(s: CommandSource | undefined): string | null {
  return s?.input === "relay" ? (s.who ?? null) : null;
}

export function remoteStateOf(s: Pick<PlayerState, "currentId" | "status" | "sleep">, changedBy: string | null): RemoteState {
  return { stationId: s.currentId, paused: s.status === "paused", changedBy, sleepEndsAt: s.sleep ? Math.round(s.sleep.endsAt) : null };
}

export interface StatePoster {
  post(state: RemoteState): void;
  end(): void;
}

/** Posts only what changed, and only once the TV has its device token. A failed post is sent again next time. */
export function statePoster(send: { post(state: RemoteState): Promise<unknown>; end(): Promise<unknown> }, ready: () => boolean): StatePoster {
  let sent: string | null = null;
  return {
    post(state) {
      if (!ready()) return;
      const key = JSON.stringify(state);
      if (key === sent) return;
      sent = key;
      void send.post(state).catch(() => {
        if (sent === key) sent = null;
      });
    },
    end() {
      if (!ready()) return;
      sent = null;
      void send.end().catch(() => undefined);
    }
  };
}

const viaApi = { post: (body: RemoteState) => call(tvApi.postRemoteState, { body }), end: () => call(tvApi.endRemote) };

export function RelayStateToPhones({ relay, poster }: { relay: RelayInput; poster?: StatePoster }) {
  const [s] = usePlayer();
  const p = useRef(poster ?? statePoster(viaApi, () => !!getDevice().deviceToken));
  useEffect(() => {
    if (s.status !== "stopped") p.current.post(remoteStateOf(s, changedByOf(lastSource)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.currentId, s.status, s.sleep?.endsAt]);
  useEffect(() => {
    if (s.status !== "stopped") return;
    p.current.end();
    relay.reset();
  }, [s.status, relay]);
  return null;
}
