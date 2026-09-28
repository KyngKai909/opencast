// Data the live, listings and library screens share.

import { logApi, stationsApi } from "@opencast/contracts";
import { useMemo } from "react";
import { useApi } from "../../api/hooks";
import { listHosts, LiveSourcesExt } from "../../api/ext/live";
import { now } from "../../lib/clock";
import { useMe, useStation } from "../../station/StationContext";

const HOUR = 3600e3;

/** A window of the log around now: from `back` hours ago to `days` days on. Fixed per page visit. */
export function useLogWindow(days = 8, back = 12) {
  const window = useMemo(() => {
    const t = now().getTime();
    return { from: new Date(t - back * HOUR).toISOString(), to: new Date(t + days * 24 * HOUR).toISOString() };
  }, [days, back]);
  const s = useStation();
  return useApi(logApi.getLog, { params: { stationId: s.id }, query: window }, { refetchInterval: 60_000 });
}

export function useLiveSources() {
  const s = useStation();
  return useApi(stationsApi.listLiveSources, { params: { stationId: s.id } }, { schema: LiveSourcesExt, refetchInterval: 15_000 });
}

/** A4 (proposed): who hosts each live program. Absent on the real API until it lands. */
export function useHosts() {
  const s = useStation();
  return useApi(listHosts, { params: { stationId: s.id } }, { retry: false });
}

/** The live programs this person hosts (a host sees only these, A27). */
export function useMyHostedPrograms(): string[] | null {
  const me = useMe();
  const hosts = useHosts();
  return useMemo(() => {
    if (!hosts.data || !me.data) return hosts.isError ? [] : null;
    return hosts.data.programs.filter((p) => p.hosts.some((h) => h.userId === me.data!.id)).map((p) => p.programId);
  }, [hosts.data, hosts.isError, me.data]);
}
