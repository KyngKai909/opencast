// TV mode's data: the market's dial (both bands, in channel order), who's signed in, presets
// (the account's, or this TV's while signed out), reminders.

import { useMemo } from "react";
import { accountsApi, stationsApi } from "@opencast/contracts";
import { DialX, type DialRowX } from "../api/ext";
import { useApi } from "../api/hooks";
import { now } from "../lib/clock";
import { useDevice } from "./device";

/** Until the TV knows its market (S10: from the connection), the Inland Empire in mock mode. */
export const DEFAULT_MARKET = "inland-empire";

export function useSignedIn(): boolean {
  return !!useDevice().token;
}

export function useMe() {
  return useApi(accountsApi.getMe, {}, { enabled: useSignedIn(), staleTime: 60_000 });
}

export function useMarketSlug(): string {
  const me = useMe();
  const d = useDevice();
  return me.data?.market?.slug ?? d.marketSlug ?? DEFAULT_MARKET;
}

export function useDial(band: "tv" | "radio") {
  const slug = useMarketSlug();
  return useApi(stationsApi.getDial, { params: { marketSlug: slug }, query: { band } }, { schema: DialX, refetchInterval: (q) => nextRefresh(q.state.data?.rows ?? [], now().getTime()) });
}

/**
 * When to read the dial again: a second after the first program on it ends (so the banner never
 * shows a program that's over), and at least every minute.
 */
export function nextRefresh(rows: Array<{ now?: { endsAt?: string | null } | null }>, at: number): number {
  const ends = rows.map((r) => Date.parse(r.now?.endsAt ?? "")).filter((t) => t > at);
  return Math.max(1_000, Math.min(60_000, (ends.length ? Math.min(...ends) : Infinity) - at + 1_000));
}

/**
 * Every station on both bands, in channel order: what the player tunes. Nothing until both bands
 * have answered, so the first tune is the first TV channel whichever band's dial comes back first.
 */
export function useChannels(): DialRowX[] {
  const tv = useDial("tv");
  const radio = useDial("radio");
  const waiting = tv.isPending || radio.isPending;
  return useMemo(() => (waiting ? [] : [...(tv.data?.rows ?? []), ...(radio.data?.rows ?? [])]), [waiting, tv.data, radio.data]);
}

export interface TvPreset {
  key: number;
  row: DialRowX | null;
  stationId: string;
}

/** Keys 1 to 6: the account's presets when signed in, this TV's otherwise. */
export function usePresets(): { presets: TvPreset[]; loading: boolean } {
  const signedIn = useSignedIn();
  const d = useDevice();
  const channels = useChannels();
  const remote = useApi(accountsApi.listPresets, {}, { enabled: signedIn });
  return useMemo(() => {
    const rowFor = (id: string) => channels.find((c) => c.station.id === id) ?? null;
    const keyed: Array<{ key: number; stationId: string }> = signedIn
      ? (remote.data ?? []).filter((p) => p.key !== null).map((p) => ({ key: p.key!, stationId: p.station.id }))
      : Object.entries(d.presets).map(([k, id]) => ({ key: Number(k), stationId: id }));
    return { presets: keyed.sort((a, b) => a.key - b.key).map((p) => ({ ...p, row: rowFor(p.stationId) })), loading: signedIn && remote.isLoading };
  }, [signedIn, remote.data, remote.isLoading, d.presets, channels]);
}
