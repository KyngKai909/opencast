// The phone and tablet home (A245): the app opens straight onto live TV, full screen. `/` picks the
// station (what's playing, else the last channel with "Start on: Last channel", else the start of
// the order) and becomes its `/watch/:stationRef`, so the URL follows the channel as it always has
// and links and Back keep working. First visit, the market picker opens over the empty screen.
// While this phone is a remote for a TV (casting or mirroring), Watch is the remote as designed.

import { useEffect, type ReactNode } from "react";
import { Navigate, useNavigate } from "react-router";
import { usePlayer } from "@opencast/player";
import { useAuth } from "../../../auth/AuthProvider";
import { useChannels, useMarketSlug, usePresets, useWatchHistory } from "../../data/viewer";
import { useDevice } from "../../device/store";
import { useSavedSettings } from "../../layout/SettingsSync";
import { useCastSession } from "../../cast/session";
import { stationSlug } from "../watch/logic";
import type { WatchData } from "../watch/useWatch";
import { startStation } from "./rules";
import { useSwipeOrders } from "./useSwipeOrder";
import { SwipeScreen } from "./SwipeScreen";
import { useSwipeForm, useSwipeShell } from "./form";
import "./swipe.css";

/** "Muted previews" (Watching settings, on unless turned off): the home opens muted until the first tap. */
export function useMutedPreviews(): boolean {
  return useSavedSettings()?.watching?.mutedPreviews !== false;
}

/**
 * Opening the app on the home with nothing playing yet: with Muted previews on, the picture plays
 * muted with "Tap for sound" until the first tap (swipe home 08, "Sound"). Call before the tune.
 */
export function useOpeningSound() {
  const [, engine] = usePlayer();
  const muted = useMutedPreviews();
  useEffect(() => {
    const st = engine.getState();
    if (muted && st.status === "idle" && !st.currentId && !st.pendingId) engine.holdSound();
    // Once, as the home opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Which station the home opens on, once what it depends on has loaded (undefined until then). */
function useStartChoice(): string | null | undefined {
  const auth = useAuth();
  const settings = useSavedSettings();
  const history = useWatchHistory();
  const device = useDevice();
  const channels = useChannels();
  const presets = usePresets();
  const orders = useSwipeOrders();
  const [s] = usePlayer();
  if (!auth.ready || !settings) return undefined;
  if (auth.signedIn && (history.isLoading || presets.loading)) return undefined;
  if (!channels.length) return undefined;
  return startStation({
    playingId: s.pendingId ?? s.currentId,
    startOn: settings.watching?.startOn,
    lastId: history.data?.lastChannel?.station.id ?? device.lastStationId,
    tv: orders.tv.rows.map((r) => r.station.id),
    radio: orders.radio.rows.map((r) => r.station.id)
  });
}

/** `/` on a phone or tablet. */
export function SwipeStart() {
  const form = useSwipeForm();
  useSwipeShell(form);
  useOpeningSound();
  const slug = useMarketSlug();
  const choice = useStartChoice();
  const channels = useChannels();
  const navigate = useNavigate();
  useEffect(() => {
    if (!choice) return;
    const row = channels.find((c) => c.station.id === choice);
    if (row) navigate(`/watch/${stationSlug(row.station)}${window.location.search}`, { replace: true });
  }, [choice, channels, navigate]);
  return (
    <div className={`vw-sw vw-sw--empty vw-sw--${form.device}`} aria-busy={!!slug && choice === undefined}>
      {slug && choice === null && <p className="vw-sw__wait">No stations on the dial here yet.</p>}
    </div>
  );
}

/** `/watch/:stationRef` on a phone or tablet: the swipe home on that station. */
export function SwipeWatch({ w, fallback }: { w: WatchData; fallback?: ReactNode }) {
  const form = useSwipeForm();
  const cast = useCastSession();
  if (cast.status === "casting" || cast.status === "mirroring") return <Navigate to="/remote" replace />;
  if (fallback) return <>{fallback}</>;
  return <SwipeScreen w={w} form={form} />;
}
