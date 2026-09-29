// What "Watch on" and the remote need from the session: this phone's introduction (its name, the
// market, whether other phones may change the channel), the TVs to offer, and the one-time
// mirroring guide's "shown once" flag.

import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useMarketSlug, useMe } from "../data/viewer";
import { useSavedSettings } from "../layout/SettingsSync";
import { SIGNED_OUT_NAME, phoneName } from "./messages";
import { getMirroring, mirroringOffered } from "./mirroring";
import { castOffered, getSender } from "./sender";
import { orderTargets, uniqueTargets } from "./targets";
import type { CastTarget, SessionIntro } from "./types";

/** Whether "Watch on" has anything to offer in this build and browser (the cast button hides otherwise). */
export function watchOnOffered(): boolean {
  return castOffered() || mirroringOffered();
}

export function useCastIntro(): SessionIntro {
  const auth = useAuth();
  const me = useMe();
  const slug = useMarketSlug();
  const settings = useSavedSettings();
  return {
    from: auth.signedIn ? phoneName(me.data?.displayName) : SIGNED_OUT_NAME,
    marketSlug: slug,
    // "Anyone on the same network with the app can pick up the remote" (tv 06 note): on unless the account says otherwise.
    othersCanChange: settings?.tvs?.othersOnWifiCanChange ?? true
  };
}

/** Chromecasts the sender finds, and AirPlay TVs this phone has mirrored to. Loaded while the sheet is open. */
export async function findTargets(): Promise<CastTarget[]> {
  const [sender, mirroring] = await Promise.all([getSender(), getMirroring()]);
  const cast = sender ? await sender.targets().catch(() => []) : [];
  const airplay: CastTarget[] = (mirroring?.knownTvs() ?? []).map((name) => ({ id: `airplay:${name}`, name, kind: "airplay" }));
  // TVs with the Opencast app (tv_app) join here once the account's TV registry (B2) or Cast Connect says which TVs have it.
  return orderTargets(uniqueTargets([...cast, ...airplay]));
}

export function useWatchOnTargets(open: boolean): { targets: CastTarget[]; loading: boolean } {
  const [state, setState] = useState<{ targets: CastTarget[]; loading: boolean }>({ targets: [], loading: true });
  useEffect(() => {
    if (!open) return;
    let gone = false;
    setState((s) => ({ ...s, loading: true }));
    void findTargets().then((targets) => !gone && setState({ targets, loading: false }));
    return () => {
      gone = true;
    };
  }, [open]);
  return state;
}

// ---------- The one-time mirroring guide ----------

const GUIDE_KEY = "oc-mirror-guide-hidden";

export function mirrorGuideHidden(): boolean {
  try {
    return localStorage.getItem(GUIDE_KEY) === "1";
  } catch {
    return false;
  }
}

export function hideMirrorGuide() {
  try {
    localStorage.setItem(GUIDE_KEY, "1");
  } catch {
    // Private windows: it shows again next time.
  }
}
