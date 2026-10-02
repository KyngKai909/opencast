// The account's "Reduce motion" (Settings, Appearance, on the web or phone) on the TV too, as on
// the web: data-motion="reduce" on <html>, so the channel change crossfades instead of showing
// static and the TV's own animations stop. The TV's system setting still counts on its own.

import { useEffect } from "react";
import { useMe } from "./data";

export function useAccountMotion() {
  const reduce = useMe().data?.settings?.appearance?.reducedMotion ?? false;
  useEffect(() => {
    if (reduce) document.documentElement.dataset.motion = "reduce";
    else delete document.documentElement.dataset.motion;
  }, [reduce]);
}
