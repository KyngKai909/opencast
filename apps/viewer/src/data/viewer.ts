// The viewer's shared data: the market, the dial, presets and reminders, and the actions that
// change them. Signed in, they're the account's; signed out, they're kept on this device and
// offered to the account at sign-in.

import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { accountsApi, stationsApi, type StationIdent } from "@opencast/contracts";
import { call } from "../api/client";
import { DialX, MarketsX, type AiringX, type DialRowX, type StationIdentX } from "../api/ext";
import { keyFor, useApi } from "../api/hooks";
import { useAuth } from "../auth/AuthProvider";
import { setDevice, useDevice } from "../device/store";
import { useToast } from "@opencast/ui";

export function useMarkets() {
  return useApi(stationsApi.listMarkets, {}, { schema: MarketsX, staleTime: 3600e3 });
}

export function useMe() {
  const auth = useAuth();
  return useApi(accountsApi.getMe, {}, { enabled: auth.signedIn });
}

/** The market the dial is for: the account's, or the one chosen on this device. Null: first visit. */
export function useMarketSlug(): string | null {
  const me = useMe();
  const device = useDevice();
  return me.data?.market?.slug ?? device.marketSlug;
}

export function useDial(band: "tv" | "radio", marketSlug = useMarketSlug()) {
  return useApi(stationsApi.getDial, { params: { marketSlug: marketSlug ?? "" }, query: { band } }, { schema: DialX, enabled: !!marketSlug, refetchInterval: 60_000 });
}

/** Every station on the market's dial, both bands, in channel order: what the player tunes. */
export function useChannels(): DialRowX[] {
  const tv = useDial("tv");
  const radio = useDial("radio");
  return useMemo(() => [...(tv.data?.rows ?? []), ...(radio.data?.rows ?? [])], [tv.data, radio.data]);
}

export interface PresetView {
  key: number | null;
  station: StationIdentX;
  position: number;
  /** What it's airing now, when the station's on this market's dial. */
  row?: DialRowX;
}

export function usePresets(): { presets: PresetView[]; loading: boolean; onDevice: boolean } {
  const auth = useAuth();
  const device = useDevice();
  const channels = useChannels();
  const remote = useApi(accountsApi.listPresets, {}, { enabled: auth.signedIn });
  return useMemo(() => {
    const rowFor = (id: string) => channels.find((c) => c.station.id === id);
    if (auth.signedIn) {
      const list = (remote.data ?? []).map((p) => ({ key: p.key, station: rowFor(p.station.id)?.station ?? p.station, position: p.position, row: rowFor(p.station.id) }));
      return { presets: list, loading: remote.isLoading, onDevice: false };
    }
    const list = device.presets.flatMap((p, i) => {
      const row = rowFor(p.stationId);
      return row ? [{ key: p.key, station: row.station, position: i, row }] : [];
    });
    return { presets: list, loading: false, onDevice: true };
  }, [auth.signedIn, remote.data, remote.isLoading, device.presets, channels]);
}

export interface ReminderTarget {
  airing: Pick<AiringX, "logEntryId" | "listedAiringId" | "title" | "startsAt">;
  station: Pick<StationIdent, "id" | "callSign" | "channel">;
}

function identLabel(s: Pick<StationIdent, "callSign" | "channel">) {
  return [s.callSign, s.channel].filter(Boolean).join(" ");
}

/**
 * Save, remind, pledge: each asks for sign-in at the moment it's needed and finishes afterwards;
 * signed out, saving and reminding can be kept on this device instead.
 */
export function useViewerActions() {
  const auth = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: keyFor(accountsApi.listPresets).slice(0, 2) });
    void qc.invalidateQueries({ queryKey: keyFor(accountsApi.listReminders).slice(0, 2) });
  }, [qc]);

  /** The lowest free key 1 to 6, or null when all six are taken. */
  const freeKey = useCallback(async (): Promise<number | null> => {
    const list = auth.signedIn ? await call(accountsApi.listPresets) : (await Promise.resolve(null), null);
    const taken = new Set((list ?? []).map((p) => p.key).filter((k): k is number => k !== null));
    for (let k = 1; k <= 6; k++) if (!taken.has(k)) return k;
    return null;
  }, [auth.signedIn]);

  const savePreset = useCallback(
    (station: Pick<StationIdent, "id" | "callSign" | "channel">, opts: { key?: number | null; onFull?: () => void } = {}) => {
      const run = async () => {
        let key = opts.key;
        if (key === undefined) {
          key = await freeKey();
          if (key === null && opts.onFull) return opts.onFull(); // The replace dialog asks which key.
        }
        await call(accountsApi.savePreset, { body: { stationId: station.id, key: key ?? null } });
        refresh();
      };
      const onDevice = () => {
        setDevice((d) => {
          if (d.presets.some((p) => p.stationId === station.id)) return {};
          const taken = new Set(d.presets.map((p) => p.key));
          const key = [1, 2, 3, 4, 5, 6].find((k) => !taken.has(k)) ?? null;
          return { presets: [...d.presets, { stationId: station.id, key }] };
        });
      };
      const label = identLabel(station);
      return auth.requireSignIn({ kind: "preset", label: `save ${label} as a preset`, finish: `Save ${label} and go back` }, run, onDevice);
    },
    [auth, freeKey, refresh]
  );

  const removePreset = useCallback(
    async (stationId: string) => {
      if (auth.signedIn) {
        await call(accountsApi.removePreset, { params: { stationId } });
        refresh();
      } else setDevice((d) => ({ presets: d.presets.filter((p) => p.stationId !== stationId) }));
    },
    [auth.signedIn, refresh]
  );

  const remind = useCallback(
    (target: ReminderTarget, switchMeOver = false) => {
      const ids = target.airing.listedAiringId ? { listedAiringId: target.airing.listedAiringId } : { logEntryId: target.airing.logEntryId ?? undefined };
      const run = async () => {
        const r = await call(accountsApi.addReminder, { body: { ...ids, switchMeOver } });
        refresh();
        // A toast with Undo, not a modal.
        toast.show({
          message: `Reminder set for ${target.airing.title}, ${new Date(target.airing.startsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" }).toLowerCase()}`,
          onUndo: async () => {
            await call(accountsApi.removeReminder, { params: { reminderId: r.id } });
            refresh();
          }
        });
      };
      const onDevice = () => setDevice((d) => ({ reminders: [...d.reminders, { ...ids, switchMeOver, title: target.airing.title, startsAt: target.airing.startsAt, stationId: target.station.id }] }));
      return auth.requireSignIn({ kind: "remind", label: `be reminded about ${target.airing.title}`, finish: `Remind me and go back` }, run, onDevice);
    },
    [auth, refresh, toast]
  );

  return { savePreset, removePreset, remind, freeKey };
}
