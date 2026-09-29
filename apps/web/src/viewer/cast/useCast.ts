// What "Watch on" and the remote need from the session: this phone's introduction (its name, the
// market, whether other phones may change the channel), the TVs to offer (the account's TV apps,
// TVs paired by code, Chromecasts, AirPlay TVs), and the one-time mirroring guide's "shown once" flag.

import { useEffect, useMemo, useState } from "react";
import { tvApi, type Tv } from "@opencast/contracts";
import { useApi } from "../../api/hooks";
import { useAuth } from "../../auth/AuthProvider";
import { useMarketSlug, useMe } from "../data/viewer";
import { useSavedSettings } from "../layout/SettingsSync";
import { config } from "../../config";
import type { MirrorConfig } from "../native/plugins";
import { SIGNED_OUT_NAME, mirrorDeviceName, phoneName } from "./messages";
import { getMirroring } from "./mirroring";
import { loadPairings } from "./pairings";
import { getSender } from "./sender";
import { orderTargets, pairedTargets, tvAppTargets, uniqueTargets } from "./targets";
import type { CastTarget, SessionIntro } from "./types";

/**
 * Whether "Watch on" has anything to offer in this build and browser (the cast button hides
 * otherwise). The relay to the Opencast TV app works from any browser, and a code from the TV pairs
 * a phone that isn't signed in, so it always has.
 */
export function watchOnOffered(): boolean {
  return true;
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

/**
 * What the iPhone's external display loads TV mode with: "Kai's iPhone" for its chip, the market,
 * the station on the phone now, and where TV mode comes from (the app's own copy, or VITE_TV_URL).
 */
export function mirrorConfig(o: { signedIn: boolean; displayName: string | null | undefined; marketSlug: string | null; stationId: string | null }): MirrorConfig {
  return {
    device: o.signedIn ? mirrorDeviceName(o.displayName) : null,
    marketSlug: o.marketSlug,
    stationId: o.stationId,
    tvUrl: config.mirrorTv === "url" ? `${config.tvUrl}/` : null
  };
}

/** Chromecasts the sender finds, and AirPlay TVs this phone has mirrored to. */
async function discover(): Promise<CastTarget[]> {
  const [sender, mirroring] = await Promise.all([getSender(), getMirroring()]);
  const cast = sender ? await sender.targets().catch(() => []) : [];
  const airplay: CastTarget[] = (mirroring?.knownTvs() ?? []).map((name) => ({ id: `airplay:${name}`, name, kind: "airplay" }));
  return [...cast, ...airplay];
}

/** Every row "Watch on" offers: the account's TV apps (listTvs), TVs paired by code, then what the senders find; in order. */
export function combineTargets(accountTvs: readonly Tv[], found: CastTarget[], pairings = loadPairings()): CastTarget[] {
  return orderTargets(uniqueTargets([...tvAppTargets(accountTvs), ...pairedTargets(pairings), ...found]));
}

/** The TVs to offer now, given the account's TVs if they're known. */
export async function findTargets(accountTvs: readonly Tv[] = []): Promise<CastTarget[]> {
  return combineTargets(accountTvs, await discover());
}

/** Loaded while the sheet is open. `refresh` asks the account again (whether a TV app is on now). */
export function useWatchOnTargets(open: boolean): { targets: CastTarget[]; loading: boolean; refresh: () => Promise<CastTarget[]> } {
  const auth = useAuth();
  const account = useApi(tvApi.listTvs, {}, { enabled: open && auth.signedIn, refetchOnMount: "always" });
  const [found, setFound] = useState<{ targets: CastTarget[]; loading: boolean }>({ targets: [], loading: true });
  useEffect(() => {
    if (!open) return;
    let gone = false;
    setFound((s) => ({ ...s, loading: true }));
    void discover().then((targets) => !gone && setFound({ targets, loading: false }));
    return () => {
      gone = true;
    };
  }, [open]);
  const tvs = auth.signedIn ? account.data : undefined;
  const targets = useMemo(() => combineTargets(tvs ?? [], found.targets), [tvs, found.targets]);
  const refresh = async () => {
    const r = auth.signedIn ? await account.refetch() : null;
    return combineTargets(r?.data ?? [], found.targets);
  };
  return { targets, loading: found.loading || (auth.signedIn && account.isLoading), refresh };
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
