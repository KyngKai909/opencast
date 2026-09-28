// Changing the presets as a whole list (drag to reorder, replace a key, give it a key, remove):
// on the account with reorderPresets, shown at once and synced after; on this device while
// signed out. The rules are presetRules'.

import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { accountsApi, type Preset } from "@opencast/contracts";
import { call } from "../../api/client";
import { getCached, setCached } from "./cache";
import { useAuth } from "../../auth/AuthProvider";
import { usePresets, type PresetView } from "../../data/viewer";
import { getDevice, setDevice } from "../../device/store";
import type { KeyedPreset } from "./presetRules";

export function usePresetEditor() {
  const auth = useAuth();
  const qc = useQueryClient();
  const { presets, loading, onDevice } = usePresets();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The list the rules work on, in order. */
  const list: KeyedPreset[] = useMemo(() => presets.map((p) => ({ stationId: p.station.id, key: p.key })), [presets]);

  /** Makes `next` the presets, everywhere. Returns false when the account refused it. */
  const apply = useCallback(
    async (next: KeyedPreset[]): Promise<boolean> => {
      setError(null);
      if (!auth.signedIn) {
        setDevice({ presets: next.map((p) => ({ stationId: p.stationId, key: p.key })) });
        return true;
      }
      const before = getCached<Preset[]>(qc, accountsApi.listPresets);
      if (before) {
        const byId = new Map(before.map((p) => [p.station.id, p.station] as const));
        const extra = new Map(presets.map((p: PresetView) => [p.station.id, p.station] as const));
        setCached<Preset[]>(
          qc,
          accountsApi.listPresets,
          {},
          next.flatMap((p, i) => {
            const station = byId.get(p.stationId) ?? extra.get(p.stationId);
            return station ? [{ station, key: p.key, position: i }] : [];
          })
        );
      }
      setSaving(true);
      try {
        const saved = await call(accountsApi.reorderPresets, { body: next.map((p) => ({ stationId: p.stationId, key: p.key })) });
        setCached(qc, accountsApi.listPresets, {}, saved);
        return true;
      } catch (e) {
        if (before) setCached(qc, accountsApi.listPresets, {}, before);
        setError((e as Error).message);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [auth.signedIn, qc, presets]
  );

  /** The current list, read fresh (for the device, which may have changed since render). */
  const current = useCallback((): KeyedPreset[] => (auth.signedIn ? list : getDevice().presets.map((p) => ({ ...p }))), [auth.signedIn, list]);

  return { presets, list, loading, onDevice, apply, current, saving, error };
}
