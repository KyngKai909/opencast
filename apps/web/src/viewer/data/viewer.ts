// The viewer's shared data: the market, the dial, presets and reminders, and the actions that
// change them. Signed in, they're the account's; signed out, they're kept on this device and
// offered to the account at sign-in.

import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { accountsApi, stationsApi, type StationIdent } from "@opencast/contracts";
import { call } from "../../api/client";
import { DialX, MarketsX, type AiringX, type DialRowX, type StationIdentX } from "../api/ext";
import { keyFor, useApi } from "../../api/hooks";
import { useAuth } from "../../auth/AuthProvider";
import { getDevice, setDevice, useDevice } from "../device/store";
import { clock, useToast } from "@opencast/ui";
import type { SignInReason } from "../../auth/types";
import { MARKET_TZ } from "../../lib/clock";
import { addPreset, lowestFreeKey, placePreset, removePresetFrom } from "../components/you/presetRules";

export function useMarkets() {
  return useApi(stationsApi.listMarkets, {}, { schema: MarketsX, staleTime: 3600e3 });
}

export function useMe() {
  const auth = useAuth();
  return useApi(accountsApi.getMe, {}, { enabled: auth.signedIn });
}

/** The account's watch history and last channel (A2), signed in. */
export function useWatchHistory() {
  const auth = useAuth();
  return useApi(accountsApi.getWatchHistory, {}, { enabled: auth.signedIn, staleTime: 60_000 });
}

/**
 * The last channel: the account's (A2: kept from any of its phones, computers and TVs while
 * watch history is on), else the one tuned on this device.
 */
export function useLastChannelId(): string | null {
  const device = useDevice();
  const history = useWatchHistory();
  return history.data?.lastChannel?.station.id ?? device.lastStationId;
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
 * Why sign-in opened, with where "go back" returns to: "Two things before you go back to CIVC."
 * (`backTo` rides along on the reason; SignInModal reads it.)
 */
export type SignInReasonX = SignInReason;

/** The replace dialog's search params over the current page: ?modal=replace-key&station=<id>. */
export function replaceKeySearch(search: string, stationId: string): string {
  const p = new URLSearchParams(search);
  // Over the station preview (?station= alone): remember which, to go back to it on close.
  const preview = p.get("modal") ? null : p.get("station");
  if (preview) p.set("preview", preview);
  p.set("modal", "replace-key");
  p.set("station", stationId);
  return `?${p}`;
}

/**
 * Save, remind, pledge: each asks for sign-in at the moment it's needed and finishes afterwards;
 * signed out, saving and reminding can be kept on this device instead (closing sign-in keeps it,
 * with a toast that can undo it). Needs the router: with all six keys taken, saving opens the
 * replace dialog over the current page unless `onFull` says otherwise.
 */
export function useViewerActions() {
  const auth = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: keyFor(accountsApi.listPresets).slice(0, 2) });
    void qc.invalidateQueries({ queryKey: keyFor(accountsApi.listReminders).slice(0, 2) });
  }, [qc]);

  /** Opens "All six keys are taken" for a station, over whatever page is showing. */
  const openReplaceKey = useCallback((stationId: string) => navigate({ search: replaceKeySearch(window.location.search, stationId) }), [navigate]);

  /** The lowest free key 1 to 6, or null when all six are taken (the account's, or this device's). */
  const freeKey = useCallback(async (): Promise<number | null> => {
    if (!auth.signedIn) return lowestFreeKey(getDevice().presets);
    const list = await call(accountsApi.listPresets);
    return lowestFreeKey(list.map((p) => ({ stationId: p.station.id, key: p.key })));
  }, [auth.signedIn]);

  const savePreset = useCallback(
    (station: Pick<StationIdent, "id" | "callSign" | "channel">, opts: { key?: number | null; onFull?: () => void } = {}) => {
      const label = identLabel(station);
      const onFull = opts.onFull ?? (() => void openReplaceKey(station.id));
      const run = async () => {
        let key = opts.key;
        if (key === undefined) {
          const list = await call(accountsApi.listPresets);
          if (list.some((p) => p.station.id === station.id)) return; // Already a preset.
          key = lowestFreeKey(list.map((p) => ({ stationId: p.station.id, key: p.key })));
          if (key === null) return onFull(); // The replace dialog asks which key.
        }
        await call(accountsApi.savePreset, { body: { stationId: station.id, key: key ?? null } });
        refresh();
      };
      const onDevice = () => {
        const before = getDevice().presets;
        if (before.some((p) => p.stationId === station.id)) return;
        const next = opts.key !== undefined ? placePreset(before, station.id, opts.key) : addPreset(before, station.id);
        if (!next) return onFull(); // All six keys on this device are taken: the dialog asks here too.
        setDevice({ presets: next });
        toast.show({ message: `${label} saved on this device`, onUndo: () => setDevice({ presets: before }) });
      };
      const reason: SignInReasonX = { kind: "preset", label: `save ${label} as a preset`, finish: `Save ${label} and go back`, backTo: station.callSign ?? label };
      return auth.requireSignIn(reason, run, onDevice);
    },
    [auth, refresh, toast, openReplaceKey]
  );

  const removePreset = useCallback(
    async (stationId: string) => {
      if (auth.signedIn) {
        await call(accountsApi.removePreset, { params: { stationId } });
        refresh();
      } else setDevice((d) => ({ presets: removePresetFrom(d.presets, stationId) }));
    },
    [auth.signedIn, refresh]
  );

  const remind = useCallback(
    (target: ReminderTarget, switchMeOver = false) => {
      const ids = target.airing.listedAiringId ? { listedAiringId: target.airing.listedAiringId } : { logEntryId: target.airing.logEntryId ?? undefined };
      const at = clock(target.airing.startsAt, { timeZone: MARKET_TZ });
      const run = async () => {
        const r = await call(accountsApi.addReminder, { body: { ...ids, switchMeOver } });
        refresh();
        // A toast with Undo, not a modal.
        toast.show({
          message: `Reminder set for ${target.airing.title}, ${at}`,
          onUndo: async () => {
            await call(accountsApi.removeReminder, { params: { reminderId: r.id } });
            refresh();
          }
        });
      };
      const onDevice = () => {
        const before = getDevice().reminders;
        const id = ids.listedAiringId ?? ids.logEntryId;
        if (before.some((r) => (r.listedAiringId ?? r.logEntryId) === id)) return;
        setDevice({ reminders: [...before, { ...ids, switchMeOver, title: target.airing.title, startsAt: target.airing.startsAt, stationId: target.station.id }] });
        toast.show({ message: `Reminder set on this device for ${target.airing.title}, ${at}`, onUndo: () => setDevice({ reminders: before }) });
      };
      const reason: SignInReasonX = { kind: "remind", label: `be reminded about ${target.airing.title}`, finish: `Remind me and go back`, backTo: target.station.callSign ?? identLabel(target.station) };
      return auth.requireSignIn(reason, run, onDevice);
    },
    [auth, refresh, toast]
  );

  return { savePreset, removePreset, remind, freeKey, openReplaceKey };
}
