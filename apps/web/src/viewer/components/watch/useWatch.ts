// The tuned-in page's data and behaviour, shared by the web and phone layouts: which station the
// URL names, tuning to it, keeping the URL in step with the channel, the arrow keys, and the
// station's night.

import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router";
import { libraryApi, stationsApi } from "@opencast/contracts";
import { usePlayer } from "@opencast/player";
import { StationPageX, type DialRowX } from "../../api/ext";
import { useChannels, useDial, useMarketSlug } from "../../data/viewer";
import { useNowPlaying, useTune } from "../../player/PlayerRoot";
import { useApiAs } from "./overlay";
import { backAtOf, isOffAir, resolveStation, rowFromPage, stationSlug, tuneForUrl, urlForChannel, watchKey, withOutsideStation } from "./logic";

export function useWatch(stationRef: string | undefined) {
  const [s, engine] = usePlayer();
  const channels = useChannels();
  const slug = useMarketSlug();
  const tvDial = useDial("tv");
  const radioDial = useDial("radio");
  const dialReady = !!slug && tvDial.isSuccess && radioDial.isSuccess;
  const tune = useTune();
  const navigate = useNavigate();
  const np = useNowPlaying();

  const engineChannels = s.channels as DialRowX[];
  // The URL's station on the market's dial, or read on its own (a nearby market's, from a thin dial).
  const inDial = resolveStation(channels, stationRef);
  const ref = inDial ? stationSlug(inDial.station) : stationRef ?? "";
  const page = useApiAs("watch", stationsApi.getStation, { params: { stationRef: ref } }, StationPageX, !!ref);
  const outside = useMemo(() => (dialReady && !inDial && page.data ? rowFromPage(page.data) : null), [dialReady, inDial, page.data]);

  // A station from outside the dial joins the player's dial while you're on it, so it can be
  // tuned (and stays when the market's dial refreshes over it).
  useEffect(() => {
    if (!outside) return;
    const next = withOutsideStation(engine.getState().channels as DialRowX[], outside);
    if (next) engine.setChannels(next);
  }, [outside, s.channels, engine]);
  useEffect(() => {
    if (!outside) return;
    return () => {
      // Leaving: it goes again, unless it's what's playing.
      const st = engine.getState();
      if (st.currentId !== outside.station.id && st.pendingId !== outside.station.id) engine.setChannels(st.channels.filter((c) => c.station.id !== outside.station.id));
    };
  }, [outside, engine]);

  // Resolved against the player's own dial, so a tune always finds its station.
  const target = resolveStation(engineChannels, stationRef);
  const playingId = s.pendingId ?? s.currentId;
  const playingNow = () => {
    const st = engine.getState();
    return st.pendingId ?? st.currentId;
  };

  // The URL names a station: tune to it, unless it's already on.
  const lastSynced = useRef<string | null>(null);
  useEffect(() => {
    if (!target) return;
    const id = tuneForUrl(target.station.id, playingNow());
    lastSynced.current = target.station.id;
    if (id) void tune(id);
    // Only when the URL changes (or the dial first arrives), not on every channel change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.station.id]);

  // The channel changed here (arrow keys, the buttons, a swipe, a preset key): the URL follows.
  useEffect(() => {
    // The player's state as it is now: a tune started by the effect above has already moved it.
    const id = urlForChannel(playingNow(), lastSynced.current);
    if (!id) return;
    const row = engineChannels.find((c) => c.station.id === id);
    if (!row) return;
    lastSynced.current = id;
    navigate(`/watch/${stationSlug(row.station)}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingId, engineChannels, navigate]);

  // Arrow keys change channel on this page, and only here; the space bar (or k) pauses and resumes;
  // l (or End) goes back to live (watchKey).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmd = watchKey(e);
      if (!cmd) return;
      e.preventDefault();
      engine.handle(cmd, { input: "keyboard" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine]);

  // The page shows the station the URL names; the URL follows the channel.
  const shown = target ?? inDial ?? outside;
  // Off air, planned (the dial's `off_air` airing) or by the stream (its sign-off), shows as off air
  // with when it's back, not as the dial's program.
  const listed = shown?.now ?? page.data?.now ?? null;
  const offByPlayer = !!shown && s.currentId === shown.station.id && s.status === "off_air";
  const offAir = offByPlayer || isOffAir(listed) || (!!shown && !shown.onAir && !listed);
  const now = offAir ? null : listed;
  const backAt = offAir ? backAtOf(shown, s.offAir, shown?.station.id) : null;
  const programId = now?.programId ?? null;
  const program = useApiAs("watch", libraryApi.getProgram, { params: { programId: programId ?? "" } }, libraryApi.getProgram.response, !!programId);

  return useMemo(
    () => ({
      state: s,
      engine,
      /** The player's dial: the market's, and a station from outside it while you're on it. */
      channels: engineChannels,
      /** The dial has loaded, the URL's station isn't on it, and it can't be found at all. */
      notOnDial: dialReady && !inDial && page.isError,
      row: shown ?? null,
      now,
      /** Off air: when the station is back (the stream's sign-off, the dial's back time, or its next airing). */
      backAt,
      page,
      program,
      playing: np.playing
    }),
    [s, engine, engineChannels, dialReady, inDial, shown, now, backAt, page, program, np.playing]
  );
}

export type WatchData = ReturnType<typeof useWatch>;
