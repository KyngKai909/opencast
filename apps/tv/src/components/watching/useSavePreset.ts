// Saving a preset from the TV: signed in, to the account (accounts.savePreset; a taken key moves
// its station to More presets); signed out, to this TV. Also counts preset presses for the
// account's "least used key" (accounts.usePresetKey).

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { accountsApi } from "@opencast/contracts";
import { call } from "../../api/client";
import { getDevice, setDevice } from "../../tv/device";
import { saveOnDevice } from "./presetStrip";

export function useSavePreset() {
  const qc = useQueryClient();
  const save = useCallback(
    async (key: number, stationId: string) => {
      if (!getDevice().token) {
        setDevice((d) => ({ presets: saveOnDevice(d.presets, key, stationId) }));
        return;
      }
      await call(accountsApi.savePreset, { body: { stationId, key } });
      await qc.invalidateQueries({ queryKey: [accountsApi.listPresets.method, accountsApi.listPresets.path] });
    },
    [qc]
  );
  const used = useCallback((key: number) => {
    if (getDevice().token) void call(accountsApi.usePresetKey, { params: { key } }).catch(() => {});
  }, []);
  return { save, used };
}
