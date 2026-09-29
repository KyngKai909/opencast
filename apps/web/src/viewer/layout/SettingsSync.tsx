// The account's settings (or this device's, signed out) applied from the start, not only when
// changed in Settings: the ground and "Reduce motion". Captions go to the player in PlayerSync.

import { useEffect } from "react";
import { useGround } from "@opencast/ui";
import { useAuth } from "../../auth/AuthProvider";
import { useMe } from "../data/viewer";
import { useDevice } from "../device/store";

export function useSavedSettings() {
  const auth = useAuth();
  const me = useMe();
  const device = useDevice();
  return auth.signedIn ? (me.data?.settings ?? null) : device.settings;
}

export function SettingsSync() {
  const settings = useSavedSettings();
  const { choice, setChoice } = useGround();
  const ground = settings?.appearance?.ground;
  const reduce = settings?.appearance?.reducedMotion ?? false;

  // Only when the saved ground changes (sign-in, another device), so a change here isn't fought.
  useEffect(() => {
    if (ground && ground !== choice) setChoice(ground);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ground]);

  useEffect(() => {
    if (reduce) document.documentElement.dataset.motion = "reduce";
    else delete document.documentElement.dataset.motion;
  }, [reduce]);
  return null;
}
