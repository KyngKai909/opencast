// TV settings, read and saved. A change applies on this TV at once (the device store, which the
// player follows) and, signed in, goes to the account a moment later (several ◀ ▶ presses become
// one save), so the account's other TVs use it too. The account's values come back to this TV
// whenever the account is read (useAccountSettingsSync).

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { accountsApi } from "@opencast/contracts";
import { call } from "../../api/client";
import { useMe } from "../../tv/data";
import { getDevice, setDevice, useDevice, type TvSettings } from "../../tv/device";
import { changed, fromAccount, toAccount, type TvSettingsX } from "./model";

const SAVE_AFTER_MS = 600;
/** Changes not yet on the account: an account read mustn't put the old values back meanwhile. */
let unsaved = 0;

export function invalidateMe(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ queryKey: [accountsApi.getMe.method, accountsApi.getMe.path] });
}

export function useTvSettings() {
  const device = useDevice();
  const signedIn = !!device.token;
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const queued = useRef<Partial<TvSettingsX>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const patch = queued.current;
    queued.current = {};
    if (!Object.keys(patch).length) return;
    try {
      await call(accountsApi.updateMe, { body: { settings: toAccount(patch) } });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      unsaved = Math.max(0, unsaved - 1);
      void invalidateMe(qc);
    }
  }, [qc]);

  // Leaving settings saves what's waiting.
  useEffect(() => () => void flush(), [flush]);

  const save = useCallback(
    (patch: Partial<TvSettingsX>) => {
      setDevice({ settings: patch as TvSettings }); // setDevice merges settings; its type asks for all of them
      if (!getDevice().token) return;
      if (!Object.keys(queued.current).length) unsaved++;
      queued.current = { ...queued.current, ...patch };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS);
    },
    [flush]
  );

  return { settings: device.settings as TvSettingsX, save, signedIn, error };
}

/** Puts the account's settings on this TV when the account is read (signed in only). */
export function useAccountSettingsSync() {
  const me = useMe();
  const settings = me.data?.settings;
  useEffect(() => {
    if (!settings || unsaved > 0 || !getDevice().token) return;
    const diff = changed(getDevice().settings as TvSettingsX, fromAccount(settings));
    if (Object.keys(diff).length) setDevice({ settings: diff as TvSettings });
  }, [settings]);
}
