// Where settings are kept: on the account when signed in (accounts.updateMe settings, and
// notifications.getPrefs / setPrefs), on this device when signed out. Each change saves at once,
// with the account's copy updated first so the screen doesn't wait.

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { accountsApi, notificationsApi, type Me, type NotificationPrefs, type ViewerSettings } from "@opencast/contracts";
import { call } from "../../api/client";
import { useApi } from "../../api/hooks";
import { getCached, setCached } from "../you/cache";
import { useAuth } from "../../auth/AuthProvider";
import { useMe } from "../../data/viewer";
import { setDevice, useDevice } from "../../device/store";

export type SettingsPatch = { [K in keyof ViewerSettings]?: Partial<NonNullable<ViewerSettings[K]>> } & Record<string, unknown>;

/** One section deep: a patch's section merges into the saved one, other sections stay. */
export function mergeSettings(cur: ViewerSettings, patch: SettingsPatch): ViewerSettings {
  const out: Record<string, unknown> = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    const prev = out[k];
    out[k] = v && typeof v === "object" && !Array.isArray(v) && prev && typeof prev === "object" ? { ...(prev as object), ...(v as object) } : v;
  }
  return out as ViewerSettings;
}

/** Where a change goes. */
export function settingsTarget(signedIn: boolean): "account" | "device" {
  return signedIn ? "account" : "device";
}

/**
 * Saves a settings patch to the account or the device. `account` is the updateMe call; `device`
 * writes the device store. Returns what's saved.
 */
export async function saveSettings(
  signedIn: boolean,
  cur: ViewerSettings,
  patch: SettingsPatch,
  io: { account: (patch: SettingsPatch) => Promise<ViewerSettings>; device: (next: ViewerSettings) => void }
): Promise<ViewerSettings> {
  if (settingsTarget(signedIn) === "account") return io.account(patch);
  const next = mergeSettings(cur, patch);
  io.device(next);
  return next;
}

export function useSettings() {
  const auth = useAuth();
  const me = useMe();
  const device = useDevice();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const settings: ViewerSettings = auth.signedIn ? (me.data?.settings ?? {}) : device.settings;

  const save = useCallback(
    async (patch: SettingsPatch) => {
      setError(null);
      const before = getCached<Me>(qc, accountsApi.getMe);
      try {
        await saveSettings(auth.signedIn, settings, patch, {
          account: async (p) => {
            if (before) setCached<Me>(qc, accountsApi.getMe, {}, { ...before, settings: mergeSettings(before.settings, p) });
            const saved = await call(accountsApi.updateMe, { body: { settings: p } });
            setCached<Me>(qc, accountsApi.getMe, {}, saved);
            return saved.settings;
          },
          device: (next) => setDevice({ settings: next })
        });
      } catch (e) {
        if (before) setCached<Me>(qc, accountsApi.getMe, {}, before);
        setError((e as Error).message);
      }
    },
    [auth.signedIn, settings, qc]
  );

  return { settings, save, error, loading: auth.signedIn && me.isLoading, target: settingsTarget(auth.signedIn), me: me.data ?? null };
}

const PREFS_ARGS = { query: { scope: "viewer" } };

/** Notification kinds and channels: the account's prefs, or this device's while signed out. */
export function useNotificationPrefs() {
  const auth = useAuth();
  const device = useDevice();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const remote = useApi(notificationsApi.getPrefs, PREFS_ARGS, { enabled: auth.signedIn });
  const devicePrefs = ((device.settings as Record<string, unknown>).notificationPrefs ?? {}) as NotificationPrefs;
  const prefs: NotificationPrefs = auth.signedIn ? (remote.data?.prefs ?? {}) : devicePrefs;

  const set = useCallback(
    async (kind: string, value: { push?: boolean; email?: boolean }) => {
      setError(null);
      const next = { ...(prefs[kind] ?? { push: false, email: false }), ...value };
      if (!auth.signedIn) {
        setDevice((d) => ({ settings: mergeSettings(d.settings, { notificationPrefs: { ...devicePrefs, [kind]: next } }) }));
        return;
      }
      const before = getCached<{ prefs: NotificationPrefs; alwaysOn: string[] }>(qc, notificationsApi.getPrefs, PREFS_ARGS);
      if (before) setCached(qc, notificationsApi.getPrefs, PREFS_ARGS, { ...before, prefs: { ...before.prefs, [kind]: next } });
      try {
        const saved = await call(notificationsApi.setPrefs, { body: { scope: "viewer", scopeId: null, prefs: { ...prefs, [kind]: next } } });
        setCached(qc, notificationsApi.getPrefs, PREFS_ARGS, saved);
      } catch (e) {
        if (before) setCached(qc, notificationsApi.getPrefs, PREFS_ARGS, before);
        setError((e as Error).message);
      }
    },
    [auth.signedIn, prefs, devicePrefs, qc]
  );

  return { prefs, set, error, loading: auth.signedIn && remote.isLoading, alwaysOn: remote.data?.alwaysOn ?? [] };
}
