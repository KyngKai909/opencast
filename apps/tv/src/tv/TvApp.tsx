// TV mode: one tree for the TV app (Android TV, Google TV, Fire TV, TV browsers), the Cast Web
// Receiver and the iPhone's external display. They differ only in their input (the remote's keys,
// Cast messages from phones, the bridge from the iPhone app), their router (the TV app has
// history; the receiver and mirror run in memory) and where they count as tuned in.

import { createContext, useContext, useEffect, useMemo, useRef, type MutableRefObject, type ReactNode } from "react";
import { BrowserRouter, MemoryRouter, Outlet, useLocation, useNavigate } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { audienceApi } from "@opencast/contracts";
import { PlayerProvider, PlayerSurface, startHeartbeat, startInputs, usePlayer, type Command, type CommandSource, type EngineOptions, type InputAdapter } from "@opencast/player";
import { GroundProvider, TvShell } from "@opencast/ui";
import { call, setAuthHandlers, setTokenSource } from "../api/client";
import { useAccountSettingsSync } from "../components/settings/useTvSettings";
import { hintsFor, keyHintsHidden, readFirstUse } from "../components/watching/hintRow";
import { useNotForMeFlag } from "../components/watching/notForMe";
import { now, MARKET_TZ } from "../lib/clock";
import { contextFor, dispatch, onPictureCommand, type Ui } from "./commands";
import { useChannels, usePresets } from "./data";
import { useAccountMotion } from "./motion";
import { getDevice, setDevice, useDevice } from "./device";
import { startFocus } from "./focus";
import { queryClient } from "./queryClient";
import { registerAgain } from "./registration";
import { noteSource } from "./remoteState";
import { signOutLocally } from "./session";
import "./tv.css";

export type TvMode = "tv" | "cast" | "mirror";

export interface TvAppProps {
  mode: TvMode;
  /** Builds the inputs, given where TV mode is (picture or overlay) for the remote's arrows. */
  inputs: (where: () => "picture" | "overlay") => InputAdapter[];
  routes: ReactNode;
  /** Extra wiring inside the player and router (the receiver's state to phones). */
  children?: ReactNode;
}

// The TV's tokens (registerTv's, and the code sign-in's session); read on every call, so signing
// in takes effect at once. The client picks one per endpoint.
setTokenSource(() => ({ device: getDevice().deviceToken, session: getDevice().token }));
setAuthHandlers({
  // The account signed this TV out from "Your TVs" while the relay wasn't listening.
  onSessionEnded: () => {
    if (getDevice().token) signOutLocally();
  },
  onDeviceUnknown: () => registerAgain()
});

/** The inputs in use, for the hint row ("▲▼ Channels…", "Playing from Kai's phone"). */
const InputsContext = createContext<InputAdapter[]>([]);
export function useInputs(): InputAdapter[] {
  return useContext(InputsContext);
}

/** Where TV mode is running: the TV app, a Cast receiver, or an iPhone's second screen. */
const ModeContext = createContext<TvMode>("tv");
export function useTvMode(): TvMode {
  return useContext(ModeContext);
}

export function TvApp({ mode, inputs, routes, children }: TvAppProps) {
  startFocus();
  const ui = useRef<Ui | null>(null);
  const path = useRef("/");
  // Built once: the keyboard reads where TV mode is through `path`.
  const adapters = useMemo(() => inputs(() => contextFor(path.current)), [inputs]);
  const settings = getDevice().settings;
  const options = useMemo<EngineOptions>(
    () => ({
      // Neighbours are pre-warmed by their playlists and first segment (no hidden <video>); on a
      // Chromecast only the playlists (memory).
      warm: mode === "cast" ? "playlists" : "prefetch",
      neighbours: { sameBand: !settings.includeRadioBand },
      bannerMs: settings.bannerSeconds * 1000,
      numberWaitMs: settings.numberWaitSeconds * 1000,
      quality: settings.quality,
      eveningOut: settings.eveningOut,
      tuningSound: { video: settings.tuningSound, radio: settings.radioTuningSound },
      now: () => now().getTime(),
      onCommand: (c: Command, s?: CommandSource) => {
        if (ui.current && engineRef.current) onPictureCommand(c, ui.current, engineRef.current, s);
      }
    }),
    // The starting values; later changes go through engine.setOptions (Wiring).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode]
  );
  const engineRef = useRef<import("@opencast/player").PlayerEngine | null>(null);
  const Router = mode === "tv" ? BrowserRouter : MemoryRouter;
  return (
    <QueryClientProvider client={queryClient}>
      <GroundProvider>
        <PlayerProvider options={options}>
          <Router>
            <ModeContext.Provider value={mode}>
              <InputsContext.Provider value={adapters}>
                <Wiring mode={mode} adapters={adapters} path={path} ui={ui} engineRef={engineRef} />
                {routes}
                {children}
              </InputsContext.Provider>
            </ModeContext.Provider>
          </Router>
        </PlayerProvider>
      </GroundProvider>
    </QueryClientProvider>
  );
}

