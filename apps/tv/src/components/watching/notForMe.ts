// "Not for me" in TV mode (follow-up Phase 1, 2026-09-29): an item on the menu rail, after the
// station line, while `features.notForMe` (GET /config) is on and a program is airing. The menu is
// reached with the remote's Menu key and the arrows, so no key of its own clashes with the
// player's. OK sends the vote with the heartbeat's session (never the person), once per airing;
// the item then reads "Noted" and a quiet line under the menu says what's kept. The switch is read
// at start (TvApp) and every few minutes, so turning it on needs no deploy.

import { useCallback, useState } from "react";
import { audienceApi, configApi } from "@opencast/contracts";
import { sessionId } from "@opencast/player";
import { ApiError, call } from "../../api/client";
import { useApi } from "../../api/hooks";

export const CONFIG_REFRESH_MS = 5 * 60_000;

/** Whether the menu offers it: false until `/config` says otherwise (and if it can't be read). */
export function useNotForMeFlag(): boolean {
  const q = useApi(configApi.getConfig, {}, { refetchInterval: CONFIG_REFRESH_MS, staleTime: 60_000, retry: 1 });
  return q.data?.features.notForMe ?? false;
}

/** Airings said about in this run of the app (station:log entry). */
const said = new Set<string>();

export function airingKey(stationId: string, airing: { logEntryId?: string | null; startsAt: string }): string {
  return `${stationId}:${airing.logEntryId ?? airing.startsAt}`;
}

/** Tests start from nothing. */
export function forgetNotForMe() {
  said.clear();
}

/** Whether the item shows: the switch is on and a program from a station's log is on. */
export function offersNotForMe(o: { flag: boolean; stationKind: string | null | undefined; airing: { kind?: string | null } | null | undefined }): boolean {
  if (!o.flag || !o.airing) return false;
  return o.stationKind !== "listed" && o.airing.kind !== "listed" && o.airing.kind !== "off_air";
}

export type NotForMeOutcome = "recorded" | "already_recorded" | "nothing_on";

/** The quiet line after OK. */
export function notForMeLine(outcome: NotForMeOutcome, title: string): string {
  if (outcome === "recorded") return "Noted. Only a count is kept, never who said it.";
  if (outcome === "already_recorded") return `You've already said ${title} isn't for you.`;
  return "Nothing is airing right now.";
}

/** The item's state and its action, for the airing on now. */
export function useNotForMe(stationId: string | null, airing: { logEntryId?: string | null; startsAt: string; title: string } | null) {
  const key = stationId && airing ? airingKey(stationId, airing) : null;
  const [line, setLine] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const say = useCallback(async () => {
    if (!stationId || !airing || !key || sending) return;
    if (said.has(key)) return setLine(notForMeLine("already_recorded", airing.title));
    setSending(true);
    try {
      const r = await call(audienceApi.voteNotForMe, { params: { stationId }, body: { sessionId: sessionId() } });
      said.add(key);
      setLine(notForMeLine(r.status, airing.title));
    } catch (e) {
      setLine(e instanceof ApiError && e.code === "nothing_on" ? notForMeLine("nothing_on", airing.title) : e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setSending(false);
    }
  }, [stationId, airing, key, sending]);
  return { said: !!key && said.has(key), line, say };
}
