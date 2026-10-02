// "Not for me" in the player (follow-up Phase 1, 2026-09-29): behind `features.notForMe` from
// `GET /config`, off by default, read at start and again every few minutes (and when the page is
// back in view), so turning it on in the desk's Settings needs no deploy. A vote goes with the
// heartbeat's session (never the person), once per airing: this tab remembers the airings it said
// it about, as the API does per session.

import { useCallback, useState } from "react";
import { audienceApi, configApi } from "@opencast/contracts";
import { sessionId } from "@opencast/player";
import { useToast } from "@opencast/ui";
import { ApiError, call } from "../../api/client";
import { useApi } from "../../api/hooks";

/** How often the switches are read again. */
export const CONFIG_REFRESH_MS = 5 * 60_000;

/** Whether the control shows: false until `/config` says otherwise (and if it can't be read). */
export function useNotForMeFlag(): boolean {
  const q = useApi(configApi.getConfig, {}, { refetchInterval: CONFIG_REFRESH_MS, refetchOnWindowFocus: true, staleTime: 60_000, retry: 1 });
  return q.data?.features.notForMe ?? false;
}

const KEY = "oc-not-for-me";
let memory: string[] = [];

function readVoted(): string[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return memory;
  }
}

/** The airing's key: its log entry, else its station and start. */
export function airingKey(stationId: string, airing: { logEntryId?: string | null; startsAt: string }): string {
  return `${stationId}:${airing.logEntryId ?? airing.startsAt}`;
}

export function hasSaidNotForMe(key: string): boolean {
  return readVoted().includes(key);
}

export function rememberNotForMe(key: string) {
  const list = [...readVoted().filter((k) => k !== key), key].slice(-50);
  memory = list;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage off: remembered for this page */
  }
}

/** Tests start from nothing. */
export function forgetNotForMe() {
  memory = [];
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing kept */
  }
}

/**
 * Whether the player offers it: the switch is on, a program from a station's log is on (not off
 * air, not an external station's stream), and the player is tuned to it.
 */
export function offersNotForMe(o: { flag: boolean; stationKind: string | null | undefined; airing: { kind?: string | null; logEntryId?: string | null } | null; tuned: boolean }): boolean {
  if (!o.flag || !o.tuned || !o.airing) return false;
  if (o.stationKind === "listed" || o.airing.kind === "listed" || o.airing.kind === "off_air") return false;
  return true;
}

/** The confirmation, or what went wrong, in words. */
export function notForMeWords(outcome: "recorded" | "already_recorded" | "nothing_on", title: string): string {
  if (outcome === "recorded") return "Noted. Only a count is kept, never who said it.";
  if (outcome === "already_recorded") return `You've already said ${title} isn't for you.`;
  return "Nothing is airing right now.";
}

/** The control's state and its one action, for the airing on now. */
export function useNotForMe(stationId: string | null, airing: { logEntryId?: string | null; startsAt: string; title: string } | null) {
  const toast = useToast();
  const key = stationId && airing ? airingKey(stationId, airing) : null;
  const [, setTick] = useState(0);
  const [sending, setSending] = useState(false);
  const said = !!key && hasSaidNotForMe(key);
  const say = useCallback(async () => {
    if (!stationId || !airing || !key || sending || hasSaidNotForMe(key)) return;
    setSending(true);
    try {
      const r = await call(audienceApi.voteNotForMe, { params: { stationId }, body: { sessionId: sessionId() } });
      rememberNotForMe(key);
      toast.show({ message: notForMeWords(r.status, airing.title) });
    } catch (e) {
      if (e instanceof ApiError && e.code === "nothing_on") toast.show({ message: notForMeWords("nothing_on", airing.title) });
      else toast.show({ message: e instanceof Error ? e.message : "Something went wrong. Try again." });
    } finally {
      setSending(false);
      setTick((t) => t + 1);
    }
  }, [stationId, airing, key, sending, toast]);
  return { said, sending, say };
}