/** Connects the router, the inputs and the player; keeps the dial, presets and captions current. */
function Wiring({ mode, adapters, path, ui, engineRef }: { mode: TvMode; adapters: InputAdapter[]; path: MutableRefObject<string>; ui: MutableRefObject<Ui | null>; engineRef: MutableRefObject<import("@opencast/player").PlayerEngine | null> }) {
  const [state, engine] = usePlayer();
  engineRef.current = engine;
  const navigate = useNavigate();
  const loc = useLocation();
  path.current = loc.pathname;
  const device = useDevice();
  const channels = useChannels();
  const { presets } = usePresets();
  // A signed-in TV picks up settings changed on the account (another TV, the phone) as it starts.
  useAccountSettingsSync();
  useAccountMotion();

  ui.current = {
    path: () => path.current,
    go: (to, o) => navigate(to, { replace: o?.replace }),
    close: () => {
      const p = path.current;
      if (p === "/") return;
      // The guide's options go back to the guide; settings and the market back to the menu they
      // opened from; everything else to the picture.
      const to = p.startsWith("/guide/") ? "/guide" : p.startsWith("/settings") || p === "/market" ? "/menu" : "/";
      navigate(to, { replace: true });
    }
  };

  // Inputs: every command goes through the one dispatcher.
  // "Channel up goes down the dial" (Remote and phones) flips the TV remote's channel keys (not a phone's rocker).
  useEffect(
    () =>
      startInputs(adapters, (c, s) => {
        if (!ui.current) return;
        noteSource(s);
        const flip = c.type === "channel" && s?.input === "remote" && getDevice().settings.channelUp === "down_the_dial";
        dispatch(flip ? { type: "channel", dir: c.dir === "up" ? "down" : "up" } : c, s, ui.current, engine);
      }),
    [engine, adapters, ui]
  );

  // Settings take effect at once.
  const { bannerSeconds, numberWaitSeconds, includeRadioBand, quality, eveningOut, tuningSound, radioTuningSound } = device.settings;
  useEffect(
    () => engine.setOptions({ bannerMs: bannerSeconds * 1000, numberWaitMs: numberWaitSeconds * 1000, neighbours: { sameBand: !includeRadioBand }, quality, eveningOut }),
    [engine, bannerSeconds, numberWaitSeconds, includeRadioBand, quality, eveningOut]
  );
  // "Tuning sound", per band: the soft hiss when changing channel (the player plays it).
  useEffect(() => engine.setOptions({ tuningSound: { video: tuningSound, radio: radioTuningSound } }), [engine, tuningSound, radioTuningSound]);

  useEffect(() => engine.setChannels(channels), [engine, channels]);
  useEffect(() => engine.setPresets(Object.fromEntries(presets.map((p) => [p.key, p.stationId]))), [engine, presets]);
  useEffect(() => engine.setCaptions(device.settings.captions, device.settings.captionSize), [engine, device.settings.captions, device.settings.captionSize]);
  useEffect(() => startHeartbeat(engine, (body) => call(audienceApi.heartbeat, { body }), mode === "cast" ? "cast" : mode === "mirror" ? "mirror" : "tv_app"), [engine, mode]);
  // The apps' switches ("Not for me" on the menu): read at start, then every few minutes.
  useNotForMeFlag();

  // First tune: the last channel on this TV, or the first station on the dial. Unless something
  // tuned first (a phone, or "/radio", which tunes its band's station: it's left to do that).
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !channels.length) return;
    if (state.currentId || state.pendingId) {
      started.current = true;
      return;
    }
    if (loc.pathname === "/radio") return;
    started.current = true;
    const last = getDevice().settings.startOn === "last_channel" ? channels.find((c) => c.station.id === getDevice().lastStationId) : null;
    void engine.tune((last ?? channels[0]).station.id, { input: "app" });
  }, [channels, engine, state.currentId, state.pendingId, loc.pathname]);
  useEffect(() => {
    if (state.currentId && state.currentId !== getDevice().lastStationId) setDevice({ lastStationId: state.currentId });
  }, [state.currentId]);
  // The dial changed under the picture (another market): what's on isn't on this dial, so tune
  // its first station, or stop when the new market has none.
  useEffect(() => {
    if (!started.current || !state.currentId || !channels.length) return;
    if (channels.some((c) => c.station.id === state.currentId)) return;
    const first = channels.find((c) => c.station.band === "tv") ?? channels[0];
    void engine.tune(first.station.id, { input: "app" });
  }, [channels, engine, state.currentId]);

  // First launch on the TV app: sign in on your phone, or watch without signing in.
  useEffect(() => {
    if (mode === "tv" && !getDevice().welcomed && path.current !== "/welcome") navigate("/welcome", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** The picture, full screen, with whatever overlay the route draws over it. */
export function TvLayout() {
  const loc = useLocation();
  const adapters = useInputs();
  // Re-render as the player changes: a new phone casting changes the chip.
  const [ps, engine] = usePlayer();
  // Captions move up above the banner and the presets strip (a two-line banner covers the bottom 44%).
  const lift = (!!ps.banner && !ps.entry && loc.pathname === "/") || loc.pathname === "/presets";
  useEffect(() => engine.setCaptionLift(lift ? 45 : null), [engine, lift]);
  const mode = useTvMode();
  // After a week on this TV the key hints hide; the casting and mirroring chips never do.
  const hidden = mode === "tv" && keyHintsHidden(readFirstUse(), now().getTime());
  // A remote on the picture holds OK to go back to live: the hint row and the chip say so.
  const remote = loc.pathname === "/" && adapters.some((a) => a.name === "remote");
  const hints = loc.pathname === "/" ? hintsFor(adapters.flatMap((a) => a.hints?.() ?? []), { hidden, behindLive: ps.behindLive, remote }) : [];
  // The guide shows the picture small in its window: the bug alone there, small, as tv 03.1 draws it.
  const graphics = loc.pathname.startsWith("/guide") ? "bug" : true;
  return (
    <TvShell picture={<PlayerSurface size="tv" timeZone={MARKET_TZ} clock={now} hints={hints} lastChannelHint={!hidden} holdOkHint={remote} overlays={graphics} />}>
      <Outlet />
    </TvShell>
  );
}
